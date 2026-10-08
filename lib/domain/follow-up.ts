import type {
  BothFlagsOrder,
  ClockTimeSubtype,
  CompetitionType,
  ConditionCheck,
  DrawClaimFacts,
  DrawSubtype,
  FlagFallFacts,
  FlagFallen,
  HistoryConfirmation,
  Incident,
  IllegalMoveDetection,
  IllegalMoveFacts,
  IllegalMoveSubtype,
  MatePositionInput,
  PlayerColor,
  RepetitionClaimMode,
  SupervisionRegime,
  TouchHow,
  TouchMoveFacts,
  TouchPromotion,
  TouchWhatNext,
} from "@/lib/domain/entities";
import { TOUCH_MOVE_SUBTYPE } from "@/lib/domain/entities";
import {
  ENDED_BEFORE_FLAG_LABELS,
  ENDED_BEFORE_FLAG_VALUES,
  GAME_END_EVENT_LABELS,
  GAME_END_EVENTS,
  GAME_RECORD_STATE_LABELS,
  GAME_RECORD_STATES,
} from "@/lib/domain/services/game-end";

/**
 * 追加確認質問（要件 §12）。
 * 質問の定義（ID・ラベル・選択肢・入力形式）はドメインが持ち、UIは表示と回答の収集のみを行う。
 */

export type IncidentQuestionId =
  // 違法手（DT-001 / DT-002 / DT-003）
  | "playerColor"
  | "subtype"
  | "gameEndEvent"
  | "gameRecordState"
  | "clockPressed"
  | "opponentMadeNextMove"
  | "detectedBy"
  | "reinstatedFen"
  // 時計・時間（DT-004）
  | "clockTimeSubtype"
  | "flagFallen"
  | "bothFlagsOrder"
  | "quickplayGuidelinesApply"
  | "lastPeriod"
  | "endedBeforeFlag"
  | "movesNotCompleted"
  | "positionFen"
  // メイト可能性の局面（DT-001〜004。ADR-014 §5）
  | "matePosition"
  // ドロー（DT-005 Draw Claim / DT-006 Automatic Draw）
  | "drawSubtype"
  | "claimant"
  | "lastMover"
  | "claimMode"
  | "moveWritten"
  | "touchedPiece"
  | "repetitionCheck"
  | "fiftyMoveCheck"
  | "fivefoldCheck"
  | "seventyFiveCheck"
  | "positionsText"
  | "historyConfirmed"
  | "intendedMove"
  // 触れた駒の規則（DT-007。ADR-014 §6）
  | "touchPlayer"
  | "touchHow"
  | "touchAdjustDeclared"
  | "touchOnMove"
  | "touchClaimedByOpponent"
  | "touchClaimTiming"
  | "touchWhatNext"
  | "touchReleased"
  | "touchChangedAfter"
  | "touchPromotion"
  | "touchedPieces"
  | "touchFen"
  // 手動確認（決定木の対象外）
  | "situationNote";

export type GameContextQuestionId = "competitionType" | "supervisionRegime";

export type FollowUpQuestionId = IncidentQuestionId | GameContextQuestionId;

export interface FollowUpOption {
  value: string;
  label: string;
  /**
   * false の場合、unknown の回答で列挙しない（resolveUnknown。fact-model §3.3）。
   * 例: 違法手の種類の「触れた駒の規則」は別の決定木へ移る選択肢で、7.5 の種類が
   * 分からないことは、触れた駒の規則の可能性を意味しない
   */
  enumerate?: false;
}

/**
 * 入力形式
 * - choice: 選択肢ボタン（既定）
 * - count:  0 以上の整数（大きな +/- ステッパー）
 * - text:   任意入力のテキスト（上級者向け: FEN / 棋譜）
 */
export type FollowUpInputKind = "choice" | "count" | "text";

export interface FollowUpQuestion {
  id: FollowUpQuestionId;
  /** incident: このIncidentへの回答 / game-context: 対局（大会）コンテキストの設定 */
  scope: "incident" | "game-context";
  label: string;
  help?: string;
  options: FollowUpOption[];
  /** 省略時は "choice" */
  input?: FollowUpInputKind;
  /** count の範囲 */
  min?: number;
  max?: number;
  /** UI の初期値（count では "0"） */
  defaultValue?: string;
  /** true の場合、未回答（空）でも送信できる */
  optional?: boolean;
  placeholder?: string;
  /** UI でまとめて表示するためのグループ名（例: "白の駒（キング以外）"） */
  group?: string;
  /**
   * 同じラウンドの別の質問への回答が values のいずれかの場合のみ表示・回答を求める。
   * 条件の定義はドメインが持ち、UI は一致判定のみ行う。
   */
  showWhen?: { questionId: FollowUpQuestionId; values: string[] };
  /**
   * 共通の「わからない・確認できない」選択肢（UNKNOWN_OPTION）を持つ質問での扱い
   * （fact-model §3.3）。
   * - enumerate:     unknown のとき、他の選択肢すべてで評価して比較する（resolveUnknown）
   * - manual-review: 列挙できない（例: 駒数の確認）。unknown なら手動確認
   * 未設定の質問は共通の unknown を持たない（独自の unknown 値を持つ質問を含む）。
   */
  onUnknown?: "enumerate" | "manual-review";
}

/** 共通の「わからない・確認できない」の回答値 */
export const UNKNOWN_VALUE = "unknown";

/** 共通の「わからない・確認できない」選択肢（他の選択肢と同じ大きさで表示する） */
export const UNKNOWN_OPTION: FollowUpOption = {
  value: UNKNOWN_VALUE,
  label: "わからない・確認できない",
};

/** unknown のときに列挙する値（共通の unknown 以外の選択肢） */
export function enumerableValues(q: FollowUpQuestion): string[] {
  return q.options
    .filter((o) => o.value !== UNKNOWN_VALUE && o.enumerate !== false)
    .map((o) => o.value);
}

/** showWhen の条件を満たすか（UI 用の純粋関数） */
export function isQuestionVisible(
  q: FollowUpQuestion,
  answers: Record<string, string>,
  /**
   * 同じラウンドの質問。指定すると、条件の質問自体が非表示なら（以前の回答が残っていても）
   * この質問も非表示にする（例: 局面の入力方法が隠れたら FEN 欄も隠す）
   */
  round?: FollowUpQuestion[]
): boolean {
  if (!q.showWhen) return true;
  const a = answers[q.showWhen.questionId];
  if (a === undefined || !q.showWhen.values.includes(a)) return false;
  const parent = round?.find((p) => p.id === q.showWhen?.questionId);
  return parent ? isQuestionVisible(parent, answers, round) : true;
}

const YES_NO: FollowUpOption[] = [
  { value: "true", label: "はい" },
  { value: "false", label: "いいえ" },
];

const COLOR_OPTIONS: FollowUpOption[] = [
  { value: "white", label: "白" },
  { value: "black", label: "黒" },
];

export const SUBTYPE_LABELS: Record<IllegalMoveSubtype, string> = {
  "illegal-move": "通常の違法手",
  "promotion-not-replaced": "昇格の駒を置かずに時計を押した",
  "clock-without-move": "手を指さずに時計を押した",
  "two-hands": "両手で指した",
};

/** 違法手カテゴリの subtype の質問の選択肢（7.5 の違法手に加えて、触れた駒の規則） */
export const TOUCH_MOVE_LABEL = "触れた駒の規則（タッチムーブ）";

export const CLOCK_TIME_SUBTYPE_LABELS: Record<ClockTimeSubtype, string> = {
  "flag-fall": "フラッグが落ちた（時間切れ）",
  other: "その他の時計トラブル",
};

export const DRAW_SUBTYPE_LABELS: Record<DrawSubtype, string> = {
  "threefold-repetition-claim": "三回同一局面のクレーム（9.2）",
  "fifty-move-claim": "50手ルールのクレーム（9.3）",
  "fivefold-repetition": "五回同一局面（9.6.1）",
  "75-move-rule": "75手ルール（9.6.2）",
  agreement: "ドローの合意",
  stalemate: "ステイルメイト",
  "dead-position": "これ以上メイトできない局面",
  other: "その他",
};

/** 共通の unknown を加える（fact-model §3.3: すべての DT 質問に unknown） */
function withUnknown(
  q: FollowUpQuestion,
  onUnknown: "enumerate" | "manual-review" = "enumerate"
): FollowUpQuestion {
  return { ...q, options: [...q.options, UNKNOWN_OPTION], onUnknown };
}

const CONDITION_AUTO: FollowUpOption = {
  value: "auto",
  label: "下の棋譜から判定する",
};

const BASE_QUESTIONS: Record<FollowUpQuestionId, FollowUpQuestion> = {
  playerColor: {
    id: "playerColor",
    scope: "incident",
    label: "違反したのはどちらのプレーヤーですか？",
    options: COLOR_OPTIONS,
  },
  subtype: {
    id: "subtype",
    scope: "incident",
    label: "どの違反ですか？",
    help: "1つの手の中で複数該当する場合（例: 両手による違法キャスリング）は主なものを1つ選んでください。1回として数えます。触れた駒の規則（タッチムーブ）は違法手の回数に数えません。",
    options: [
      ...(Object.keys(SUBTYPE_LABELS) as IllegalMoveSubtype[]).map((value) => ({
        value,
        label: SUBTYPE_LABELS[value],
      })),
      // 「わからない」は 7.5 の種類が分からないこと（触れた駒の規則は列挙しない）
      { value: TOUCH_MOVE_SUBTYPE, label: TOUCH_MOVE_LABEL, enumerate: false },
    ],
  },
  gameEndEvent: {
    id: "gameEndEvent",
    scope: "incident",
    label:
      "違法手に気づいた時点で、対局を終わらせた出来事はありましたか？（観察したもの）",
    help: "違法な手（第3条・4.2〜4.7 に反する手）によるチェックメイト・ステイルメイトでは対局は終了しません（5.1.1 / 5.2.1）。その場合は「まだ対局中」を選び、判断できない場合は「わからない・確認できない」を選んでください。握手だけでは対局の終了として扱いません。投了やドローの合意の発言・動作、結果の記入などで終了を確認できない場合は「わからない・確認できない」を選んでください（ADR-014 §3）。",
    options: GAME_END_EVENTS.map((value) => ({
      value,
      label: GAME_END_EVENT_LABELS[value],
    })),
  },
  gameRecordState: {
    id: "gameRecordState",
    scope: "incident",
    label: "（任意・記録用）結果の記入・署名の状態",
    help: "判断には影響しません。記録と、署名の確認に使います。",
    optional: true,
    // 「わからない」は記録しない（未回答と同じ。判断には影響しない）
    options: [
      ...GAME_RECORD_STATES.map((value) => ({
        value,
        label: GAME_RECORD_STATE_LABELS[value],
      })),
      UNKNOWN_OPTION,
    ],
    showWhen: {
      questionId: "gameEndEvent",
      values: GAME_END_EVENTS.filter((v) => v !== "in-progress"),
    },
  },
  clockPressed: {
    id: "clockPressed",
    scope: "incident",
    label: "違反したプレーヤーは時計を押しましたか？",
    help: "「手を指さずに時計を押した」の場合は「はい」",
    options: YES_NO,
  },
  reinstatedFen: {
    id: "reinstatedFen",
    scope: "incident",
    label: "違法手の直前に戻した局面の FEN（手番は違反者）",
    help: "7.5.1〜7.5.4 により対局を再開する局面です（違法手を指した後の局面ではありません）。入力した局面は端末の外へ送りません。",
    input: "text",
    placeholder: "例: 6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 30",
    options: [],
    showWhen: { questionId: "matePosition", values: ["fen"] },
  },
  matePosition: {
    id: "matePosition",
    scope: "incident",
    label: "相手がメイト可能かを、局面から判定しますか？",
    help: "局面（FEN）を入力すると、端末内でメイトまでの手順を探します。手順が見つかれば「メイト可能」、駒の構成上メイト不可能なら「メイト不可能」。それ以外はCAへ確認になります。",
    options: [
      { value: "fen", label: "局面（FEN）を入力して判定する" },
      { value: "unknown", label: "局面を入力できない（CAへ確認）" },
    ],
  },
  opponentMadeNextMove: {
    id: "opponentMadeNextMove",
    scope: "incident",
    label: "違反者の相手は、すでに次の手を指しましたか？",
    help: "A.5.2: 相手が次の手を指した後は、違法手を訂正できません。",
    options: YES_NO,
  },
  detectedBy: {
    id: "detectedBy",
    scope: "incident",
    label: "違法手を指摘したのは誰ですか？",
    options: [
      { value: "arbiter", label: "アービターが目撃した" },
      { value: "opponent-claim", label: "相手がクレームした" },
      { value: "other", label: "その他（観戦者の報告など）" },
    ],
  },

  // ---- 時計・時間 ----
  clockTimeSubtype: {
    id: "clockTimeSubtype",
    scope: "incident",
    label: "どの事象ですか？",
    options: (Object.keys(CLOCK_TIME_SUBTYPE_LABELS) as ClockTimeSubtype[]).map(
      (value) => ({ value, label: CLOCK_TIME_SUBTYPE_LABELS[value] })
    ),
  },
  flagFallen: {
    id: "flagFallen",
    scope: "incident",
    label: "フラッグが落ちたのはどちらですか？",
    options: [
      ...COLOR_OPTIONS,
      { value: "both", label: "両方（両方の時計が 0.00）" },
    ],
  },
  bothFlagsOrder: {
    id: "bothFlagsOrder",
    scope: "incident",
    label: "どちらのフラッグが先に落ちましたか？",
    help: "電子時計では、先に落ちた側に表示（フラッグ表示）が出ることが多いです。",
    options: [
      { value: "white-first", label: "白が先（白の時計に表示）" },
      { value: "black-first", label: "黒が先（黒の時計に表示）" },
      { value: "unknown", label: "判別できない" },
    ],
  },
  quickplayGuidelinesApply: {
    id: "quickplayGuidelinesApply",
    scope: "incident",
    label:
      "増加時間なしの対局で、Guidelines III（Quickplay Finish）の使用が事前に告知されていますか？",
    options: YES_NO,
  },
  lastPeriod: {
    id: "lastPeriod",
    scope: "incident",
    label: "残りの全ての手を指し切る最終ピリオドですか？",
    options: YES_NO,
  },
  endedBeforeFlag: {
    id: "endedBeforeFlag",
    scope: "incident",
    label:
      "フラッグが確定する前に（アービターが気付く、または有効な主張がされる前に）、対局を終わらせる出来事がありましたか？",
    help: "表示が 0 になった後でも、フラッグの確定前のチェックメイトは有効です（6.8 / 5.1.1）。ただし、違法な手（第3条・4.2〜4.7 に反する手）によるチェックメイト・ステイルメイトでは対局は終了しません（5.1.1 / 5.2.1）。握手だけでは対局の終了として扱いません。",
    options: ENDED_BEFORE_FLAG_VALUES.map((value) => ({
      value,
      label: ENDED_BEFORE_FLAG_LABELS[value],
    })),
  },
  movesNotCompleted: {
    id: "movesNotCompleted",
    scope: "incident",
    label:
      "時間切れのプレーヤーは、そのピリオドの規定手数を完了していませんでしたか？",
    help: "全手数を指し切る持ち時間（単一ピリオド）の場合は「完了していない」",
    options: [
      { value: "true", label: "完了していない" },
      { value: "false", label: "規定手数は完了していた" },
      { value: "unknown", label: "わからない（CAへ確認）" },
    ],
  },
  positionFen: {
    id: "positionFen",
    scope: "incident",
    label: "フラッグ確定時の局面の FEN（正しい手番を含む）",
    help: "入力した局面は端末の外へ送りません。",
    input: "text",
    placeholder: "例: 8/8/8/4k3/8/8/4K3/7R b - - 0 60",
    options: [],
    showWhen: { questionId: "matePosition", values: ["fen"] },
  },

  // ---- ドロー ----
  drawSubtype: {
    id: "drawSubtype",
    scope: "incident",
    label: "どの事象ですか？",
    options: (Object.keys(DRAW_SUBTYPE_LABELS) as DrawSubtype[]).map(
      (value) => ({ value, label: DRAW_SUBTYPE_LABELS[value] })
    ),
  },
  claimant: {
    id: "claimant",
    scope: "incident",
    label: "クレームしたのはどちらのプレーヤーですか？",
    options: COLOR_OPTIONS,
  },
  lastMover: {
    id: "lastMover",
    scope: "incident",
    label: "クレームの直前に、盤上で最後に手を指したのはどちらですか？",
    help: "手番は盤上の手から判断します（時計の状態からは判断しません）。クレームできるのは手番のプレーヤーだけです。",
    options: COLOR_OPTIONS,
  },
  claimMode: {
    id: "claimMode",
    scope: "incident",
    label: "どのクレームですか？",
    options: [
      {
        value: "just-appeared",
        label: "相手の直前の手で条件が成立した（9.2.2 / 9.3.2）",
      },
      {
        value: "about-to-appear",
        label: "自分の次の手で条件が成立する（9.2.1 / 9.3.1）",
      },
    ],
  },
  moveWritten: {
    id: "moveWritten",
    scope: "incident",
    label:
      "クレームしたプレーヤーは、指す手を棋譜に記入し、その手を指す意思をアービターに宣言しましたか？（盤上ではまだ指していない）",
    options: YES_NO,
  },
  touchedPiece: {
    id: "touchedPiece",
    scope: "incident",
    label:
      "クレームの前に、クレームしたプレーヤーはその手番で、動かす・取る意思で盤上の駒に触れましたか？",
    help: "駒を整える目的の接触や、偶然の接触は含みません（9.4 / 4.3）。",
    options: YES_NO,
  },
  repetitionCheck: {
    id: "repetitionCheck",
    scope: "incident",
    label:
      "対局を再現して確認した結果、クレームの局面は3回以上（今回を含む）出現していますか？",
    help: "同じ手番・同じ駒配置・同じキャスリング権・同じアンパッサンの可否（9.2.3）",
    options: [
      { value: "met", label: "3回以上を確認した" },
      { value: "not-met", label: "3回未満だった" },
      { value: "unknown", label: "確認できない（CAへ）" },
      CONDITION_AUTO,
    ],
  },
  fiftyMoveCheck: {
    id: "fiftyMoveCheck",
    scope: "incident",
    label:
      "対局を再現して確認した結果、両プレーヤーとも直近50手以上を、ポーンの移動も駒取りもなく指していますか？",
    help: "9.3.1（次の手で成立）の場合は、記入した手を含めて数えます。51手目以降でもクレームできます。",
    options: [
      { value: "met", label: "50手以上を確認した" },
      { value: "not-met", label: "50手未満だった" },
      { value: "unknown", label: "確認できない（CAへ）" },
      CONDITION_AUTO,
    ],
  },
  fivefoldCheck: {
    id: "fivefoldCheck",
    scope: "incident",
    label:
      "同じ局面が5回以上出現していることを確認しましたか？（連続でなくてよい）",
    options: [
      { value: "met", label: "5回以上を確認した" },
      { value: "not-met", label: "5回未満だった" },
      { value: "unknown", label: "確認できない（CAへ）" },
      CONDITION_AUTO,
    ],
  },
  seventyFiveCheck: {
    id: "seventyFiveCheck",
    scope: "incident",
    label:
      "両プレーヤーとも、ポーンの移動も駒取りもなく75手以上を指したことを確認しましたか？",
    help: "75手に達した手でチェックメイトになった場合は、チェックメイトが優先されます（9.6.2）。",
    options: [
      { value: "met", label: "75手以上を確認した（チェックメイトではない）" },
      {
        value: "met-checkmate",
        label: "75手に達した手でチェックメイトになった",
      },
      { value: "not-met", label: "75手未満だった" },
      { value: "unknown", label: "確認できない（CAへ）" },
      CONDITION_AUTO,
    ],
  },
  positionsText: {
    id: "positionsText",
    scope: "incident",
    label: "（任意）棋譜・PGN（初期配置からの指し手）",
    help: '「判定する」を選んだ場合に使用します。標準の表記（SAN）で入力してください。例: 1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6。途中の局面から始める場合は [FEN "…"] を先頭に書きます（その場合「不成立」は自動では確定しません）。FEN の列は使えません。入力した棋譜は端末の外へ送りません。',
    input: "text",
    optional: true,
    placeholder: "1. e4 e5 2. Nf3 Nc6 ...",
    options: [],
  },
  historyConfirmed: {
    id: "historyConfirmed",
    scope: "incident",
    label:
      "棋譜を再生した最終局面と手数は、盤上の局面・スコアシートと一致しますか？",
    help: "上に表示した最終局面（手番・最後の手・FEN）を盤上と照合してください。一致しない場合は自動判定を使いません。",
    options: [
      { value: "match", label: "局面も手数も一致した" },
      { value: "position-only", label: "局面は一致・手数は確認できない" },
      { value: "mismatch", label: "一致しない" },
      { value: "unknown", label: "照合できない（盤上で再現する）" },
    ],
  },
  intendedMove: {
    id: "intendedMove",
    scope: "incident",
    label: "（任意）記入した次の手（例: Nf3）",
    input: "text",
    optional: true,
    placeholder: "Nf3",
    options: [],
  },

  // ---- 触れた駒の規則（DT-007） ----
  touchPlayer: {
    id: "touchPlayer",
    scope: "incident",
    label: "駒に触れたのはどちらのプレーヤーですか？",
    options: COLOR_OPTIONS,
  },
  touchHow: {
    id: "touchHow",
    scope: "incident",
    label: "どのように触れましたか？",
    help: "明らかに偶然の接触以外は、動かす・取る意思があったとみなします（4.2.2）。",
    options: [
      { value: "grasped", label: "指でつかんだ" },
      { value: "lifted", label: "持ち上げた" },
      { value: "pushed", label: "指で押した" },
      { value: "brushed", label: "袖や手が当たった（明らかに偶然）" },
    ],
  },
  touchAdjustDeclared: {
    id: "touchAdjustDeclared",
    scope: "incident",
    label: "触れる前に「整えます（j'adoube）」などと言いましたか？",
    // 偶然の接触以外では常に意味がある。touchHow が「わからない」でも質問できるよう、
    // 表示条件を付けない（fact-model §3.3）
    options: YES_NO,
  },
  touchOnMove: {
    id: "touchOnMove",
    scope: "incident",
    label: "触れたのは、そのプレーヤーの手番のときでしたか？",
    options: YES_NO,
  },
  touchClaimedByOpponent: {
    id: "touchClaimedByOpponent",
    scope: "incident",
    label: "相手からの申し立てで始まりましたか？",
    options: [
      { value: "true", label: "はい（相手が申し立てた）" },
      { value: "false", label: "いいえ（相手の申し立てではない）" },
    ],
  },
  touchClaimTiming: {
    id: "touchClaimTiming",
    scope: "incident",
    label:
      "相手が申し立てたのは、相手自身が（動かす・取る意思で）駒に触れる前でしたか？",
    help: "駒に触れた後の申し立てでは、4.1〜4.7 の違反を申し立てる権利を失っています（4.8）。",
    options: YES_NO,
    showWhen: { questionId: "touchClaimedByOpponent", values: ["true"] },
  },
  touchWhatNext: {
    id: "touchWhatNext",
    scope: "incident",
    label: "触れた後、そのプレーヤーは何をしましたか？",
    options: [
      { value: "moved-touched", label: "触れた駒を動かした" },
      { value: "moved-other", label: "触れた駒ではなく、別の駒を動かした" },
      { value: "not-moved", label: "まだ指していない" },
    ],
  },
  touchReleased: {
    id: "touchReleased",
    scope: "incident",
    label: "動かした駒を、マスの上で手から離しましたか？",
    options: YES_NO,
    showWhen: { questionId: "touchWhatNext", values: ["moved-touched"] },
  },
  touchChangedAfter: {
    id: "touchChangedAfter",
    scope: "incident",
    label:
      "手を離した後（昇格では、選んだ駒が昇格のマスに触れた後）に、別のマスへ動かし直したり、別の駒に替えたりしましたか？",
    options: YES_NO,
    showWhen: { questionId: "touchReleased", values: ["true"] },
  },
  touchPromotion: {
    id: "touchPromotion",
    scope: "incident",
    label: "昇格（プロモーション）の手でしたか？",
    options: [
      {
        value: "promotion-placed",
        label: "昇格：選んだ駒を昇格のマスに触れさせた",
      },
      {
        value: "promotion-not-placed",
        label: "昇格：まだ駒を昇格のマスに触れさせていない",
      },
      { value: "none", label: "昇格の手ではない" },
    ],
    showWhen: { questionId: "touchWhatNext", values: ["moved-touched"] },
  },
  touchedPieces: {
    id: "touchedPieces",
    scope: "incident",
    label: "触れた駒とマス（触れた順に）",
    help: "駒の記号（白は大文字・黒は小文字。K キング・Q クイーン・R ルーク・B ビショップ・N ナイト・P ポーン）とマスを、触れた順に書きます（例: Pe2 Qd1）。下に局面（FEN）を入力する場合は、マスだけでも構いません（例: e2 d1）。自分の駒と相手の駒のどちらを先に触れたか分からない場合は、自分の駒を先に書きます（4.3.3）。入力した内容は端末の外へ送りません。",
    input: "text",
    placeholder: "Pe2 Qd1",
    options: [],
    showWhen: {
      questionId: "touchWhatNext",
      values: ["moved-other", "not-moved"],
    },
  },
  touchFen: {
    id: "touchFen",
    scope: "incident",
    label: "（任意）触れた時点の局面の FEN（手番は触れたプレーヤー）",
    help: "入力すると、触れた駒で指せる合法手を端末内で判定します。入力しない場合は盤上で確認してください。入力した局面は端末の外へ送りません。",
    input: "text",
    optional: true,
    placeholder:
      "例: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    options: [],
    showWhen: {
      questionId: "touchWhatNext",
      values: ["moved-other", "not-moved"],
    },
  },

  // ---- 手動確認 ----
  situationNote: {
    id: "situationNote",
    scope: "incident",
    label: "状況のメモ（必須）",
    help: "決定木の対象外のため、CA・記録用に状況を簡潔に記入してください。",
    input: "text",
    placeholder: "例: 時計の表示が消えた",
    options: [],
  },

  // ---- 対局コンテキスト ----
  competitionType: {
    id: "competitionType",
    scope: "game-context",
    label: "競技区分を選択してください",
    options: [
      { value: "standard", label: "Standard" },
      { value: "rapid", label: "Rapid" },
      { value: "blitz", label: "Blitz" },
    ],
  },
  supervisionRegime: {
    id: "supervisionRegime",
    scope: "game-context",
    label: "大会規定で適用される規則（Rapid A.4/A.5・Blitz B.2/B.3）",
    options: [
      { value: "competition-rules", label: "Competition Rules（A.4 / B.2）" },
      { value: "basic-rules", label: "それ以外（A.5 / B.3）" },
    ],
  },
};

/**
 * 共通の unknown を持つ質問（fact-model §3.3）。
 * 独自の unknown 値を持つ質問（matePosition・bothFlagsOrder・movesNotCompleted・
 * 同一局面の確認・対局履歴の照合）は各 DT が独自の手動確認で扱うため含めない。
 * テキスト（FEN・棋譜）は列挙できないため含めない。
 * game-context（競技区分・規則）は大会プロファイルから与えるため含めない。
 */
const ENUMERATED_UNKNOWN: readonly IncidentQuestionId[] = [
  "playerColor",
  "subtype",
  "gameEndEvent",
  "clockPressed",
  "opponentMadeNextMove",
  "detectedBy",
  "clockTimeSubtype",
  "flagFallen",
  "quickplayGuidelinesApply",
  "lastPeriod",
  "endedBeforeFlag",
  "drawSubtype",
  "claimant",
  "lastMover",
  "claimMode",
  "moveWritten",
  "touchedPiece",
  "touchPlayer",
  "touchHow",
  "touchAdjustDeclared",
  "touchOnMove",
  "touchClaimedByOpponent",
  "touchClaimTiming",
  "touchWhatNext",
  "touchReleased",
  "touchChangedAfter",
  "touchPromotion",
];
/** 列挙できない質問（unknown なら手動確認）。現在はなし（駒数の確認は ADR-014 §5 で廃止） */
const MANUAL_REVIEW_UNKNOWN: readonly IncidentQuestionId[] = [];

export const QUESTIONS: Record<FollowUpQuestionId, FollowUpQuestion> = {
  ...BASE_QUESTIONS,
};
for (const id of ENUMERATED_UNKNOWN)
  QUESTIONS[id] = withUnknown(BASE_QUESTIONS[id], "enumerate");
for (const id of MANUAL_REVIEW_UNKNOWN)
  QUESTIONS[id] = withUnknown(BASE_QUESTIONS[id], "manual-review");

/** この質問への回答 raw が共通の unknown か */
export function isGenericUnknownAnswer(
  id: string,
  raw: string | undefined
): boolean {
  return (
    raw === UNKNOWN_VALUE &&
    (QUESTIONS as Record<string, FollowUpQuestion | undefined>)[id]
      ?.onUnknown !== undefined
  );
}

function parseBoolean(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseTriState(value: string): boolean | "unknown" | undefined {
  if (value === "unknown") return "unknown";
  return parseBoolean(value);
}

function isOneOf<T extends string>(
  value: string,
  allowed: readonly T[]
): value is T {
  return (allowed as readonly string[]).includes(value);
}

const CONDITION_CHECKS = ["met", "not-met", "unknown", "auto"] as const;
/** 75手の確認だけが「75手に達した手でチェックメイト」を持つ（9.6.2） */
const SEVENTY_FIVE_CHECKS = [...CONDITION_CHECKS, "met-checkmate"] as const;
/** 盤上の手順の確認結果（auto を含む）を表す質問 */
const CONDITION_CHECK_QUESTIONS = [
  "repetitionCheck",
  "fiftyMoveCheck",
  "fivefoldCheck",
  "seventyFiveCheck",
] as const;

/** 触れた駒の規則の質問 → TouchMoveFacts のキー（touchPlayer は Incident.playerColor） */
const TOUCH_FACT_KEYS = {
  touchHow: "how",
  touchAdjustDeclared: "adjustDeclared",
  touchOnMove: "onMove",
  touchClaimedByOpponent: "claimedByOpponent",
  touchClaimTiming: "claimBeforeOwnTouch",
  touchWhatNext: "whatNext",
  touchReleased: "released",
  touchChangedAfter: "changedAfter",
  touchPromotion: "promotion",
  touchedPieces: "touchedText",
  touchFen: "fen",
} as const satisfies Partial<Record<IncidentQuestionId, keyof TouchMoveFacts>>;
const TOUCH_FACT_KEYS_BY_ID: Partial<
  Record<IncidentQuestionId, keyof TouchMoveFacts>
> = TOUCH_FACT_KEYS;

/**
 * Incident スコープの回答を Incident に反映した新しい Incident を返す（純粋関数）。
 * 不正な値は無視する。
 */
export function applyIncidentAnswers(
  incident: Incident,
  answers: Partial<Record<IncidentQuestionId, string>>
): Incident {
  const facts: Partial<IllegalMoveFacts> = { ...incident.illegalMoveFacts };
  const flag: Partial<FlagFallFacts> = { ...incident.flagFallFacts };
  const draw: Partial<DrawClaimFacts> = { ...incident.drawClaimFacts };
  const touch: Partial<TouchMoveFacts> = { ...incident.touchMoveFacts };
  let playerColor: PlayerColor | undefined = incident.playerColor;
  let subtype: string | undefined = incident.subtype;
  let touchedIllegal = false;
  let touchedFlag = false;
  let touchedDraw = false;
  let touchedTouch = false;
  let next_description = incident.description;
  const unknown = new Set(incident.unknownAnswers ?? []);

  /** 共通の unknown が選ばれた質問の、以前の回答を取り消す */
  const clearAnswer = (id: IncidentQuestionId): void => {
    switch (id) {
      case "playerColor":
        playerColor = undefined;
        break;
      case "subtype":
      case "clockPressed":
      case "opponentMadeNextMove":
      case "detectedBy":
        delete facts[id];
        touchedIllegal = true;
        break;
      case "gameEndEvent":
        delete facts.endEvent;
        delete facts.recordState;
        touchedIllegal = true;
        break;
      case "clockTimeSubtype":
        if (incident.category === "clock-time") subtype = undefined;
        break;
      case "flagFallen":
        delete flag.flagFallen;
        if (incident.category === "clock-time") playerColor = undefined;
        touchedFlag = true;
        break;
      case "quickplayGuidelinesApply":
      case "lastPeriod":
        delete flag[id];
        touchedFlag = true;
        break;
      case "endedBeforeFlag":
        delete flag.endedBeforeFlag;
        touchedFlag = true;
        break;
      case "drawSubtype":
        if (incident.category === "draw") subtype = undefined;
        delete draw.subtype;
        touchedDraw = true;
        break;
      case "claimant":
        delete draw.claimant;
        if (incident.category === "draw") playerColor = undefined;
        touchedDraw = true;
        break;
      case "lastMover":
      case "claimMode":
      case "moveWritten":
      case "touchedPiece":
        delete draw[id];
        touchedDraw = true;
        break;
      case "touchPlayer":
        playerColor = undefined;
        break;
      default: {
        const key = TOUCH_FACT_KEYS_BY_ID[id];
        if (key !== undefined) {
          delete touch[key];
          touchedTouch = true;
        }
      }
    }
  };

  // 確認結果の意味はドローの種類ごとに違う（3回・50手・5回・75手）ため、種類を変えたら
  // 以前の確認結果を消す（同じ送信の確認結果は、この後の反映で入る）
  const previousDrawSubtype =
    incident.category === "draw"
      ? (incident.drawClaimFacts?.subtype ?? incident.subtype)
      : undefined;
  if (
    answers.drawSubtype !== undefined &&
    previousDrawSubtype !== undefined &&
    answers.drawSubtype !== previousDrawSubtype
  ) {
    delete draw.conditionCheck;
    delete draw.historyConfirmed;
    delete draw.lastMoveCheckmate;
    touchedDraw = true;
  }

  for (const [id, raw] of Object.entries(answers) as [
    IncidentQuestionId,
    string | undefined,
  ][]) {
    if (raw === undefined) continue;

    // 共通の unknown は値として保持せず unknownAnswers に記録する（fact-model §3.3 e）。
    // 未回答（undefined）とは区別され、DT は needs-input で止まらずに resolveUnknown で扱う
    if (isGenericUnknownAnswer(id, raw)) {
      unknown.add(id);
      clearAnswer(id);
      continue;
    }
    unknown.delete(id);

    switch (id) {
      // ---- 違法手 ----
      case "playerColor":
        if (isOneOf(raw, ["white", "black"] as const)) playerColor = raw;
        break;
      case "subtype":
        if (isOneOf(raw, Object.keys(SUBTYPE_LABELS) as IllegalMoveSubtype[])) {
          facts.subtype = raw;
          touchedIllegal = true;
        } else if (raw === TOUCH_MOVE_SUBTYPE) {
          // 触れた駒の規則は 7.5 の違法手ではない（DT-007。ADR-014 §6）
          delete facts.subtype;
          subtype = raw;
          touchedIllegal = true;
        }
        break;
      case "gameEndEvent":
        if (isOneOf(raw, GAME_END_EVENTS)) {
          facts.endEvent = raw;
          // 対局中なら結果の記入・署名の状態は意味を持たない
          if (raw === "in-progress") delete facts.recordState;
          touchedIllegal = true;
        }
        break;
      case "gameRecordState":
        if (isOneOf(raw, GAME_RECORD_STATES)) {
          facts.recordState = raw;
          touchedIllegal = true;
        } else if (raw === UNKNOWN_VALUE) {
          // 「わからない」は記録しない（以前の記録も残さない）
          delete facts.recordState;
          touchedIllegal = true;
        }
        break;
      case "clockPressed":
      case "opponentMadeNextMove": {
        const b = parseBoolean(raw);
        if (b !== undefined) {
          facts[id] = b;
          touchedIllegal = true;
        }
        break;
      }
      case "matePosition":
        if (isOneOf(raw, ["fen", "unknown"] as readonly MatePositionInput[])) {
          if (incident.category === "illegal-move") {
            facts.matePosition = raw;
            touchedIllegal = true;
          } else if (incident.category === "clock-time") {
            flag.matePosition = raw;
            touchedFlag = true;
          }
        }
        break;
      case "reinstatedFen": {
        const fen = raw.trim();
        facts.positionFen = fen === "" ? undefined : fen;
        touchedIllegal = true;
        break;
      }
      case "detectedBy":
        if (
          isOneOf(raw, [
            "arbiter",
            "opponent-claim",
            "other",
          ] as readonly IllegalMoveDetection[])
        ) {
          facts.detectedBy = raw;
          touchedIllegal = true;
        }
        break;

      // ---- 時計・時間 ----
      case "clockTimeSubtype":
        if (
          isOneOf(
            raw,
            Object.keys(CLOCK_TIME_SUBTYPE_LABELS) as ClockTimeSubtype[]
          )
        )
          subtype = raw;
        break;
      case "flagFallen":
        if (isOneOf(raw, ["white", "black", "both"] as readonly FlagFallen[])) {
          flag.flagFallen = raw;
          // 時間切れの対象プレーヤー（両方の場合は未設定のまま）
          if (raw !== "both") playerColor = raw;
          touchedFlag = true;
        }
        break;
      case "bothFlagsOrder":
        if (
          isOneOf(raw, [
            "white-first",
            "black-first",
            "unknown",
          ] as readonly BothFlagsOrder[])
        ) {
          flag.bothFlagsOrder = raw;
          touchedFlag = true;
        }
        break;
      case "endedBeforeFlag":
        if (isOneOf(raw, ENDED_BEFORE_FLAG_VALUES)) {
          flag.endedBeforeFlag = raw;
          touchedFlag = true;
        }
        break;
      case "quickplayGuidelinesApply":
      case "lastPeriod": {
        const b = parseBoolean(raw);
        if (b !== undefined) {
          flag[id] = b;
          touchedFlag = true;
        }
        break;
      }
      case "movesNotCompleted": {
        const t = parseTriState(raw);
        if (t !== undefined) {
          flag[id] = t;
          touchedFlag = true;
        }
        break;
      }
      case "positionFen": {
        const fen = raw.trim();
        flag.fen = fen === "" ? undefined : fen;
        touchedFlag = true;
        break;
      }

      // ---- ドロー ----
      case "drawSubtype":
        if (isOneOf(raw, Object.keys(DRAW_SUBTYPE_LABELS) as DrawSubtype[])) {
          subtype = raw;
          draw.subtype = raw;
          touchedDraw = true;
        }
        break;
      case "claimant":
        if (isOneOf(raw, ["white", "black"] as const)) {
          draw.claimant = raw;
          // 誤ったクレームの時間加算は請求者の履歴に帰属させる（Penalty 履歴）
          playerColor = raw;
          touchedDraw = true;
        }
        break;
      case "lastMover":
        if (isOneOf(raw, ["white", "black"] as const)) {
          draw.lastMover = raw;
          touchedDraw = true;
        }
        break;
      case "moveWritten":
      case "touchedPiece": {
        const b = parseBoolean(raw);
        if (b !== undefined) {
          draw[id] = b;
          touchedDraw = true;
        }
        break;
      }
      case "claimMode":
        if (
          isOneOf(raw, [
            "about-to-appear",
            "just-appeared",
          ] as readonly RepetitionClaimMode[])
        ) {
          draw.claimMode = raw;
          touchedDraw = true;
        }
        break;
      case "repetitionCheck":
      case "fiftyMoveCheck":
      case "fivefoldCheck":
      case "seventyFiveCheck":
        if (
          isOneOf(
            raw,
            (id === "seventyFiveCheck"
              ? SEVENTY_FIVE_CHECKS
              : CONDITION_CHECKS) as readonly ConditionCheck[]
          )
        ) {
          draw.conditionCheck = raw;
          // 75手の手動確認では「チェックメイトではない（met）」も明示の観測として記録する。
          // 旧（J1b-5 より前）の「75手以上」には記録がなく、DT-006 は確認をやり直す
          if (id === "seventyFiveCheck" && raw === "met")
            draw.lastMoveCheckmate = false;
          else delete draw.lastMoveCheckmate;
          // 旧「最後の手はチェックメイトか」への「わからない」は、新しい確認結果で置き換える
          unknown.delete("lastMoveCheckmate");
          touchedDraw = true;
        }
        break;
      // ---- 触れた駒の規則 ----
      case "touchPlayer":
        if (isOneOf(raw, ["white", "black"] as const)) playerColor = raw;
        break;
      case "touchHow":
        if (
          isOneOf(raw, [
            "grasped",
            "lifted",
            "pushed",
            "brushed",
          ] as readonly TouchHow[])
        ) {
          touch.how = raw;
          touchedTouch = true;
        }
        break;
      case "touchAdjustDeclared":
      case "touchOnMove":
      case "touchClaimedByOpponent":
      case "touchClaimTiming":
      case "touchReleased":
      case "touchChangedAfter": {
        const b = parseBoolean(raw);
        if (b !== undefined) {
          touch[TOUCH_FACT_KEYS[id]] = b;
          touchedTouch = true;
        }
        break;
      }
      case "touchWhatNext":
        if (
          isOneOf(raw, [
            "moved-touched",
            "moved-other",
            "not-moved",
          ] as readonly TouchWhatNext[])
        ) {
          touch.whatNext = raw;
          touchedTouch = true;
        }
        break;
      case "touchPromotion":
        if (
          isOneOf(raw, [
            "promotion-placed",
            "promotion-not-placed",
            "none",
          ] as readonly TouchPromotion[])
        ) {
          touch.promotion = raw;
          touchedTouch = true;
        }
        break;
      case "touchedPieces":
      case "touchFen": {
        const text = raw.trim();
        touch[TOUCH_FACT_KEYS[id]] = text === "" ? undefined : text;
        touchedTouch = true;
        break;
      }

      case "situationNote": {
        const note = raw.trim();
        if (note !== "") {
          next_description = next_description.trim()
            ? `${next_description}\n${note}`
            : note;
        }
        break;
      }
      case "positionsText":
      case "intendedMove": {
        const text = raw.trim();
        draw[id] = text === "" ? undefined : text;
        touchedDraw = true;
        break;
      }
      case "historyConfirmed":
        if (
          isOneOf(raw, [
            "match",
            "position-only",
            "mismatch",
            "unknown",
          ] as readonly HistoryConfirmation[])
        ) {
          draw.historyConfirmed = raw;
          touchedDraw = true;
        }
        break;
    }
  }

  // J1b-8 より前の「対局は終了していたか（はい/いいえ）」の回答と「わからない」は、
  // 対局を終わらせた出来事の回答（unknown を含む）で置き換える（ADR-014 §3）
  if (answers.gameEndEvent !== undefined) {
    delete facts.gameEnded;
    unknown.delete("gameEnded");
  }
  if (answers.endedBeforeFlag !== undefined) {
    delete flag.gameEndedBeforeFlag;
    unknown.delete("gameEndedBeforeFlag");
  }

  // 別の対局履歴に対する照合結果は引き継がない（ADR-014 §4）。同じ送信で新しい棋譜と
  // 照合結果が届いた場合も、照合は表示していた旧い棋譜に対するものなので消す
  if (draw.positionsText !== incident.drawClaimFacts?.positionsText)
    delete draw.historyConfirmed;
  // 「判定する」を選び直した場合は、照合からやり直す（「一致しない」の誤タップを取り消せる）
  const reselectedAuto = CONDITION_CHECK_QUESTIONS.some(
    (id) => answers[id] === "auto"
  );
  if (reselectedAuto && answers.historyConfirmed === undefined)
    delete draw.historyConfirmed;

  const next: Incident = {
    ...incident,
    playerColor,
    subtype,
    description: next_description,
  };
  if (unknown.size > 0) next.unknownAnswers = Array.from(unknown);
  else delete next.unknownAnswers;
  if (
    incident.category === "illegal-move" ||
    touchedIllegal ||
    incident.illegalMoveFacts
  ) {
    next.illegalMoveFacts = facts;
    // 違法手の subtype は Incident.subtype にも反映（従来どおり）
    // 「わからない」と回答された場合は、以前の subtype を残さない（ログ・CSV・回数の明細に出さない）
    if (incident.category === "illegal-move")
      next.subtype =
        facts.subtype ?? (unknown.has("subtype") ? undefined : subtype);
  }
  if (touchedFlag || incident.flagFallFacts) next.flagFallFacts = flag;
  if (touchedDraw || incident.drawClaimFacts) next.drawClaimFacts = draw;
  if (touchedTouch || incident.touchMoveFacts) next.touchMoveFacts = touch;
  return next;
}

/**
 * 構造化された追加質問で判断するカテゴリ（自由記述は任意のメモ）。
 * それ以外のカテゴリは手動確認になるため、状況の説明を必須とする。
 */
export function usesStructuredQuestions(
  category: Incident["category"]
): boolean {
  return (
    category === "illegal-move" ||
    category === "clock-time" ||
    category === "draw"
  );
}

/**
 * カテゴリ選択画面のショートカット（M3: 頻出の決定木へ subtype 込みで直接入る）。
 * subtype をカテゴリ選択時に確定し、追加質問のラウンドを減らす。
 */
export interface QuickReport {
  id: string;
  category: Incident["category"];
  subtype: string;
  label: string;
}

export const QUICK_REPORTS: readonly QuickReport[] = [
  {
    id: "touch-move",
    category: "illegal-move",
    subtype: TOUCH_MOVE_SUBTYPE,
    label: "タッチムーブ（触れた駒）",
  },
  {
    id: "flag-fall",
    category: "clock-time",
    subtype: "flag-fall",
    label: "フラッグ（時間切れ）",
  },
  {
    id: "threefold",
    category: "draw",
    subtype: "threefold-repetition-claim",
    label: "三回同一局面のクレーム",
  },
  {
    id: "fifty-move",
    category: "draw",
    subtype: "fifty-move-claim",
    label: "50手ルールのクレーム",
  },
  {
    id: "fivefold",
    category: "draw",
    subtype: "fivefold-repetition",
    label: "五回同一局面",
  },
  {
    id: "75-move",
    category: "draw",
    subtype: "75-move-rule",
    label: "75手ルール",
  },
];

/** カテゴリに対して有効な subtype か（報告時の検証用） */
export function isKnownSubtype(
  category: Incident["category"],
  subtype: string
): boolean {
  if (category === "clock-time")
    return Object.keys(CLOCK_TIME_SUBTYPE_LABELS).includes(subtype);
  if (category === "draw")
    return Object.keys(DRAW_SUBTYPE_LABELS).includes(subtype);
  // 違法手は、決定木の振り分けが変わる touch-move だけを報告時に確定できる
  // （7.5 の種類は決定木の質問で確認する）
  if (category === "illegal-move") return subtype === TOUCH_MOVE_SUBTYPE;
  return false;
}

/** game-context スコープの回答を解釈する（純粋関数） */
export function parseGameContextAnswers(
  answers: Partial<Record<GameContextQuestionId, string>>
): {
  competitionType?: CompetitionType;
  supervisionRegime?: SupervisionRegime;
} {
  const out: {
    competitionType?: CompetitionType;
    supervisionRegime?: SupervisionRegime;
  } = {};
  const ct = answers.competitionType;
  if (ct && isOneOf(ct, ["standard", "rapid", "blitz"] as const))
    out.competitionType = ct;
  const sr = answers.supervisionRegime;
  if (sr && isOneOf(sr, ["competition-rules", "basic-rules"] as const))
    out.supervisionRegime = sr;
  return out;
}
