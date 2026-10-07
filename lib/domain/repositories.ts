import type {
  Game,
  PlayerProfile,
  Round,
  Tournament,
} from "@/lib/domain/entities";

/**
 * 大会管理（Milestone 6）のリポジトリ境界。純粋なインターフェースのみを定義し、
 * 実装（Dexie / IndexedDB）は lib/infrastructure/db に置く。
 */

export interface TournamentRepository {
  findById(id: string): Promise<Tournament | null>;
  /** 大会管理で作成した大会（暫定大会 adhoc:* は含めない）。開始日の新しい順 */
  findAll(): Promise<Tournament[]>;
  save(tournament: Tournament): Promise<void>;
  /** 大会と、そのラウンド・登録プレーヤーを削除する（対局・Incident は履歴として残す） */
  delete(id: string): Promise<void>;
}

export interface RoundRepository {
  findById(id: string): Promise<Round | null>;
  /** ラウンド番号順 */
  findByTournament(tournamentId: string): Promise<Round[]>;
  findByNumber(
    tournamentId: string,
    roundNumber: number
  ): Promise<Round | null>;
  save(round: Round): Promise<void>;
}

export interface GameRepository {
  findById(id: string): Promise<Game | null>;
  /** ボード番号順 */
  findByRound(tournamentId: string, roundNumber: number): Promise<Game[]>;
  /** 既存 ID は上書きしない（既存の対局と履歴を保持する）。追加した件数を返す */
  addMissing(games: Game[]): Promise<number>;
  save(game: Game): Promise<void>;
}

export interface PlayerRepository {
  findById(id: string): Promise<PlayerProfile | null>;
  /** 名前順 */
  findByTournament(tournamentId: string): Promise<PlayerProfile[]>;
  save(player: PlayerProfile): Promise<void>;
  delete(id: string): Promise<void>;
}

/** 端末ローカルで選択中の大会 */
export interface ActiveTournamentStore {
  getActiveTournamentId(): Promise<string | null>;
  setActiveTournamentId(id: string | null): Promise<void>;
}

export interface TournamentRepositories {
  tournaments: TournamentRepository;
  rounds: RoundRepository;
  games: GameRepository;
  players: PlayerRepository;
  active: ActiveTournamentStore;
  /** 大会の対局に記録された Incident 数（削除可否の判定用） */
  countIncidents(tournamentId: string): Promise<number>;
}
