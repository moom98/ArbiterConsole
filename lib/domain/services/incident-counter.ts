import type {
  Decision,
  Incident,
  PenaltyType,
  PlayerColor,
} from "@/lib/domain/entities";
import { DT_001_ID } from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";

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

  static countIllegalMoves(
    records: readonly IncidentRecord[],
    gameId: string,
    playerColor: PlayerColor,
    options: { excludeIncidentId?: string } = {}
  ): number {
    return records.filter(
      (r) =>
        r.incident.gameId === gameId &&
        r.incident.playerColor === playerColor &&
        r.incident.id !== options.excludeIncidentId &&
        IncidentCounter.isPenalisedIllegalMove(r)
    ).length;
  }

  static countIllegalMovesByColor(
    records: readonly IncidentRecord[],
    gameId: string,
    options: { excludeIncidentId?: string } = {}
  ): Record<PlayerColor, number> {
    return {
      white: IncidentCounter.countIllegalMoves(
        records,
        gameId,
        "white",
        options
      ),
      black: IncidentCounter.countIllegalMoves(
        records,
        gameId,
        "black",
        options
      ),
    };
  }
}
