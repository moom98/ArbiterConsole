// @vitest-environment node
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ArbiterDatabase } from "@/lib/infrastructure/db/schema";
import { createTournamentRepositories } from "@/lib/infrastructure/db/tournament-repository";
import {
  TournamentHasIncidentsError,
  type TournamentRepositories,
} from "@/lib/domain/repositories";
import type {
  Game,
  Incident,
  PlayerProfile,
  Round,
} from "@/lib/domain/entities";
import { FIXED_NOW } from "../helpers";
import { tournament } from "./fixtures";

let counter = 0;

function round(over: Partial<Round> = {}): Round {
  return {
    id: "T1:r1",
    tournamentId: "T1",
    roundNumber: 1,
    status: "pending",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...over,
  };
}

function game(over: Partial<Game> = {}): Game {
  return {
    id: "T1:r1:b1",
    tournamentId: "T1",
    roundId: "T1:r1",
    round: 1,
    boardNumber: 1,
    white: { name: "" },
    black: { name: "" },
    startTime: FIXED_NOW,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...over,
  };
}

function player(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    id: "p1",
    tournamentId: "T1",
    name: "山田",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...over,
  };
}

function incident(gameId: string): Incident {
  return {
    id: `inc-${gameId}`,
    gameId,
    category: "illegal-move",
    description: "",
    arbiterObserved: true,
    reportedBy: "arbiter",
    reportedAt: FIXED_NOW,
    status: "resolved",
    escalatedToCA: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

describe("Tournament repositories (Dexie)", () => {
  let db: ArbiterDatabase;
  let repos: TournamentRepositories;

  beforeEach(() => {
    db = new ArbiterDatabase(`tournament-repo-${++counter}`);
    repos = createTournamentRepositories(db, () => FIXED_NOW);
  });

  afterEach(async () => {
    await db.delete();
  });

  it("TournamentRepository CRUD; findAll excludes ad-hoc tournaments and sorts newest first", async () => {
    await repos.tournaments.save(
      tournament({ id: "old", startDate: new Date(2025, 0, 1) })
    );
    await repos.tournaments.save(
      tournament({ id: "new", startDate: new Date(2026, 0, 1) })
    );
    await repos.tournaments.save(
      tournament({ id: "adhoc:2026-01-01:standard:-:FIDE-2023" })
    );
    expect((await repos.tournaments.findAll()).map((t) => t.id)).toEqual([
      "new",
      "old",
    ]);
    expect((await repos.tournaments.findById("old"))?.name).toBe("テスト大会");

    await repos.tournaments.save(tournament({ id: "old", name: "改名" }));
    expect((await repos.tournaments.findById("old"))?.name).toBe("改名");

    await repos.tournaments.delete("old");
    expect(await repos.tournaments.findById("old")).toBeNull();
  });

  it("deleting a tournament removes rounds, games, players, its rule sources/rules/embeddings and the active selection atomically", async () => {
    await repos.tournaments.save(tournament());
    await repos.rounds.save(round());
    await repos.players.save(player());
    await repos.games.save(game());
    await repos.active.setActiveTournamentId("T1");
    await db.ruleSources.add({
      id: "src-t1",
      name: "要項",
      fileName: "r.pdf",
      sourceType: "tournament",
      version: "1",
      status: "active",
      language: "ja",
      tournamentId: "T1",
      totalPages: 1,
      importedAt: FIXED_NOW,
    });
    const rule = (id: string, tournamentId: string) => ({
      id,
      source: "tournament" as const,
      sourceId: tournamentId === "T1" ? "src-t1" : "src-t2",
      tournamentId,
      article: "1",
      title: "",
      content: "",
      priority: 1000,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    await db.rules.bulkAdd([rule("r1", "T1"), rule("r2", "T2")]);
    await db.embeddings.bulkAdd([
      { id: "e1", ruleId: "r1", vector: [1], model: "m", createdAt: FIXED_NOW },
      { id: "e2", ruleId: "r2", vector: [1], model: "m", createdAt: FIXED_NOW },
    ]);

    await repos.tournaments.delete("T1");
    expect(await repos.tournaments.findById("T1")).toBeNull();
    expect(await repos.rounds.findByTournament("T1")).toEqual([]);
    expect(await repos.players.findByTournament("T1")).toEqual([]);
    expect(await repos.active.getActiveTournamentId()).toBeNull();
    expect(await repos.games.findById("T1:r1:b1")).toBeNull();
    expect(await db.ruleSources.get("src-t1")).toBeUndefined();
    expect((await db.rules.toArray()).map((r) => r.id)).toEqual(["r2"]);
    expect((await db.embeddings.toArray()).map((e) => e.id)).toEqual(["e2"]);
  });

  it("refuses deletion (and deletes nothing) when incidents exist", async () => {
    await repos.tournaments.save(tournament());
    await repos.rounds.save(round());
    await repos.games.save(game());
    await db.incidents.add(incident("T1:r1:b1"));
    await expect(repos.tournaments.delete("T1")).rejects.toBeInstanceOf(
      TournamentHasIncidentsError
    );
    expect(await repos.tournaments.findById("T1")).not.toBeNull();
    expect(await repos.rounds.findByTournament("T1")).toHaveLength(1);
    expect(await repos.games.findById("T1:r1:b1")).not.toBeNull();
  });

  it("RoundRepository finds by tournament (ordered) and by number", async () => {
    await repos.rounds.save(round({ id: "T1:r2", roundNumber: 2 }));
    await repos.rounds.save(round());
    await repos.rounds.save(round({ id: "T2:r1", tournamentId: "T2" }));
    expect(
      (await repos.rounds.findByTournament("T1")).map((r) => r.id)
    ).toEqual(["T1:r1", "T1:r2"]);
    expect((await repos.rounds.findByNumber("T1", 2))?.id).toBe("T1:r2");
    expect(await repos.rounds.findByNumber("T1", 3)).toBeNull();
    await repos.rounds.save(round({ status: "active" }));
    expect((await repos.rounds.findById("T1:r1"))?.status).toBe("active");
  });

  it("GameRepository.addMissing never overwrites existing games", async () => {
    await repos.games.save(game({ white: { name: "既存" } }));
    const added = await repos.games.addMissing([
      game(),
      game({ id: "T1:r1:b2", boardNumber: 2 }),
    ]);
    expect(added).toBe(1);
    expect((await repos.games.findById("T1:r1:b1"))?.white.name).toBe("既存");
    expect(
      (await repos.games.findByRound("T1", 1)).map((g) => g.boardNumber)
    ).toEqual([1, 2]);
    expect(await repos.games.findByRound("T1", 2)).toEqual([]);
  });

  it("PlayerRepository CRUD", async () => {
    await repos.players.save(player({ id: "p2", name: "佐藤" }));
    await repos.players.save(player());
    await repos.players.save(player({ id: "p3", tournamentId: "T2" }));
    const names = (await repos.players.findByTournament("T1")).map(
      (p) => p.name
    );
    expect(names).toHaveLength(2);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "ja")));
    await repos.players.delete("p1");
    expect(await repos.players.findById("p1")).toBeNull();
  });

  it("ActiveTournamentStore persists the selection in appState", async () => {
    expect(await repos.active.getActiveTournamentId()).toBeNull();
    await repos.active.setActiveTournamentId("T1");
    expect(await repos.active.getActiveTournamentId()).toBe("T1");
    const reopened = createTournamentRepositories(db);
    expect(await reopened.active.getActiveTournamentId()).toBe("T1");
    await repos.active.setActiveTournamentId(null);
    expect(await repos.active.getActiveTournamentId()).toBeNull();
  });

  it("countIncidents counts incidents on the tournament's games only", async () => {
    await repos.games.save(game());
    await repos.games.save(game({ id: "T2:r1:b1", tournamentId: "T2" }));
    await db.incidents.add(incident("T1:r1:b1"));
    await db.incidents.add(incident("T2:r1:b1"));
    expect(await repos.countIncidents("T1")).toBe(1);
    expect(await repos.countIncidents("T3")).toBe(0);
  });
});

describe("Schema v5 migration", () => {
  it("preserves v3 data (ad-hoc tournaments, games, incidents, app state)", async () => {
    const name = `migration-${++counter}`;
    // v3 時点のスキーマ（現行 schema.ts の version 1〜3 と同じ定義）
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      tournaments: "id, name, competitionType, startDate",
      games: "id, tournamentId, round, boardNumber, startTime",
      incidents: "id, gameId, category, status, reportedAt",
      decisions: "id, incidentId, generatedBy, confidence, createdAt",
      rules: "id, source, tournamentId, article, priority",
      embeddings: "id, ruleId, model",
    });
    legacy.version(2).stores({
      incidents:
        "id, gameId, category, status, reportedAt, [gameId+playerColor]",
      appState: "key",
    });
    legacy.version(3).stores({
      rules: "id, source, sourceId, tournamentId, article, priority",
      ruleSources: "id, sourceType, tournamentId, status",
    });
    await legacy.open();
    const adHocId = "adhoc:2026-01-01:standard:-:FIDE-2023";
    const gameId = `${adHocId}:r3:b12`;
    await legacy.table("tournaments").add(tournament({ id: adHocId }));
    await legacy.table("games").add(
      game({
        id: gameId,
        tournamentId: adHocId,
        round: 3,
        boardNumber: 12,
        roundId: undefined,
      })
    );
    await legacy.table("incidents").add(incident(gameId));
    await legacy.table("appState").add({
      key: "lastReportContext",
      value: {
        competitionType: "standard",
        rulesVersion: "FIDE-2023",
        round: 3,
        boardNumber: 12,
      },
      updatedAt: FIXED_NOW,
    });
    legacy.close();

    const db = new ArbiterDatabase(name);
    await db.open();
    expect(db.verno).toBe(7);
    expect(await db.tournaments.get(adHocId)).toBeDefined();
    expect((await db.games.get(gameId))?.boardNumber).toBe(12);
    expect(await db.incidents.where("gameId").equals(gameId).count()).toBe(1);
    expect((await db.appState.get("lastReportContext"))?.value).toMatchObject({
      round: 3,
    });
    // 新しいインデックスが既存データに対して機能する
    const repos = createTournamentRepositories(db);
    expect(
      (await repos.games.findByRound(adHocId, 3)).map((g) => g.id)
    ).toEqual([gameId]);
    // 暫定大会は大会一覧に出ない
    expect(await repos.tournaments.findAll()).toEqual([]);
    expect(await db.rounds.count()).toBe(0);
    await db.delete();
  });
});
