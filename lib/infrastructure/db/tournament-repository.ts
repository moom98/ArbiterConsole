import type {
  Game,
  PlayerProfile,
  Round,
  Tournament,
} from "@/lib/domain/entities";
import { isAdHocTournament } from "@/lib/domain/entities";
import type {
  ActiveTournamentStore,
  GameRepository,
  PlayerRepository,
  RoundRepository,
  TournamentRepositories,
  TournamentRepository,
} from "@/lib/domain/repositories";
import { TournamentHasIncidentsError } from "@/lib/domain/repositories";
import type { ArbiterDatabase } from "./schema";

/**
 * 大会管理リポジトリの Dexie（IndexedDB）実装。
 */

export const ACTIVE_TOURNAMENT_KEY = "activeTournamentId";

export class DexieTournamentRepository implements TournamentRepository {
  constructor(private readonly db: ArbiterDatabase) {}

  async findById(id: string): Promise<Tournament | null> {
    return (await this.db.tournaments.get(id)) ?? null;
  }

  async findAll(): Promise<Tournament[]> {
    const all = await this.db.tournaments.toArray();
    return all
      .filter((t) => !isAdHocTournament(t))
      .sort(
        (a, b) =>
          new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
      );
  }

  async save(tournament: Tournament): Promise<void> {
    await this.db.tournaments.put(tournament);
  }

  async delete(id: string): Promise<void> {
    const db = this.db;
    await db.transaction(
      "rw",
      [
        db.tournaments,
        db.rounds,
        db.players,
        db.games,
        db.incidents,
        db.ruleSources,
        db.rules,
        db.embeddings,
        db.appState,
      ],
      async () => {
        const gameIds = (await db.games
          .where("tournamentId")
          .equals(id)
          .primaryKeys()) as string[];
        const incidentCount =
          gameIds.length === 0
            ? 0
            : await db.incidents.where("gameId").anyOf(gameIds).count();
        if (incidentCount > 0)
          throw new TournamentHasIncidentsError(incidentCount);

        // 大会固有規定（資料・条文・Embedding）
        const ruleIds = (await db.rules
          .where("tournamentId")
          .equals(id)
          .primaryKeys()) as string[];
        if (ruleIds.length > 0) {
          await db.embeddings.where("ruleId").anyOf(ruleIds).delete();
          await db.rules.bulkDelete(ruleIds);
        }
        await db.ruleSources.where("tournamentId").equals(id).delete();

        await db.games.bulkDelete(gameIds);
        await db.rounds.where("tournamentId").equals(id).delete();
        await db.players.where("tournamentId").equals(id).delete();
        await db.tournaments.delete(id);
        const active = await db.appState.get(ACTIVE_TOURNAMENT_KEY);
        if (active?.value === id)
          await db.appState.delete(ACTIVE_TOURNAMENT_KEY);
      }
    );
  }
}

export class DexieRoundRepository implements RoundRepository {
  constructor(private readonly db: ArbiterDatabase) {}

  async findById(id: string): Promise<Round | null> {
    return (await this.db.rounds.get(id)) ?? null;
  }

  async findByTournament(tournamentId: string): Promise<Round[]> {
    const rounds = await this.db.rounds
      .where("tournamentId")
      .equals(tournamentId)
      .toArray();
    return rounds.sort((a, b) => a.roundNumber - b.roundNumber);
  }

  async findByNumber(
    tournamentId: string,
    roundNumber: number
  ): Promise<Round | null> {
    return (
      (await this.db.rounds
        .where("[tournamentId+roundNumber]")
        .equals([tournamentId, roundNumber])
        .first()) ?? null
    );
  }

  async save(round: Round): Promise<void> {
    await this.db.rounds.put(round);
  }
}

export class DexieGameRepository implements GameRepository {
  constructor(private readonly db: ArbiterDatabase) {}

  async findById(id: string): Promise<Game | null> {
    return (await this.db.games.get(id)) ?? null;
  }

  async findByRound(
    tournamentId: string,
    roundNumber: number
  ): Promise<Game[]> {
    const games = await this.db.games
      .where("[tournamentId+round]")
      .equals([tournamentId, roundNumber])
      .toArray();
    return games.sort((a, b) => (a.boardNumber ?? 0) - (b.boardNumber ?? 0));
  }

  async addMissing(games: Game[]): Promise<number> {
    if (games.length === 0) return 0;
    const db = this.db;
    return db.transaction("rw", db.games, async () => {
      const existing = await db.games.bulkGet(games.map((g) => g.id));
      const missing = games.filter((_, i) => !existing[i]);
      if (missing.length > 0) await db.games.bulkAdd(missing);
      return missing.length;
    });
  }

  async save(game: Game): Promise<void> {
    await this.db.games.put(game);
  }
}

export class DexiePlayerRepository implements PlayerRepository {
  constructor(private readonly db: ArbiterDatabase) {}

  async findById(id: string): Promise<PlayerProfile | null> {
    return (await this.db.players.get(id)) ?? null;
  }

  async findByTournament(tournamentId: string): Promise<PlayerProfile[]> {
    const players = await this.db.players
      .where("tournamentId")
      .equals(tournamentId)
      .toArray();
    return players.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }

  async save(player: PlayerProfile): Promise<void> {
    await this.db.players.put(player);
  }

  async delete(id: string): Promise<void> {
    await this.db.players.delete(id);
  }
}

export class DexieActiveTournamentStore implements ActiveTournamentStore {
  constructor(
    private readonly db: ArbiterDatabase,
    private readonly now: () => Date = () => new Date()
  ) {}

  async getActiveTournamentId(): Promise<string | null> {
    const entry = await this.db.appState.get(ACTIVE_TOURNAMENT_KEY);
    return typeof entry?.value === "string" ? entry.value : null;
  }

  async setActiveTournamentId(id: string | null): Promise<void> {
    if (id === null) {
      await this.db.appState.delete(ACTIVE_TOURNAMENT_KEY);
      return;
    }
    await this.db.appState.put({
      key: ACTIVE_TOURNAMENT_KEY,
      value: id,
      updatedAt: this.now(),
    });
  }
}

export function createTournamentRepositories(
  db: ArbiterDatabase,
  now?: () => Date
): TournamentRepositories {
  return {
    tournaments: new DexieTournamentRepository(db),
    rounds: new DexieRoundRepository(db),
    games: new DexieGameRepository(db),
    players: new DexiePlayerRepository(db),
    active: new DexieActiveTournamentStore(db, now),
    countIncidents: async (tournamentId) => {
      const gameIds = (await db.games
        .where("tournamentId")
        .equals(tournamentId)
        .primaryKeys()) as string[];
      if (gameIds.length === 0) return 0;
      return db.incidents.where("gameId").anyOf(gameIds).count();
    },
  };
}
