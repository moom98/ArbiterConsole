import type {
  CompetitionType,
  RuleCitation,
  SupervisionRegime,
  TournamentOverrides,
  TournamentRuleReference,
} from "@/lib/domain/entities";
import { cite, type CitationKey } from "./citations";

/**
 * 第7条（違法手 7.5.5）・第9条（誤ったドロー主張 9.5.3）による「相手への時間加算」の量。
 *
 * - Standard:                 2分（7.5.5 / 9.5.3 の本文）
 * - Rapid（A.4 / A.5 とも）:  1分（A.3 は Appendix A の共通条項）
 * - Blitz B.3（basic-rules）: 1分（B.3 が A.3 を明示的に準用）
 * - Blitz B.2（competition-rules）: 原典で確定できない。
 *   B.2 は Competition Rules（7.5.5 / 9.5.3: 2分）を適用し、A.3 の1分規定を準用するのは B.3 のみ。
 *   文言上は2分と読めるが確定できないため、2分を「文言上の解釈・要確認」として提示し、
 *   自動適用はせず CA 確認とする（ADR-005）。
 *   大会規定で加算時間が明示されている場合（TournamentOverrides）は、その値を大会規定を出典として
 *   適用する（ADR-006）。
 */
export type TimePenaltyRule =
  | { kind: "fixed"; seconds: number; sources: CitationKey[] }
  | {
      kind: "unverified";
      reason: string;
      /** 文言上の解釈による提示値（自動適用しない） */
      suggestedSeconds: number;
      sources: CitationKey[];
    }
  | {
      /** 大会規定で明示された加算時間（出典付き） */
      kind: "tournament";
      seconds: number;
      sources: CitationKey[];
      /** 大会規定の出典（判断の根拠として先頭に表示する） */
      citation: RuleCitation;
    };

/** 未確定の加算時間を提示するときの表記 */
export const UNVERIFIED_AMOUNT_NOTE = "（文言上の解釈・要確認）";

/** 大会規定の出典を RuleCitation にする（priority は大会規定の保存用 priority と同じ） */
export function tournamentCitation(ref: TournamentRuleReference): RuleCitation {
  const article = ref.article?.trim();
  const quote = ref.quote?.trim();
  return {
    article: article ? `大会規定 ${article}` : "大会規定",
    ...(quote ? { text: quote } : {}),
    source: "tournament",
    priority: 1000,
    edition: ref.document.trim(),
  };
}

/** 大会規定の上書きとして有効な値か（正の整数秒・出典あり） */
export function isValidTimePenaltyOverride(
  seconds: unknown,
  ref: TournamentRuleReference | undefined
): boolean {
  return (
    typeof seconds === "number" &&
    Number.isInteger(seconds) &&
    seconds > 0 &&
    !!ref &&
    typeof ref.document === "string" &&
    ref.document.trim().length > 0
  );
}

export function opponentTimePenalty(
  competitionType: CompetitionType,
  regime: SupervisionRegime | undefined,
  overrides?: TournamentOverrides
): TimePenaltyRule {
  if (competitionType === "standard") {
    return { kind: "fixed", seconds: 120, sources: [] };
  }
  if (competitionType === "rapid") {
    return {
      kind: "fixed",
      seconds: 60,
      sources: ["FIDE_A_3", "JCF_NA_P88_ONE_MINUTE"],
    };
  }
  if (regime === "basic-rules") {
    return { kind: "fixed", seconds: 60, sources: ["FIDE_B_3", "FIDE_A_3"] };
  }
  const override = overrides?.blitzCompetitionTimePenaltySeconds;
  if (override && isValidTimePenaltyOverride(override.value, override.source)) {
    return {
      kind: "tournament",
      seconds: override.value,
      sources: ["FIDE_B_2"],
      citation: tournamentCitation(override.source),
    };
  }
  return {
    kind: "unverified",
    reason:
      "B.2 は Competition Rules（7.5.5 / 9.5.3: 2分）を適用します。A.3 の1分規定を準用するのは B.3 のみのため、文言上は2分ですが、CA・大会規定で確認してください。",
    suggestedSeconds: 120,
    sources: ["FIDE_B_2", "FIDE_B_3", "FIDE_A_3"],
  };
}

export function formatMinutes(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60}分` : `${seconds}秒`;
}

/** 判断に表示する加算時間（未確定の場合は注記付き） */
export function timePenaltyAmount(rule: TimePenaltyRule): string {
  return rule.kind === "unverified"
    ? `${formatMinutes(rule.suggestedSeconds)}${UNVERIFIED_AMOUNT_NOTE}`
    : formatMinutes(rule.seconds);
}

/** 自動適用できる加算秒数（未確定の場合は undefined） */
export function appliedPenaltySeconds(
  rule: TimePenaltyRule
): number | undefined {
  return rule.kind === "unverified" ? undefined : rule.seconds;
}

/** 大会規定による加算時間の表示（例: "大会規定: 2分（出典: 大会規定 第5条 / ○○大会要項）"） */
export function tournamentPenaltyNote(
  rule: Extract<TimePenaltyRule, { kind: "tournament" }>
): string {
  return `大会規定: ${formatMinutes(rule.seconds)}（出典: ${rule.citation.article} / ${rule.citation.edition}）`;
}

/** 加算時間の根拠となる引用（大会規定がある場合は先頭） */
export function timePenaltyCitations(
  rule: TimePenaltyRule,
  keys: CitationKey[]
): RuleCitation[] {
  const cited = cite(...keys);
  return rule.kind === "tournament" ? [{ ...rule.citation }, ...cited] : cited;
}
