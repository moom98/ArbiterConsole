import Dexie, { type EntityTable } from "dexie";
import { normalizeTimeControl } from "@/lib/domain/services/time-control";
import type {
  Tournament,
  Game,
  PlayerProfile,
  Round,
  Incident,
  Decision,
  Rule,
  RuleSource,
  Embedding,
  RoundChecklist,
  TournamentChecklistTemplate,
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
  ruleSources!: EntityTable<RuleSource, "id">;
  embeddings!: EntityTable<Embedding, "id">;
  appState!: EntityTable<AppStateEntry, "key">;
  rounds!: EntityTable<Round, "id">;
  players!: EntityTable<PlayerProfile, "id">;
  roundChecklists!: EntityTable<RoundChecklist, "id">;
  checklistTemplates!: EntityTable<TournamentChecklistTemplate, "tournamentId">;

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

    // v3: ルール資料（RuleSource）と Rule.sourceId を追加（§29, §30）
    this.version(3).stores({
      rules: "id, source, sourceId, tournamentId, article, priority",
      ruleSources: "id, sourceType, tournamentId, status",
    });

    // v5: 大会管理（Milestone 6）。ラウンド・登録プレーヤーを追加し、対局をラウンド単位で引けるようにする。
    // 既存データ（暫定大会・対局・Incident）は変換不要（追加フィールドはすべて任意）。
    // v4 は欠番、v6 は LLM 連携（Milestone 5）用に予約。
    this.version(5).stores({
      games:
        "id, tournamentId, round, boardNumber, startTime, roundId, [tournamentId+round]",
      rounds: "id, tournamentId, [tournamentId+roundNumber], status",
      players: "id, tournamentId, name",
    });

    // v7: Round Checklist（Milestone 7）。ラウンドごとの完了状態（id = roundId）と、
    // 大会ごとのチェックリスト構成を追加する。既存テーブルは変更しない（変換不要）。
    // v6 は欠番（Milestone 5 はスキーマを変更しない）。今後のスキーマ変更は v8 以降を使う。
    this.version(7).stores({
      roundChecklists: "id, tournamentId",
      checklistTemplates: "tournamentId",
    });

    // v8: 持ち時間のピリオド（ADR-014 §7, J1b-7）。timeControl はインデックスではないため
    // stores は変えず、旧形式 { initialMinutes, incrementSeconds } を1つのピリオドへ変換する。
    // 旧形式の additionalTimeAfterMove は意味が不明なため保持し、periodsIncomplete とする。
    // 解釈できない値は変更しない（破壊しない。読み込み時も normalizeTimeControl を通す）。
    this.version(8)
      .stores({})
      .upgrade((tx) =>
        tx
          .table("tournaments")
          .toCollection()
          .modify((t: { timeControl?: unknown }) => {
            if (t.timeControl === undefined) return;
            const tc = normalizeTimeControl(t.timeControl);
            if (tc) t.timeControl = tc;
          })
      );
  }
}

export const db = new ArbiterDatabase();
