import type { CompetitionType, SupervisionRegime } from "@/lib/domain/entities";
import type { CitationKey } from "./citations";

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
 */
export type TimePenaltyRule =
  | { kind: "fixed"; seconds: number; sources: CitationKey[] }
  | {
      kind: "unverified";
      reason: string;
      /** 文言上の解釈による提示値（自動適用しない） */
      suggestedSeconds: number;
      sources: CitationKey[];
    };

/** 未確定の加算時間を提示するときの表記 */
export const UNVERIFIED_AMOUNT_NOTE = "（文言上の解釈・要確認）";

export function opponentTimePenalty(
  competitionType: CompetitionType,
  regime: SupervisionRegime | undefined
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
