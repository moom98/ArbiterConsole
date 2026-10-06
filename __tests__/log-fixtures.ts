import type {
  Decision,
  Game,
  Incident,
  Penalty,
  PlayerColor,
  Tournament,
} from "@/lib/domain/entities";
import type { IncidentLogEntry } from "@/lib/domain/services/penalty-history";

let seq = 0;

export const TOURNAMENT: Tournament = {
  id: "t1",
  name: "暫定大会",
  competitionType: "standard",
  rulesVersion: "FIDE-2023",
  startDate: new Date(2026, 0, 1, 9, 0, 0),
  regulations: [],
  createdAt: new Date(2026, 0, 1, 9, 0, 0),
  updatedAt: new Date(2026, 0, 1, 9, 0, 0),
};

export function makeGame(id: string, round: number, board: number): Game {
  return {
    id,
    tournamentId: TOURNAMENT.id,
    round,
    boardNumber: board,
    white: { name: "" },
    black: { name: "" },
    startTime: new Date(2026, 0, 1, 9, 0, 0),
    createdAt: new Date(2026, 0, 1, 9, 0, 0),
    updatedAt: new Date(2026, 0, 1, 9, 0, 0),
  };
}

export const TIME_ADD_FOR = (opp: PlayerColor): Penalty => ({
  type: "time-addition-opponent",
  playerColor: opp,
  timeAdjustmentSeconds: 120,
  description: `${opp === "white" ? "白" : "黒"}に2分追加`,
});

export function entry(opts: {
  game?: Game;
  color?: PlayerColor;
  category?: Incident["category"];
  penalties?: Penalty[];
  minute?: number;
  description?: string;
  noDecision?: boolean;
  escalated?: boolean;
  treeId?: Decision["treeId"] | null;
}): IncidentLogEntry {
  const id = `inc-${++seq}`;
  const game = opts.game ?? makeGame("g1", 1, 1);
  const reportedAt = new Date(2026, 0, 1, 10, opts.minute ?? seq, 0);
  const incident: Incident = {
    id,
    gameId: game.id,
    category: opts.category ?? "illegal-move",
    playerColor: opts.color,
    description: opts.description ?? "",
    arbiterObserved: true,
    reportedBy: "arbiter",
    reportedAt,
    status: opts.escalated ? "escalated" : "resolved",
    escalatedToCA: opts.escalated ?? false,
    createdAt: reportedAt,
    updatedAt: reportedAt,
  };
  if (opts.noDecision) return { incident, game, tournament: TOURNAMENT };
  const decision: Decision = {
    id: `dec-${seq}`,
    incidentId: id,
    kind: "recommendation",
    treeId:
      opts.treeId === null
        ? undefined
        : (opts.treeId ?? "DT-001-illegal-move-standard"),
    rulesVersion: "FIDE-2023",
    conclusion: "推奨される結論",
    actions: [],
    intervention: "immediate",
    penalties: opts.penalties ?? [],
    sources: [
      {
        article: "FIDE 7.5.5",
        source: "FIDE",
        priority: 1,
        edition: "FIDE Laws of Chess 2023",
      },
    ],
    confidence: "high",
    escalationRecommended: opts.escalated ?? false,
    generatedBy: "decision-tree",
    validationPassed: true,
    createdAt: reportedAt,
  };
  return {
    incident: { ...incident, decisionId: decision.id },
    decision,
    game,
    tournament: TOURNAMENT,
  };
}
