export type GameResult =
  "white-win" | "black-win" | "draw" | "ongoing" | "both-lose";

/** 対局に記録するプレーヤー情報（登録済みプレーヤーの場合は id を保持） */
export interface Player {
  /** PlayerProfile.id（登録済みプレーヤーの場合） */
  id?: string;
  name: string;
  rating?: number;
  fideId?: string;
}

export interface Game {
  id: string;
  tournamentId: string;
  /** Round.id（大会管理で作成した対局の場合） */
  roundId?: string;
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

/** 大会に登録したプレーヤー（Milestone 6） */
export interface PlayerProfile {
  id: string;
  tournamentId: string;
  name: string;
  rating?: number;
  fideId?: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
}
