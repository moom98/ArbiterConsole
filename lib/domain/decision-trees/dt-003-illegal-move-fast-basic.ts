import type { CompetitionType } from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import { cite, type CitationKey } from "@/lib/domain/rules/citations";
import {
  QUESTIONS,
  SUBTYPE_LABELS,
  type FollowUpQuestion,
} from "@/lib/domain/follow-up";
import type { DecisionTreeResult } from "./dt-001-illegal-move-standard";
import {
  COMPETITION_LABEL,
  evaluateFastPenalty,
  evaluateFastPreliminaries,
  type IllegalMoveFastInput,
} from "./illegal-move-fast-shared";
import { COLOR_JA, TreeOutput } from "./tree-support";

export const DT_003_ID = "DT-003-illegal-move-fast-basic" as const;

/**
 * DT-003: Illegal Move — Rapid / Blitz when the Competition Rules do not apply
 * （FIDE Laws 2023 Appendix A.5.2 / B.3）
 *
 * A.5.2:
 * - アービターが観察した場合、相手が次の手を指していなければ 7.5.5 に従う
 * - アービターが介入しない場合、相手が次の手を指していなければ相手はクレームできる
 * - クレームも介入もなければ違法手は成立したまま対局続行
 * - 相手が次の手を指した後は、アービターの介入なしにプレーヤー同士が合意しない限り訂正不可
 */
export class IllegalMoveFastBasicTree {
  private readonly out: TreeOutput;

  constructor(
    providers: DomainProviders,
    private readonly competitionType: Exclude<CompetitionType, "standard">,
    rulesVersion = "FIDE-2023"
  ) {
    this.out = new TreeOutput(providers, DT_003_ID, rulesVersion);
  }

  private regimeSources(): CitationKey[] {
    return this.competitionType === "rapid"
      ? ["FIDE_A_5_2", "JCF_NA_P90_A_5_2"]
      : ["FIDE_B_3", "FIDE_A_5_2", "JCF_NA_P90_A_5_2"];
  }

  evaluate(input: Partial<IllegalMoveFastInput>): DecisionTreeResult {
    const label = `${COMPETITION_LABEL[this.competitionType]}（${
      this.competitionType === "rapid" ? "A.5" : "B.3"
    }）`;

    const regimeQuestions: FollowUpQuestion[] = [];
    if (input.opponentMadeNextMove === undefined)
      regimeQuestions.push(QUESTIONS.opponentMadeNextMove);
    if (input.detectedBy === undefined)
      regimeQuestions.push(QUESTIONS.detectedBy);

    const pre = evaluateFastPreliminaries(
      this.out,
      input,
      label,
      this.regimeSources(),
      regimeQuestions
    );
    if (pre) return pre;
    if (regimeQuestions.length > 0) return this.out.needsInput(regimeQuestions);

    const color = input.playerColor!;
    const subtype = input.subtype!;

    // 相手が次の手を指した後 → 訂正不可（A.5.2）
    if (input.opponentMadeNextMove) {
      const pawnOnLastRank = subtype === "promotion-not-replaced";
      const sources: CitationKey[] = [...this.regimeSources()];
      if (pawnOnLastRank)
        sources.push("FIDE_A_5_4", "MANUAL_3_10_FAST_INTERVENE");
      return this.out.decided({
        kind: "recommendation",
        conclusion: pawnOnLastRank
          ? `${label}: 相手が次の手を指した後のため、${COLOR_JA[color]}の違法手（${SUBTYPE_LABELS[subtype]}）は訂正できず、ペナルティもありません。ただしポーンが最終段にある不正な局面のため、A.5.4 の手順に従います。`
          : `${label}: 相手が次の手を指した後のため、${COLOR_JA[color]}の違法手（${SUBTYPE_LABELS[subtype]}）は成立したままです。訂正もペナルティもなく対局を続行します。`,
        actions: pawnOnLastRank
          ? [
              "違法手としてのペナルティは科さない",
              "次の手が完了するまで待つ（A.5.4）",
              "その後も不正な局面（最終段のポーン）が盤上に残っていればドローを宣言する（A.5.4）",
            ]
          : [
              "違法手としてのペナルティは科さず、対局を続行する",
              "プレーヤー同士がアービターの介入なしに合意した場合に限り訂正できる",
              "この違法手は違法手回数に数えない（ペナルティ未適用のため）",
            ],
        intervention: pawnOnLastRank ? "immediate" : "no-intervention",
        penalties: [],
        sources: cite(...sources),
        confidence: pawnOnLastRank ? "medium" : "high",
        escalationRecommended: false,
      });
    }

    // 観戦者等からの報告 → A.5.2 はアービターの観察か相手のクレームのみを規定
    if (input.detectedBy === "other") {
      return this.out.decided({
        kind: "manual-review",
        conclusion: `${label}: 違法手がアービターの目撃でも相手のクレームでもなく指摘されました。A.5.2 はこの場合を直接規定していないため、CAへ確認してください。`,
        actions: [
          "時計を止める（必要な場合）",
          "相手が次の手を指す前であれば、相手がクレームする権利があることに留意する",
          "CAへ確認する",
        ],
        intervention: "consult-ca",
        penalties: [],
        sources: cite(...this.regimeSources(), "MANUAL_3_10_FAST_INTERVENE"),
        confidence: "low",
        escalationRecommended: true,
        escalationReason:
          "A.5.2 の適用条件（アービターの観察／相手のクレーム）に該当しません",
      });
    }

    // アービターの観察 or 相手のクレーム（相手は次の手を指していない） → 7.5.5
    return evaluateFastPenalty(this.out, {
      competitionType: this.competitionType,
      regime: "basic-rules",
      color,
      subtype,
      playerIncidentCount: input.playerIncidentCount,
      priorIllegalMoves: input.priorIllegalMoves,
      opponentCanCheckmate: input.opponentCanCheckmate,
      regimeSources: this.regimeSources(),
    });
  }
}
