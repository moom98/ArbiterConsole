import type { CompetitionType } from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import type { CitationKey } from "@/lib/domain/rules/citations";
import type { DecisionTreeResult } from "./dt-001-illegal-move-standard";
import {
  COMPETITION_LABEL,
  evaluateFastPenalty,
  evaluateFastPreliminaries,
  type IllegalMoveFastInput,
} from "./illegal-move-fast-shared";
import { TreeOutput } from "./tree-support";

export const DT_002_ID = "DT-002-illegal-move-fast-competition" as const;

/**
 * DT-002: Illegal Move — Rapid / Blitz under the Competition Rules
 * （FIDE Laws 2023 Appendix A.4 / B.2）
 *
 * Competitive Rules of Play がそのまま適用されるため、手順は 7.5.1–7.5.5（Standard と同じ構造）。
 * 「相手が次の手を指したか」は判断に影響しない（それは A.5.2 の規定）。
 * 相手への加算時間は A.3 により1分（Rapid）。Blitz B.2 は原典で確定できないため CA 確認。
 */
export class IllegalMoveFastCompetitionTree {
  private readonly out: TreeOutput;

  constructor(
    providers: DomainProviders,
    private readonly competitionType: Exclude<CompetitionType, "standard">,
    rulesVersion = "FIDE-2023"
  ) {
    this.out = new TreeOutput(providers, DT_002_ID, rulesVersion);
  }

  private regimeSources(): CitationKey[] {
    return this.competitionType === "rapid"
      ? ["FIDE_A_4", "FIDE_A_6"]
      : ["FIDE_B_2", "FIDE_B_4"];
  }

  evaluate(input: Partial<IllegalMoveFastInput>): DecisionTreeResult {
    const label = `${COMPETITION_LABEL[this.competitionType]}（${
      this.competitionType === "rapid" ? "A.4" : "B.2"
    }）`;
    const pre = evaluateFastPreliminaries(
      this.out,
      input,
      label,
      this.regimeSources()
    );
    if (pre) return pre;

    return evaluateFastPenalty(this.out, {
      competitionType: this.competitionType,
      regime: "competition-rules",
      color: input.playerColor!,
      subtype: input.subtype!,
      playerIncidentCount: input.playerIncidentCount,
      priorIllegalMoves: input.priorIllegalMoves,
      opponentCanCheckmate: input.opponentCanCheckmate,
      regimeSources: this.regimeSources(),
      tournamentOverrides: input.tournamentOverrides,
    });
  }
}
