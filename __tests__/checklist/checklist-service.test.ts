// @vitest-environment node
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ArbiterDatabase } from "@/lib/infrastructure/db/schema";
import { createTournamentRepositories } from "@/lib/infrastructure/db/tournament-repository";
import { DexieChecklistRepository } from "@/lib/infrastructure/db/checklist-repository";
import { TournamentService } from "@/lib/application/tournament-management";
import { RoundChecklistService } from "@/lib/application/round-checklist";
import type { Incident, IncidentStatus } from "@/lib/domain/entities";
import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/domain/services/round-checklist";
import { FIXED_NOW, fixedProviders } from "../helpers";
import { profileInput } from "../tournament/fixtures";

let counter = 0;

function incident(
  id: string,
  gameId: string,
  status: IncidentStatus
): Incident {
  return {
    id,
    gameId,
    category: "illegal-move",
    description: "",
    arbiterObserved: true,
    reportedBy: "arbiter",
    reportedAt: FIXED_NOW,
    status,
    escalatedToCA: status === "escalated",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

const PRE_IDS = DEFAULT_CHECKLIST_ITEMS.filter((i) => i.phase === "pre").map(
  (i) => i.id
);

describe("RoundChecklistService (Dexie)", () => {
  let db: ArbiterDatabase;
  let tournaments: TournamentService;
  let service: RoundChecklistService;
  let checklists: DexieChecklistRepository;

  beforeEach(async () => {
    db = new ArbiterDatabase(`checklist-${++counter}`);
    const providers = fixedProviders();
    const repos = createTournamentRepositories(db, providers.now);
    tournaments = new TournamentService(repos, providers);
    checklists = new DexieChecklistRepository(db);
    service = new RoundChecklistService(
      { checklists, tournaments: repos.tournaments, rounds: repos.rounds },
      tournaments,
      providers
    );
  });
  afterEach(async () => {
    await db.delete();
  });

  async function setup() {
    const t = await tournaments.saveTournamentProfile(profileInput());
    const { round } = await tournaments.createRoundWithBoards(t.id, 1, {
      from: 1,
      to: 4,
    });
    return { t, round };
  }

  it("loads the default checklist for a pending round in the pre stage", async () => {
    const { t, round } = await setup();
    const data = await service.load(t.id, 1);
    expect(data).not.toBeNull();
    expect(data!.round.id).toBe(round.id);
    expect(data!.view.currentStage).toBe("pre");
    expect(data!.customized).toBe(false);
    expect(data!.checklist).toBeNull();
    expect(data!.view.stages.pre.progress).toEqual({
      done: 0,
      total: PRE_IDS.length,
    });
    expect(data!.items.find((i) => i.id === "pre-clock-setting")!.detail).toBe(
      "大会設定: 90分+30秒"
    );
    expect(await service.load(t.id, 9)).toBeNull();
    expect(await service.load("missing", 1)).toBeNull();
  });

  it("persists done state and notes per round; rapid toggles are not lost", async () => {
    const { t, round } = await setup();
    // 連続タップ（並行実行）でも更新が失われない
    await Promise.all(PRE_IDS.map((id) => service.setDone(round.id, id, true)));
    await service.setNote(round.id, PRE_IDS[0], "Board 3 の時計交換");
    await service.setDone(round.id, PRE_IDS[1], false);

    const stored = await checklists.findRoundChecklist(round.id);
    expect(stored?.tournamentId).toBe(t.id);
    const data = await service.load(t.id, 1);
    expect(data!.view.stages.pre.progress).toEqual({
      done: PRE_IDS.length - 1,
      total: PRE_IDS.length,
    });
    const first = data!.view.stages.pre.sections[0].items[0];
    expect(first).toMatchObject({
      id: PRE_IDS[0],
      done: true,
      doneAt: FIXED_NOW,
      note: "Board 3 の時計交換",
    });

    // 別のラウンドには影響しない
    await tournaments.createRoundWithBoards(t.id, 2, { from: 1, to: 2 });
    expect((await service.load(t.id, 2))!.view.stages.pre.progress.done).toBe(
      0
    );
  });

  it("rejects unknown items and rounds", async () => {
    const { round } = await setup();
    await expect(service.setDone(round.id, "nope", true)).rejects.toThrow(
      "チェック項目"
    );
    await expect(service.setDone("missing", PRE_IDS[0], true)).rejects.toThrow(
      "ラウンド"
    );
  });

  it("customises the template per tournament (add / remove / reorder / reset)", async () => {
    const { t } = await setup();
    const other = await tournaments.saveTournamentProfile(
      profileInput({ name: "別大会" })
    );
    await service.addItem(t.id, "pre", "消毒液の配置");
    await service.removeItem(t.id, "pre-fbo");
    await service.moveItem(t.id, PRE_IDS[1], -1);

    const { items, customized } = await service.listItems(t.id);
    expect(customized).toBe(true);
    const pre = items.filter((i) => i.phase === "pre");
    expect(pre[0].id).toBe(PRE_IDS[1]);
    expect(pre.some((i) => i.id === "pre-fbo")).toBe(false);
    expect(pre[pre.length - 1]).toMatchObject({
      label: "消毒液の配置",
      custom: true,
    });
    // 追加項目もチェックできる
    const { round } = (await service.load(t.id, 1))!;
    await service.setDone(round.id, pre[pre.length - 1].id, true);

    // 他の大会は既定のまま
    expect((await service.listItems(other.id)).customized).toBe(false);

    await service.resetTemplate(t.id);
    expect((await service.listItems(t.id)).customized).toBe(false);
    await expect(service.addItem("missing", "pre", "x")).rejects.toThrow(
      "大会"
    );
  });

  it("start: warns about incomplete pre-round items, changes only after confirmation", async () => {
    const { t, round } = await setup();
    await service.setDone(round.id, PRE_IDS[0], true);

    const first = await service.changeRoundStatus(round.id, "active");
    expect(first.status).toBe("confirmation-required");
    if (first.status !== "confirmation-required") return;
    expect(first.assessment.warnings[0]).toMatchObject({
      kind: "incomplete-pre-round",
    });
    expect((await service.load(t.id, 1))!.round.status).toBe("pending");

    const second = await service.changeRoundStatus(round.id, "active", {
      confirmed: true,
    });
    expect(second.status).toBe("changed");
    const data = await service.load(t.id, 1);
    expect(data!.round.status).toBe("active");
    expect(data!.round.actualStartTime).toEqual(FIXED_NOW);
    // チェックリストは「対局中」へ切り替わる
    expect(data!.view.currentStage).toBe("during");
  });

  it("start: no warning when every pre-round item is done", async () => {
    const { round } = await setup();
    for (const id of PRE_IDS) await service.setDone(round.id, id, true);
    const result = await service.changeRoundStatus(round.id, "active");
    expect(result.status).toBe("changed");
  });

  it("end: warns about pending incidents of this round only (escalated/resolved and other rounds ignored)", async () => {
    const { t, round } = await setup();
    const { round: r2 } = await tournaments.createRoundWithBoards(t.id, 2, {
      from: 1,
      to: 2,
    });
    await db.incidents.bulkAdd([
      incident("a", `${t.id}:r1:b1`, "pending"),
      incident("b", `${t.id}:r1:b2`, "pending"), // AI判断の確認待ちも pending
      incident("c", `${t.id}:r1:b3`, "escalated"),
      incident("d", `${t.id}:r1:b4`, "resolved"),
      incident("e", `${t.id}:r2:b1`, "pending"),
    ]);
    await service.changeRoundStatus(round.id, "active", { confirmed: true });
    expect((await service.load(t.id, 1))!.pendingIncidentCount).toBe(2);

    const result = await service.changeRoundStatus(round.id, "completed");
    expect(result).toEqual({
      status: "confirmation-required",
      assessment: {
        to: "completed",
        warnings: [{ kind: "pending-incidents", count: 2 }],
      },
    });
    expect((await service.load(t.id, 1))!.round.status).toBe("active");

    const done = await service.changeRoundStatus(round.id, "completed", {
      confirmed: true,
    });
    expect(done.status).toBe("changed");
    const data = await service.load(t.id, 1);
    expect(data!.round.status).toBe("completed");
    expect(data!.view.currentStage).toBe("post");

    // ラウンド2: 保留中の Incident を解決すると警告なしで終了できる
    await service.changeRoundStatus(r2.id, "active", { confirmed: true });
    await db.incidents.update("e", { status: "resolved" });
    expect((await service.changeRoundStatus(r2.id, "completed")).status).toBe(
      "changed"
    );
  });

  it("rejects invalid transitions without changing the round", async () => {
    const { t, round } = await setup();
    await expect(
      service.changeRoundStatus(round.id, "completed", { confirmed: true })
    ).rejects.toThrow();
    expect((await service.load(t.id, 1))!.round.status).toBe("pending");
  });

  it("deleting a tournament removes its checklists and template", async () => {
    const { t, round } = await setup();
    await service.setDone(round.id, PRE_IDS[0], true);
    await service.addItem(t.id, "post", "会場の施錠");
    await tournaments.deleteTournament(t.id);
    expect(await checklists.findRoundChecklist(round.id)).toBeNull();
    expect(await checklists.findTemplate(t.id)).toBeNull();
  });
});

describe("Schema v7 migration", () => {
  it("upgrades a v5 database without touching existing data and adds checklist tables", async () => {
    const name = `migration-v7-${++counter}`;
    // v5 時点のスキーマ（schema.ts の version 1〜5 と同じ定義）
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
    legacy.version(5).stores({
      games:
        "id, tournamentId, round, boardNumber, startTime, roundId, [tournamentId+round]",
      rounds: "id, tournamentId, [tournamentId+roundNumber], status",
      players: "id, tournamentId, name",
    });
    await legacy.open();
    await legacy.table("rounds").add({
      id: "T1:r1",
      tournamentId: "T1",
      roundNumber: 1,
      status: "active",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    await legacy.table("games").add({
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
    });
    await legacy.table("incidents").add(incident("i1", "T1:r1:b1", "pending"));
    legacy.close();

    const db = new ArbiterDatabase(name);
    await db.open();
    expect(db.verno).toBe(7);
    expect((await db.rounds.get("T1:r1"))?.status).toBe("active");
    expect(await db.incidents.count()).toBe(1);
    const repo = new DexieChecklistRepository(db);
    expect(await repo.findRoundChecklist("T1:r1")).toBeNull();
    expect(await repo.findTemplate("T1")).toBeNull();
    expect(await repo.countPendingIncidents("T1", 1)).toBe(1);
    await repo.saveRoundChecklist({
      id: "T1:r1",
      roundId: "T1:r1",
      tournamentId: "T1",
      items: [{ itemId: "pre-venue", done: true, doneAt: FIXED_NOW }],
      updatedAt: FIXED_NOW,
    });
    expect(
      (await db.roundChecklists.where("tournamentId").equals("T1").toArray())
        .length
    ).toBe(1);
    await db.delete();
  });
});
