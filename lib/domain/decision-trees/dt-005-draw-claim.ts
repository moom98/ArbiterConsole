import {
  drawClaimBasisOf,
  type DrawClaimBasis,
  type Penalty,
  type PlayerColor,
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
import type { RepetitionAnalysis } from "@/lib/domain/services/position-analysis";
import type { DecisionTreeResult } from "./dt-001-illegal-move-standard";
import {
  autoLine,
  automaticDrawNotes,
  confirmText,
  confirmedHistory,
  resolveCheck,
  type DrawTreeInput,
} from "./draw-shared";
import { COLOR_JA, TreeOutput, opponentOf } from "./tree-support";

/**
 * DT-005 Draw Claim の ID。旧名（Repetition）のまま変えない: 保存済みの判断の treeId と
 * 互換を保つため（ADR-014 §1）。
 */
export const DT_005_ID = "DT-005-repetition" as const;

/** 50手 = 両プレーヤー各50手 = 100 半手（9.3） */
export const FIFTY_MOVES_PLIES = 100;

export type DrawClaimInput = DrawTreeInput;

/** クレームの根拠ごとの違い（9.2 三回同一局面 / 9.3 50手） */
interface ClaimBasisSpec {
  /** 条文（"9.2" / "9.3"） */
  article: string;
  /** 「三回同一局面」「50手ルール」 */
  name: string;
  /** 盤上で再現した確認結果の質問 */
  checkQuestion: FollowUpQuestion;
  /** クレームの条文 */
  lawKeys: CitationKey[];
  /** 正しいクレームの追加の根拠 */
  metKeys: CitationKey[];
  /** 自動判定（対象局面: 最後の局面、または記入した手を指した後の局面） */
  isMet: (r: RepetitionAnalysis) => boolean;
  metText: string;
  notMetText: string;
  checkHint: string;
}

const BASIS: Record<DrawClaimBasis, ClaimBasisSpec> = {
  threefold: {
    article: "9.2",
    name: "三回同一局面",
    checkQuestion: QUESTIONS.repetitionCheck,
    lawKeys: ["FIDE_9_2", "FIDE_9_2_3"],
    metKeys: ["JCF_NA_P65_SAME_POSITION", "JCF_NA_P67_CLAIM_LATER"],
    isMet: (r) => r.targetOccurrences >= 3,
    metText: "同一局面が3回以上",
    notMetText: "同一局面が3回未満",
    checkHint: "同一局面の回数",
  },
  "fifty-move": {
    article: "9.3",
    name: "50手ルール",
    checkQuestion: QUESTIONS.fiftyMoveCheck,
    lawKeys: ["FIDE_9_3"],
    metKeys: ["JCF_NA_P67_CLAIM_LATER"],
    isMet: (r) => r.halfmoveClock >= FIFTY_MOVES_PLIES,
    metText:
      "両プレーヤーとも直近50手以上を、ポーンの移動も駒取りもなく指している",
    notMetText:
      "ポーンの移動も駒取りもない手数が、両プレーヤー各50手に達していない",
    checkHint: "ポーンの移動・駒取りのない手数",
  },
};

/**
 * DT-005: Draw Claim（FIDE Laws 2023 Art. 9.2, 9.3, 9.4, 9.5。ADR-014 §1）
 *
 * クレームの根拠（claimBasis: 三回同一局面 9.2 / 50手 9.3）を subtype から求め、
 * 手順（申立人・手番・9.2.1/9.3.1 の記入・9.4 の駒への接触）を共通に扱う。
 *
 * - 手番は、盤上で最後に手を指した側（lastMover）、または照合済みの対局履歴から求める。
 *   時計の状態からは求めない（ADR-014 §2）。
 * - 条件の確認は、対局履歴（game.history）の自動判定、または盤上での手動再現。
 *   自動判定では両プレーヤーの面前での確認を必ず求める。
 * - 正しいクレーム → ドロー（9.5.2）。誤ったクレーム → 9.5.3。確認できない → CA。
 */
export class DrawClaimTree {
  private readonly out: TreeOutput;

  constructor(providers: DomainProviders, rulesVersion = "FIDE-2023") {
    this.out = new TreeOutput(providers, DT_005_ID, rulesVersion);
  }

  evaluate(input: Partial<DrawClaimInput>): DecisionTreeResult {
    const basis = drawClaimBasisOf(input.subtype);
    if (!basis) return this.out.needsInput([QUESTIONS.drawSubtype]);
    // "met-checkmate" は 75手（9.6.2）の確認だけの値。クレームでは未回答として扱う
    const normalized =
      input.conditionCheck === "met-checkmate"
        ? { ...input, conditionCheck: undefined }
        : input;
    return this.claim(normalized, BASIS[basis]);
  }

  // ---------------------------------------------------------------------------

  private claim(
    input: Partial<DrawClaimInput>,
    spec: ClaimBasisSpec
  ): DecisionTreeResult {
    // 照合済みの対局履歴があれば、手番はそこから求める（最後に指した側を尋ねない）
    const history = confirmedHistory(input);
    const historyPending =
      input.conditionCheck === "auto" &&
      !!input.positionsText &&
      input.analysis?.ok === true;
    const basic: FollowUpQuestion[] = [];
    if (input.claimant === undefined) basic.push(QUESTIONS.claimant);
    if (input.lastMover === undefined && !history && !historyPending)
      basic.push(QUESTIONS.lastMover);
    if (input.claimMode === undefined) basic.push(QUESTIONS.claimMode);
    if (input.touchedPiece === undefined) basic.push(QUESTIONS.touchedPiece);
    if (basic.length > 0) return this.out.needsInput(basic);

    const claimant = input.claimant as PlayerColor;

    if (input.lastMover === claimant)
      return this.notOnMove(spec, claimant, "last-mover");

    // 最後に指した側が未回答なら、手番は照合済みの履歴から求める。照合前は、手番が
    // 分かるまで 9.4・9.x.1 の判断をせず、先に履歴の照合（下の確認）へ進む
    const sideKnown = input.lastMover !== undefined || history !== undefined;
    if (
      history &&
      input.lastMover === undefined &&
      history.sideToMove !== claimant
    )
      return this.notOnMove(spec, claimant, "history");

    if (sideKnown && input.touchedPiece) {
      return this.out.decided({
        kind: "recommendation",
        conclusion: `${COLOR_JA[claimant]}は動かす・取る意思で駒に触れたため、この手番では ${spec.article} のクレーム権を失っています（9.4）。`,
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

    if (sideKnown && input.claimMode === "about-to-appear") {
      if (input.moveWritten === undefined)
        return this.out.needsInput([QUESTIONS.moveWritten]);
      if (!input.moveWritten) {
        return this.out.decided({
          kind: "recommendation",
          conclusion: `${spec.article}.1 のクレームには、指す手を棋譜に記入しアービターに宣言することが必要です。クレームを却下せず「Make your claim legal」と伝えます。`,
          actions: [
            "「Make your claim legal（正しい手順でクレームしてください）」と伝える",
            "指す手を棋譜に記入し、その手を指す意思を宣言させる",
            "手順が整ったら、このIncidentを再評価する",
          ],
          intervention: "immediate",
          penalties: [],
          sources: cite(...spec.lawKeys, "MANUAL_9_2_MAKE_CLAIM_LEGAL"),
          confidence: "high",
          escalationRecommended: false,
        });
      }
    }

    const checkSources = cite(
      ...spec.lawKeys,
      "FIDE_9_5_1",
      "MANUAL_9_2_CHECK_PRESENCE",
      "FIDE_11_12"
    );
    let sideConflict = false;
    const intendedMissing =
      input.claimMode === "about-to-appear" &&
      input.conditionCheck === "auto" &&
      !input.intendedMove;
    const resolved = intendedMissing
      ? {
          error: `${spec.article}.1 のクレームを自動判定するには、記入した次の手（例: Ng8）を入力してください。`,
        }
      : resolveCheck(input, {
          autoOutcome: (r, complete) =>
            spec.isMet(r) ? "met" : complete ? "not-met" : "inconclusive",
          // 最後に指した側の回答と、棋譜の最終局面の手番が食い違う場合は棋譜を使わない
          validate: (r) => {
            if (input.lastMover === undefined || r.sideToMove === claimant)
              return undefined;
            sideConflict = true;
            return `入力された棋譜の最後の局面は${COLOR_JA[r.sideToMove]}の手番ですが、最後に盤上で指したのは${COLOR_JA[input.lastMover]}と回答されています。棋譜と回答を確認するか、盤上で手順を再現して確認してください。`;
          },
          // 最後に指した側が未回答の場合は、照合済みの履歴の手番を使う
          afterConfirmed: (r) =>
            input.lastMover === undefined && r.sideToMove !== claimant
              ? this.notOnMove(spec, claimant, "history")
              : undefined,
        });
    const intro = `${COLOR_JA[claimant]}の${spec.name}のクレーム（${spec.article}）です。`;
    if (resolved !== null && "result" in resolved) return resolved.result;
    if (resolved !== null && "confirm" in resolved)
      return this.out.needsInput(
        [QUESTIONS.historyConfirmed],
        `${intro}時計を止めたまま、両プレーヤーの面前で確認してください。\n${confirmText(resolved.confirm)}`,
        checkSources
      );
    if (resolved === null || "error" in resolved) {
      const qs: FollowUpQuestion[] = [spec.checkQuestion];
      // 履歴が使えない（未入力・検証失敗・照合不一致）場合、手番は最後に指した側から求める。
      // 棋譜と手番が食い違った場合は、回答を直せるように再度尋ねる
      if (input.lastMover === undefined || sideConflict)
        qs.push(QUESTIONS.lastMover);
      qs.push(QUESTIONS.positionsText);
      if (input.claimMode === "about-to-appear")
        qs.push(QUESTIONS.intendedMove);
      return this.out.needsInput(
        qs,
        `${intro}時計を止め、両プレーヤーの面前で${spec.checkHint}を確認してください。${resolved ? `\n${resolved.error}` : ""}`,
        checkSources
      );
    }
    // 手動の確認では、手番は最後に指した側から求める（履歴がないため）
    if (input.lastMover === undefined && !resolved.auto)
      return this.out.needsInput(
        [QUESTIONS.lastMover],
        `${intro}クレームできるのは手番のプレーヤーだけです。盤上で最後に手を指した側を確認してください。`,
        checkSources
      );

    if (resolved.outcome === "met" || resolved.outcome === "met-checkmate") {
      const notes = automaticDrawNotes(resolved.auto);
      return this.out.decided({
        kind: "recommendation",
        conclusion: `${COLOR_JA[claimant]}のクレームは正しいです（${spec.metText}）。ドローです。`,
        actions: [
          "時計を止める（9.5.1）",
          ...autoLine(resolved.auto, input.historyConfirmed),
          ...notes,
          "ドローを宣言する（9.5.2）",
          "結果を記録する",
        ],
        intervention: "immediate",
        penalties: [{ type: "draw", description: `ドロー（${spec.name}）` }],
        sources: cite(
          ...spec.lawKeys,
          "FIDE_9_5_2",
          "MANUAL_9_2_CHECK_PRESENCE",
          ...spec.metKeys,
          ...this.fastClaimSources(input)
        ),
        confidence: resolved.auto ? "medium" : "high",
        escalationRecommended: notes.length > 0,
        escalationReason:
          notes.length > 0
            ? "9.6 の自動ドロー（五回同一局面・75手）の可能性があります"
            : undefined,
      });
    }

    if (resolved.outcome === "unknown") {
      return this.out.decided({
        kind: "manual-review",
        conclusion: `${COLOR_JA[claimant]}のクレームの正否を確認できません。CAへ確認してください。`,
        actions: [
          "時計を止めたままにする（9.5.1: クレームは取り下げられない）",
          `両プレーヤーの面前で対局を再現し、${spec.checkHint}を確認する`,
          "CAへ確認する",
        ],
        intervention: "consult-ca",
        penalties: [],
        sources: checkSources,
        confidence: "low",
        escalationRecommended: true,
        escalationReason: `${spec.checkHint}を確認できません`,
      });
    }

    return this.incorrectClaim(input, spec, claimant, resolved.auto);
  }

  /** 申立人の手番ではない（手番は最後に指した側、または照合済みの履歴から求める） */
  private notOnMove(
    spec: ClaimBasisSpec,
    claimant: PlayerColor,
    from: "last-mover" | "history"
  ): DecisionTreeResult {
    const why =
      from === "last-mover"
        ? `盤上で最後に手を指したのは${COLOR_JA[claimant]}のため`
        : "照合した棋譜の最終局面では";
    return this.out.decided({
      kind: "recommendation",
      conclusion: `${why}、${COLOR_JA[claimant]}の手番ではありません。${spec.article} のクレームができるのは手番のプレーヤーだけです。`,
      actions: [
        `${COLOR_JA[claimant]}に、自分の手番でクレームできることを説明する`,
        "この時点でのクレームとして条件の確認は行わない",
        "罰則の要否が問題になる場合はCAへ確認する",
      ],
      intervention: "immediate",
      penalties: [],
      sources: cite(
        ...spec.lawKeys,

        "JCF_NA_P67_OWN_MOVE"
      ),
      confidence: from === "history" ? "medium" : "high",
      escalationRecommended: false,
    });
  }

  private fastClaimSources(input: Partial<DrawClaimInput>): CitationKey[] {
    if (input.competitionType === "rapid") return ["FIDE_A_2"];
    if (
      input.competitionType === "blitz" &&
      input.supervisionRegime === "basic-rules"
    )
      return ["FIDE_B_3", "FIDE_A_2"];
    return [];
  }

  private incorrectClaim(
    input: Partial<DrawClaimInput>,
    spec: ClaimBasisSpec,
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
      ...spec.lawKeys,
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
        `${COLOR_JA[claimant]}のクレームは誤りです（${spec.notMetText}）。${COLOR_JA[opp]}に${amount}を加算し、対局を続行します。` +
        (rule.kind === "unverified"
          ? "B.2 は Competition Rules（7.5.5 / 9.5.3: 2分）を適用し、A.3 の1分規定を準用するのは B.3 のみのため文言上は2分ですが、CA・大会規定で確認してください。"
          : rule.kind === "tournament"
            ? tournamentPenaltyNote(rule)
            : ""),
      actions: [
        ...autoLine(auto, input.historyConfirmed),
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
}
