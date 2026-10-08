import type {
  CompetitionType,
  DrawClaimFacts,
  HistoryConfirmation,
  SupervisionRegime,
  TournamentOverrides,
} from "@/lib/domain/entities";
import { cite, type CitationKey } from "@/lib/domain/rules/citations";
import {
  SEVENTY_FIVE_MOVES_PLIES,
  type RepetitionAnalysis,
} from "@/lib/domain/services/position-analysis";
import type { DecisionTreeResult } from "./dt-001-illegal-move-standard";
import { COLOR_JA, type TreeOutput } from "./tree-support";

/**
 * DT-005 Draw Claim と DT-006 Automatic Draw が共有する入力と補助（ADR-014 §1 / §4）。
 */
export interface DrawTreeInput extends DrawClaimFacts {
  competitionType: CompetitionType;
  supervisionRegime?: SupervisionRegime;
  /** 大会規定による明示的な上書き（Blitz B.2 の加算時間のみ参照。ADR-006） */
  tournamentOverrides?: TournamentOverrides;
  /**
   * positionsText をシステムが解析した結果（DecisionEngine が ChessPositionPort で算出）。
   * 解析できなかった場合は error。
   */
  analysis?:
    { ok: true; result: RepetitionAnalysis } | { ok: false; error: string };
}

export type CheckOutcome = "met" | "met-checkmate" | "not-met" | "unknown";

/**
 * 確認結果（盤上での手動再現 or 対局履歴による自動判定）の解決結果。
 * - outcome: 確定した確認結果（auto は自動判定に使った解析結果）
 * - error:   自動判定を使えない（理由を示して手動の確認を求める）
 * - confirm: 再生した最終局面を盤上と照合してもらう（ADR-014 §4）
 * - result:  照合後の検査（afterConfirmed）が判断を返した
 * - null:    確認方法が未回答
 */
export type CheckResolution =
  | { outcome: CheckOutcome; auto?: RepetitionAnalysis }
  | { error: string }
  | { confirm: RepetitionAnalysis }
  | { result: DecisionTreeResult }
  | null;

export interface ResolveCheckOptions {
  /**
   * 自動判定の結果。complete は「初期配置からの履歴で、局面と手数の両方を照合済み」。
   * complete でない場合に「不成立」は確定できないため "inconclusive" を返す。
   */
  autoOutcome: (
    r: RepetitionAnalysis,
    complete: boolean
  ) => "met" | "met-checkmate" | "not-met" | "inconclusive";
  /** 照合の前に、自動判定の前提を検証する（不整合ならエラー文を返す） */
  validate?: (r: RepetitionAnalysis) => string | undefined;
  /** 照合済みの履歴に対する検査（例: 履歴から求めた手番）。判断を返すとそれを使う */
  afterConfirmed?: (r: RepetitionAnalysis) => DecisionTreeResult | undefined;
}

/**
 * 確認結果を解決する。自動判定では、初期配置からの履歴で、かつ局面と手数の両方が
 * 一致した場合だけ「不成立」を確定できる。途中からの履歴や手数を確認できない場合は、
 * 盤上での手動再現に回す（ADR-014 §4）。
 */
export function resolveCheck(
  input: Partial<DrawTreeInput>,
  opts: ResolveCheckOptions
): CheckResolution {
  const check = input.conditionCheck;
  if (check === undefined) return null;
  if (check !== "auto") return { outcome: check };
  const { analysis } = input;
  if (!input.positionsText)
    return {
      error: "「判定する」を選んだ場合は、棋譜（PGN）を入力してください。",
    };
  if (!analysis) return { error: "局面の自動判定は利用できません。" };
  if (!analysis.ok)
    return {
      error: `棋譜を検証できません: ${analysis.error}\n棋譜を直すか、盤上で手順を再現して確認してください。`,
    };
  const invalid = opts.validate?.(analysis.result);
  if (invalid) return { error: invalid };
  const confirmed = input.historyConfirmed;
  if (confirmed === undefined) return { confirm: analysis.result };
  if (confirmed === "mismatch" || confirmed === "unknown")
    return {
      error:
        "棋譜を再生した局面が盤上と照合できないため、自動判定は使いません。盤上で手順を再現して確認し、結果を選んでください。",
    };
  const early = opts.afterConfirmed?.(analysis.result);
  if (early) return { result: early };
  const complete = analysis.result.complete && confirmed === "match";
  const outcome = opts.autoOutcome(analysis.result, complete);
  if (outcome === "inconclusive")
    return {
      error: analysis.result.complete
        ? "手数を確認できない棋譜では、開始より前の手順が欠けている可能性があるため「不成立」を自動では確定できません。盤上で手順を再現して確認してください。"
        : "途中の局面から始まる棋譜では、開始局面より前の局面が分からないため「不成立」を自動では確定できません。盤上で手順を再現して確認してください。",
    };
  return { outcome, auto: analysis.result };
}

/** 照合済みの対局履歴がある場合の解析結果（手番を履歴から求めるときに使う） */
export function confirmedHistory(
  input: Partial<DrawTreeInput>
): RepetitionAnalysis | undefined {
  const { analysis, historyConfirmed } = input;
  if (input.conditionCheck !== "auto" || !input.positionsText) return undefined;
  if (!analysis?.ok) return undefined;
  if (historyConfirmed !== "match" && historyConfirmed !== "position-only")
    return undefined;
  return analysis.result;
}

/** 再生した最終局面を盤上と照合してもらう案内（ADR-014 §4） */
export function confirmText(a: RepetitionAnalysis): string {
  const h = a.history;
  const from = h.complete ? "初期配置から" : "途中の局面（[FEN]）から";
  const side = COLOR_JA[h.sideToMove];
  return [
    h.lastMove
      ? `棋譜を再生しました: ${h.lastMove} まで（${from}${h.plies}半手）。最終局面は${h.fullmoveNumber}手目の${side}の手番です。`
      : `棋譜を再生しました: 指し手はありません（${from}）。最終局面は${h.fullmoveNumber}手目の${side}の手番です。`,
    `FEN: ${h.finalFen}`,
    "盤上の局面とスコアシートの手数を照合してください。",
  ].join("\n");
}

/** 自動判定に使った解析結果の説明（判断の actions に入れる） */
export function autoLine(
  a: RepetitionAnalysis | undefined,
  confirmed: HistoryConfirmation | undefined
): string[] {
  if (!a) return [];
  const checked =
    confirmed === "match" ? "盤上と照合済み" : "局面のみ照合（手数は未確認）";
  return [
    `自動判定: 棋譜（${a.complete ? "初期配置から" : "途中の局面から"}${a.history.plies}半手）を再生し、${checked}。対象局面の出現 ${a.targetOccurrences}回 / 最大 ${a.maxOccurrences}回 / ポーン移動・駒取りなし 対象局面 ${a.halfmoveClock}半手・最大 ${a.maxHalfmoveClock}半手`,
    "自動判定は入力に依存する。両プレーヤーの面前で対局を再現して確認する",
  ];
}

/**
 * クレームの自動判定で、9.6 の自動ドローの条件（五回同一局面・75手）にも達していた場合の注記。
 * その時点でドローになっている可能性があるため CA へ確認する。
 */
export function automaticDrawNotes(
  a: RepetitionAnalysis | undefined
): string[] {
  if (!a) return [];
  const notes: string[] = [];
  if (a.maxOccurrences >= 5)
    notes.push(
      "入力上、同じ局面が5回以上出現している。9.6.1 によりその時点でドローとなっている可能性がある（CAへ確認）"
    );
  if (a.maxHalfmoveClock >= SEVENTY_FIVE_MOVES_PLIES)
    notes.push(
      "入力上、ポーンの移動も駒取りもない75手（150半手）に達している。9.6.2 によりその時点でドローとなっている可能性がある（CAへ確認）"
    );
  return notes;
}

/** 確認できない（盤上でも再現できない）場合の手動確認 */
export function unknownCheck(
  out: TreeOutput,
  label: string,
  keys: CitationKey[]
): DecisionTreeResult {
  return out.decided({
    kind: "manual-review",
    conclusion: `${label}の成立を確認できません。CAへ確認してください。`,
    actions: [
      "時計を止める（必要な場合）",
      "棋譜・対局の再現で確認する",
      "CAへ確認する",
    ],
    intervention: "consult-ca",
    penalties: [],
    sources: cite(...keys),
    confidence: "low",
    escalationRecommended: true,
    escalationReason: `${label}の成立を確認できません`,
  });
}
