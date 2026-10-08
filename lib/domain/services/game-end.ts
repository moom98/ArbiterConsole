/**
 * 対局の終了（ADR-014 §3）。
 *
 * - 対局を終わらせた出来事（game.end-event / ct.ended-before-flag）を観察として記録し、
 *   DT-001〜003 の「対局はすでに終了しているか」と DT-004 の「フラッグの前に対局は
 *   終了していたか」はそこから求める。
 * - **握手だけでは対局の終了としない。** 握手は選択肢にない。終了の意思（投了・合意）が
 *   確認できない場合は「わからない・確認できない」を選び、判断が分かれれば手動確認になる。
 * - 結果の記入・署名の状態（game.record-state）は別の記録で、判断には使わない。
 */
import type {
  EndedBeforeFlag,
  GameEndEvent,
  GameRecordState,
} from "@/lib/domain/entities";

export const GAME_END_EVENT_LABELS: Record<GameEndEvent, string> = {
  "in-progress": "まだ対局中",
  checkmate: "チェックメイト",
  resignation: "投了の発言や動作",
  stalemate: "ステイルメイト",
  "draw-agreement": "ドローの合意",
  "time-out": "時間切れの確定（アービターが確認、または有効な主張）",
  other: "その他（デッドポジション・五回同一局面・75手など）",
};

export const ENDED_BEFORE_FLAG_LABELS: Record<EndedBeforeFlag, string> = {
  none: "なし（対局は続いていた）",
  checkmate: "チェックメイト",
  resignation: "投了の発言や動作",
  "draw-agreement": "ドローの合意",
  stalemate: "ステイルメイト",
  other: "その他（デッドポジション・五回同一局面・75手など）",
};

export const GAME_RECORD_STATE_LABELS: Record<GameRecordState, string> = {
  none: "結果は未記入",
  written: "結果の記入のみ（署名なし）",
  "one-signed": "片方のプレーヤーが署名",
  "both-signed": "両プレーヤーが署名",
};

export const GAME_END_EVENTS = Object.keys(
  GAME_END_EVENT_LABELS
) as GameEndEvent[];
export const ENDED_BEFORE_FLAG_VALUES = Object.keys(
  ENDED_BEFORE_FLAG_LABELS
) as EndedBeforeFlag[];
export const GAME_RECORD_STATES = Object.keys(
  GAME_RECORD_STATE_LABELS
) as GameRecordState[];

/** 対局はすでに終了しているか（未回答なら undefined） */
export function gameEndedFromEvent(
  event: GameEndEvent | undefined
): boolean | undefined {
  return event === undefined ? undefined : event !== "in-progress";
}

/** フラッグの確定前に対局は終了していたか（未回答なら undefined） */
export function endedBeforeFlagFromEvent(
  event: EndedBeforeFlag | undefined
): boolean | undefined {
  return event === undefined ? undefined : event !== "none";
}

/**
 * 結果の記入・署名の状態に応じた確認事項（要件 §20）。両者の署名があれば、または
 * 記録されていなければ、追加の確認はない
 */
export function recordStateAction(
  state: GameRecordState | undefined
): string | undefined {
  if (state === undefined || state === "both-signed") return undefined;
  return state === "none"
    ? "結果の記入と両プレーヤーの署名を確認する"
    : "両プレーヤーの署名を確認する";
}
