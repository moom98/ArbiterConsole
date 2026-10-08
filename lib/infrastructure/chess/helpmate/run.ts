import { Chess } from "chess.js";
import type { MateSearchRecord } from "@/lib/domain/entities";
import {
  HELPMATE_ENGINE_VERSION,
  type MatePositionRequest,
} from "@/lib/domain/services/mate-possibility";
import {
  DEFAULT_HELPMATE_LIMITS,
  findHelpmate,
  type HelpmateLimits,
} from "./search";

/**
 * スマホで約1.5秒（ADR-014 §5）。展開数の上限は DEFAULT_HELPMATE_LIMITS（受け入れテストと同じ）
 */
export const HELPMATE_TIME_BUDGET_MS = 1500;

/** UCI の手順を chess.js で SAN に変換する（指せない手があれば undefined） */
export function uciLineToSan(fen: string, uci: string[]): string[] | undefined {
  try {
    const chess = new Chess(fen);
    return uci.map(
      (u) =>
        chess.move({
          from: u.slice(0, 2),
          to: u.slice(2, 4),
          promotion: u[4],
        }).san
    );
  } catch {
    return undefined;
  }
}

/**
 * ヘルプメイト探索を実行して、Incident に保存する記録を作る（同期。Worker 内で呼ぶ）。
 * 手順は SAN にして返す（ドメインが ChessPositionPort で再検証する）。
 */
export function runHelpmateSearch(
  request: MatePositionRequest,
  limits: Partial<HelpmateLimits> = {},
  now: () => number = () => Date.now()
): MateSearchRecord {
  const base = {
    fen: request.fen,
    attacker: request.attacker,
    engine: HELPMATE_ENGINE_VERSION,
  };
  const result = findHelpmate(request.fen, request.attacker, {
    ...DEFAULT_HELPMATE_LIMITS,
    deadline: now() + HELPMATE_TIME_BUDGET_MS,
    now,
    ...limits,
  });
  if (result.status !== "found")
    return { ...base, status: "not-found", reason: result.reason };
  const moves = uciLineToSan(request.fen, result.uci);
  if (!moves)
    return { ...base, status: "not-found", reason: "conversion-failed" };
  return { ...base, status: "found", moves };
}
