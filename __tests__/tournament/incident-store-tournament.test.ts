// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ArbiterDatabase } from "@/lib/infrastructure/db/schema";
import { createIncidentStore } from "@/lib/stores/incident-store";
import { createTournamentRepositories } from "@/lib/infrastructure/db/tournament-repository";
import { TournamentService } from "@/lib/application/tournament-management";
import { fixedProviders, FIXED_NOW } from "../helpers";
import { profileInput } from "./fixtures";

let n = 0;

describe("Incident store with tournament games (ADR-006)", () => {
  let db: ArbiterDatabase;
  let store: ReturnType<typeof createIncidentStore>;
  let service: TournamentService;

  beforeEach(() => {
    db = new ArbiterDatabase(`store-tournament-${++n}`);
    store = createIncidentStore({ db, providers: fixedProviders(`i${n}`) });
    service = new TournamentService(
      createTournamentRepositories(db, () => FIXED_NOW),
      fixedProviders(`t${n}`)
    );
  });

  afterEach(async () => {
    await db.delete();
  });

  async function blitzB2(withOverride: boolean) {
    const t = await service.saveTournamentProfile(
      profileInput({
        competitionType: "blitz",
        supervisionRegime: "competition-rules",
        timeControl: { initialMinutes: 3, incrementSeconds: 2 },
        blitzCompetitionTimePenalty: withOverride
          ? { seconds: 60, source: { document: "要項", article: "第7条" } }
          : undefined,
      })
    );
    const g = await service.ensureGame(t.id, 1, 5);
    return { t, g };
  }

  async function reportIllegalMove(gameId: string) {
    const submitted = await store.getState().submitIncident({
      gameId,
      category: "illegal-move",
      description: "",
      arbiterObserved: true,
    });
    if (!submitted.ok) throw new Error(submitted.error);
    const answered = await store.getState().answerFollowUp({
      playerColor: "white",
      subtype: "illegal-move",
      gameEnded: "false",
      clockPressed: "true",
    });
    if (!answered.ok) throw new Error(answered.error);
    return answered.result.decision;
  }

  it("derives the ruleset (incl. B.2 override) from the tournament", async () => {
    const { g } = await blitzB2(true);
    const d = await reportIllegalMove(g.id);
    expect(d.penalties[0].timeAdjustmentSeconds).toBe(60);
    expect(d.sources[0]).toMatchObject({
      source: "tournament",
      article: "大会規定 第7条",
    });
    expect(d.conclusion).toContain(
      "大会規定: 1分（出典: 大会規定 第7条 / 要項）"
    );
    // 対局の ID は日付を含まない（日付をまたいでも履歴が分割されない）
    expect(g.id).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("keeps the unverified B.2 behaviour without an override", async () => {
    const { g } = await blitzB2(false);
    const d = await reportIllegalMove(g.id);
    expect(d.penalties[0].timeAdjustmentSeconds).toBeUndefined();
    expect(d.escalationRecommended).toBe(true);
  });

  it("counts illegal moves per tournament game (2nd → loss)", async () => {
    const { g } = await blitzB2(true);
    await reportIllegalMove(g.id);
    await reportIllegalMove(g.id);
    // 2回目は 7.5.5 ただし書きの確認が必要
    expect(store.getState().followUpQuestions.map((q) => q.id)).toContain(
      "opponentCanCheckmate"
    );
    const answered = await store
      .getState()
      .answerFollowUp({ opponentCanCheckmate: "true" });
    if (!answered.ok) throw new Error(answered.error);
    expect(answered.result.decision.penalties[0].type).toBe("game-loss");
  });

  it("rejects a tournament game whose ruleset is incomplete", async () => {
    const { t, g } = await blitzB2(false);
    await db.tournaments.update(t.id, { supervisionRegime: undefined });
    const res = await store.getState().submitIncident({
      gameId: g.id,
      category: "illegal-move",
      description: "",
      arbiterObserved: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("適用規則");
    expect(await db.incidents.count()).toBe(0);
  });

  it("rejects an unknown game id and a missing context", async () => {
    const unknown = await store.getState().submitIncident({
      gameId: "nope",
      category: "other" as never,
      description: "x",
      arbiterObserved: true,
    });
    expect(unknown.ok).toBe(false);
    const missing = await store.getState().submitIncident({
      category: "other" as never,
      description: "x",
      arbiterObserved: true,
    });
    expect(missing).toEqual({ ok: false, error: "対局を指定してください" });
  });
});
