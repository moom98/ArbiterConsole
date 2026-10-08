import { describe, it, expect } from "vitest";
import {
  AutomaticDrawTree,
  DT_006_ID,
  type AutomaticDrawInput,
} from "@/lib/domain/decision-trees/dt-006-automatic-draw";
import type { RepetitionAnalysis } from "@/lib/domain/services/position-analysis";
import { fixedProviders } from "./helpers";

function analysis(
  over: Partial<RepetitionAnalysis>
): AutomaticDrawInput["analysis"] {
  return {
    ok: true,
    result: {
      targetOccurrences: 1,
      maxOccurrences: 1,
      halfmoveClock: 0,
      maxHalfmoveClock: 0,
      sideToMove: "white",
      positions: 9,
      complete: true,
      history: {
        complete: true,
        plies: 8,
        lastMove: "4... Ng8",
        finalFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 8 5",
        sideToMove: "white",
        fullmoveNumber: 5,
      },
      ...over,
    },
  };
}

const AUTO = {
  conditionCheck: "auto" as const,
  historyConfirmed: "match" as const,
  positionsText: "...",
};

function run(input: Partial<AutomaticDrawInput>) {
  return new AutomaticDrawTree(fixedProviders()).evaluate(input);
}
function ids(r: ReturnType<typeof run>) {
  return r.status === "needs-input" ? r.questions.map((q) => q.id) : [];
}
function articles(r: ReturnType<typeof run>) {
  return r.decision.sources.map((s) => s.article);
}

describe("DT-006 Automatic Draw: fivefold repetition (9.6.1)", () => {
  const base: Partial<AutomaticDrawInput> = {
    subtype: "fivefold-repetition",
    competitionType: "blitz",
    supervisionRegime: "basic-rules",
  };
  it("asks only the check: there is no claimant or side to move", () => {
    expect(ids(run(base))).toEqual(["fivefoldCheck", "positionsText"]);
  });
  it("confirmed → immediate draw without a claim, under the DT-006 id", () => {
    const r = run({ ...base, conditionCheck: "met" });
    expect(r.decision.penalties[0].type).toBe("draw");
    expect(r.decision.intervention).toBe("immediate");
    expect(r.decision.treeId).toBe(DT_006_ID);
    expect(DT_006_ID).toBe("DT-006-automatic-draw");
    expect(articles(r)).toContain("FIDE 9.6");
  });
  it("fewer than five → no intervention", () => {
    const r = run({ ...base, conditionCheck: "not-met" });
    expect(r.decision.intervention).toBe("no-intervention");
  });
  it("automatic: maxOccurrences 5 → draw", () => {
    const r = run({
      ...base,
      ...AUTO,
      analysis: analysis({ maxOccurrences: 5 }),
    });
    expect(r.decision.penalties[0].type).toBe("draw");
  });
  it("automatic from an incomplete history: 4 occurrences → manual reconstruction", () => {
    const r = run({
      ...base,
      ...AUTO,
      analysis: analysis({ complete: false, maxOccurrences: 4 }),
    });
    expect(r.status).toBe("needs-input");
    expect(ids(r)).toContain("fivefoldCheck");
  });
  it("unknown → consult CA", () => {
    const r = run({ ...base, conditionCheck: "unknown" });
    expect(r.decision.kind).toBe("manual-review");
  });
  it("a stray 75-move 'met-checkmate' is not taken as fivefold", () => {
    const r = run({ ...base, conditionCheck: "met-checkmate" });
    expect(r.status).toBe("needs-input");
  });
});

describe("DT-006 Automatic Draw: 75-move rule (9.6.2)", () => {
  const base: Partial<AutomaticDrawInput> = {
    subtype: "75-move-rule",
    competitionType: "standard",
  };
  it("asks only the check; the last-move checkmate is part of the reconstruction result", () => {
    expect(ids(run(base))).toEqual(["seventyFiveCheck", "positionsText"]);
  });
  it("75 moves, no checkmate → draw", () => {
    const r = run({ ...base, conditionCheck: "met", lastMoveCheckmate: false });
    expect(r.decision.penalties[0].type).toBe("draw");
    expect(r.decision.treeId).toBe(DT_006_ID);
  });
  it("75 moves reached with checkmate → checkmate takes precedence", () => {
    const r = run({ ...base, conditionCheck: "met-checkmate" });
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.conclusion).toContain("チェックメイトが優先");
  });
  it("M1: legacy 'met' without a checkmate answer is asked again, never a draw", () => {
    const r = run({ ...base, conditionCheck: "met" });
    expect(r.status).toBe("needs-input");
    expect(r.decision.penalties).toHaveLength(0);
    expect(ids(r)).toEqual(["seventyFiveCheck", "positionsText"]);
    expect(r.decision.conclusion).toContain(
      "チェックメイトだったかが確認されていません"
    );
  });
  it("legacy incident (met + lastMoveCheckmate) keeps checkmate precedence", () => {
    const r = run({ ...base, conditionCheck: "met", lastMoveCheckmate: true });
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.conclusion).toContain("チェックメイトが優先");
  });
  it("automatic from a move list: 150 plies → draw; 149 → no intervention", () => {
    const met = run({
      ...base,
      ...AUTO,
      analysis: analysis({
        maxHalfmoveClock: 150,
        seventyFiveReachedWithCheckmate: false,
      }),
    });
    expect(met.decision.penalties[0].type).toBe("draw");
    const notMet = run({
      ...base,
      ...AUTO,
      analysis: analysis({ maxHalfmoveClock: 149 }),
    });
    expect(notMet.decision.intervention).toBe("no-intervention");
  });
  it("automatic: a stale legacy lastMoveCheckmate never overrides the history", () => {
    const r = run({
      ...base,
      ...AUTO,
      lastMoveCheckmate: true,
      analysis: analysis({
        maxHalfmoveClock: 150,
        seventyFiveReachedWithCheckmate: false,
      }),
    });
    expect(r.decision.penalties[0].type).toBe("draw");
  });
  it("automatic from a history starting at a FEN: 150 counted plies → draw; fewer → manual reconstruction (ADR-014 §4)", () => {
    const met = run({
      ...base,
      ...AUTO,
      analysis: analysis({
        complete: false,
        maxHalfmoveClock: 150,
        seventyFiveReachedWithCheckmate: false,
      }),
    });
    expect(met.decision.penalties[0].type).toBe("draw");
    const notMet = run({
      ...base,
      ...AUTO,
      analysis: analysis({ complete: false, maxHalfmoveClock: 149 }),
    });
    expect(notMet.status).toBe("needs-input");
    expect(ids(notMet)).toContain("seventyFiveCheck");
    expect(notMet.decision.conclusion).toContain("途中の局面");
  });
  it("incomplete history: checkmate at the counted 150th ply without a reset is not given precedence", () => {
    const r = run({
      ...base,
      ...AUTO,
      analysis: analysis({
        complete: false,
        maxHalfmoveClock: 150,
        seventyFiveReachedWithCheckmate: true,
        seventyFiveCheckmateUncertain: true,
      }),
    });
    expect(r.status).toBe("needs-input");
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.conclusion).toContain("確定できません");
  });
  it("B2: uses the maximum halfmove clock, not the last position", () => {
    const r = run({
      ...base,
      ...AUTO,
      analysis: analysis({
        halfmoveClock: 0,
        maxHalfmoveClock: 152,
        seventyFiveReachedWithCheckmate: false,
      }),
    });
    expect(r.decision.penalties[0].type).toBe("draw");
  });
  it("B2: checkmate on the move reaching 75 moves takes precedence (from the move list)", () => {
    const r = run({
      ...base,
      ...AUTO,
      analysis: analysis({
        maxHalfmoveClock: 150,
        seventyFiveReachedWithCheckmate: true,
      }),
    });
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.conclusion).toContain("チェックメイトが優先");
  });
  it("not met cites 9.3 as the remaining claim route", () => {
    const r = run({ ...base, conditionCheck: "not-met" });
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE 9.6", "FIDE 9.3"])
    );
  });
});
