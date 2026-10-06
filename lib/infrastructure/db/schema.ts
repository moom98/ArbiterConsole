import Dexie, { type EntityTable } from "dexie";
import type {
  Tournament,
  Game,
  Incident,
  Decision,
  Rule,
  Embedding,
} from "@/lib/domain/entities";

export class ArbiterDatabase extends Dexie {
  tournaments!: EntityTable<Tournament, "id">;
  games!: EntityTable<Game, "id">;
  incidents!: EntityTable<Incident, "id">;
  decisions!: EntityTable<Decision, "id">;
  rules!: EntityTable<Rule, "id">;
  embeddings!: EntityTable<Embedding, "id">;

  constructor() {
    super("ArbiterConsole");

    this.version(1).stores({
      tournaments: "id, name, competitionType, startDate",
      games: "id, tournamentId, round, boardNumber, startTime",
      incidents: "id, gameId, category, status, reportedAt",
      decisions: "id, incidentId, generatedBy, confidence, createdAt",
      rules: "id, source, tournamentId, article, priority",
      embeddings: "id, ruleId, model",
    });
  }
}

export const db = new ArbiterDatabase();
