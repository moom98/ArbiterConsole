import type { Game, Tournament } from "@/lib/domain/entities";
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
  return Promise.all(
    incidents.map(async (incident) => ({
      incident,
      decision: incident.decisionId
        ? await db.decisions.get(incident.decisionId)
        : undefined,
    }))
  );
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
