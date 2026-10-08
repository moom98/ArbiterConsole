import type {
  CompetitionType,
  EndedBeforeFlag,
  FlagFallFacts,
  PlayerColor,
  SupervisionRegime,
} from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import { cite, type CitationKey } from "@/lib/domain/rules/citations";
import { QUESTIONS, type FollowUpQuestion } from "@/lib/domain/follow-up";
import type { MatePossibility } from "@/lib/domain/services/mate-possibility";
import type { DecisionTreeResult } from "./dt-001-illegal-move-standard";
import { COLOR_JA, TreeOutput, opponentOf } from "./tree-support";
import {
  ENDED_BEFORE_FLAG_LABELS,
  endedBeforeFlagFromEvent,
} from "@/lib/domain/services/game-end";

export const DT_004_ID = "DT-004-flag-fall" as const;

export interface FlagFallInput extends Omit<
  FlagFallFacts,
  "gameEndedBeforeFlag"
> {
  competitionType: CompetitionType;
  /** Rapid / Blitz では必須 */
  supervisionRegime?: SupervisionRegime;
  /**
   * フラッグ確定時の局面によるメイト可能性（DecisionEngine が assessMatePossibility で算出。
   * ADR-014 §5）。matePosition = "fen" のときに使う
   */
  mate?: MatePossibility;
}

/** メイト可能性の局面の質問（局面の入力方法 → FEN） */
export function matePositionQuestions(): FollowUpQuestion[] {
  return [QUESTIONS.matePosition, QUESTIONS.positionFen];
}

/**
 * DT-004: Flag fall（FIDE Laws 2023 Art. 6.8 / 6.9, A.5.3 / A.5.5, Guidelines III.3.1）
 *
 * - フラッグに気付く前に結果が出ていれば、その結果のまま
 * - 規定手数の完了を確認（6.4）
 * - 両フラッグ: 先に落ちた側が判別できればその側、できなければ Guidelines III.3.1（Standard/Rapid の増加時間なし・事前告知）
 * - 相手がどのような合法手の連続でもメイトできなければドロー（6.9 / A.5.3）
 *   メイト可能性は局面から判定する（ADR-014 §5）: 駒の構成で不可能が証明できればドロー、
 *   メイトまでの手順が見つかれば負け、それ以外は CA 確認
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
    if (input.endedBeforeFlag === undefined)
      basic.push(QUESTIONS.endedBeforeFlag);
    if (basic.length > 0) return this.out.needsInput(basic);

    // 2. フラッグの確定前に対局を終わらせた出来事があった → 結果は変わらない。
    // 終了は観察した出来事から求める（握手だけでは終了としない。ADR-014 §3）
    if (endedBeforeFlagFromEvent(input.endedBeforeFlag)) {
      const event = input.endedBeforeFlag as EndedBeforeFlag;
      return this.out.decided({
        kind: "recommendation",
        conclusion: `フラッグが確定する前に対局は終了していた（${ENDED_BEFORE_FLAG_LABELS[event]}）ため、その結果がそのまま有効です。`,
        actions: [
          "時間切れとしての裁定は行わない",
          "終了時点の結果（チェックメイト・投了・ドロー等）を記録する",
          ...(event === "other"
            ? [
                "対局を終わらせた出来事（終了の根拠）を確認し、明確でなければCAへ確認する",
              ]
            : []),
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
        confidence: event === "other" ? "medium" : "high",
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
    const positionError = this.positionError(input);
    if (input.movesNotCompleted === undefined) {
      // 時間切れのプレーヤーが確定してから質問する。局面も同じラウンドで尋ねる
      // （局面は「規定手数を完了していない」場合のみ必要）
      return this.out.needsInput(
        [
          QUESTIONS.movesNotCompleted,
          ...(input.matePosition !== undefined && !positionError
            ? []
            : matePositionQuestions().map((q) => ({
                ...q,
                showWhen: q.showWhen ?? {
                  questionId: "movesNotCompleted" as const,
                  values: ["true"],
                },
              }))),
        ],
        `${COLOR_JA[flagged]}のフラッグが落ちました。${COLOR_JA[flagged]}が規定手数を完了していたかと、フラッグ確定時の局面を確認してください。${positionError ? `\n${positionError}` : ""}`,
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

    // 6. メイト可能性（局面から判定。ADR-014 §5）
    if (input.matePosition === undefined || positionError) {
      return this.out.needsInput(
        matePositionQuestions(),
        `${COLOR_JA[flagged]}のフラッグが落ちました。相手（${COLOR_JA[opponentOf(flagged)]}）がメイト可能かを判定するため、フラッグ確定時の局面を入力してください。${positionError ? `\n${positionError}` : ""}`,
        cite("FIDE_6_9", "MANUAL_6_9_CHECK_POSITION")
      );
    }

    const winner = opponentOf(flagged);
    const sources = [...this.regimeSources(input), ...extraSources];
    if (input.matePosition === "unknown")
      return this.mateUnknown(flagged, "局面が入力されていません", sources);
    const assessment = input.mate;
    if (!assessment || assessment.verdict === "unknown")
      return this.mateUnknown(
        flagged,
        assessment?.reason ?? "局面を判定できません",
        sources
      );

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

    return this.out.decided({
      kind: "recommendation",
      conclusion: `${COLOR_JA[flagged]}のフラッグが落ちました。${COLOR_JA[winner]}はメイト可能な局面のため、${COLOR_JA[flagged]}の負けです。\nメイトまでの手順の例（入力した局面から）: ${assessment.line}`,
      actions: [
        "時計を止める",
        this.procedureAction(input),
        "入力した局面（手番を含む）が盤上と一致することを確認する",
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

  /** 入力された局面を判定に使えない場合（FEN の誤りなど）、再入力を求める理由 */
  private positionError(input: Partial<FlagFallInput>): string | undefined {
    if (input.matePosition !== "fen") return undefined;
    const cause = input.mate?.cause;
    if (cause === "no-position") return "局面（FEN）を入力してください。";
    if (cause === "invalid-position")
      return `${input.mate?.reason}。FEN を修正するか、「局面を入力できない」を選んでください。`;
    return undefined;
  }

  private mateUnknown(
    flagged: PlayerColor,
    reason: string,
    sources: CitationKey[]
  ): DecisionTreeResult {
    const winner = opponentOf(flagged);
    return this.out.decided({
      kind: "manual-review",
      conclusion: `${COLOR_JA[flagged]}のフラッグが落ちましたが、${COLOR_JA[winner]}がメイト可能かを確定できません（${reason}）。局面を確認し、CAへ確認してください。`,
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
