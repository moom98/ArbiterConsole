export type GameResult =
  | "white-win"
  | "black-win"
  | "draw"
  | "ongoing"
  | "both-lose";

export interface Player {
  name: string;
  rating?: number;
  fideId?: string;
}

export interface Game {
  id: string;
  tournamentId: string;
  round: number;
  boardNumber?: number;
  white: Player;
  black: Player;
  result?: GameResult;
  pgn?: string;
  startTime: Date;
  endTime?: Date;
  createdAt: Date;
  updatedAt: Date;
}
