import type {
  RoundChecklist,
  TournamentChecklistTemplate,
} from "@/lib/domain/entities";
import type { ChecklistRepository } from "@/lib/domain/repositories";
import type { ArbiterDatabase } from "./schema";

/** Round Checklist リポジトリの Dexie（IndexedDB）実装（Milestone 7, schema v7） */
export class DexieChecklistRepository implements ChecklistRepository {
  constructor(private readonly db: ArbiterDatabase) {}

  async findTemplate(
    tournamentId: string
  ): Promise<TournamentChecklistTemplate | null> {
    return (await this.db.checklistTemplates.get(tournamentId)) ?? null;
  }

  async saveTemplate(template: TournamentChecklistTemplate): Promise<void> {
    await this.db.checklistTemplates.put(template);
  }

  async deleteTemplate(tournamentId: string): Promise<void> {
    await this.db.checklistTemplates.delete(tournamentId);
  }

  async findRoundChecklist(roundId: string): Promise<RoundChecklist | null> {
    return (await this.db.roundChecklists.get(roundId)) ?? null;
  }

  async saveRoundChecklist(checklist: RoundChecklist): Promise<void> {
    await this.db.roundChecklists.put(checklist);
  }

  async countPendingIncidents(
    tournamentId: string,
    roundNumber: number
  ): Promise<number> {
    const gameIds = (await this.db.games
      .where("[tournamentId+round]")
      .equals([tournamentId, roundNumber])
      .primaryKeys()) as string[];
    if (gameIds.length === 0) return 0;
    return this.db.incidents
      .where("gameId")
      .anyOf(gameIds)
      .filter((i) => i.status === "pending")
      .count();
  }
}
