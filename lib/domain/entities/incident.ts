export type IncidentCategory =
  | "illegal-move"
  | "board-piece"
  | "clock-time"
  | "game-result"
  | "draw"
  | "scoresheet"
  | "player-behavior"
  | "team"
  | "fair-play"
  | "tournament-admin";

export type IncidentStatus = "pending" | "resolved" | "escalated";

export interface Incident {
  id: string;
  gameId: string;
  category: IncidentCategory;
  subtype?: string;
  description: string;
  arbiterObserved: boolean;
  reportedBy: "arbiter" | "player-white" | "player-black";
  reportedAt: Date;
  status: IncidentStatus;
  decisionId?: string;
  escalatedToCA: boolean;
  escalationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
