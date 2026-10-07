import type {
  Game,
  PlayerProfile,
  Round,
  RoundChecklist,
  Tournament,
  TournamentChecklistTemplate,
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
  /**
   * 大会と、そのラウンド・対局・登録プレーヤー・大会固有規定（資料・条文・Embedding）を
   * 1トランザクションで削除する。Incident が記録されている場合は何も削除せず
   * TournamentHasIncidentsError を投げる（判定も同じトランザクション内で行う）。
   */
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

/** Round Checklist（Milestone 7）の永続化 */
export interface ChecklistRepository {
  /** 大会のチェックリスト構成。未カスタマイズなら null（既定テンプレートを使う） */
  findTemplate(
    tournamentId: string
  ): Promise<TournamentChecklistTemplate | null>;
  saveTemplate(template: TournamentChecklistTemplate): Promise<void>;
  deleteTemplate(tournamentId: string): Promise<void>;
  /** ラウンドの完了状態。未記録なら null */
  findRoundChecklist(roundId: string): Promise<RoundChecklist | null>;
  saveRoundChecklist(checklist: RoundChecklist): Promise<void>;
  /**
   * ラウンドの対局で保留中（status = "pending"）の Incident 数。
   * 追加質問待ちと、AI判断で確認待ちのもの（Milestone 5）を含む。
   */
  countPendingIncidents(
    tournamentId: string,
    roundNumber: number
  ): Promise<number>;
}

/** Incident が記録されている大会は削除できない（履歴保全） */
export class TournamentHasIncidentsError extends Error {
  constructor(readonly incidentCount: number) {
    super(
      `この大会には${incidentCount}件のIncidentが記録されているため削除できません`
    );
    this.name = "TournamentHasIncidentsError";
  }
}
