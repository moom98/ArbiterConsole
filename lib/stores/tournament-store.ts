import { create } from "zustand";
import type { Round, Tournament } from "@/lib/domain/entities";
import { defaultProviders, type DomainProviders } from "@/lib/domain/providers";
import { TournamentService } from "@/lib/application/tournament-management";
import { db as defaultDb, type ArbiterDatabase } from "@/lib/infrastructure/db";
import { createTournamentRepositories } from "@/lib/infrastructure/db/tournament-repository";
import { RoundChecklistService } from "@/lib/application/round-checklist";
import { DexieChecklistRepository } from "@/lib/infrastructure/db/checklist-repository";

/**
 * 選択中の大会（ホーム・報告・検索・設定で共有）。永続化は TournamentService 経由。
 */
export interface TournamentStore {
  loaded: boolean;
  tournaments: Tournament[];
  active: Tournament | null;
  /** 選択中の大会のラウンド（番号順） */
  rounds: Round[];
  error: string | null;
  service: TournamentService;
  /** Round Checklist（Milestone 7） */
  checklist: RoundChecklistService;
  /** 大会一覧・選択中の大会・ラウンドを読み込み直す */
  load: () => Promise<void>;
  setActive: (id: string | null) => Promise<void>;
}

export interface TournamentStoreDeps {
  db: ArbiterDatabase;
  providers: DomainProviders;
}

export function createTournamentStore(deps: TournamentStoreDeps) {
  const repos = createTournamentRepositories(deps.db, deps.providers.now);
  const service = new TournamentService(repos, deps.providers);
  const checklist = new RoundChecklistService(
    {
      checklists: new DexieChecklistRepository(deps.db),
      tournaments: repos.tournaments,
      rounds: repos.rounds,
    },
    service,
    deps.providers
  );

  return create<TournamentStore>((set, get) => ({
    loaded: false,
    tournaments: [],
    active: null,
    rounds: [],
    error: null,
    service,
    checklist,

    load: async () => {
      try {
        const [tournaments, active] = await Promise.all([
          service.listTournaments(),
          service.getActiveTournament(),
        ]);
        const rounds = active ? await service.listRounds(active.id) : [];
        set({ tournaments, active, rounds, loaded: true, error: null });
      } catch (error) {
        console.error("Failed to load tournaments:", error);
        set({
          loaded: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    setActive: async (id) => {
      try {
        await service.setActiveTournament(id);
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
      await get().load();
    },
  }));
}

export const useTournamentStore = createTournamentStore({
  db: defaultDb,
  providers: defaultProviders,
});
