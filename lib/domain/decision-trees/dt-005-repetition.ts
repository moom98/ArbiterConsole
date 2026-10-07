import type {
  CompetitionType,
  ConditionCheck,
  DrawClaimFacts,
  Penalty,
  PlayerColor,
  SupervisionRegime,
  TournamentOverrides,
} from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import { cite, type CitationKey } from "@/lib/domain/rules/citations";
import { QUESTIONS, type FollowUpQuestion } from "@/lib/domain/follow-up";
import {
  appliedPenaltySeconds,
  opponentTimePenalty,
  timePenaltyAmount,
  timePenaltyCitations,
  tournamentPenaltyNote,
} from "@/lib/domain/rules/time-penalty";
import {
  SEVENTY_FIVE_MOVES_PLIES,
  type RepetitionAnalysis,
} from "@/lib/domain/services/position-analysis";
import type { DecisionTreeResult } from "./dt-001-illegal-move-standard";
import { COLOR_JA, TreeOutput, opponentOf } from "./tree-support";

export const DT_005_ID = "DT-005-repetition" as const;

/** 75手 = 両プレーヤー各75手 = 150 半手 */
export { SEVENTY_FIVE_MOVES_PLIES } from "@/lib/domain/services/position-analysis";

export interface RepetitionInput extends DrawClaimFacts {
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

type Outcome = "met" | "not-met" | "unknown";

/**
 * DT-005: Repetition（FIDE Laws 2023 Art. 9.2, 9.4, 9.5, 9.6）
 *
 * - threefold-repetition-claim: 9.2 のクレーム手順と、正しい／誤ったクレームの扱い（9.5.2 / 9.5.3）
 * - fivefold-repetition:        9.6.1（クレーム不要、アービターが介入してドロー）
 * - 75-move-rule:               9.6.2（同上。最後の手がチェックメイトならメイトが優先）
 *
 * 局面の同一性は 9.2.3（手番・駒配置・キャスリング権・合法なアンパッサンの可否）。
 * 自動判定は入力された棋譜 / FEN の解析結果を用い、両プレーヤーの面前での確認を必ず求める。
 */
export class RepetitionTree {
  private readonly out: TreeOutput;

  constructor(providers: DomainProviders, rulesVersion = "FIDE-2023") {
    this.out = new TreeOutput(providers, DT_005_ID, rulesVersion);
  }

  evaluate(input: Partial<RepetitionInput>): DecisionTreeResult {
    switch (input.subtype) {
      case "threefold-repetition-claim":
        return this.threefold(input);
      case "fivefold-repetition":
        return this.fivefold(input);
      case "75-move-rule":
        return this.seventyFive(input);
      default:
        return this.out.needsInput([QUESTIONS.drawSubtype]);
    }
  }

  // ---------------------------------------------------------------------------

  /** 確認結果（手動 or 自動）を解決する。追加入力が必要なら null + 質問 */
  private resolveCheck(
    check: ConditionCheck | undefined,
    analysis: RepetitionInput["analysis"],
    positionsText: string | undefined,
    autoOutcome: (r: RepetitionAnalysis) => Outcome,
    /** 自動判定の前提を検証する（不整合ならエラー文を返す） */
    validate?: (r: RepetitionAnalysis) => string | undefined
  ):
    { outcome: Outcome; auto?: RepetitionAnalysis } | { error: string } | null {
    if (check === undefined) return null;
    if (check !== "auto") return { outcome: check };
    if (!positionsText)
      return {
        error:
          "「判定する」を選んだ場合は、棋譜または FEN を入力してください。",
      };
    if (!analysis) return { error: "局面の自動判定は利用できません。" };
    if (!analysis.ok)
      return { error: `入力を解析できません: ${analysis.error}` };
    const invalid = validate?.(analysis.result);
    if (invalid) return { error: invalid };
    return { outcome: autoOutcome(analysis.result), auto: analysis.result };
  }

  private autoLine(a: RepetitionAnalysis | undefined): string[] {
    if (!a) return [];
    return [
      `自動判定: ${a.positions}局面を解析（${a.format === "moves" ? "棋譜" : "FEN"}）。対象局面の出現 ${a.targetOccurrences}回 / 最大 ${a.maxOccurrences}回 / ポーン移動・駒取りなし 最大 ${a.maxHalfmoveClock}半手`,
      "自動判定は入力に依存する。両プレーヤーの面前で対局を再現して確認する",
    ];
  }

  private threefold(input: Partial<RepetitionInput>): DecisionTreeResult {
    const basic: FollowUpQuestion[] = [];
    if (input.claimant === undefined) basic.push(QUESTIONS.claimant);
    if (input.claimantHasMove === undefined)
      basic.push(QUESTIONS.claimantHasMove);
    if (input.claimMode === undefined) basic.push(QUESTIONS.claimMode);
    if (input.touchedPiece === undefined) basic.push(QUESTIONS.touchedPiece);
    if (basic.length > 0) return this.out.needsInput(basic);

    const claimant = input.claimant as PlayerColor;

    if (!input.claimantHasMove) {
      return this.out.decided({
        kind: "recommendation",
        conclusion: `${COLOR_JA[claimant]}の手番ではないため、9.2 のクレームはできません。クレームできるのは手番のプレーヤー（自分の時計が動いている）のみです。`,
        actions: [
          `${COLOR_JA[claimant]}に、自分の手番でクレームできることを説明する`,
          "この時点でのクレームとして同一局面の確認は行わない",
          "罰則の要否が問題になる場合はCAへ確認する",
        ],
        intervention: "immediate",
        penalties: [],
        sources: cite("FIDE_9_2", "MANUAL_9_2_ONLY_PLAYER_TO_MOVE"),
        confidence: "medium",
        escalationRecommended: false,
      });
    }

    if (input.touchedPiece) {
      return this.out.decided({
        kind: "recommendation",
        conclusion: `${COLOR_JA[claimant]}は動かす意図で駒に触れたため、この手番では 9.2 のクレーム権を失っています（9.4）。`,
        actions: [
          "クレームを受け付けず、タッチムーブ（4.3）に従って指させる",
          "クレーム権は次の手番で回復するが、遡ってクレームすることはできない",
        ],
        intervention: "immediate",
        penalties: [],
        sources: cite("FIDE_9_4", "MANUAL_9_4_RIGHT_RETURNS", "FIDE_4_3"),
        confidence: "high",
        escalationRecommended: false,
      });
    }

    if (input.claimMode === "about-to-appear") {
      if (input.moveWritten === undefined)
        return this.out.needsInput([QUESTIONS.moveWritten]);
      if (!input.moveWritten) {
        return this.out.decided({
          kind: "recommendation",
          conclusion:
            "9.2.1 のクレームには、指す手を棋譜に記入しアービターに宣言することが必要です。クレームを却下せず「Make your claim legal」と伝えます。",
          actions: [
            "「Make your claim legal（正しい手順でクレームしてください）」と伝える",
            "指す手を棋譜に記入し、その手を指す意思を宣言させる",
            "手順が整ったら、このIncidentを再評価する",
          ],
          intervention: "immediate",
          penalties: [],
          sources: cite("FIDE_9_2", "MANUAL_9_2_MAKE_CLAIM_LEGAL"),
          confidence: "high",
          escalationRecommended: false,
        });
      }
    }

    const intendedMissing =
      input.claimMode === "about-to-appear" &&
      input.conditionCheck === "auto" &&
      !input.intendedMove;
    const resolved = intendedMissing
      ? {
          error:
            "9.2.1 のクレームを自動判定するには、記入した次の手（例: Ng8）を入力してください。",
        }
      : this.resolveCheck(
          input.conditionCheck,
          input.analysis,
          input.positionsText,
          (r) => (r.targetOccurrences >= 3 ? "met" : "not-met"),
          (r) =>
            r.sideToMove !== claimant
              ? `入力された手順の最後の局面は${COLOR_JA[r.sideToMove]}の手番です。クレームした${COLOR_JA[claimant]}の手番になるまでの手順を入力してください。`
              : undefined
        );
    if (resolved === null || "error" in resolved) {
      const qs: FollowUpQuestion[] = [
        QUESTIONS.repetitionCheck,
        QUESTIONS.positionsText,
      ];
      if (input.claimMode === "about-to-appear")
        qs.push(QUESTIONS.intendedMove);
      return this.out.needsInput(
        qs,
        `${COLOR_JA[claimant]}の三回同一局面のクレームです。時計を止め、両プレーヤーの面前で同一局面の回数を確認してください。${resolved ? `\n${resolved.error}` : ""}`,
        cite(
          "FIDE_9_2",
          "FIDE_9_2_3",
          "FIDE_9_5_1",
          "MANUAL_9_2_CHECK_PRESENCE"
        )
      );
    }

    const fastSources = this.fastClaimSources(input);
    const fivefoldNote =
      resolved.auto && resolved.auto.maxOccurrences >= 5
        ? [
            "入力上、同じ局面が5回以上出現している。9.6.1 によりその時点でドローとなっている可能性がある（CAへ確認）",
          ]
        : [];

    if (resolved.outcome === "met") {
      return this.out.decided({
        kind: "recommendation",
        conclusion: `${COLOR_JA[claimant]}のクレームは正しいです（同一局面が3回以上）。ドローです。`,
        actions: [
          "時計を止める（9.5.1）",
          ...this.autoLine(resolved.auto),
          ...fivefoldNote,
          "ドローを宣言する（9.5.2）",
          "結果を記録する",
        ],
        intervention: "immediate",
        penalties: [{ type: "draw", description: "ドロー（三回同一局面）" }],
        sources: cite(
          "FIDE_9_2",
          "FIDE_9_2_3",
          "FIDE_9_5_2",
          "MANUAL_9_2_CHECK_PRESENCE",
          "JCF_NA_P65_SAME_POSITION",
          ...fastSources
        ),
        confidence: resolved.auto ? "medium" : "high",
        escalationRecommended: fivefoldNote.length > 0,
        escalationReason:
          fivefoldNote.length > 0
            ? "五回同一局面の可能性があります"
            : undefined,
      });
    }

    if (resolved.outcome === "unknown") {
      return this.out.decided({
        kind: "manual-review",
        conclusion: `${COLOR_JA[claimant]}のクレームの正否を確認できません。CAへ確認してください。`,
        actions: [
          "時計を止めたままにする（9.5.1: クレームは取り下げられない）",
          "両プレーヤーの面前で対局を再現し、同一局面の回数を確認する",
          "CAへ確認する",
        ],
        intervention: "consult-ca",
        penalties: [],
        sources: cite(
          "FIDE_9_2",
          "FIDE_9_2_3",
          "FIDE_9_5_1",
          "MANUAL_9_2_CHECK_PRESENCE"
        ),
        confidence: "low",
        escalationRecommended: true,
        escalationReason: "同一局面の回数を確認できません",
      });
    }

    return this.incorrectClaim(input, claimant, resolved.auto);
  }

  private fastClaimSources(input: Partial<RepetitionInput>): CitationKey[] {
    if (input.competitionType === "rapid") return ["FIDE_A_2"];
    if (
      input.competitionType === "blitz" &&
      input.supervisionRegime === "basic-rules"
    )
      return ["FIDE_B_3", "FIDE_A_2"];
    return [];
  }

  private incorrectClaim(
    input: Partial<RepetitionInput>,
    claimant: PlayerColor,
    auto: RepetitionAnalysis | undefined
  ): DecisionTreeResult {
    const opp = opponentOf(claimant);
    const rule = opponentTimePenalty(
      input.competitionType ?? "standard",
      input.supervisionRegime,
      input.tournamentOverrides
    );
    const amount = timePenaltyAmount(rule);
    // 未確定の加算時間は提示のみ（timeAdjustmentSeconds は設定しない）
    const penalty: Penalty = {
      type: "time-addition-opponent",
      playerColor: opp,
      description: `${COLOR_JA[opp]}に${amount}追加`,
    };
    const applied = appliedPenaltySeconds(rule);
    if (applied !== undefined) penalty.timeAdjustmentSeconds = applied;

    const intended = input.claimMode === "about-to-appear";
    const keys: CitationKey[] = [
      "FIDE_9_2",
      "FIDE_9_2_3",
      "FIDE_9_5_3",
      ...rule.sources,
    ];
    if (input.competitionType === "standard")
      keys.push("JCF_NA_P69_INCORRECT_CLAIM");
    if (intended) keys.push("MANUAL_9_5_INTENDED_MOVE");
    keys.push("MANUAL_9_2_CHECK_PRESENCE");

    return this.out.decided({
      kind: "recommendation",
      conclusion:
        `${COLOR_JA[claimant]}のクレームは誤りです（同一局面が3回未満）。${COLOR_JA[opp]}に${amount}を加算し、対局を続行します。` +
        (rule.kind === "unverified"
          ? "B.2 は Competition Rules（7.5.5 / 9.5.3: 2分）を適用し、A.3 の1分規定を準用するのは B.3 のみのため文言上は2分ですが、CA・大会規定で確認してください。"
          : rule.kind === "tournament"
            ? tournamentPenaltyNote(rule)
            : ""),
      actions: [
        ...this.autoLine(auto),
        rule.kind === "fixed"
          ? `${COLOR_JA[opp]}の残り時間に${amount}加算する（9.5.3${input.competitionType === "standard" ? "" : " / A.3"}）`
          : rule.kind === "tournament"
            ? `${COLOR_JA[opp]}の残り時間に${amount}加算する（9.5.3 / ${tournamentPenaltyNote(rule)}）`
            : `${COLOR_JA[opp]}の残り時間に${amount}加算する（9.5.3）。CA・大会規定で加算時間を確認する`,
        ...(intended
          ? [
              "記入した手を指させる（第3条・第4条に従う。違法な手なら、その駒で別の手を指す）",
            ]
          : []),
        "時計を再開し、対局を続行する",
      ],
      intervention: "immediate",
      penalties: [penalty],
      sources: timePenaltyCitations(rule, keys),
      confidence:
        rule.kind === "unverified" ? "medium" : auto ? "medium" : "high",
      escalationRecommended: rule.kind === "unverified",
      escalationReason: rule.kind === "unverified" ? rule.reason : undefined,
    });
  }

  private fivefold(input: Partial<RepetitionInput>): DecisionTreeResult {
    const resolved = this.resolveCheck(
      input.conditionCheck,
      input.analysis,
      input.positionsText,
      (r) => (r.maxOccurrences >= 5 ? "met" : "not-met")
    );
    if (resolved === null || "error" in resolved) {
      return this.out.needsInput(
        [QUESTIONS.fivefoldCheck, QUESTIONS.positionsText],
        `五回同一局面（9.6.1）の確認が必要です。${resolved ? `\n${resolved.error}` : ""}`,
        cite("FIDE_9_6", "MANUAL_9_6_INTERVENE")
      );
    }
    if (resolved.outcome === "met") {
      return this.out.decided({
        kind: "recommendation",
        conclusion:
          "同じ局面が5回以上出現しています。プレーヤーのクレームは不要で、対局はドローです（9.6.1）。直ちに介入してください。",
        actions: [
          "直ちに時計を止めて介入する",
          ...this.autoLine(resolved.auto),
          "ドローを宣言する（9.6.1）",
          "結果を記録する",
        ],
        intervention: "immediate",
        penalties: [{ type: "draw", description: "ドロー（五回同一局面）" }],
        sources: cite(
          "FIDE_9_6",
          "FIDE_9_2_3",
          "MANUAL_9_6_INTERVENE",
          "JCF_NA_P70_FIVEFOLD_75"
        ),
        confidence: resolved.auto ? "medium" : "high",
        escalationRecommended: false,
      });
    }
    if (resolved.outcome === "not-met") {
      return this.out.decided({
        kind: "recommendation",
        conclusion:
          "同じ局面は5回未満のため、9.6.1 による介入は行いません。対局を続行します。",
        actions: [
          ...this.autoLine(resolved.auto),
          "介入しない（プレーヤーは手番で 9.2 のクレームができる）",
          "引き続き、同一局面の回数を記録しておく",
        ],
        intervention: "no-intervention",
        penalties: [],
        sources: cite("FIDE_9_6", "FIDE_9_2"),
        confidence: resolved.auto ? "medium" : "high",
        escalationRecommended: false,
      });
    }
    return this.unknownCheck("五回同一局面", [
      "FIDE_9_6",
      "MANUAL_9_6_INTERVENE",
    ]);
  }

  private seventyFive(input: Partial<RepetitionInput>): DecisionTreeResult {
    const resolved = this.resolveCheck(
      input.conditionCheck,
      input.analysis,
      input.positionsText,
      (r) =>
        r.format === "moves"
          ? // 9.6.2: 途中で一度でも 150 半手に達していれば成立
            r.maxHalfmoveClock >= SEVENTY_FIVE_MOVES_PLIES
            ? "met"
            : "not-met"
          : // FEN の halfmove clock は入力者が記入した値のため、確定には使わない
            "unknown"
    );
    const missing: FollowUpQuestion[] = [];
    if (resolved === null || "error" in resolved)
      missing.push(QUESTIONS.seventyFiveCheck, QUESTIONS.positionsText);
    // 自動判定（棋譜）では、150半手に達した局面がメイトかを棋譜から求める
    const autoCheckmate =
      resolved && !("error" in resolved) && resolved.auto
        ? resolved.auto.seventyFiveReachedWithCheckmate
        : undefined;
    const lastMoveCheckmate = autoCheckmate ?? input.lastMoveCheckmate;
    if (lastMoveCheckmate === undefined && input.conditionCheck !== "auto")
      missing.push(QUESTIONS.lastMoveCheckmate);
    if (missing.length > 0 || resolved === null || "error" in resolved) {
      return this.out.needsInput(
        missing,
        `75手ルール（9.6.2）の確認が必要です。${resolved && "error" in resolved ? `\n${resolved.error}` : ""}`,
        cite("FIDE_9_6", "MANUAL_9_6_INTERVENE")
      );
    }

    if (resolved.outcome === "met" && lastMoveCheckmate) {
      return this.out.decided({
        kind: "recommendation",
        conclusion:
          "75手に達した最後の手がチェックメイトのため、チェックメイトが優先されます（9.6.2）。",
        actions: ["チェックメイトによる結果を記録する"],
        intervention: "no-intervention",
        penalties: [],
        sources: cite("FIDE_9_6"),
        confidence: resolved.auto ? "medium" : "high",
        escalationRecommended: false,
      });
    }
    if (resolved.outcome === "met") {
      return this.out.decided({
        kind: "recommendation",
        conclusion:
          "両プレーヤーとも、ポーンの移動も駒取りもなく75手以上を指しています。対局はドローです（9.6.2）。直ちに介入してください。",
        actions: [
          "直ちに時計を止めて介入する",
          ...this.autoLine(resolved.auto),
          "ドローを宣言する（9.6.2）",
          "結果を記録する",
        ],
        intervention: "immediate",
        penalties: [{ type: "draw", description: "ドロー（75手ルール）" }],
        sources: cite(
          "FIDE_9_6",
          "MANUAL_9_6_INTERVENE",
          "JCF_NA_P70_FIVEFOLD_75"
        ),
        confidence: resolved.auto ? "medium" : "high",
        escalationRecommended: false,
      });
    }
    if (resolved.outcome === "not-met") {
      return this.out.decided({
        kind: "recommendation",
        conclusion: "75手に達していないため、9.6.2 による介入は行いません。",
        actions: [
          ...this.autoLine(resolved.auto),
          "介入しない（50手ルール 9.3 のクレームは手番のプレーヤーが行える）",
          "引き続き手数を記録しておく",
        ],
        intervention: "no-intervention",
        penalties: [],
        sources: cite("FIDE_9_6"),
        confidence: resolved.auto ? "medium" : "high",
        escalationRecommended: false,
      });
    }
    return this.unknownCheck("75手ルール", [
      "FIDE_9_6",
      "MANUAL_9_6_INTERVENE",
    ]);
  }

  private unknownCheck(label: string, keys: CitationKey[]): DecisionTreeResult {
    return this.out.decided({
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
}
