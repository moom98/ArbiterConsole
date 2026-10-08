import type {
  Decision,
  GameEndEvent,
  GameRecordState,
  IllegalMoveFacts,
  IllegalMoveSubtype,
  PlayerColor,
  RuleCitation,
} from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import {
  CITATIONS,
  cite,
  type CitationKey,
} from "@/lib/domain/rules/citations";
import {
  QUESTIONS,
  SUBTYPE_LABELS,
  type FollowUpQuestion,
} from "@/lib/domain/follow-up";
import { buildDecision, type DecisionFields } from "./build-decision";
import type { MatePossibility } from "@/lib/domain/services/mate-possibility";
import { mateStep, reinstatedPositionQuestions } from "./mate-position";
import {
  GAME_END_EVENT_LABELS,
  gameEndedFromEvent,
  recordStateAction,
} from "@/lib/domain/services/game-end";

export const DT_001_ID = "DT-001-illegal-move-standard" as const;
export const DT_001_RULES_VERSION = "FIDE-2023";

/**
 * DT-001 の入力。Standard（FIDE Laws of Chess 2023, Article 7.5）専用。
 * Rapid / Blitz の判断にはこの Tree を使用しない（要件 §17）。
 */
export interface IllegalMoveStandardInput extends Omit<
  IllegalMoveFacts,
  "gameEnded"
> {
  /** 違反したプレーヤー */
  playerColor: PlayerColor;
  /**
   * この対局で同じプレーヤーに対して既に違法手ペナルティ（7.5.5）が適用された回数。
   * IncidentCounter が算出する。非負整数でなければならない。
   */
  playerIncidentCount: number;
  /**
   * 数えた違法手の明細（アービターが回数を確認できるよう、2回目の判断に表示する）。
   * IncidentCounter が算出する。
   */
  priorIllegalMoves?: PriorIllegalMove[];
  /**
   * 違法手の直前に戻した局面によるメイト可能性（DecisionEngine が assessMatePossibility で算出。
   * ADR-014 §5）。matePosition = "fen" のときに使う
   */
  mate?: MatePossibility;
}

/**
 * 対局終了後に判明した違法手（DT-001〜003 共通）の結論・対応・信頼度。
 * 「その他」の出来事は終了の根拠をアービターが確かめる（ADR-014 §3）
 */
export function gameEndedFields(
  what: string,
  event: GameEndEvent,
  recordState: GameRecordState | undefined
): Pick<
  DecisionFields,
  "conclusion" | "actions" | "confidence" | "escalationRecommended"
> & { endSources: CitationKey[] } {
  const recordAction = recordStateAction(recordState);
  const end = endEventCheck(event);
  return {
    conclusion: `対局終了後（${GAME_END_EVENT_LABELS[event]}）に判明した${what}です。訂正はできず、結果はそのまま確定します。`,
    actions: [
      "局面・結果の訂正は行わない",
      "結果をそのまま記録する",
      ...(recordAction ? [recordAction] : []),
      ...(end ? [end.action] : []),
      event === "other"
        ? "対局を終わらせた出来事（終了の根拠）を確認し、明確でなければCAへ確認する"
        : "対局終了の有無が明確でない場合はCAへ確認する",
    ],
    confidence: event === "other" || end ? "medium" : "high",
    escalationRecommended: false,
    endSources: end?.sources ?? [],
  };
}

/**
 * チェックメイト・ステイルメイトは、その局面を作った手が第3条・4.2〜4.7 に従っている場合
 * だけ対局を終わらせる（5.1.1 / 5.2.1）。違法な手によるものなら対局は終わっていない。
 * DT-001〜004 の「終了していた」判断で、その確認を求める
 */
export function endEventCheck(
  event: string
): { action: string; sources: CitationKey[] } | undefined {
  if (event === "checkmate")
    return {
      action:
        "チェックメイトの局面を作った手が合法だったか確認する（違法な手によるメイトでは対局は終了していない。5.1.1）",
      sources: ["FIDE_5_1_1"],
    };
  if (event === "stalemate")
    return {
      action:
        "ステイルメイトの局面を作った手が合法だったか確認する（違法な手によるステイルメイトでは対局は終了していない。5.2.1）",
      sources: ["FIDE_5_2_1"],
    };
  return undefined;
}

/** これまでに違法手ペナルティが適用された Incident の要約 */
export interface PriorIllegalMove {
  incidentId: string;
  reportedAt: Date;
  subtype?: IllegalMoveSubtype;
}

export type DecisionTreeResult =
  | { status: "decided"; decision: Decision }
  | {
      status: "needs-input";
      decision: Decision;
      questions: FollowUpQuestion[];
    };

const COLOR_JA: Record<PlayerColor, string> = { white: "白", black: "黒" };

function opponentOf(color: PlayerColor): PlayerColor {
  return color === "white" ? "black" : "white";
}

/** subtype ごとの、違法手とみなす根拠条文 */
const SUBTYPE_ARTICLE: Record<IllegalMoveSubtype, CitationKey> = {
  "illegal-move": "FIDE_7_5_1",
  "promotion-not-replaced": "FIDE_7_5_2",
  "clock-without-move": "FIDE_7_5_3",
  "two-hands": "FIDE_7_5_4",
};

/** 7.5.1 による局面の復元・タッチムーブが適用される subtype */
function replacesMove(subtype: IllegalMoveSubtype): boolean {
  return subtype === "illegal-move" || subtype === "two-hands";
}

function isNonNegativeInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

function formatTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** 数えた違法手の確認用の行（例: "記録済み 1回目: 10:23 通常の違法手"） */
export function describePriorIllegalMoves(
  prior: PriorIllegalMove[] | undefined,
  count: number
): string[] {
  if (!prior || prior.length === 0) {
    return [`記録上の違法手 ${count}回（明細なし）: 記録を確認する`];
  }
  return prior.map(
    (p, i) =>
      `記録済み ${i + 1}回目: ${formatTime(p.reportedAt)} ${
        p.subtype ? SUBTYPE_LABELS[p.subtype] : "種別不明"
      }（この回数で正しいか確認する）`
  );
}

/**
 * DT-001: Illegal Move (Standard)
 *
 * FIDE Laws of Chess 2023 Article 7.5.1–7.5.5（および 4.3 / 4.7）に基づく決定木。
 * 入力不足時は追加質問を返し、推測で判断しない。
 */
export class IllegalMoveStandardTree {
  constructor(private readonly providers: DomainProviders) {}

  evaluate(input: Partial<IllegalMoveStandardInput>): DecisionTreeResult {
    // 1. 基本事実（互いに独立なので同時に質問する）
    const basic: FollowUpQuestion[] = [];
    if (input.playerColor === undefined) basic.push(QUESTIONS.playerColor);
    if (input.subtype === undefined) basic.push(QUESTIONS.subtype);
    if (input.endEvent === undefined)
      basic.push(QUESTIONS.gameEndEvent, QUESTIONS.gameRecordState);
    // 時計の質問も同じラウンドで行う（7.5.3 と分かっている場合は不要）
    if (
      basic.length > 0 &&
      input.clockPressed === undefined &&
      input.subtype !== "clock-without-move"
    ) {
      basic.push(QUESTIONS.clockPressed);
    }
    if (basic.length > 0) return this.needsInput(basic);

    const color = input.playerColor as PlayerColor;
    const subtype = input.subtype as IllegalMoveSubtype;

    // 2. 対局終了後に判明 → 訂正不可、結果は確定。終了は観察した出来事から求める
    // （握手だけでは終了としない。ADR-014 §3）
    if (gameEndedFromEvent(input.endEvent))
      return this.decided(
        this.gameEnded(
          color,
          subtype,
          input.endEvent as GameEndEvent,
          input.recordState
        )
      );

    // 3. 時計を押したか（7.5.3 は定義上押している）
    const clockPressed =
      subtype === "clock-without-move" ? true : input.clockPressed;
    if (clockPressed === undefined)
      return this.needsInput([QUESTIONS.clockPressed]);
    if (!clockPressed) {
      return this.decided(
        subtype === "two-hands"
          ? this.twoHandsNotCompleted(color)
          : this.notCompleted(color)
      );
    }

    // 4. 違法手回数（システムが提供）。不正値で負けを出さない
    if (!isNonNegativeInteger(input.playerIncidentCount)) {
      return this.decided(this.invalidCount(color, input.playerIncidentCount));
    }
    const priorCount = input.playerIncidentCount;

    // 5. 1回目 → 相手に2分
    if (priorCount === 0)
      return this.decided(this.firstOffence(color, subtype));

    // 6. 2回目 → 原則負け。ただし相手がメイト不可能ならドロー（7.5.5）
    const priorLines = describePriorIllegalMoves(
      input.priorIllegalMoves,
      priorCount
    );
    const step = mateStep(input.matePosition, input.mate);
    if (step.kind === "ask") {
      return this.needsInput(
        reinstatedPositionQuestions(),
        `${COLOR_JA[color]}の2回目の違法手（${SUBTYPE_LABELS[subtype]}）の可能性があります。結論には、相手がメイト可能な局面かの判定が必要です（7.5.5 ただし書き）。違法手の直前に戻した局面を入力してください。${step.error ? `\n${step.error}` : ""}\n${priorLines.join("\n")}`,
        cite(
          SUBTYPE_ARTICLE[subtype],
          "FIDE_7_5_5",
          "JCF_NA_P48_DRAW_EXCEPTION"
        )
      );
    }
    if (step.kind === "unknown")
      return this.decided(
        this.secondOffenceMateUnknown(color, subtype, priorLines, step.reason)
      );
    if (step.kind === "cannot-mate")
      return this.decided(
        this.secondOffenceDraw(color, subtype, priorLines, step.reason)
      );
    return this.decided(
      this.secondOffenceLoss(color, subtype, priorCount, priorLines, step.line)
    );
  }

  // ---------------------------------------------------------------------------

  private decided(fields: DecisionFields): DecisionTreeResult {
    return {
      status: "decided",
      decision: buildDecision(this.providers, fields),
    };
  }

  private needsInput(
    questions: FollowUpQuestion[],
    conclusion = "判断に必要な情報が不足しています。以下の質問に回答してください。",
    sources: RuleCitation[] = []
  ): DecisionTreeResult {
    // 任意の質問（結果の記入・署名の状態など）は不足項目に含めない
    const labels = questions.filter((q) => !q.optional).map((q) => q.label);
    const decision = buildDecision(this.providers, {
      ...this.base(),
      kind: "follow-up-required",
      conclusion,
      actions: labels,
      intervention: "consult-ca",
      penalties: [],
      sources,
      confidence: "low",
      escalationRecommended: false,
      missingFields: labels,
    });
    return { status: "needs-input", decision, questions };
  }

  private base(): Pick<
    DecisionFields,
    "incidentId" | "treeId" | "rulesVersion"
  > {
    return {
      incidentId: "",
      treeId: DT_001_ID,
      rulesVersion: DT_001_RULES_VERSION,
    };
  }

  private gameEnded(
    color: PlayerColor,
    subtype: IllegalMoveSubtype,
    event: GameEndEvent,
    recordState: GameRecordState | undefined
  ): DecisionFields {
    const ended = gameEndedFields(
      `${COLOR_JA[color]}の違法手（${SUBTYPE_LABELS[subtype]}）`,
      event,
      recordState
    );
    const { endSources, ...fields } = ended;
    return {
      ...this.base(),
      kind: "recommendation",
      ...fields,
      intervention: "no-intervention",
      penalties: [],
      sources: cite(
        "FIDE_7_5_1",
        "MANUAL_7_5_GAME_OVER",
        "FIDE_8_7",
        "JCF_NA_P47_GAME_OVER",
        ...endSources
      ),
    };
  }

  private notCompleted(color: PlayerColor): DecisionFields {
    return {
      ...this.base(),
      kind: "recommendation",
      conclusion: `${COLOR_JA[color]}は時計を押していないため、違法手は成立していません。違法手のペナルティはありません。`,
      actions: [
        "違法手としてのペナルティは科さない",
        "プレーヤーが手を訂正する場合、タッチムーブ（4.3 / 4.7）が適用される：最初に触れた指せる駒を動かす",
        "時計が押された時点で違法手が成立する",
      ],
      intervention: "no-intervention",
      penalties: [],
      sources: cite(
        "FIDE_7_5_1",
        "MANUAL_7_5_NOT_COMPLETED",
        "FIDE_4_3",
        "FIDE_4_7"
      ),
      confidence: "high",
      escalationRecommended: false,
    };
  }

  private twoHandsNotCompleted(color: PlayerColor): DecisionFields {
    return {
      ...this.base(),
      kind: "recommendation",
      conclusion: `${COLOR_JA[color]}は時計を押していないため、7.5.4（両手による着手）の違法手は成立していません。ただし第4.1条（片手で指す）違反として介入が必要です。`,
      actions: [
        "時計を止めて介入する",
        "違法手としてのペナルティ（7.5.5）は科さない",
        "第4.1条違反への対応（12.9 の罰則の要否）はCAへ確認する",
      ],
      intervention: "immediate",
      penalties: [],
      sources: cite("FIDE_4_1", "MANUAL_4_INTERVENE", "FIDE_7_5_4"),
      confidence: "medium",
      escalationRecommended: true,
      escalationReason: "第4.1条違反の罰則は決定木の対象外です",
    };
  }

  private invalidCount(color: PlayerColor, value: unknown): DecisionFields {
    return {
      ...this.base(),
      kind: "manual-review",
      conclusion: `${COLOR_JA[color]}のこの対局での違法手回数を確定できません（値: ${String(value)}）。判断を確定できません。`,
      actions: [
        "時計を止める",
        "この対局の違法手の記録を確認する",
        "CAへ確認する",
      ],
      intervention: "consult-ca",
      penalties: [],
      sources: cite("FIDE_7_5_5"),
      confidence: "low",
      escalationRecommended: true,
      escalationReason: "違法手回数の履歴が不正または取得できません",
    };
  }

  private restoreActions(
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
          "違法手の代わりの手にはタッチムーブ（4.3 / 4.7）が適用される：可能であれば最初に触れた駒（違法に動かした駒、または取った駒）で指す",
        ];
    }
  }

  private firstOffence(
    color: PlayerColor,
    subtype: IllegalMoveSubtype
  ): DecisionFields {
    const opp = opponentOf(color);
    const sourceKeys: CitationKey[] = [SUBTYPE_ARTICLE[subtype]];
    if (subtype !== "illegal-move" && subtype !== "promotion-not-replaced")
      sourceKeys.push("FIDE_7_5_1");
    sourceKeys.push("FIDE_7_5_5");
    if (replacesMove(subtype))
      sourceKeys.push(
        "FIDE_4_3",
        "FIDE_4_7",
        "MANUAL_7_5_TOUCH_MOVE",
        "JCF_NA_P47_TOUCH_MOVE"
      );
    if (subtype === "two-hands") sourceKeys.push("MANUAL_7_5_COUNT_ONCE");
    if (subtype === "clock-without-move")
      sourceKeys.push("MANUAL_7_5_3_CLOCK_IN_ERROR");
    sourceKeys.push(
      "MANUAL_7_5_INCREMENT",
      "MANUAL_7_5_INTERVENE",
      "JCF_NA_P48_PENALTY"
    );

    const actions = ["時計を止める"];
    if (subtype === "clock-without-move")
      actions.push(
        "相手の時計が誤って（例: 一時停止の代わりに）始動された場合は、違法手か妨害（distraction）かをアービターが判断する"
      );
    actions.push(
      ...this.restoreActions(color, subtype),
      `${COLOR_JA[opp]}の時計に2分加算する（7.5.5）`,
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

    return {
      ...this.base(),
      kind: "recommendation",
      conclusion: `${COLOR_JA[color]}の1回目の違法手（${SUBTYPE_LABELS[subtype]}）です。${COLOR_JA[opp]}に2分を加算します。`,
      actions,
      intervention: "immediate",
      penalties: [
        {
          type: "time-addition-opponent",
          playerColor: opp,
          timeAdjustmentSeconds: 120,
          description: `${COLOR_JA[opp]}に2分追加`,
        },
      ],
      sources: cite(...sourceKeys),
      // 7.5.3: 誤って時計が始動された場合は違法手か妨害かの判断が必要（Arbiters' Manual）
      confidence: subtype === "clock-without-move" ? "medium" : "high",
      escalationRecommended: false,
    };
  }

  private secondOffenceMateUnknown(
    color: PlayerColor,
    subtype: IllegalMoveSubtype,
    priorLines: string[],
    reason: string
  ): DecisionFields {
    return {
      ...this.base(),
      kind: "manual-review",
      conclusion: `${COLOR_JA[color]}の2回目の違法手（${SUBTYPE_LABELS[subtype]}）ですが、相手がメイト可能な局面か確定できないため（${reason}）、結論（負け／ドロー）を確定できません。局面を確認し、CAへ確認してください。`,
      actions: [
        "時計を止める",
        ...priorLines,
        "相手があらゆる合法手の連続で違反者のキングをメイトできるかをCAと確認する",
        "メイト可能なら違反者の負け、不可能ならドロー（7.5.5）",
      ],
      intervention: "consult-ca",
      penalties: [],
      sources: cite(
        SUBTYPE_ARTICLE[subtype],
        "FIDE_7_5_5",
        "JCF_NA_P48_PENALTY",
        "JCF_NA_P48_DRAW_EXCEPTION"
      ),
      confidence: "low",
      escalationRecommended: true,
      escalationReason:
        "7.5.5 ただし書き（相手がメイト不可能ならドロー）の該当性を判断できません",
    };
  }

  private secondOffenceLoss(
    color: PlayerColor,
    subtype: IllegalMoveSubtype,
    priorCount: number,
    priorLines: string[],
    line: string
  ): DecisionFields {
    const inconsistent = priorCount >= 2;
    return {
      ...this.base(),
      kind: "recommendation",
      conclusion: `${COLOR_JA[color]}の2回目の違法手（${SUBTYPE_LABELS[subtype]}）です。相手はメイト可能な局面のため、${COLOR_JA[color]}の負けとなります。\nメイトまでの手順の例（違法手の直前の局面から）: ${line}`,
      actions: [
        "時計を止める",
        ...priorLines,
        "入力した局面（手番を含む）が、違法手の直前の局面と一致することを確認する",
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
        SUBTYPE_ARTICLE[subtype],
        "FIDE_7_5_5",
        "MANUAL_7_5_INTERVENE",
        "JCF_NA_P48_PENALTY",
        ...(subtype === "clock-without-move"
          ? (["MANUAL_7_5_3_CLOCK_IN_ERROR"] as const)
          : [])
      ),
      confidence:
        inconsistent || subtype === "clock-without-move" ? "medium" : "high",
      escalationRecommended: inconsistent,
      escalationReason: inconsistent
        ? `記録上、${COLOR_JA[color]}にはすでに${priorCount}回の違法手ペナルティがあります。記録を確認してください。`
        : undefined,
    };
  }

  private secondOffenceDraw(
    color: PlayerColor,
    subtype: IllegalMoveSubtype,
    priorLines: string[],
    reason: string
  ): DecisionFields {
    return {
      ...this.base(),
      kind: "recommendation",
      conclusion: `${COLOR_JA[color]}の2回目の違法手（${SUBTYPE_LABELS[subtype]}）ですが、相手はどのような合法手の連続でもメイトできない局面のため、ドローとなります。（${reason}）`,
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
        SUBTYPE_ARTICLE[subtype],
        "FIDE_7_5_5",
        "JCF_NA_P48_DRAW_EXCEPTION"
      ),
      confidence: subtype === "clock-without-move" ? "medium" : "high",
      escalationRecommended: false,
    };
  }

  /** このDecision Treeが処理できる subtype */
  static getSupportedSubtypes(): IllegalMoveSubtype[] {
    return Object.keys(SUBTYPE_ARTICLE) as IllegalMoveSubtype[];
  }
}

/** テスト・表示用: subtype と根拠条文の対応 */
export const DT_001_SUBTYPE_ARTICLES: Record<IllegalMoveSubtype, string> = {
  "illegal-move": CITATIONS.FIDE_7_5_1.article,
  "promotion-not-replaced": CITATIONS.FIDE_7_5_2.article,
  "clock-without-move": CITATIONS.FIDE_7_5_3.article,
  "two-hands": CITATIONS.FIDE_7_5_4.article,
};
