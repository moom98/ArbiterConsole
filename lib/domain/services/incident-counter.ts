import type {
  Decision,
  Incident,
  PenaltyType,
  PlayerColor,
} from "@/lib/domain/entities";
import {
  DT_001_ID,
  type PriorIllegalMove,
} from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";
import { DT_002_ID } from "@/lib/domain/decision-trees/dt-002-illegal-move-fast-competition";
import { DT_003_ID } from "@/lib/domain/decision-trees/dt-003-illegal-move-fast-basic";
import { DT_007_ID } from "@/lib/domain/decision-trees/dt-007-touch-move";
import { TOUCH_MOVE_SUBTYPE } from "@/lib/domain/entities";

export type { PriorIllegalMove };

export interface IncidentRecord {
  incident: Incident;
  decision?: Decision;
}

/**
 * 違法手の回数として数える Decision Tree。
 * Rapid / Blitz の違法手も 7.5.5 の「同じプレーヤーの2回目」として Standard と同じく数える
 * （A.5.2 は 7.5.5 に従うと規定。Arbiters' Manual: "as it is in standard chess"）。
 * 対局の競技区分は大会で固定のため、1つの対局で DT-001 と DT-002/003 が混在することはない。
 */
const ILLEGAL_MOVE_TREES: readonly string[] = [DT_001_ID, DT_002_ID, DT_003_ID];

/** 違法手ペナルティとして数えるペナルティ種別（7.5.5） */
const ILLEGAL_MOVE_PENALTY_TYPES: readonly PenaltyType[] = [
  "time-addition-opponent",
  "game-loss",
];

/**
 * IncidentCounter（要件 §16, §25 / 実装計画 §3.2）
 *
 * 対局（gameId）× 違反プレーヤー（playerColor）ごとに、
 * 違法手の Decision Tree が実際に違法手ペナルティ（相手への時間加算または負け）を
 * 適用した Incident のみを数える。
 * 時計未押下・対局終了後・追加質問待ち・手動確認などペナルティのない Incident は数えない。
 */
export class IncidentCounter {
  static isPenalisedIllegalMove(record: IncidentRecord): boolean {
    const { incident, decision } = record;
    if (incident.category !== "illegal-move") return false;
    // 触れた駒の規則（Article 4）は 7.5 の違法手として数えない（ADR-014 §6）
    if (incident.subtype === TOUCH_MOVE_SUBTYPE) return false;
    if (!decision || decision.incidentId !== incident.id) return false;
    if (!decision.treeId || !ILLEGAL_MOVE_TREES.includes(decision.treeId))
      return false;
    return decision.penalties.some((p) =>
      ILLEGAL_MOVE_PENALTY_TYPES.includes(p.type)
    );
  }

  /** 数えた違法手の明細（報告時刻順） */
  static listIllegalMoves(
    records: readonly IncidentRecord[],
    gameId: string,
    playerColor: PlayerColor,
    options: { excludeIncidentId?: string } = {}
  ): PriorIllegalMove[] {
    return records
      .filter(
        (r) =>
          r.incident.gameId === gameId &&
          r.incident.playerColor === playerColor &&
          r.incident.id !== options.excludeIncidentId &&
          IncidentCounter.isPenalisedIllegalMove(r)
      )
      .map((r) => ({
        incidentId: r.incident.id,
        reportedAt: r.incident.reportedAt,
        subtype: r.incident.illegalMoveFacts?.subtype,
      }))
      .sort((a, b) => a.reportedAt.getTime() - b.reportedAt.getTime());
  }

  static countIllegalMoves(
    records: readonly IncidentRecord[],
    gameId: string,
    playerColor: PlayerColor,
    options: { excludeIncidentId?: string } = {}
  ): number {
    return IncidentCounter.listIllegalMoves(
      records,
      gameId,
      playerColor,
      options
    ).length;
  }

  /** 色ごとの明細。DecisionEngine の illegalMoveHistory にそのまま渡す */
  static illegalMoveHistory(
    records: readonly IncidentRecord[],
    gameId: string,
    options: { excludeIncidentId?: string } = {}
  ): Record<PlayerColor, PriorIllegalMove[]> {
    return {
      white: IncidentCounter.listIllegalMoves(
        records,
        gameId,
        "white",
        options
      ),
      black: IncidentCounter.listIllegalMoves(
        records,
        gameId,
        "black",
        options
      ),
    };
  }

  /**
   * タッチムーブ違反（DT-007 が「触れた駒の規則に従わずに別の駒を動かした」と判断した Incident）か。
   * 7.5 の違法手とは別に数え、合算しない（ADR-014 §6）。
   */
  static isTouchMoveViolation(record: IncidentRecord): boolean {
    const { incident, decision } = record;
    return (
      incident.category === "illegal-move" &&
      incident.subtype === TOUCH_MOVE_SUBTYPE &&
      decision !== undefined &&
      decision.incidentId === incident.id &&
      decision.treeId === DT_007_ID &&
      decision.touchMoveViolation === true
    );
  }

  /** 色ごとのタッチムーブ違反の回数。DecisionEngine の touchMoveViolations にそのまま渡す */
  static touchMoveViolationsByColor(
    records: readonly IncidentRecord[],
    gameId: string,
    options: { excludeIncidentId?: string } = {}
  ): Record<PlayerColor, number> {
    const counts: Record<PlayerColor, number> = { white: 0, black: 0 };
    for (const r of records) {
      const color = r.incident.playerColor;
      if (
        r.incident.gameId === gameId &&
        color !== undefined &&
        r.incident.id !== options.excludeIncidentId &&
        IncidentCounter.isTouchMoveViolation(r)
      )
        counts[color] += 1;
    }
    return counts;
  }

  static countIllegalMovesByColor(
    records: readonly IncidentRecord[],
    gameId: string,
    options: { excludeIncidentId?: string } = {}
  ): Record<PlayerColor, number> {
    const h = IncidentCounter.illegalMoveHistory(records, gameId, options);
    return { white: h.white.length, black: h.black.length };
  }
}
