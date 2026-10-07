import type {
  BoardMaterial,
  CompetitionType,
  FlagFallFacts,
  PlayerColor,
  SideMaterial,
  SupervisionRegime,
} from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import { cite, type CitationKey } from "@/lib/domain/rules/citations";
import {
  MATERIAL_KEYS,
  QUESTIONS,
  materialQuestionId,
  type FollowUpQuestion,
} from "@/lib/domain/follow-up";
import {
  assessMatingPossibility,
  materialFromFen,
  validateSideMaterial,
} from "@/lib/domain/services/mate-material";
import type { DecisionTreeResult } from "./dt-001-illegal-move-standard";
import { COLOR_JA, TreeOutput, opponentOf } from "./tree-support";

export const DT_004_ID = "DT-004-flag-fall" as const;

export interface FlagFallInput extends FlagFallFacts {
  competitionType: CompetitionType;
  /** Rapid / Blitz では必須 */
  supervisionRegime?: SupervisionRegime;
}

/** 駒数入力の質問一式（白 → 黒） */
export function materialQuestions(): FollowUpQuestion[] {
  const qs: FollowUpQuestion[] = [];
  for (const color of ["white", "black"] as const)
    for (const piece of MATERIAL_KEYS)
      qs.push(QUESTIONS[materialQuestionId(color, piece)]);
  return qs;
}

/**
 * DT-004: Flag fall（FIDE Laws 2023 Art. 6.8 / 6.9, A.5.3 / A.5.5, Guidelines III.3.1）
 *
 * - フラッグに気付く前に結果が出ていれば、その結果のまま
 * - 規定手数の完了を確認（6.4）
 * - 両フラッグ: 先に落ちた側が判別できればその側、できなければ Guidelines III.3.1（Standard/Rapid の増加時間なし・事前告知）
 * - 相手がどのような合法手の連続でもメイトできなければドロー（6.9 / A.5.3）
 *   メイト可能性は駒数で確定できる場合のみ確定し、それ以外は CA 確認
 */
export class FlagFallTree {
  private readonly out: TreeOutput;

  constructor(providers: DomainProviders, rulesVersion = "FIDE-2023") {
    this.out = new TreeOutput(providers, DT_004_ID, rulesVersion);
  }

  private regimeSources(input: Partial<FlagFallInput>): CitationKey[] {
    if (
      input.competitionType !== "standard" &&
      input.supervisionRegime === "basic-rules"
    ) {
      return input.competitionType === "blitz"
        ? ["FIDE_B_3", "FIDE_A_5_3", "FIDE_A_5_5", "FIDE_6_9"]
        : ["FIDE_A_5_3", "FIDE_A_5_5", "FIDE_6_9"];
    }
    return ["FIDE_6_8", "FIDE_6_9"];
  }

  private procedureAction(input: Partial<FlagFallInput>): string {
    return input.competitionType !== "standard" &&
      input.supervisionRegime === "basic-rules"
      ? "相手は時計を一時停止してアービターに通知することで時間切れを主張できる（A.5.3）。アービターは目撃したフラッグを宣告する（A.5.5）"
      : "アービターは気付いた時点でフラッグを宣告する（6.8）";
  }

  evaluate(input: Partial<FlagFallInput>): DecisionTreeResult {
    // 1. 基本事実
    const basic: FollowUpQuestion[] = [];
    if (input.flagFallen === undefined) basic.push(QUESTIONS.flagFallen);
    if (input.gameEndedBeforeFlag === undefined)
      basic.push(QUESTIONS.gameEndedBeforeFlag);
    if (basic.length > 0) return this.out.needsInput(basic);

    // 2. フラッグに気付く前に結果が出ていた → 結果は変わらない
    if (input.gameEndedBeforeFlag) {
      return this.out.decided({
        kind: "recommendation",
        conclusion:
          "フラッグに気付く（主張される）前に対局は終了していたため、その結果がそのまま有効です。",
        actions: [
          "時間切れとしての裁定は行わない",
          "終了時点の結果（チェックメイト・投了・ドロー等）を記録する",
        ],
        intervention: "no-intervention",
        penalties: [],
        sources: cite(
          "FIDE_6_8",
          "MANUAL_6_8_NOTICED",
          "FIDE_6_9",
          "MANUAL_6_9_AND_9_6",
          "JCF_NA_P39_FLAG_NOTICED"
        ),
        confidence: "high",
        escalationRecommended: false,
      });
    }

    // 4. 両フラッグ
    let flagged: PlayerColor;
    const extraSources: CitationKey[] = [];
    if (input.flagFallen === "both") {
      if (input.bothFlagsOrder === undefined)
        return this.out.needsInput([QUESTIONS.bothFlagsOrder]);
      if (input.bothFlagsOrder === "unknown") return this.bothUnknown(input);
      flagged = input.bothFlagsOrder === "white-first" ? "white" : "black";
      extraSources.push(
        "MANUAL_6_BOTH_ZERO_ELECTRONIC",
        ...(input.competitionType !== "standard" &&
        input.supervisionRegime === "basic-rules"
          ? (["MANUAL_A_BOTH_ZERO"] as const)
          : [])
      );
    } else {
      flagged = input.flagFallen as PlayerColor;
    }

    // 5. 規定手数（6.4）: 時間切れのプレーヤーが確定した後に確認する
    const material = this.resolveMaterial(input);
    if (input.movesNotCompleted === undefined) {
      // 時間切れのプレーヤーが確定してから質問する。駒数も同じラウンドで尋ねる
      return this.out.needsInput(
        [
          QUESTIONS.movesNotCompleted,
          ...(material.ok
            ? []
            : [
                ...materialQuestions(),
                QUESTIONS.positionFen,
                QUESTIONS.materialConfirmed,
              ]),
        ],
        `${COLOR_JA[flagged]}のフラッグが落ちました。${COLOR_JA[flagged]}が規定手数を完了していたかと、盤上の駒数を確認してください。${!material.ok && material.error ? `\n${material.error}` : ""}`,
        cite("FIDE_6_4", "FIDE_6_9", "MANUAL_6_9_CHECK_POSITION")
      );
    }
    if (input.movesNotCompleted === false) {
      return this.out.decided({
        kind: "manual-review",
        conclusion: `${COLOR_JA[flagged]}は規定手数を完了していたため、時間切れ負けにはなりません（6.9 は規定手数を完了しなかった場合）。時計の設定を確認してください。`,
        actions: [
          "時計を止める",
          "両方の時計の表示時間と手数を記録する",
          "時計の設定（次のピリオドの加算時間）を確認・修正し、CAへ確認する",
        ],
        intervention: "consult-ca",
        penalties: [],
        sources: cite("FIDE_6_4", "FIDE_6_9"),
        confidence: "medium",
        escalationRecommended: true,
        escalationReason: "時計の設定・残り時間の調整が必要です",
      });
    }
    if (input.movesNotCompleted === "unknown") {
      return this.out.decided({
        kind: "manual-review",
        conclusion:
          "規定手数を完了していたかが不明なため、時間切れの裁定を確定できません。",
        actions: [
          "時計を止める",
          "棋譜・時計の手数表示で規定手数の完了を確認する（6.4）",
          "CAへ確認する",
        ],
        intervention: "consult-ca",
        penalties: [],
        sources: cite("FIDE_6_4", "FIDE_6_9"),
        confidence: "low",
        escalationRecommended: true,
        escalationReason: "規定手数の完了を確認できません",
      });
    }

    // 6. メイト可能性（駒数または FEN）
    if (!material.ok) {
      return this.out.needsInput(
        [
          ...materialQuestions(),
          QUESTIONS.positionFen,
          QUESTIONS.materialConfirmed,
        ],
        `${COLOR_JA[flagged]}のフラッグが落ちました。相手（${COLOR_JA[opponentOf(flagged)]}）がメイト可能かを判定するため、盤上の駒数を入力してください。${material.error ? `\n${material.error}` : ""}`,
        cite("FIDE_6_9", "MANUAL_6_9_CHECK_POSITION")
      );
    }

    const winner = opponentOf(flagged);
    const assessment = assessMatingPossibility(
      material.material[winner],
      material.material[flagged]
    );
    const sources = [...this.regimeSources(input), ...extraSources];

    if (assessment.verdict === "cannot-mate") {
      return this.out.decided({
        kind: "recommendation",
        conclusion: `${COLOR_JA[flagged]}のフラッグが落ちましたが、${COLOR_JA[winner]}はどのような合法手の連続でも${COLOR_JA[flagged]}のキングをメイトできないため、ドローです。（${assessment.reason}）`,
        actions: [
          "時計を止める",
          this.procedureAction(input),
          "ドローを宣言する（6.9 ただし書き）",
          "結果を記録する",
        ],
        intervention: "immediate",
        penalties: [
          {
            type: "draw",
            description: "ドロー（相手がメイト不可能な局面）",
          },
        ],
        sources: cite(
          ...sources,
          "MANUAL_6_9_CHECK_POSITION",
          "JCF_NA_P40_FLAG_RESULT"
        ),
        confidence: "high",
        escalationRecommended: false,
      });
    }

    if (assessment.verdict === "unknown") {
      return this.mateUnknown(flagged, assessment.reason, sources);
    }

    // can-mate: ポーンがある場合は閉塞局面でないことを確認
    if (assessment.positionDependent) {
      if (input.positionBlocked === undefined) {
        return this.out.needsInput(
          [QUESTIONS.positionBlocked],
          `${COLOR_JA[winner]}は駒数上メイト可能です（${assessment.reason}）。盤上にポーンがあるため、閉塞局面でないかを確認してください。`,
          cite("FIDE_6_9", "MANUAL_6_9_CHECK_POSITION")
        );
      }
      if (input.positionBlocked !== false) {
        return this.mateUnknown(
          flagged,
          "閉塞局面の可能性があり、メイト可能かを駒数だけでは判定できません",
          sources
        );
      }
    }

    return this.out.decided({
      kind: "recommendation",
      conclusion: `${COLOR_JA[flagged]}のフラッグが落ちました。${COLOR_JA[winner]}はメイト可能な局面のため、${COLOR_JA[flagged]}の負けです。（${assessment.reason}）`,
      actions: [
        "時計を止める",
        this.procedureAction(input),
        "強制手順で時間切れ側がメイト／ステイルメイトする局面でないか確認する（該当すればドロー: 解説）",
        `${COLOR_JA[flagged]}の負けを宣言する（6.9）`,
        "結果を記録する",
      ],
      intervention: "immediate",
      penalties: [
        {
          type: "game-loss",
          playerColor: flagged,
          description: `${COLOR_JA[flagged]}の時間切れ負け`,
        },
      ],
      sources: cite(
        ...sources,
        "MANUAL_6_9_CHECK_POSITION",
        "JCF_NA_P40_FLAG_RESULT",
        "JCF_NA_P39_ARBITER_INTERVENES"
      ),
      confidence: "high",
      escalationRecommended: false,
    });
  }

  private resolveMaterial(
    input: Partial<FlagFallInput>
  ): { ok: true; material: BoardMaterial } | { ok: false; error?: string } {
    if (input.fen) {
      const parsed = materialFromFen(input.fen);
      if (parsed.ok) return parsed;
      return {
        ok: false,
        error: `FEN を解釈できません（${parsed.error}）。FEN を修正するか、空欄にして駒数を入力してください。`,
      };
    }
    if (!input.materialConfirmed || !input.material) return { ok: false };
    const errors = [
      ...validateSideMaterial(input.material.white, "白"),
      ...validateSideMaterial(input.material.black, "黒"),
    ];
    if (errors.length > 0) return { ok: false, error: errors.join(" / ") };
    return {
      ok: true,
      material: {
        white: input.material.white as SideMaterial,
        black: input.material.black as SideMaterial,
      },
    };
  }

  private mateUnknown(
    flagged: PlayerColor,
    reason: string,
    sources: CitationKey[]
  ): DecisionTreeResult {
    const winner = opponentOf(flagged);
    return this.out.decided({
      kind: "manual-review",
      conclusion: `${COLOR_JA[flagged]}のフラッグが落ちましたが、${COLOR_JA[winner]}がメイト可能かを確定できません（${reason}）。CAへ確認してください。`,
      actions: [
        "時計を止める",
        `${COLOR_JA[winner]}があらゆる合法手の連続（相手の協力を含む）で${COLOR_JA[flagged]}のキングをメイトできる局面かをCAと確認する`,
        `メイト可能なら${COLOR_JA[flagged]}の負け、不可能ならドロー（6.9）`,
      ],
      intervention: "consult-ca",
      penalties: [],
      sources: cite(...sources, "MANUAL_6_9_CHECK_POSITION"),
      confidence: "low",
      escalationRecommended: true,
      escalationReason:
        "6.9 ただし書き（相手がメイト不可能ならドロー）の該当性を判断できません",
    });
  }

  private bothUnknown(input: Partial<FlagFallInput>): DecisionTreeResult {
    // Guidelines III は Blitz には適用されない（III.2.2）
    if (input.competitionType === "blitz") {
      return this.out.decided({
        kind: "manual-review",
        conclusion:
          "両方のフラッグが落ち、どちらが先か判別できません。Blitz には Guidelines III.3.1 が適用されないため、CAへ確認してください。",
        actions: [
          "時計を止める",
          "時計の表示（フラッグ表示）で先に落ちた側を確認する",
          "CAへ確認する",
        ],
        intervention: "consult-ca",
        penalties: [],
        sources: cite("FIDE_III_2_2", "MANUAL_6_BOTH_ZERO_ELECTRONIC"),
        confidence: "low",
        escalationRecommended: true,
        escalationReason: "どちらのフラッグが先に落ちたか判別できません",
      });
    }
    const missing: FollowUpQuestion[] = [];
    if (input.quickplayGuidelinesApply === undefined)
      missing.push(QUESTIONS.quickplayGuidelinesApply);
    if (input.lastPeriod === undefined) missing.push(QUESTIONS.lastPeriod);
    if (missing.length > 0)
      return this.out.needsInput(
        missing,
        "両方のフラッグが落ち、どちらが先か判別できません。Guidelines III の適用を確認してください。",
        cite("FIDE_III_2_1", "FIDE_III_2_2", "FIDE_III_3_1")
      );

    if (!input.quickplayGuidelinesApply) {
      return this.out.decided({
        kind: "manual-review",
        conclusion:
          "両方のフラッグが落ち、どちらが先か判別できません。Guidelines III が適用されない対局のため、CAへ確認してください。",
        actions: [
          "時計を止める",
          "時計の表示（フラッグ表示）で先に落ちた側を確認する",
          "CAへ確認する",
        ],
        intervention: "consult-ca",
        penalties: [],
        sources: cite(
          "FIDE_III_2_1",
          "FIDE_III_2_2",
          "MANUAL_6_BOTH_ZERO_ELECTRONIC"
        ),
        confidence: "low",
        escalationRecommended: true,
        escalationReason: "どちらのフラッグが先に落ちたか判別できません",
      });
    }
    if (input.lastPeriod) {
      return this.out.decided({
        kind: "recommendation",
        conclusion:
          "両方のフラッグが落ち、どちらが先か判別できません。最終ピリオドのため、ドローです（III.3.1.2）。",
        actions: [
          "時計を止める",
          "ドローを宣言する（III.3.1.2）",
          "結果を記録する",
        ],
        intervention: "immediate",
        penalties: [
          {
            type: "draw",
            description: "ドロー（両フラッグ・順序不明・最終ピリオド）",
          },
        ],
        sources: cite("FIDE_III_3_1", "FIDE_III_2_1", "FIDE_III_2_2"),
        confidence: "high",
        escalationRecommended: false,
      });
    }
    return this.out.decided({
      kind: "recommendation",
      conclusion:
        "両方のフラッグが落ち、どちらが先か判別できません。最終ピリオドではないため、対局を続行します（III.3.1.1）。",
      actions: [
        "時計を次のピリオドの設定にする（必要な場合）",
        "対局を続行する（III.3.1.1）",
      ],
      intervention: "immediate",
      penalties: [],
      sources: cite("FIDE_III_3_1", "FIDE_III_2_1", "FIDE_III_2_2"),
      confidence: "high",
      escalationRecommended: false,
    });
  }
}
