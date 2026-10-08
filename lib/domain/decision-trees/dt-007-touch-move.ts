import type {
  PlayerColor,
  RuleCitation,
  TouchMoveFacts,
} from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import { cite } from "@/lib/domain/rules/citations";
import { QUESTIONS, type FollowUpQuestion } from "@/lib/domain/follow-up";
import {
  touchedPieceJa,
  type TouchObligation,
  type TouchObligationResult,
} from "@/lib/domain/services/touch-move";
import type { DecisionTreeResult } from "./dt-001-illegal-move-standard";
import { COLOR_JA, TreeOutput, opponentOf } from "./tree-support";

export const DT_007_ID = "DT-007-touch-move" as const;

export interface TouchMoveInput extends Partial<TouchMoveFacts> {
  /** tch.player: 駒に触れたプレーヤー（Incident.playerColor） */
  player?: PlayerColor;
  /** アービター自身が観察したか（4.8 で申し立ての権利が失われても、観察した違反には介入する） */
  arbiterObserved: boolean;
  /**
   * 触れた駒の義務（DecisionEngine が touchObligation で求める）。
   * whatNext が moved-other / not-moved で、触れた駒が入力された場合だけ与える
   */
  obligation?: TouchObligationResult;
  /** この対局で、このプレーヤーに記録済みのタッチムーブ違反の回数（評価中の Incident を除く） */
  priorViolations?: number;
}

const INITIAL_CONCLUSION =
  "触れた駒の規則（Article 4）の判断に必要な情報です。以下の質問に回答してください。";

/** 一緒に質問する親の質問がない場合は showWhen を外す（単独でも表示されるように） */
function bare(q: FollowUpQuestion): FollowUpQuestion {
  const { showWhen: _ignored, ...rest } = q;
  return rest;
}

/**
 * DT-007: Touch Move（FIDE Laws 2023 Article 4。ADR-014 §6）
 *
 * - 偶然の接触（4.2.2）・事前に表明した調整（4.2.1）・手番でない接触は、触れた駒の義務を生じない
 * - 相手の申し立ての権利（4.8）
 * - 触れた駒を動かした: 手を離したら変更できない（4.7）・昇格の駒の確定（4.4.4）
 * - まだ指していない・別の駒を動かした: どの駒を動かす・取る義務があるか（4.3 / 4.4 / 4.5）
 *
 * ペナルティは自動で適用しない（アービターの裁量。12.9）。違反の回数は 7.5 の違法手とは別に数える。
 */
export class TouchMoveTree {
  private readonly out: TreeOutput;

  constructor(providers: DomainProviders, rulesVersion = "FIDE-2023") {
    this.out = new TreeOutput(providers, DT_007_ID, rulesVersion);
  }

  evaluate(input: Partial<TouchMoveInput>): DecisionTreeResult {
    // 1. 触れた駒の義務を生じない接触（4.2）・手番でない接触（4.3）
    if (input.how === "brushed") return this.accidental(input.player);
    if (input.onMove === false) return this.notOnMove(input.player);
    if (input.adjustDeclared === true && input.onMove === true)
      return this.adjusted(input.player);

    // 2. 4.8 までに必要な事実
    const first: FollowUpQuestion[] = [];
    if (input.player === undefined) first.push(QUESTIONS.touchPlayer);
    if (input.how === undefined) first.push(QUESTIONS.touchHow);
    if (input.adjustDeclared === undefined)
      first.push(
        input.how === undefined
          ? QUESTIONS.touchAdjustDeclared
          : bare(QUESTIONS.touchAdjustDeclared)
      );
    if (input.onMove === undefined) first.push(QUESTIONS.touchOnMove);
    // 4.8 は相手の申し立ての権利。アービターが観察した違反には申し立てに関係なく介入する
    // （Arbiters' Manual）ため、観察していない場合だけ質問する
    if (!input.arbiterObserved) {
      if (input.claimedByOpponent === undefined) {
        first.push(
          QUESTIONS.touchClaimedByOpponent,
          QUESTIONS.touchClaimTiming
        );
      } else if (
        input.claimedByOpponent &&
        input.claimBeforeOwnTouch === undefined
      ) {
        first.push(bare(QUESTIONS.touchClaimTiming));
      }
    }
    const next = this.whatNextQuestions(input);
    if (first.length > 0)
      return this.out.needsInput([...first, ...next], INITIAL_CONCLUSION);

    const player = input.player as PlayerColor;

    // 3. 4.8: 相手が駒に触れた後の申し立て（アービターが観察していなければ介入しない）
    if (
      input.claimedByOpponent === true &&
      input.claimBeforeOwnTouch === false &&
      !input.arbiterObserved
    )
      return this.claimForfeited(player);

    if (next.length > 0) return this.out.needsInput(next, INITIAL_CONCLUSION);

    // 4. 触れた後の行動
    switch (input.whatNext) {
      case "moved-touched":
        return this.movedTouched(input, player);
      case "moved-other":
      case "not-moved":
        return this.obligation(input, player);
      default:
        return this.out.needsInput([QUESTIONS.touchWhatNext]);
    }
  }

  // ---------------------------------------------------------------------------

  /** 触れた後の行動とその条件の質問（未回答のもの） */
  private whatNextQuestions(
    input: Partial<TouchMoveInput>
  ): FollowUpQuestion[] {
    if (input.whatNext === undefined)
      return [
        QUESTIONS.touchWhatNext,
        QUESTIONS.touchPromotion,
        QUESTIONS.touchReleased,
        QUESTIONS.touchChangedAfter,
        QUESTIONS.touchedPieces,
        QUESTIONS.touchFen,
      ];
    if (input.whatNext === "moved-touched") {
      const qs: FollowUpQuestion[] = [];
      if (input.promotion === undefined)
        qs.push(bare(QUESTIONS.touchPromotion));
      if (input.released === undefined) qs.push(bare(QUESTIONS.touchReleased));
      // 動かし直したかは、手（または昇格の駒）が確定した場合だけ意味がある
      if (input.changedAfter === undefined) {
        if (isFinal(input)) qs.push(bare(QUESTIONS.touchChangedAfter));
        else if (input.released === undefined)
          qs.push(QUESTIONS.touchChangedAfter);
      }
      return qs;
    }
    return input.touchedText === undefined
      ? [bare(QUESTIONS.touchedPieces), bare(QUESTIONS.touchFen)]
      : [];
  }

  private accidental(player: PlayerColor | undefined): DecisionTreeResult {
    return this.out.decided({
      kind: "recommendation",
      conclusion: `${player ? `${COLOR_JA[player]}の` : ""}明らかに偶然の接触（袖や手が当たった）は、動かす・取る意思での接触とはみなしません（4.2.2）。触れた駒を動かす義務はありません。`,
      actions: [
        "触れた駒を動かす義務はない（4.2.2）",
        "駒の位置がずれていれば、元のマスに戻させる",
      ],
      intervention: "no-intervention",
      penalties: [],
      sources: cite("FIDE_4_2_2", "MANUAL_4_ACCIDENTAL"),
      confidence: "high",
      escalationRecommended: false,
    });
  }

  private notOnMove(player: PlayerColor | undefined): DecisionTreeResult {
    return this.out.decided({
      kind: "recommendation",
      conclusion: `手番でないときに駒に触れても、触れた駒の規則（4.3）は適用されません。${player ? `${COLOR_JA[player]}に` : ""}触れた駒を動かす義務はありません。`,
      actions: [
        "触れた駒を動かす義務はない（4.3 は手番のプレーヤーに適用）",
        "駒を整えられるのは手番のプレーヤーだけ（4.2.1）。駒の位置がずれていれば、元のマスに戻させる",
        "相手の妨げになっている場合は、アービターの裁量で対応する（12.9）",
      ],
      intervention: "no-intervention",
      penalties: [],
      sources: cite("FIDE_4_3", "FIDE_4_2_1", "FIDE_12_9"),
      confidence: "high",
      escalationRecommended: false,
    });
  }

  private adjusted(player: PlayerColor | undefined): DecisionTreeResult {
    return this.out.decided({
      kind: "recommendation",
      conclusion: `${player ? `${COLOR_JA[player]}は` : ""}手番で、触れる前に駒を整える意思を表明しているため、触れた駒を動かす義務はありません（4.2.1）。`,
      actions: [
        "触れた駒を動かす義務はない（4.2.1）",
        "「整える」はずれた駒を直す場合に限られる。ずれていない駒に触れていた場合はCAへ確認する",
      ],
      intervention: "no-intervention",
      penalties: [],
      sources: cite("FIDE_4_2_1", "MANUAL_4_2_1_DISPLACED"),
      // 駒がずれていたか（4.2.1 を使える場面か）は質問していない
      confidence: "medium",
      escalationRecommended: false,
    });
  }

  private claimForfeited(player: PlayerColor): DecisionTreeResult {
    return this.out.decided({
      kind: "recommendation",
      conclusion: `相手（${COLOR_JA[opponentOf(player)]}）は、自分が駒に触れた後に申し立てたため、4.1〜4.7 の違反を申し立てる権利を失っています（4.8）。アービターは違反を観察していないため、介入しません。`,
      actions: ["申し立ては認めない（4.8）", "対局を続行する"],
      intervention: "no-intervention",
      penalties: [],
      sources: cite("FIDE_4_8", "MANUAL_4_INTERVENE"),
      confidence: "high",
      escalationRecommended: false,
    });
  }

  private movedTouched(
    input: Partial<TouchMoveInput>,
    player: PlayerColor
  ): DecisionTreeResult {
    const who = COLOR_JA[player];
    const promotion = input.promotion === "promotion-placed";
    if (!isFinal(input))
      return this.out.decided({
        kind: "recommendation",
        conclusion: `${who}はまだ駒を手から離していないため、手は確定していません（4.7）。触れた駒を、合法なマスへ動かせます。`,
        actions: [
          "触れた駒で指す（4.3）。行き先は、手を離すまで変えられる",
          ...(input.promotion === "promotion-not-placed"
            ? ["昇格する駒は、昇格のマスに触れた時点で確定する（4.4.4）"]
            : []),
        ],
        intervention: "no-intervention",
        penalties: [],
        sources: cite("FIDE_4_7", "FIDE_4_3", "FIDE_4_4"),
        confidence: "high",
        escalationRecommended: false,
      });
    const finalRule = promotion
      ? "昇格する駒は、その駒が昇格のマスに触れた時点で確定しています（4.4.4）"
      : "駒をマスの上で手から離した時点で、その手は確定しています（4.7）";
    const finalSources = promotion
      ? cite("FIDE_4_4", "FIDE_4_7")
      : cite("FIDE_4_7", "JCF_NA_P20_RELEASED");
    if (input.changedAfter === false)
      return this.out.decided({
        kind: "recommendation",
        conclusion: `${finalRule}。${who}は確定した手を変えていないため、違反はありません。`,
        actions: ["確定した手のまま対局を続ける"],
        intervention: "no-intervention",
        penalties: [],
        sources: finalSources,
        confidence: "high",
        escalationRecommended: false,
      });
    // changedAfter = true: 確定した手（昇格の駒）を変えた（違反として記録する）
    const basis = basisNote(input);
    const decided = this.out.decided({
      kind: "recommendation",
      conclusion:
        promotion && input.released === true
          ? `${finalRule}。手も確定しています（4.7）。${who}が確定した後に変えたため、最初に昇格のマスに触れた駒を、最初に手を離したマスに戻させてください。`
          : promotion
            ? `${finalRule}。${who}が別の駒に替えたため、最初に昇格のマスに触れた駒に戻させてください。`
            : `${finalRule}。${who}が別のマスへ動かし直したため、最初に手を離したマスに戻させてください。`,
      actions: [
        "直ちに時計を止めて介入する",
        ...basis.actions,
        ...(promotion
          ? ["昇格の駒を、最初に昇格のマスに触れた駒に戻す（4.4.4）"]
          : []),
        ...(input.released === true
          ? ["駒を、最初に手を離したマスに戻す（4.7）"]
          : []),
        ...violationLines(who, input.priorViolations),
      ],
      intervention: "immediate",
      penalties: [],
      sources: [
        ...finalSources,
        ...cite("MANUAL_4_INTERVENE"),
        ...VIOLATION_SOURCES(),
      ],
      confidence: basis.confidence,
      escalationRecommended: false,
    });
    if (decided.status === "decided")
      decided.decision.touchMoveViolation = true;
    return decided;
  }

  private obligation(
    input: Partial<TouchMoveInput>,
    player: PlayerColor
  ): DecisionTreeResult {
    const result = input.obligation;
    if (!result || !result.ok)
      return this.out.needsInput(
        [bare(QUESTIONS.touchedPieces), bare(QUESTIONS.touchFen)],
        `触れた駒を確認できません。${result && !result.ok ? `\n${result.error}` : ""}`,
        cite("FIDE_4_3")
      );
    const o = result.obligation;
    const who = COLOR_JA[player];
    const required = describe(o);
    const sources = sourcesFor(o);
    const detail = result.fromPosition
      ? o.moves
        ? [`許される手: ${o.moves.join(", ")}`]
        : ["任意の合法手を指せる（4.5）"]
      : [
          ...(o.steps ?? []),
          "局面が入力されていないため、合法手は盤上で確認する",
        ];
    const promotionNote = o.includesPromotion
      ? ["昇格する駒は、昇格のマスに触れた時点で確定する（4.4.4）"]
      : [];
    const touched = `触れた順: ${o.touched.map(touchedPieceJa).join(" → ")}`;

    const basis = basisNote(input);
    const confidence =
      result.fromPosition && basis.confidence === "high" ? "high" : "medium";

    if (input.whatNext === "not-moved")
      return this.out.decided({
        kind: "recommendation",
        conclusion: `${who}は、${required}。\n${touched}`,
        actions: [
          ...basis.actions,
          `${who}に、触れた駒の規則に従って指させる`,
          ...detail,
          ...promotionNote,
        ],
        intervention: "immediate",
        penalties: [],
        sources,
        confidence,
        escalationRecommended: false,
      });

    // moved-other: 触れた駒の規則に従わずに別の駒を動かした（違反として記録する）
    const decided = this.out.decided({
      kind: "recommendation",
      conclusion: `${who}は触れた駒の規則に従わずに別の駒を動かしています。直ちに介入し、触れる前の局面に戻して、${required}。\n${touched}`,
      actions: [
        "直ちに時計を止めて介入する",
        ...basis.actions,
        "動かした駒を戻し、触れる前の局面に戻す",
        `${who}に、触れた駒の規則に従って指させる`,
        ...detail,
        ...promotionNote,
        ...violationLines(who, input.priorViolations),
      ],
      intervention: "immediate",
      penalties: [],
      sources: [
        ...sources,
        ...cite("MANUAL_4_INTERVENE"),
        ...VIOLATION_SOURCES(),
      ],
      confidence,
      escalationRecommended: false,
    });
    if (decided.status === "decided")
      decided.decision.touchMoveViolation = true;
    return decided;
  }
}

/** 手（または昇格の駒）が確定したか（4.7 / 4.4.4） */
function isFinal(input: Partial<TouchMoveInput>): boolean {
  return input.released === true || input.promotion === "promotion-placed";
}

/**
 * アービターが観察しておらず、相手の申し立てでもない（観戦者の報告など）場合は、
 * 事実を確認してから介入する（信頼度を下げる）
 */
function basisNote(input: Partial<TouchMoveInput>): {
  actions: string[];
  confidence: "high" | "medium";
} {
  return !input.arbiterObserved && input.claimedByOpponent === false
    ? {
        actions: [
          "アービターが観察しておらず、相手の申し立てでもないため、両プレーヤーから事実を確認してから対応する",
        ],
        confidence: "medium",
      }
    : { actions: [], confidence: "high" };
}

/** 違反（記録して別に数える）の場合の、裁量のペナルティと回数の案内 */
function violationLines(who: string, prior: number | undefined): string[] {
  return [
    "ペナルティはアービターの裁量（12.9）。JCF の例: 警告。時計を押していた場合は相手に時間加算",
    "相手がすでに次の手を指している場合は、CAへ確認する",
    ...(prior !== undefined
      ? [
          `この対局での${who}のタッチムーブ違反の記録: 今回を含めて ${prior + 1} 回（7.5 の違法手の回数には含めません）`,
        ]
      : []),
    "大会規定を確認する（大会によっては、タッチムーブ違反の3回目で失格となる場合がある）",
  ];
}

const VIOLATION_SOURCES = (): RuleCitation[] =>
  cite(
    "FIDE_12_9",
    "JCF_NA_P20_WARNING",
    "JCF_NA_P20_CLOCK_PRESSED",
    "JCF_NA_P20_THIRD"
  );

/** 義務の要約（「〜しなければなりません」） */
function describe(o: TouchObligation): string {
  const piece = o.piece ? touchedPieceJa(o.piece) : undefined;
  const target = o.target ? touchedPieceJa(o.target) : undefined;
  switch (o.rule) {
    case "4.3.1":
      return `${piece}を動かさなければなりません（4.3.1）`;
    case "4.3.2":
      return `${target}を取らなければなりません（4.3.2）`;
    case "4.3.3":
      if (piece && target)
        return `${piece}で${target}を取らなければなりません（4.3.3）`;
      return piece
        ? `${piece}を動かさなければなりません（4.3.3: 最初に触れた相手の駒を取れないため、触れた順に動かせる最初の駒）`
        : `${target}を取らなければなりません（4.3.3: 触れた順に取れる最初の駒）`;
    case "4.4.1":
      return "キャスリングをしなければなりません（キングとルークの順に触れた。4.4.1）";
    case "4.4.2":
      return `${piece}を動かさなければなりません（ルークを先に触れたため、その側へのキャスリングはできません。4.4.2 / 4.3.1）`;
    case "4.4.3":
      return "キングで指さなければなりません（その側へのキャスリングは合法でないため。4.4.3）";
    case "4.5":
      return "触れた駒はどれも動かせない・取れないため、任意の合法手を指せます（4.5）";
  }
}

function sourcesFor(o: TouchObligation): RuleCitation[] {
  switch (o.rule) {
    case "4.4.1":
    case "4.4.3":
      return cite("FIDE_4_4", "FIDE_4_5");
    case "4.4.2":
      return cite(
        "FIDE_4_4",
        "MANUAL_4_4_2_ROOK_FIRST",
        "FIDE_4_3",
        "FIDE_4_5"
      );
    default:
      return cite("FIDE_4_3", "FIDE_4_5");
  }
}
