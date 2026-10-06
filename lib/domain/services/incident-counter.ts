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

export type { PriorIllegalMove };

export interface IncidentRecord {
  incident: Incident;
  decision?: Decision;
}

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
    if (!decision || decision.incidentId !== incident.id) return false;
    if (decision.treeId !== DT_001_ID) return false;
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

  static countIllegalMovesByColor(
    records: readonly IncidentRecord[],
    gameId: string,
    options: { excludeIncidentId?: string } = {}
  ): Record<PlayerColor, number> {
    const h = IncidentCounter.illegalMoveHistory(records, gameId, options);
    return { white: h.white.length, black: h.black.length };
  }
}
