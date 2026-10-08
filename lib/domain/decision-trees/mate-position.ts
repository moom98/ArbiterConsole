import type { MatePositionInput } from "@/lib/domain/entities";
import { QUESTIONS, type FollowUpQuestion } from "@/lib/domain/follow-up";
import type { MatePossibility } from "@/lib/domain/services/mate-possibility";

/**
 * 7.5.5 ただし書き（相手がメイト不可能ならドロー）の、局面による判定（ADR-014 §5）。
 * DT-001 / DT-002 / DT-003 で共通。メイト可能性は DecisionEngine が assessMatePossibility で
 * 算出して mate に渡す。
 */
export type MateStep =
  /** 局面を質問する（error: 入力された局面を使えない理由） */
  | { kind: "ask"; error?: string }
  /** メイト可能か確定できない（CAへ確認） */
  | { kind: "unknown"; reason: string }
  | { kind: "cannot-mate"; reason: string }
  /** line: 検証済みのメイトまでの手順 */
  | { kind: "can-mate"; line: string };

/** 違法手の直前に戻した局面の質問（入力方法 → FEN） */
export function reinstatedPositionQuestions(): FollowUpQuestion[] {
  return [QUESTIONS.matePosition, QUESTIONS.reinstatedFen];
}

export function mateStep(
  matePosition: MatePositionInput | undefined,
  mate: MatePossibility | undefined
): MateStep {
  if (matePosition === undefined) return { kind: "ask" };
  if (matePosition === "unknown")
    return { kind: "unknown", reason: "局面が入力されていません" };
  if (!mate) return { kind: "unknown", reason: "局面を判定できません" };
  switch (mate.cause) {
    case "no-position":
      return { kind: "ask", error: "局面（FEN）を入力してください。" };
    case "invalid-position":
    case "wrong-side-to-move":
      return {
        kind: "ask",
        error: `${mate.reason}。FEN を修正するか、「局面を入力できない」を選んでください。`,
      };
  }
  if (mate.verdict === "cannot-mate")
    return { kind: "cannot-mate", reason: mate.reason };
  if (mate.verdict === "can-mate" && mate.line)
    return { kind: "can-mate", line: mate.line };
  return { kind: "unknown", reason: mate.reason };
}
