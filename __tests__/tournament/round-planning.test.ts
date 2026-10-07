// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  currentRound,
  MAX_BOARDS_PER_ROUND,
  parseBoardRange,
  planRoundWithBoards,
  transitionRound,
  validateBoardRange,
} from "@/lib/domain/services/round-planning";
import type { Round } from "@/lib/domain/entities";
import { ArbiterDatabase } from "@/lib/infrastructure/db/schema";
import { createTournamentRepositories } from "@/lib/infrastructure/db/tournament-repository";
import { TournamentService } from "@/lib/application/tournament-management";
import { fixedProviders, FIXED_NOW } from "../helpers";
import { profileInput } from "./fixtures";

function r(n: number, status: Round["status"]): Round {
  return {
    id: `T:r${n}`,
    tournamentId: "T",
    roundNumber: n,
    status,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

describe("round planning (pure)", () => {
  it("parses board ranges", () => {
    expect(parseBoardRange("1-40")).toEqual({ from: 1, to: 40 });
    expect(parseBoardRange(" 5 – 8 ")).toEqual({ from: 5, to: 8 });
    expect(parseBoardRange("12")).toEqual({ from: 12, to: 12 });
    expect(parseBoardRange("0-3")).toBeNull();
    expect(parseBoardRange("8-3")).toBeNull();
    expect(parseBoardRange("abc")).toBeNull();
    expect(parseBoardRange(`1-${MAX_BOARDS_PER_ROUND + 1}`)).toBeNull();
    expect(validateBoardRange({ from: 3, to: 1 })).toEqual([
      "終了ボードは開始ボード以上にしてください",
    ]);
  });

  it("plans 'Round 3, boards 1–40' with deterministic ids", () => {
    const plan = planRoundWithBoards({
      tournament: { id: "T" },
      roundNumber: 3,
      boards: { from: 1, to: 40 },
      now: FIXED_NOW,
    });
    expect(plan.round).toMatchObject({
      id: "T:r3",
      roundNumber: 3,
      status: "pending",
    });
    expect(plan.games).toHaveLength(40);
    expect(plan.games[0]).toMatchObject({
      id: "T:r3:b1",
      tournamentId: "T",
      roundId: "T:r3",
      round: 3,
      boardNumber: 1,
    });
    expect(plan.games[39].id).toBe("T:r3:b40");
  });

  it("reuses an existing round without changing its status", () => {
    const plan = planRoundWithBoards({
      tournament: { id: "T" },
      roundNumber: 3,
      boards: { from: 41, to: 42 },
      existingRound: r(3, "active"),
      now: FIXED_NOW,
    });
    expect(plan.round.status).toBe("active");
  });

  it("allows only pending → active → completed", () => {
    const active = transitionRound(r(1, "pending"), "active", FIXED_NOW);
    expect(active).toMatchObject({
      status: "active",
      actualStartTime: FIXED_NOW,
    });
    const done = transitionRound(active, "completed", FIXED_NOW);
    expect(done).toMatchObject({ status: "completed", endTime: FIXED_NOW });
    expect(() =>
      transitionRound(r(1, "pending"), "completed", FIXED_NOW)
    ).toThrow();
    expect(() => transitionRound(done, "active", FIXED_NOW)).toThrow();
  });

  it("picks the current round: latest active, else first pending, else last", () => {
    expect(currentRound([])).toBeNull();
    expect(
      currentRound([r(1, "completed"), r(2, "active"), r(3, "pending")])
        ?.roundNumber
    ).toBe(2);
    expect(
      currentRound([r(2, "pending"), r(1, "completed"), r(3, "pending")])
        ?.roundNumber
    ).toBe(2);
    expect(
      currentRound([r(1, "completed"), r(2, "completed")])?.roundNumber
    ).toBe(2);
  });
});

let counter = 0;

describe("TournamentService (IndexedDB)", () => {
  let db: ArbiterDatabase;
  let service: TournamentService;

  beforeEach(() => {
    db = new ArbiterDatabase(`tournament-service-${++counter}`);
    service = new TournamentService(
      createTournamentRepositories(db, () => FIXED_NOW),
      fixedProviders("s")
    );
  });

  afterEach(async () => {
    await db.delete();
  });

  it("creating the first tournament selects it; a second does not change the selection", async () => {
    const first = await service.saveTournamentProfile(profileInput());
    expect((await service.getActiveTournament())?.id).toBe(first.id);
    const second = await service.saveTournamentProfile(
      profileInput({ name: "2" })
    );
    expect((await service.getActiveTournament())?.id).toBe(first.id);
    await service.setActiveTournament(second.id);
    expect((await service.getActiveTournament())?.id).toBe(second.id);
    await expect(service.setActiveTournament("missing")).rejects.toThrow();
  });

  it("bulk-creates boards idempotently and keeps existing games", async () => {
    const t = await service.saveTournamentProfile(profileInput());
    const first = await service.createRoundWithBoards(t.id, 3, {
      from: 1,
      to: 40,
    });
    expect(first.added).toBe(40);
    await service.assignPlayers(`${t.id}:r3:b1`, {
      white: "山田",
      black: "佐藤",
    });

    const again = await service.createRoundWithBoards(t.id, 3, {
      from: 1,
      to: 45,
    });
    expect(again.added).toBe(5);
    const games = await service.listGames(t.id, 3);
    expect(games).toHaveLength(45);
    expect(games[0].white.name).toBe("山田");
    expect(await service.listRounds(t.id)).toHaveLength(1);
  });

  it("assignPlayers links registered players and registers new names", async () => {
    const t = await service.saveTournamentProfile(profileInput());
    const yamada = await service.addPlayer(t.id, {
      name: "山田",
      rating: 2100,
    });
    await service.createRoundWithBoards(t.id, 1, { from: 1, to: 1 });
    const g = await service.assignPlayers(`${t.id}:r1:b1`, {
      white: " 山田 ",
      black: "佐藤",
    });
    expect(g.white).toMatchObject({
      id: yamada.id,
      name: "山田",
      rating: 2100,
    });
    expect(g.black.id).toBeDefined();
    expect((await service.listPlayers(t.id)).map((p) => p.name).sort()).toEqual(
      ["佐藤", "山田"].sort()
    );
  });

  it("ensureGame creates a single missing board in a round", async () => {
    const t = await service.saveTournamentProfile(profileInput());
    const g = await service.ensureGame(t.id, 2, 17);
    expect(g.id).toBe(`${t.id}:r2:b17`);
    expect((await service.ensureGame(t.id, 2, 17)).id).toBe(g.id);
  });

  it("changes round status through the allowed transitions", async () => {
    const t = await service.saveTournamentProfile(profileInput());
    const { round } = await service.createRoundWithBoards(t.id, 1, {
      from: 1,
      to: 2,
    });
    expect((await service.changeRoundStatus(round.id, "active")).status).toBe(
      "active"
    );
    await expect(
      service.changeRoundStatus(round.id, "pending")
    ).rejects.toThrow();
  });

  it("refuses to delete a tournament with recorded incidents", async () => {
    const t = await service.saveTournamentProfile(profileInput());
    const g = await service.ensureGame(t.id, 1, 1);
    await db.incidents.add({
      id: "i1",
      gameId: g.id,
      category: "other" as never,
      description: "",
      arbiterObserved: true,
      reportedBy: "arbiter",
      reportedAt: FIXED_NOW,
      status: "resolved",
      escalatedToCA: false,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    await expect(service.deleteTournament(t.id)).rejects.toThrow(
      /1件のIncident/
    );
    await db.incidents.clear();
    await service.deleteTournament(t.id);
    expect(await service.listTournaments()).toEqual([]);
  });
});
