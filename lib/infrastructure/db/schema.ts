import Dexie, { type EntityTable } from "dexie";
import type {
  Tournament,
  Game,
  Incident,
  Decision,
  Rule,
  Embedding,
} from "@/lib/domain/entities";

/** 端末ローカルのアプリ状態（例: 最後に使用した報告コンテキスト） */
export interface AppStateEntry {
  key: string;
  value: unknown;
  updatedAt: Date;
}

export class ArbiterDatabase extends Dexie {
  tournaments!: EntityTable<Tournament, "id">;
  games!: EntityTable<Game, "id">;
  incidents!: EntityTable<Incident, "id">;
  decisions!: EntityTable<Decision, "id">;
  rules!: EntityTable<Rule, "id">;
  embeddings!: EntityTable<Embedding, "id">;
  appState!: EntityTable<AppStateEntry, "key">;

  constructor(name = "ArbiterConsole") {
    super(name);

    this.version(1).stores({
      tournaments: "id, name, competitionType, startDate",
      games: "id, tournamentId, round, boardNumber, startTime",
      incidents: "id, gameId, category, status, reportedAt",
      decisions: "id, incidentId, generatedBy, confidence, createdAt",
      rules: "id, source, tournamentId, article, priority",
      embeddings: "id, ruleId, model",
    });

    // v2: 違反プレーヤー単位の履歴参照と、最後に使用した報告コンテキストの保存
    this.version(2).stores({
      incidents:
        "id, gameId, category, status, reportedAt, [gameId+playerColor]",
      appState: "key",
    });
  }
}

export const db = new ArbiterDatabase();
