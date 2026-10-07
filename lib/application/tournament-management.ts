import type {
  Game,
  PlayerProfile,
  Round,
  RoundStatus,
  Tournament,
} from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import {
  buildTournament,
  type TournamentProfileInput,
} from "@/lib/domain/services/tournament-profile";
import {
  planRoundWithBoards,
  transitionRound,
  type BoardRange,
} from "@/lib/domain/services/round-planning";
import type { TournamentRepositories } from "@/lib/domain/repositories";

/**
 * 大会管理のユースケース（Milestone 6）。リポジトリ（インターフェース）経由でのみ永続化する。
 */
export class TournamentService {
  constructor(
    private readonly repos: TournamentRepositories,
    private readonly providers: DomainProviders
  ) {}

  listTournaments(): Promise<Tournament[]> {
    return this.repos.tournaments.findAll();
  }

  /** 選択中の大会。削除済みの大会を指している場合は null */
  async getActiveTournament(): Promise<Tournament | null> {
    const id = await this.repos.active.getActiveTournamentId();
    return id ? this.repos.tournaments.findById(id) : null;
  }

  async setActiveTournament(id: string | null): Promise<void> {
    if (id !== null && !(await this.repos.tournaments.findById(id)))
      throw new Error("大会が見つかりません");
    await this.repos.active.setActiveTournamentId(id);
  }

  /**
   * 大会を作成・更新する。新規作成時に選択中の大会がなければ、その大会を選択する。
   */
  async saveTournamentProfile(
    input: TournamentProfileInput,
    existingId?: string
  ): Promise<Tournament> {
    const existing = existingId
      ? await this.repos.tournaments.findById(existingId)
      : undefined;
    if (existingId && !existing) throw new Error("大会が見つかりません");
    const tournament = buildTournament(
      input,
      this.providers,
      existing ?? undefined
    );
    await this.repos.tournaments.save(tournament);
    if (!existing && !(await this.getActiveTournament()))
      await this.repos.active.setActiveTournamentId(tournament.id);
    return tournament;
  }

  /**
   * 大会を削除する。Incident が記録されている大会は履歴保全のため削除できない。
   * 大会固有規定の資料は呼び出し側で削除する（rule-library.deleteRuleSource）。
   */
  async deleteTournament(id: string): Promise<void> {
    const count = await this.repos.countIncidents(id);
    if (count > 0)
      throw new Error(
        `この大会には${count}件のIncidentが記録されているため削除できません`
      );
    await this.repos.tournaments.delete(id);
  }

  listRounds(tournamentId: string): Promise<Round[]> {
    return this.repos.rounds.findByTournament(tournamentId);
  }

  listGames(tournamentId: string, roundNumber: number): Promise<Game[]> {
    return this.repos.games.findByRound(tournamentId, roundNumber);
  }

  /**
   * 「Round N, boards a–b」を作成する。既存のラウンド・対局はそのまま（履歴を保持）。
   * @returns ラウンドと、新たに追加した対局数
   */
  async createRoundWithBoards(
    tournamentId: string,
    roundNumber: number,
    boards: BoardRange
  ): Promise<{ round: Round; added: number }> {
    const tournament = await this.repos.tournaments.findById(tournamentId);
    if (!tournament) throw new Error("大会が見つかりません");
    const existingRound = await this.repos.rounds.findByNumber(
      tournamentId,
      roundNumber
    );
    const plan = planRoundWithBoards({
      tournament,
      roundNumber,
      boards,
      existingRound,
      now: this.providers.now(),
    });
    if (!existingRound) await this.repos.rounds.save(plan.round);
    const added = await this.repos.games.addMissing(plan.games);
    return { round: plan.round, added };
  }

  /** 報告時に未作成のボードを指定した場合に、その対局を作成して返す */
  async ensureGame(
    tournamentId: string,
    roundNumber: number,
    boardNumber: number
  ): Promise<Game> {
    await this.createRoundWithBoards(tournamentId, roundNumber, {
      from: boardNumber,
      to: boardNumber,
    });
    const games = await this.repos.games.findByRound(tournamentId, roundNumber);
    const game = games.find((g) => g.boardNumber === boardNumber);
    if (!game) throw new Error("対局を作成できませんでした");
    return game;
  }

  async changeRoundStatus(roundId: string, to: RoundStatus): Promise<Round> {
    const round = await this.repos.rounds.findById(roundId);
    if (!round) throw new Error("ラウンドが見つかりません");
    const updated = transitionRound(round, to, this.providers.now());
    await this.repos.rounds.save(updated);
    return updated;
  }

  listPlayers(tournamentId: string): Promise<PlayerProfile[]> {
    return this.repos.players.findByTournament(tournamentId);
  }

  async addPlayer(
    tournamentId: string,
    fields: { name: string; rating?: number; fideId?: string; title?: string }
  ): Promise<PlayerProfile> {
    const name = fields.name.trim();
    if (!name) throw new Error("プレーヤー名を入力してください");
    if (!(await this.repos.tournaments.findById(tournamentId)))
      throw new Error("大会が見つかりません");
    const now = this.providers.now();
    const player: PlayerProfile = {
      id: this.providers.generateId(),
      tournamentId,
      name,
      rating: fields.rating,
      fideId: fields.fideId?.trim() || undefined,
      title: fields.title?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.players.save(player);
    return player;
  }

  removePlayer(id: string): Promise<void> {
    return this.repos.players.delete(id);
  }

  /**
   * 対局の白・黒を設定する。登録済みプレーヤーと同名なら id を紐づけ、未登録の名前は
   * プレーヤーとして登録する。空欄はクリア。
   */
  async assignPlayers(
    gameId: string,
    names: { white: string; black: string }
  ): Promise<Game> {
    const game = await this.repos.games.findById(gameId);
    if (!game) throw new Error("対局が見つかりません");
    const registered = await this.repos.players.findByTournament(
      game.tournamentId
    );
    const resolve = async (raw: string) => {
      const name = raw.trim();
      if (!name) return { name: "" };
      const found =
        registered.find((p) => p.name === name) ??
        (await this.addPlayer(game.tournamentId, { name }));
      if (!registered.includes(found)) registered.push(found);
      return {
        id: found.id,
        name: found.name,
        rating: found.rating,
        fideId: found.fideId,
      };
    };
    const updated: Game = {
      ...game,
      white: await resolve(names.white),
      black: await resolve(names.black),
      updatedAt: this.providers.now(),
    };
    await this.repos.games.save(updated);
    return updated;
  }
}
