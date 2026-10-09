import type { IncidentCategory, PlayerColor } from "@/lib/domain/entities";
import { isKnownSubtype } from "@/lib/domain/follow-up";
import { needsTournamentRules } from "./keyword-classifier";
import { findJevCalibration, type JevCalibration } from "./calibration";
import type { IncidentClassification } from "./types";

export const INCIDENT_CATEGORIES: readonly IncidentCategory[] = [
  "illegal-move",
  "board-piece",
  "clock-time",
  "game-result",
  "draw",
  "scoresheet",
  "player-behavior",
  "team",
  "fair-play",
  "tournament-admin",
];

/**
 * カテゴリの説明（Gemini の分類プロンプトと Jev の choice の criteria で共有する。
 * jev-classifier-design §5.1）。文言を変えると Gemini のプロンプトも変わる
 */
export const INCIDENT_CATEGORY_DESCRIPTIONS: Readonly<
  Record<IncidentCategory, string>
> = {
  "illegal-move":
    "違法手（両手で指した、手を指さずに時計を押した、昇格の駒を置かずに時計を押した等）",
  "board-piece": "盤・駒（駒の落下・ずれ、初期配置の誤り等）",
  "clock-time": "時計・時間（フラッグ・時間切れ、時計の故障、押し忘れ等）",
  "game-result": "対局結果（結果の争い、記録・署名の誤り等）",
  draw: "ドロー（同一局面、50手・75手、ステイルメイト、合意等）",
  scoresheet: "棋譜・記録用紙",
  "player-behavior":
    "選手の行動・電子機器（スマートフォン、スマートウォッチ、離席、会話、騒音、喫煙、妨害等）",
  team: "団体戦（キャプテン、ボード順等）",
  "fair-play": "フェアプレー（不正の疑い、検査拒否等）",
  "tournament-admin": "大会運営（遅刻、不戦、ペアリング等）",
};

const MAX_ITEMS = 5;
const MAX_TEXT = 200;

function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= MAX_TEXT)
    .slice(0, MAX_ITEMS);
}

/** 確率の合計の許容誤差（Jev は小数第2位に丸めて返す。jev-classifier-design §5.4） */
export const PROBABILITY_SUM_TOLERANCE = 0.02;
/** 確率が低い・プレフィルしない場合に示す他の候補の数（category と合わせて上位3件） */
const ALTERNATIVE_COUNT = 2;

export interface ParseClassificationOptions {
  /** 応答の model（Jev は解決済みのバージョン）。較正の検索に使う */
  model?: string;
  /** 既定は登録済みの較正（JEV_CALIBRATIONS）。テストで差し替える */
  calibrations?: readonly JevCalibration[];
}

/**
 * LLM の分類出力を検証・正規化する（純粋関数）。不正な場合は null（キーワード分類へ）。
 *
 * - 確率の形（categoryProbabilities がある。Jev）は parseProbabilisticClassification
 * - それ以外は従来の Gemini の形:
 *   - category は 10 分類のいずれか
 *   - subtype は既知のもの（isKnownSubtype）のみ残す
 *   - confidence は最大 medium（"high" は medium に制限）
 */
export function parseLlmClassification(
  raw: unknown,
  options: ParseClassificationOptions = {}
): IncidentClassification | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const r = raw as Record<string, unknown>;
  if ("categoryProbabilities" in r)
    return parseProbabilisticClassification(r, options);
  const category = r.category;
  if (!isCategory(category)) return null;
  const cat = category;
  const subtype =
    typeof r.subtype === "string" && isKnownSubtype(cat, r.subtype)
      ? r.subtype
      : undefined;
  const playerColor =
    r.playerColor === "white" || r.playerColor === "black"
      ? (r.playerColor as PlayerColor)
      : undefined;
  return {
    category: cat,
    subtype,
    playerColor,
    missingInformation: strings(r.missingInformation),
    followUpQuestions: strings(r.followUpQuestions),
    needsTournamentRules:
      typeof r.needsTournamentRules === "boolean"
        ? r.needsTournamentRules || needsTournamentRules(cat)
        : needsTournamentRules(cat),
    confidence: r.confidence === "low" ? "low" : "medium",
    method: "llm",
    provider: "gemini",
  };
}

function isCategory(v: unknown): v is IncidentCategory {
  return (
    typeof v === "string" &&
    (INCIDENT_CATEGORIES as readonly string[]).includes(v)
  );
}

const isProbability = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** null・未指定は「ない」。それ以外は [0, 1] の有限の数でなければ不正（undefined ではなく false） */
function optionalProbability(v: unknown): number | null | false {
  if (v === undefined || v === null) return null;
  return isProbability(v) ? v : false;
}

/**
 * 確率の形（Jev。jev-classifier-design §5.3, §5.4）。しきい値は較正データから取り、
 * 較正がない model は未較正モード（low・プレフィルなし・上位3件を候補に）。
 *
 * 次の場合は null（不正な出力）:
 * - provider が "jev" でない
 * - categoryProbabilities が 10 カテゴリすべてを含まない、未知のキーがある、
 *   値が [0, 1] の有限の数でない、合計が 1 ± 0.02 でない
 * - category がない、または確率の最大値のカテゴリでない（サーバーの category は信用しない）
 * - subtypeProbability・needsTournamentRulesProbability が不正な数
 */
function parseProbabilisticClassification(
  r: Record<string, unknown>,
  options: ParseClassificationOptions
): IncidentClassification | null {
  if (r.provider !== "jev") return null;
  const probs = r.categoryProbabilities;
  if (typeof probs !== "object" || probs === null || Array.isArray(probs))
    return null;
  const entries = Object.entries(probs as Record<string, unknown>);
  if (entries.length !== INCIDENT_CATEGORIES.length) return null;
  const p = new Map<IncidentCategory, number>();
  for (const [key, value] of entries) {
    if (!isCategory(key) || !isProbability(value)) return null;
    p.set(key, value);
  }
  if (p.size !== INCIDENT_CATEGORIES.length) return null;
  const sum = Array.from(p.values()).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) return null;

  // ドメインが argmax を求め直す。同率の最大値なら category のとおりでよい
  if (!isCategory(r.category)) return null;
  const category = r.category;
  const top = Math.max(...Array.from(p.values()));
  const probability = p.get(category) as number;
  if (probability !== top) return null;

  const subtypeProbability = optionalProbability(r.subtypeProbability);
  const rulesProbability = optionalProbability(
    r.needsTournamentRulesProbability
  );
  if (subtypeProbability === false || rulesProbability === false) return null;

  const calibration = findJevCalibration(options.model, options.calibrations);
  const medium =
    calibration !== undefined && probability >= calibration.category.medium;
  const prefill =
    calibration !== undefined && probability >= calibration.category.prefill;

  // 確率の高い順（同率はカテゴリの定義順）。category 自身は除く
  const alternatives =
    medium && prefill
      ? undefined
      : INCIDENT_CATEGORIES.filter((c) => c !== category)
          .map((c, i) => ({ c, i, p: p.get(c) as number }))
          .sort((a, b) => b.p - a.p || a.i - b.i)
          .slice(0, ALTERNATIVE_COUNT)
          .map((x) => x.c);

  const subtype =
    typeof r.subtype === "string" &&
    isKnownSubtype(category, r.subtype) &&
    calibration?.subtype !== undefined &&
    subtypeProbability !== null &&
    subtypeProbability >= calibration.subtype
      ? r.subtype
      : undefined;

  // ドメインの規則は旗を立てるだけ（外すことはない）
  const rulesByModel =
    calibration?.needsTournamentRules !== undefined &&
    rulesProbability !== null &&
    rulesProbability >= calibration.needsTournamentRules;

  return {
    category,
    subtype,
    missingInformation: [],
    followUpQuestions: [],
    needsTournamentRules: rulesByModel || needsTournamentRules(category),
    confidence: medium ? "medium" : "low",
    method: "llm",
    provider: "jev",
    probability,
    ...(alternatives ? { alternatives } : {}),
    prefill,
  };
}
