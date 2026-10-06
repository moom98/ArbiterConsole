import type {
  CompetitionType,
  IllegalMoveDetection,
  IllegalMoveSubtype,
  Penalty,
  PlayerColor,
  SupervisionRegime,
} from "@/lib/domain/entities";
import { cite, type CitationKey } from "@/lib/domain/rules/citations";
import {
  QUESTIONS,
  SUBTYPE_LABELS,
  type FollowUpQuestion,
} from "@/lib/domain/follow-up";
import {
  opponentTimePenalty,
  formatMinutes,
} from "@/lib/domain/rules/time-penalty";
import {
  describePriorIllegalMoves,
  type DecisionTreeResult,
  type PriorIllegalMove,
} from "./dt-001-illegal-move-standard";
import {
  COLOR_JA,
  isNonNegativeInteger,
  opponentOf,
  type TreeOutput,
} from "./tree-support";

/**
 * Rapid / Blitz の違法手（DT-002 / DT-003）で共通のペナルティ判断。
 *
 * 7.5.5 の構造（1回目: 相手に時間加算 / 2回目: 負け、ただし相手がメイト不可能ならドロー）は
 * Standard と同じ。加算時間は A.3（1分）による（Blitz B.2 は原典で確定できないため CA 確認）。
 * Standard の DT-001 とはコードを共有しない（要件 §17）。
 */
export interface FastPenaltyContext {
  competitionType: Exclude<CompetitionType, "standard">;
  regime: SupervisionRegime;
  color: PlayerColor;
  subtype: IllegalMoveSubtype;
  playerIncidentCount: unknown;
  priorIllegalMoves?: PriorIllegalMove[];
  opponentCanCheckmate?: boolean | "unknown";
  /** 判断の根拠として先頭に追加する条文（A.4 / A.5.2 / B.2 / B.3 など） */
  regimeSources: CitationKey[];
}

export const FAST_SUBTYPE_ARTICLE: Record<IllegalMoveSubtype, CitationKey> = {
  "illegal-move": "FIDE_7_5_1",
  "promotion-not-replaced": "FIDE_7_5_2",
  "clock-without-move": "FIDE_7_5_3",
  "two-hands": "FIDE_7_5_4",
};

export const COMPETITION_LABEL: Record<"rapid" | "blitz", string> = {
  rapid: "Rapid",
  blitz: "Blitz",
};

function restoreActions(
  color: PlayerColor,
  subtype: IllegalMoveSubtype
): string[] {
  switch (subtype) {
    case "promotion-not-replaced":
      return [
        `${COLOR_JA[color]}のポーンを同じ色のクイーンに置き換える（7.5.2）`,
      ];
    case "clock-without-move":
      return [`局面はそのまま、${COLOR_JA[color]}の手番で再開する（7.5.3）`];
    default:
      return [
        "局面を違反直前の局面に戻す（特定できない場合は、違反前で特定できる直近の局面）",
        "違法手の代わりの手にはタッチムーブ（4.3 / 4.7）が適用される",
      ];
  }
}

/** 違法手ペナルティ（7.5.5 + A.3）を判断する */
export function evaluateFastPenalty(
  out: TreeOutput,
  ctx: FastPenaltyContext
): DecisionTreeResult {
  const { color, subtype } = ctx;
  const label = COMPETITION_LABEL[ctx.competitionType];

  if (!isNonNegativeInteger(ctx.playerIncidentCount)) {
    return out.decided({
      kind: "manual-review",
      conclusion: `${COLOR_JA[color]}のこの対局での違法手回数を確定できません（値: ${String(ctx.playerIncidentCount)}）。判断を確定できません。`,
      actions: [
        "時計を止める",
        "この対局の違法手の記録を確認する",
        "CAへ確認する",
      ],
      intervention: "consult-ca",
      penalties: [],
      sources: cite(...ctx.regimeSources, "FIDE_7_5_5"),
      confidence: "low",
      escalationRecommended: true,
      escalationReason: "違法手回数の履歴が不正または取得できません",
    });
  }

  if (ctx.playerIncidentCount === 0) return firstOffence(out, ctx, label);

  const priorLines = describePriorIllegalMoves(
    ctx.priorIllegalMoves,
    ctx.playerIncidentCount
  );
  const article = FAST_SUBTYPE_ARTICLE[subtype];
  const canMate = ctx.opponentCanCheckmate;
  if (canMate === undefined) {
    return out.needsInput(
      [QUESTIONS.opponentCanCheckmate],
      `${label}: ${COLOR_JA[color]}の2回目の違法手（${SUBTYPE_LABELS[subtype]}）の可能性があります。結論には、相手がメイト可能な局面かの確認が必要です（7.5.5 ただし書き）。\n${priorLines.join("\n")}`,
      cite(...ctx.regimeSources, article, "FIDE_7_5_5")
    );
  }
  if (canMate === "unknown") {
    return out.decided({
      kind: "manual-review",
      conclusion: `${label}: ${COLOR_JA[color]}の2回目の違法手（${SUBTYPE_LABELS[subtype]}）ですが、相手がメイト可能な局面か判断できないため、結論（負け／ドロー）を確定できません。CAへ確認してください。`,
      actions: [
        "時計を止める",
        ...priorLines,
        "相手があらゆる合法手の連続で違反者のキングをメイトできるかをCAと確認する",
        "メイト可能なら違反者の負け、不可能ならドロー（7.5.5）",
      ],
      intervention: "consult-ca",
      penalties: [],
      sources: cite(...ctx.regimeSources, article, "FIDE_7_5_5"),
      confidence: "low",
      escalationRecommended: true,
      escalationReason:
        "7.5.5 ただし書き（相手がメイト不可能ならドロー）の該当性を判断できません",
    });
  }
  if (canMate === false) {
    return out.decided({
      kind: "recommendation",
      conclusion: `${label}: ${COLOR_JA[color]}の2回目の違法手（${SUBTYPE_LABELS[subtype]}）ですが、相手はどのような合法手の連続でもメイトできない局面のため、ドローとなります。`,
      actions: [
        "時計を止める",
        ...priorLines,
        "ドローを宣言する（7.5.5 ただし書き）",
        "結果を記録する",
      ],
      intervention: "immediate",
      penalties: [
        {
          type: "draw",
          playerColor: color,
          description: "ドロー（相手がメイト不可能な局面）",
        },
      ],
      sources: cite(
        ...ctx.regimeSources,
        article,
        "FIDE_7_5_5",
        "JCF_NA_P48_DRAW_EXCEPTION"
      ),
      confidence: subtype === "clock-without-move" ? "medium" : "high",
      escalationRecommended: false,
    });
  }
  const inconsistent = ctx.playerIncidentCount >= 2;
  return out.decided({
    kind: "recommendation",
    conclusion: `${label}: ${COLOR_JA[color]}の2回目の違法手（${SUBTYPE_LABELS[subtype]}）です。相手はメイト可能な局面のため、${COLOR_JA[color]}の負けとなります。`,
    actions: [
      "時計を止める",
      ...priorLines,
      `${COLOR_JA[color]}の負けを宣言する（7.5.5）`,
      "結果を記録する",
    ],
    intervention: "immediate",
    penalties: [
      {
        type: "game-loss",
        playerColor: color,
        description: `${COLOR_JA[color]}の負け`,
      },
    ],
    sources: cite(
      ...ctx.regimeSources,
      article,
      "FIDE_7_5_5",
      "MANUAL_A_ONE_MINUTE"
    ),
    confidence:
      inconsistent || subtype === "clock-without-move" ? "medium" : "high",
    escalationRecommended: inconsistent,
    escalationReason: inconsistent
      ? `記録上、${COLOR_JA[color]}にはすでに${ctx.playerIncidentCount}回の違法手ペナルティがあります。記録を確認してください。`
      : undefined,
  });
}

/** DT-002 / DT-003 の入力（構造化された回答 + 履歴） */
export interface IllegalMoveFastInput {
  playerColor: PlayerColor;
  subtype: IllegalMoveSubtype;
  gameEnded: boolean;
  clockPressed: boolean;
  opponentCanCheckmate: boolean | "unknown";
  /** A.5 / B.3 のみ */
  opponentMadeNextMove: boolean;
  /** A.5 / B.3 のみ */
  detectedBy: IllegalMoveDetection;
  /** IncidentCounter が算出した、この対局での違法手ペナルティ回数 */
  playerIncidentCount: number;
  priorIllegalMoves?: PriorIllegalMove[];
}

/**
 * 共通の前段: 基本事実の質問 → 対局終了後 → 時計未押下。
 * 判断が確定しない場合は null を返す。
 * extraFirstRound: ツリー固有の未回答の質問（基本事実と同じラウンドで質問する）
 */
export function evaluateFastPreliminaries(
  out: TreeOutput,
  input: Partial<IllegalMoveFastInput>,
  label: string,
  regimeSources: CitationKey[],
  extraFirstRound: FollowUpQuestion[] = []
): DecisionTreeResult | null {
  const basic: FollowUpQuestion[] = [];
  if (input.playerColor === undefined) basic.push(QUESTIONS.playerColor);
  if (input.subtype === undefined) basic.push(QUESTIONS.subtype);
  if (input.gameEnded === undefined) basic.push(QUESTIONS.gameEnded);
  if (
    input.clockPressed === undefined &&
    input.subtype !== "clock-without-move"
  )
    basic.push(QUESTIONS.clockPressed);
  if (basic.length > 0) return out.needsInput([...basic, ...extraFirstRound]);

  const color = input.playerColor as PlayerColor;
  const subtype = input.subtype as IllegalMoveSubtype;

  if (input.gameEnded) {
    return out.decided({
      kind: "recommendation",
      conclusion: `${label}: 対局終了後に判明した${COLOR_JA[color]}の違法手（${SUBTYPE_LABELS[subtype]}）です。訂正はできず、結果はそのまま確定します。`,
      actions: [
        "局面・結果の訂正は行わない",
        "結果をそのまま記録する",
        "対局終了の有無が明確でない場合はCAへ確認する",
      ],
      intervention: "no-intervention",
      penalties: [],
      sources: cite(...regimeSources, "MANUAL_7_5_GAME_OVER", "FIDE_8_7"),
      confidence: "high",
      escalationRecommended: false,
    });
  }

  const clockPressed =
    subtype === "clock-without-move" ? true : input.clockPressed;
  if (!clockPressed) {
    const twoHands = subtype === "two-hands";
    const extraKeys: CitationKey[] = twoHands
      ? ["FIDE_4_1", "MANUAL_4_INTERVENE"]
      : ["FIDE_4_3", "FIDE_4_7"];
    return out.decided({
      kind: "recommendation",
      conclusion: twoHands
        ? `${label}: ${COLOR_JA[color]}は時計を押していないため、7.5.4（両手による着手）の違法手は成立していません。ただし第4.1条（片手で指す）違反として介入が必要です。`
        : `${label}: ${COLOR_JA[color]}は時計を押していないため、違法手は成立していません。違法手のペナルティはありません。`,
      actions: twoHands
        ? [
            "時計を止めて介入する",
            "違法手としてのペナルティ（7.5.5）は科さない",
            "第4.1条違反への対応（12.9 の罰則の要否）はCAへ確認する",
          ]
        : [
            "違法手としてのペナルティは科さない",
            "プレーヤーが手を訂正する場合、タッチムーブ（4.3 / 4.7）が適用される",
            "時計が押された時点で違法手が成立する",
          ],
      intervention: twoHands ? "immediate" : "no-intervention",
      penalties: [],
      sources: cite("FIDE_7_5_1", "MANUAL_7_5_NOT_COMPLETED", ...extraKeys),
      confidence: twoHands ? "medium" : "high",
      escalationRecommended: twoHands,
      escalationReason: twoHands
        ? "第4.1条違反の罰則は決定木の対象外です"
        : undefined,
    });
  }
  return null;
}

function firstOffence(
  out: TreeOutput,
  ctx: FastPenaltyContext,
  label: string
): DecisionTreeResult {
  const { color, subtype } = ctx;
  const opp = opponentOf(color);
  const rule = opponentTimePenalty(ctx.competitionType, ctx.regime);
  const article = FAST_SUBTYPE_ARTICLE[subtype];

  const keys: CitationKey[] = [...ctx.regimeSources, article];
  if (subtype !== "illegal-move" && subtype !== "promotion-not-replaced")
    keys.push("FIDE_7_5_1");
  keys.push("FIDE_7_5_5", ...rule.sources);
  if (ctx.competitionType === "rapid") keys.push("MANUAL_A_ONE_MINUTE");
  if (subtype === "illegal-move" || subtype === "two-hands")
    keys.push("FIDE_4_3", "FIDE_4_7");
  if (subtype === "two-hands") keys.push("MANUAL_7_5_COUNT_ONCE");
  if (subtype === "clock-without-move")
    keys.push("MANUAL_7_5_3_CLOCK_IN_ERROR");
  keys.push("MANUAL_7_5_FAST_INCREMENT");

  const amount =
    rule.kind === "fixed"
      ? formatMinutes(rule.seconds)
      : "（加算時間はCAへ確認）";
  const penalty: Penalty = {
    type: "time-addition-opponent",
    playerColor: opp,
    description:
      rule.kind === "fixed"
        ? `${COLOR_JA[opp]}に${amount}追加`
        : `${COLOR_JA[opp]}に時間を追加（加算時間はCAへ確認）`,
  };
  if (rule.kind === "fixed") penalty.timeAdjustmentSeconds = rule.seconds;

  const actions = ["時計を止める"];
  if (subtype === "clock-without-move")
    actions.push(
      "相手の時計が誤って始動された場合は、違法手か妨害（distraction）かをアービターが判断する"
    );
  actions.push(
    ...restoreActions(color, subtype),
    rule.kind === "fixed"
      ? `${COLOR_JA[opp]}の時計に${amount}加算する（7.5.5 / A.3）`
      : `${COLOR_JA[opp]}の時計に時間を加算する。加算時間（1分 / 2分）はCAへ確認する`,
    `インクリメントがある場合、違法手で${COLOR_JA[color]}に加算されたインクリメント分を差し引く`
  );
  if (subtype === "two-hands")
    actions.push(
      "同じ手の中の複数の違反（例: 両手による違法キャスリング）は1回として数える"
    );
  actions.push(
    `${COLOR_JA[color]}の2回目の違法手は原則として負けとなる（7.5.5）`,
    "時計を再開する"
  );

  const unverified = rule.kind === "unverified";
  return out.decided({
    kind: "recommendation",
    conclusion: unverified
      ? `${label}: ${COLOR_JA[color]}の1回目の違法手（${SUBTYPE_LABELS[subtype]}）です。${COLOR_JA[opp]}に時間を加算します（加算時間はCAへ確認）。`
      : `${label}: ${COLOR_JA[color]}の1回目の違法手（${SUBTYPE_LABELS[subtype]}）です。${COLOR_JA[opp]}に${amount}を加算します。`,
    actions,
    intervention: "immediate",
    penalties: [penalty],
    sources: cite(...keys),
    confidence:
      unverified || subtype === "clock-without-move" ? "medium" : "high",
    escalationRecommended: unverified,
    escalationReason: unverified ? rule.reason : undefined,
  });
}
