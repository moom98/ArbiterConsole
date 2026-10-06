import type {
  Decision,
  Game,
  Incident,
  Tournament,
} from "@/lib/domain/entities";
import type { IncidentLogEntry } from "@/lib/domain/services/penalty-history";
import type { IncidentRecord } from "@/lib/domain/services/incident-counter";
import {
  buildAdHocGame,
  buildAdHocTournament,
  type ReportContext,
} from "@/lib/domain/services/game-context";
import type { ArbiterDatabase } from "./schema";

const LAST_CONTEXT_KEY = "lastReportContext";

/** 報告コンテキストに対応する暫定の大会・対局を取得（なければ作成）する */
export async function ensureGameForContext(
  db: ArbiterDatabase,
  ctx: ReportContext,
  now: Date
): Promise<{ game: Game; tournament: Tournament }> {
  const tournamentDraft = buildAdHocTournament(ctx, now);
  const gameDraft = buildAdHocGame(ctx, now);
  return db.transaction("rw", db.tournaments, db.games, async () => {
    let tournament = await db.tournaments.get(tournamentDraft.id);
    if (!tournament) {
      await db.tournaments.add(tournamentDraft);
      tournament = tournamentDraft;
    }
    let game = await db.games.get(gameDraft.id);
    if (!game) {
      await db.games.add(gameDraft);
      game = gameDraft;
    }
    return { game, tournament };
  });
}

/** 対局の Incident とその Decision を取得する */
export async function loadGameRecords(
  db: ArbiterDatabase,
  gameId: string
): Promise<IncidentRecord[]> {
  const incidents = await db.incidents.where("gameId").equals(gameId).toArray();
  return attachDecisions(db, incidents);
}

/** Decision を一括取得して Incident に紐づける（N+1 を避ける） */
async function attachDecisions(
  db: ArbiterDatabase,
  incidents: Incident[]
): Promise<IncidentRecord[]> {
  const decisionIds = incidents
    .map((i) => i.decisionId)
    .filter((id): id is string => typeof id === "string");
  const decisions = await db.decisions.bulkGet(decisionIds);
  const byId = new Map<string, Decision>();
  for (const d of decisions) if (d) byId.set(d.id, d);
  return incidents.map((incident) => ({
    incident,
    decision: incident.decisionId ? byId.get(incident.decisionId) : undefined,
  }));
}

/**
 * Incident Log 用: すべての Incident と、その Decision・対局・大会を一括取得する。
 * 並び順は呼び出し側で決める。
 */
export async function loadIncidentLog(
  db: ArbiterDatabase
): Promise<IncidentLogEntry[]> {
  const incidents = await db.incidents.toArray();
  const records = await attachDecisions(db, incidents);

  const gameIds = Array.from(new Set(incidents.map((i) => i.gameId)));
  const games = await db.games.bulkGet(gameIds);
  const gameById = new Map<string, Game>();
  for (const g of games) if (g) gameById.set(g.id, g);

  const tournamentIds = Array.from(
    new Set(Array.from(gameById.values(), (g) => g.tournamentId))
  );
  const tournaments = await db.tournaments.bulkGet(tournamentIds);
  const tournamentById = new Map<string, Tournament>();
  for (const t of tournaments) if (t) tournamentById.set(t.id, t);

  return records.map((record) => {
    const game = gameById.get(record.incident.gameId);
    return {
      ...record,
      game,
      tournament: game ? tournamentById.get(game.tournamentId) : undefined,
    };
  });
}

export async function loadLastReportContext(
  db: ArbiterDatabase
): Promise<ReportContext | null> {
  const entry = await db.appState.get(LAST_CONTEXT_KEY);
  return (entry?.value as ReportContext | undefined) ?? null;
}

export async function saveLastReportContext(
  db: ArbiterDatabase,
  ctx: ReportContext,
  now: Date
): Promise<void> {
  await db.appState.put({ key: LAST_CONTEXT_KEY, value: ctx, updatedAt: now });
}
