// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ArbiterDatabase } from "@/lib/infrastructure/db/schema";
import { createIncidentStore } from "@/lib/stores/incident-store";
import type { ReportContext } from "@/lib/domain/services/game-context";
import type { IncidentQuestionId } from "@/lib/domain/follow-up";
import { fixedProviders } from "./helpers";

const STANDARD_CTX: ReportContext = {
  competitionType: "standard",
  rulesVersion: "FIDE-2023",
  round: 3,
  boardNumber: 12,
};

const WHITE_COMPLETED: Partial<Record<IncidentQuestionId, string>> = {
  playerColor: "white",
  subtype: "illegal-move",
  gameEnded: "false",
  clockPressed: "true",
};

let dbCounter = 0;

describe("Incident flow (store + engine + IndexedDB)", () => {
  let db: ArbiterDatabase;
  let store: ReturnType<typeof createIncidentStore>;

  beforeEach(() => {
    db = new ArbiterDatabase(`test-db-${++dbCounter}`);
    store = createIncidentStore({
      db,
      providers: fixedProviders(`run${dbCounter}`),
    });
  });

  afterEach(async () => {
    await db.delete();
  });

  async function report(
    answers: Partial<Record<IncidentQuestionId, string>>,
    ctx: ReportContext = STANDARD_CTX
  ) {
    const submitted = await store.getState().submitIncident({
      context: ctx,
      category: "illegal-move",
      description: "",
      arbiterObserved: true,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw new Error(submitted.error);
    expect(submitted.result.requiresFollowUp).toBe(true);
    const incidentId = store.getState().currentIncident!.id;

    const answered = await store.getState().answerFollowUp(answers);
    if (!answered.ok) throw new Error(answered.error);
    // 同じ Incident を再評価している
    expect(store.getState().currentIncident!.id).toBe(incidentId);
    return answered.result;
  }

  it("2nd penalised illegal move by the same player suggests a game loss; non-penalised reports do not count", async () => {
    // 1回目: 白の違法手 → 黒に2分
    const first = await report(WHITE_COMPLETED);
    expect(first.requiresFollowUp).toBe(false);
    expect(first.decision.penalties[0].type).toBe("time-addition-opponent");

    // 間に: 時計を押していない（ペナルティなし）→ 数えない
    const notCompleted = await report({
      ...WHITE_COMPLETED,
      clockPressed: "false",
    });
    expect(notCompleted.decision.penalties).toHaveLength(0);

    // 間に: 黒の違法手 → 白の回数には影響しない
    const black = await report({ ...WHITE_COMPLETED, playerColor: "black" });
    expect(black.decision.penalties[0].type).toBe("time-addition-opponent");
    expect(black.decision.conclusion).toContain("黒の1回目");

    // 2回目: 白 → メイト可能かを質問 → 負け
    const second = await report(WHITE_COMPLETED);
    expect(second.requiresFollowUp).toBe(true);
    expect(second.followUpQuestions.map((q) => q.id)).toEqual([
      "opponentCanCheckmate",
    ]);
    // 追加質問待ちの間は保留（エスカレーション扱いにしない）
    const pending = await db.incidents.get(
      store.getState().currentIncident!.id
    );
    expect(pending?.status).toBe("pending");
    expect(pending?.escalatedToCA).toBe(false);

    const final = await store
      .getState()
      .answerFollowUp({ opponentCanCheckmate: "true" });
    if (!final.ok) throw new Error(final.error);
    expect(final.result.decision.penalties[0].type).toBe("game-loss");
    expect(final.result.decision.penalties[0].playerColor).toBe("white");

    const incidents = await db.incidents.toArray();
    expect(incidents).toHaveLength(4);
    expect(new Set(incidents.map((i) => i.gameId)).size).toBe(1);
    const stored = await db.incidents.get(store.getState().currentIncident!.id);
    expect(stored?.status).toBe("resolved");
    expect(stored?.decisionId).toBe(final.result.decision.id);
  });

  it("'unknown' mate ability ends in a persisted consult-CA decision (not left pending) and lists the counted move", async () => {
    await report(WHITE_COMPLETED);
    const second = await report(WHITE_COMPLETED);
    expect(second.followUpQuestions.map((q) => q.id)).toEqual([
      "opponentCanCheckmate",
    ]);
    expect(second.decision.conclusion).toContain("記録済み 1回目");

    const final = await store
      .getState()
      .answerFollowUp({ opponentCanCheckmate: "unknown" });
    if (!final.ok) throw new Error(final.error);
    expect(final.result.requiresFollowUp).toBe(false);
    expect(final.result.decision.kind).toBe("manual-review");
    expect(final.result.decision.penalties).toHaveLength(0);
    expect(final.result.decision.actions.join("\n")).toContain(
      "記録済み 1回目"
    );
    const stored = await db.incidents.get(store.getState().currentIncident!.id);
    expect(stored?.status).toBe("escalated");
    expect(stored?.decisionId).toBe(final.result.decision.id);
  });

  it("history is keyed by game: a different board starts from zero", async () => {
    await report(WHITE_COMPLETED);
    const other = await report(WHITE_COMPLETED, {
      ...STANDARD_CTX,
      boardNumber: 13,
    });
    expect(other.decision.penalties[0].type).toBe("time-addition-opponent");
  });

  it("persists the game, tournament and last-used context", async () => {
    await report(WHITE_COMPLETED);
    const games = await db.games.toArray();
    expect(games).toHaveLength(1);
    expect(games[0].round).toBe(3);
    expect(games[0].boardNumber).toBe(12);
    const tournament = await db.tournaments.get(games[0].tournamentId);
    expect(tournament?.competitionType).toBe("standard");
    expect(tournament?.rulesVersion).toBe("FIDE-2023");

    const fresh = createIncidentStore({
      db,
      providers: fixedProviders("fresh"),
    });
    await fresh.getState().loadLastContext();
    expect(fresh.getState().lastContext).toEqual(STANDARD_CTX);
  });

  it("rapid A.5 reports go to DT-003 (1 minute), not the standard tree", async () => {
    const res = await store.getState().submitIncident({
      context: {
        ...STANDARD_CTX,
        competitionType: "rapid",
        supervisionRegime: "basic-rules",
      },
      category: "illegal-move",
      description: "",
      arbiterObserved: true,
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.decision.treeId).toBe("DT-003-illegal-move-fast-basic");
    const answered = await store.getState().answerFollowUp({
      ...WHITE_COMPLETED,
      opponentMadeNextMove: "false",
      detectedBy: "arbiter",
    });
    if (!answered.ok) throw new Error(answered.error);
    expect(answered.result.decision.penalties[0].timeAdjustmentSeconds).toBe(
      60
    );
    const stored = await db.incidents.get(store.getState().currentIncident!.id);
    expect(stored?.status).toBe("resolved");
  });

  it("invalid context fails without a decision and without creating an incident", async () => {
    const res = await store.getState().submitIncident({
      context: { ...STANDARD_CTX, round: 0 },
      category: "illegal-move",
      description: "",
      arbiterObserved: true,
    });
    expect(res.ok).toBe(false);
    expect(store.getState().currentDecision).toBeNull();
    expect(store.getState().error).toBeTruthy();
    expect(await db.incidents.count()).toBe(0);
  });

  it("a new submit clears the previous decision", async () => {
    await report(WHITE_COMPLETED);
    expect(store.getState().currentDecision).not.toBeNull();
    const p = store.getState().submitIncident({
      context: { ...STANDARD_CTX, round: -1 },
      category: "illegal-move",
      description: "",
      arbiterObserved: true,
    });
    await p;
    expect(store.getState().currentDecision).toBeNull();
  });

  describe("Milestone 4 trees through the store", () => {
    const RAPID_A5: ReportContext = {
      ...STANDARD_CTX,
      competitionType: "rapid",
      supervisionRegime: "basic-rules",
    };
    const A5_ANSWERS = {
      ...WHITE_COMPLETED,
      opponentMadeNextMove: "false",
      detectedBy: "arbiter",
    };

    async function submit(
      category: "clock-time" | "draw" | "illegal-move",
      ctx: ReportContext
    ) {
      const res = await store.getState().submitIncident({
        context: ctx,
        category,
        description: "",
        arbiterObserved: true,
      });
      if (!res.ok) throw new Error(res.error);
      return res.result;
    }
    async function answer(a: Record<string, string>) {
      const res = await store
        .getState()
        .answerFollowUp(a as Partial<Record<IncidentQuestionId, string>>);
      if (!res.ok) throw new Error(res.error);
      return res.result;
    }

    it("Rapid A.5: a move that stood is not counted; the 2nd penalised one asks about mate", async () => {
      await submit("illegal-move", RAPID_A5);
      const first = await answer(A5_ANSWERS);
      expect(first.decision.penalties[0].timeAdjustmentSeconds).toBe(60);

      await submit("illegal-move", RAPID_A5);
      const stood = await answer({
        ...A5_ANSWERS,
        opponentMadeNextMove: "true",
      });
      expect(stood.decision.penalties).toHaveLength(0);

      await submit("illegal-move", RAPID_A5);
      const second = await answer(A5_ANSWERS);
      expect(second.followUpQuestions.map((q) => q.id)).toEqual([
        "opponentCanCheckmate",
      ]);
      const final = await answer({ opponentCanCheckmate: "true" });
      expect(final.decision.penalties[0].type).toBe("game-loss");
      expect(final.decision.treeId).toBe("DT-003-illegal-move-fast-basic");
    });

    it("flag fall: subtype → facts → material → decision persisted", async () => {
      const first = await submit("clock-time", STANDARD_CTX);
      expect(first.followUpQuestions.map((q) => q.id)).toEqual([
        "clockTimeSubtype",
      ]);
      await answer({ clockTimeSubtype: "flag-fall" });
      await answer({
        flagFallen: "white",
        gameEndedBeforeFlag: "false",
        movesNotCompleted: "true",
      });
      // UI は全ステッパーを既定値 "0" で送信する
      const zeros = Object.fromEntries(
        ["white", "black"].flatMap((c) =>
          [
            "Queens",
            "Rooks",
            "LightBishops",
            "DarkBishops",
            "Knights",
            "Pawns",
          ].map((p) => [`${c}${p}`, "0"])
        )
      );
      const final = await answer({
        ...zeros,
        blackKnights: "1",
        materialConfirmed: "true",
      });
      expect(final.requiresFollowUp).toBe(false);
      expect(final.decision.treeId).toBe("DT-004-flag-fall");
      expect(final.decision.penalties[0].type).toBe("draw");
      const stored = await db.incidents.get(
        store.getState().currentIncident!.id
      );
      expect(stored?.status).toBe("resolved");
      expect(stored?.subtype).toBe("flag-fall");
    });

    it("M3: quick flag-fall report reaches a decision in 2 answer rounds", async () => {
      const res = await store.getState().submitIncident({
        context: STANDARD_CTX,
        category: "clock-time",
        subtype: "flag-fall",
        description: "",
        arbiterObserved: true,
      });
      if (!res.ok) throw new Error(res.error);
      expect(res.result.followUpQuestions.map((q) => q.id)).toEqual([
        "flagFallen",
        "gameEndedBeforeFlag",
      ]);
      await answer({ flagFallen: "white", gameEndedBeforeFlag: "false" });
      const zeros = Object.fromEntries(
        ["white", "black"].flatMap((c) =>
          [
            "Queens",
            "Rooks",
            "LightBishops",
            "DarkBishops",
            "Knights",
            "Pawns",
          ].map((p) => [`${c}${p}`, "0"])
        )
      );
      const final = await answer({
        movesNotCompleted: "true",
        ...zeros,
        blackRooks: "1",
        materialConfirmed: "true",
      });
      expect(final.requiresFollowUp).toBe(false);
      expect(final.decision.penalties[0].type).toBe("game-loss");
    });

    it("rejects an unknown quick-report subtype without creating an incident", async () => {
      const res = await store.getState().submitIncident({
        context: STANDARD_CTX,
        category: "draw",
        subtype: "bogus",
        description: "",
        arbiterObserved: true,
      });
      expect(res.ok).toBe(false);
      expect(await db.incidents.count()).toBe(0);
    });

    it("threefold claim with a move list is checked automatically", async () => {
      await submit("draw", STANDARD_CTX);
      await answer({ drawSubtype: "threefold-repetition-claim" });
      await answer({
        claimant: "black",
        claimantHasMove: "true",
        claimMode: "just-appeared",
        touchedPiece: "false",
      });
      const final = await answer({
        repetitionCheck: "auto",
        positionsText: "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1",
      });
      // 黒番で 4.Ng1 の後の局面は2回目のみ → 誤ったクレーム（白に2分）
      expect(final.decision.treeId).toBe("DT-005-repetition");
      expect(final.decision.penalties[0]).toEqual(
        expect.objectContaining({
          type: "time-addition-opponent",
          playerColor: "white",
          timeAdjustmentSeconds: 120,
        })
      );
    });
  });
});
