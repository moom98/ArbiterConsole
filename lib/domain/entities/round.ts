/**
 * ラウンドの状態（要件 §26 / implementation-plan Milestone 7.3 の遷移 pending → active → completed）。
 * Round Checklist（Milestone 7）はこの Round.id に紐づけて別に保持する想定。
 */
export type RoundStatus = "pending" | "active" | "completed";

export interface Round {
  id: string;
  tournamentId: string;
  /** 1始まり */
  roundNumber: number;
  status: RoundStatus;
  scheduledStartTime?: Date;
  actualStartTime?: Date;
  endTime?: Date;
  createdAt: Date;
  updatedAt: Date;
}
