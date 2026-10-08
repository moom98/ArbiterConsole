import type { IncidentCategory, PlayerColor } from "@/lib/domain/entities";
import type { IncidentClassification } from "./types";

/**
 * 端末内のキーワードによる Incident 分類（オフライン・LLM 失敗時のフォールバック）。
 * 決定的な純粋関数。結果は**提案のみ**に使い、判断には使用しない。
 */

interface KeywordRule {
  category: IncidentCategory;
  /** 一致した場合に提案する subtype（isKnownSubtype で有効なもののみ） */
  subtype?: string;
  patterns: RegExp[];
  /** 同点の場合の優先度（大きいほど優先） */
  weight: number;
}

// subtype 付きの具体的な規則を先に、一般的な規則を後に置く（同点時は weight で決める）
const RULES: KeywordRule[] = [
  {
    category: "clock-time",
    subtype: "flag-fall",
    patterns: [
      /フラッグ|フラグ|flag/i,
      /時間切れ|時間が(落ち|なくな|切れ)|持ち時間.{0,4}(0|ゼロ)|0[:：.]00/,
    ],
    weight: 3,
  },
  {
    category: "draw",
    subtype: "threefold-repetition-claim",
    patterns: [/(三|3)回.{0,4}(同一|同じ)局面|threefold/i],
    weight: 3,
  },
  {
    category: "draw",
    subtype: "fifty-move-claim",
    // 「150手」「50手目（手数）」を除く
    patterns: [
      /(?<![0-9０-９])50\s*手(?!目)|fifty[- ]move|(?<![0-9])50[- ]move/i,
    ],
    weight: 3,
  },
  {
    category: "draw",
    subtype: "fivefold-repetition",
    patterns: [/(五|5)回.{0,4}(同一|同じ)局面|fivefold/i],
    weight: 3,
  },
  {
    category: "draw",
    subtype: "75-move-rule",
    patterns: [/75\s*手|75[- ]move/i],
    weight: 3,
  },
  {
    // 触れた駒の規則（Article 4）。7.5 の違法手とは別の決定木（DT-007）
    category: "illegal-move",
    subtype: "touch-move",
    patterns: [
      /タッチ\s*(アンド|&|＆)?\s*ムーブ|touch[\s-]*(and[\s-]*)?move|j.?adoube/i,
    ],
    weight: 3,
  },
  {
    // 「触れた駒」だけでは弱い（違法手の代わりの手にも触れた駒の規則が適用される: JCF p.47）
    category: "illegal-move",
    subtype: "touch-move",
    patterns: [/(触れた|触った)駒/],
    weight: 1,
  },
  {
    category: "illegal-move",
    patterns: [
      /違法手|反則手|イリーガル|illegal/i,
      /両手/,
      /手を指さずに時計|指さずに.{0,4}時計/,
      /キングを?チェック(に|のまま)/,
    ],
    weight: 2,
  },
  {
    category: "fair-play",
    patterns: [
      // 「不正確」「不正解」「不正な手（違法手）」等の日常語は除く
      /不正(?!確|解|常|規|な(?:手|指し手|着手|駒|位置|操作))|カンニング|チート|\bcheat/i,
      /(身体|ボディ|バッグ|所持品)?検査.{0,3}(拒|断)|金属探知/,
      /外部.{0,4}(情報|助言|援助)|エンジン.{0,4}(使|利用)/,
      /\b(engine|computer|electronic)\s*(assist\w*|help\w*|aid|advice|use[ds]?)\b|\b(outside|external)\s*(assist\w*|help\w*|aid|advice)\b|\bfair[\s-]*play\b|suspicio\w*\s+of\s+(cheat|engine)|body\s*search|metal\s*detector/i,
    ],
    weight: 2,
  },
  {
    category: "player-behavior",
    patterns: [
      /スマート\s*ウォッチ|スマホ|スマートフォン|携帯|電話|電子機器|イヤホン|smart\s*watch|phone|device/i,
      /離席|席を(離|外)|会場(を|の外)|対局(エリア|場)(を|から)(出|離)/,
      /話しかけ|会話|おしゃべり|騒音|うるさ|大声|騒/,
      /喫煙|たばこ|タバコ/,
      /妨害|邪魔|ドロー.{0,4}(提案|オファー).{0,6}(何度|繰り返|しつこ)/,
      /バッグ|鞄|かばん|メモ/,
    ],
    weight: 1,
  },
  {
    category: "team",
    patterns: [/キャプテン|captain|団体戦|チーム|ボード順|board order/i],
    weight: 2,
  },
  {
    category: "scoresheet",
    patterns: [
      /棋譜|記録用紙|スコアシート|scoresheet|記入|記録(して|せず|しない)/i,
    ],
    weight: 1,
  },
  {
    category: "board-piece",
    patterns: [
      /駒.{0,6}(落|倒|ずれ|配置|置き間違|並べ間違)|盤.{0,4}(向き|置き方|間違)/,
      /初期配置|ディスプレイス|displace/i,
    ],
    weight: 1,
  },
  {
    category: "game-result",
    patterns: [/投了|結果.{0,6}(違|誤|異議|争)|署名|サイン|resign/i],
    weight: 1,
  },
  {
    category: "draw",
    patterns: [/ドロー|引き分け|ステイルメイト|stalemate|50\s*手|draw/i],
    weight: 1,
  },
  {
    category: "clock-time",
    subtype: "other",
    patterns: [/時計|クロック|clock|押し忘れ/i],
    weight: 1,
  },
  {
    category: "tournament-admin",
    patterns: [/ペアリング|遅刻|遅れて(到着|来)|不戦|棄権|bye|default|欠席/i],
    weight: 1,
  },
];

/** 大会固有規則を優先して確認すべきカテゴリ（要件 §21, §22, §23） */
const TOURNAMENT_RULE_CATEGORIES: readonly IncidentCategory[] = [
  "player-behavior",
  "team",
  "fair-play",
  "tournament-admin",
];

export function needsTournamentRules(category: IncidentCategory): boolean {
  return TOURNAMENT_RULE_CATEGORIES.includes(category);
}

/** テキストから対象プレーヤーの色を推定する（両方の色が出る場合は推定しない） */
export function detectPlayerColor(text: string): PlayerColor | undefined {
  const white = /白|white/i.test(text);
  const black = /黒|black/i.test(text);
  if (white && !black) return "white";
  if (black && !white) return "black";
  return undefined;
}

/**
 * フェアプレー（不正の疑い・申告）に触れている記述か（最高得点のカテゴリかどうかに関係なく）。
 * true の記述は外部の LLM に送信しない（要件 §23, ADR-007）。
 */
export function mentionsFairPlay(text: string): boolean {
  const input = text.normalize("NFKC");
  return RULES.some(
    (rule) =>
      rule.category === "fair-play" && rule.patterns.some((p) => p.test(input))
  );
}

/**
 * キーワードで分類する。該当なしの場合は null。
 * 一致したパターン数 × weight が最大の規則を選ぶ（同点は RULES の順）。
 */
export function classifyByKeywords(
  text: string
): IncidentClassification | null {
  const input = text.normalize("NFKC");
  let best: { rule: KeywordRule; score: number } | null = null;
  for (const rule of RULES) {
    const hits = rule.patterns.filter((p) => p.test(input)).length;
    if (hits === 0) continue;
    const score = hits * rule.weight;
    if (!best || score > best.score) best = { rule, score };
  }
  if (!best) return null;
  return {
    category: best.rule.category,
    subtype: best.rule.subtype,
    playerColor: detectPlayerColor(input),
    missingInformation: [],
    followUpQuestions: [],
    needsTournamentRules: needsTournamentRules(best.rule.category),
    confidence: "low",
    method: "keyword",
  };
}
