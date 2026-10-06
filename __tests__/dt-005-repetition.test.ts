import { describe, it, expect } from "vitest";
import {
  RepetitionTree,
  type RepetitionInput,
} from "@/lib/domain/decision-trees/dt-005-repetition";
import type { RepetitionAnalysis } from "@/lib/domain/services/position-analysis";
import { fixedProviders } from "./helpers";

const CLAIM: Partial<RepetitionInput> = {
  subtype: "threefold-repetition-claim",
  competitionType: "standard",
  claimant: "white",
  claimantHasMove: true,
  claimMode: "just-appeared",
  touchedPiece: false,
};

function analysis(
  over: Partial<RepetitionAnalysis>
): RepetitionInput["analysis"] {
  return {
    ok: true,
    result: {
      targetOccurrences: 3,
      maxOccurrences: 3,
      halfmoveClock: 0,
      positions: 9,
      format: "moves",
      ...over,
    },
  };
}

function run(input: Partial<RepetitionInput>) {
  return new RepetitionTree(fixedProviders()).evaluate(input);
}
function ids(r: ReturnType<typeof run>) {
  return r.status === "needs-input" ? r.questions.map((q) => q.id) : [];
}
function articles(r: ReturnType<typeof run>) {
  return r.decision.sources.map((s) => s.article);
}

describe("DT-005 threefold repetition claim (9.2 / 9.5)", () => {
  it("asks the claim procedure questions first", () => {
    expect(
      ids(
        run({
          subtype: "threefold-repetition-claim",
          competitionType: "standard",
        })
      )
    ).toEqual(["claimant", "claimantHasMove", "claimMode", "touchedPiece"]);
  });

  it("scenario 1: correct claim confirmed by the arbiter → draw", () => {
    const r = run({ ...CLAIM, conditionCheck: "met" });
    expect(r.decision.penalties[0].type).toBe("draw");
    expect(r.decision.confidence).toBe("high");
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE 9.2", "FIDE 9.2.3", "FIDE 9.5.2"])
    );
  });

  it("scenario 2: incorrect claim in Standard → opponent +2 minutes", () => {
    const r = run({ ...CLAIM, conditionCheck: "not-met" });
    expect(r.decision.penalties[0]).toEqual(
      expect.objectContaining({
        type: "time-addition-opponent",
        playerColor: "black",
        timeAdjustmentSeconds: 120,
      })
    );
    expect(articles(r)).toContain("FIDE 9.5.3");
  });

  it.each([
    ["rapid", "competition-rules", 60],
    ["rapid", "basic-rules", 60],
    ["blitz", "basic-rules", 60],
    ["blitz", "competition-rules", undefined],
  ] as const)(
    "scenario 3: incorrect claim in %s / %s → %s seconds",
    (competitionType, supervisionRegime, seconds) => {
      const r = run({
        ...CLAIM,
        competitionType,
        supervisionRegime,
        conditionCheck: "not-met",
      });
      expect(r.decision.penalties[0].timeAdjustmentSeconds).toBe(seconds);
      expect(r.decision.escalationRecommended).toBe(seconds === undefined);
    }
  );

  it("scenario 4: intended move (9.2.1) not written → 'Make your claim legal'", () => {
    const base = { ...CLAIM, claimMode: "about-to-appear" as const };
    expect(ids(run(base))).toEqual(["moveWritten"]);
    const r = run({ ...base, moveWritten: false });
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.conclusion).toContain("Make your claim legal");
  });

  it("scenario 5: incorrect 9.2.1 claim → the written move must be played", () => {
    const r = run({
      ...CLAIM,
      claimMode: "about-to-appear",
      moveWritten: true,
      conditionCheck: "not-met",
    });
    expect(r.decision.actions.join("\n")).toContain("記入した手を指させる");
    expect(articles(r).some((a) => a.includes("intended move"))).toBe(true);
  });

  it("not the claimant's move → claim not admissible, no penalty", () => {
    const r = run({ ...CLAIM, claimantHasMove: false });
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.conclusion).toContain("手番ではない");
  });

  it("touched a piece → lost the right to claim on this move (9.4)", () => {
    const r = run({ ...CLAIM, touchedPiece: true });
    expect(articles(r)).toContain("FIDE 9.4");
    expect(r.decision.penalties).toHaveLength(0);
  });

  it("asks for the repetition check (with optional move list) once procedure is fine", () => {
    expect(ids(run(CLAIM))).toEqual(["repetitionCheck", "positionsText"]);
    expect(
      ids(run({ ...CLAIM, claimMode: "about-to-appear", moveWritten: true }))
    ).toEqual(["repetitionCheck", "positionsText", "intendedMove"]);
  });

  it("automatic check: 3 occurrences → draw with medium confidence and replay reminder", () => {
    const r = run({
      ...CLAIM,
      conditionCheck: "auto",
      positionsText: "1. Nf3 ...",
      analysis: analysis({ targetOccurrences: 3 }),
    });
    expect(r.decision.penalties[0].type).toBe("draw");
    expect(r.decision.confidence).toBe("medium");
    expect(r.decision.actions.join("\n")).toContain("両プレーヤーの面前");
  });

  it("automatic check: 2 occurrences → incorrect claim", () => {
    const r = run({
      ...CLAIM,
      conditionCheck: "auto",
      positionsText: "1. Nf3 ...",
      analysis: analysis({ targetOccurrences: 2 }),
    });
    expect(r.decision.penalties[0].type).toBe("time-addition-opponent");
  });

  it("automatic check without input or with a parse error → asks again with the error", () => {
    const noText = run({ ...CLAIM, conditionCheck: "auto" });
    expect(noText.status).toBe("needs-input");
    const bad = run({
      ...CLAIM,
      conditionCheck: "auto",
      positionsText: "1. e4 e5 2. Ke3",
      analysis: { ok: false, error: "3手目を指せません" },
    });
    expect(bad.status).toBe("needs-input");
    expect(bad.decision.conclusion).toContain("3手目を指せません");
  });

  it("automatic check finding a fivefold repetition flags it for CA", () => {
    const r = run({
      ...CLAIM,
      conditionCheck: "auto",
      positionsText: "...",
      analysis: analysis({ targetOccurrences: 5, maxOccurrences: 5 }),
    });
    expect(r.decision.escalationRecommended).toBe(true);
  });

  it("unknown → consult CA", () => {
    const r = run({ ...CLAIM, conditionCheck: "unknown" });
    expect(r.decision.kind).toBe("manual-review");
  });
});

describe("DT-005 fivefold repetition (9.6.1)", () => {
  const base: Partial<RepetitionInput> = {
    subtype: "fivefold-repetition",
    competitionType: "blitz",
    supervisionRegime: "basic-rules",
  };
  it("confirmed → immediate draw without a claim", () => {
    const r = run({ ...base, conditionCheck: "met" });
    expect(r.decision.penalties[0].type).toBe("draw");
    expect(r.decision.intervention).toBe("immediate");
    expect(articles(r)).toContain("FIDE 9.6");
  });
  it("fewer than five → no intervention", () => {
    const r = run({ ...base, conditionCheck: "not-met" });
    expect(r.decision.intervention).toBe("no-intervention");
  });
  it("automatic: maxOccurrences 5 → draw", () => {
    const r = run({
      ...base,
      conditionCheck: "auto",
      positionsText: "...",
      analysis: analysis({ maxOccurrences: 5 }),
    });
    expect(r.decision.penalties[0].type).toBe("draw");
  });
});

describe("DT-005 75-move rule (9.6.2)", () => {
  const base: Partial<RepetitionInput> = {
    subtype: "75-move-rule",
    competitionType: "standard",
  };
  it("asks the check and whether the last move was checkmate", () => {
    expect(ids(run(base))).toEqual([
      "seventyFiveCheck",
      "positionsText",
      "lastMoveCheckmate",
    ]);
  });
  it("75 moves, no checkmate → draw", () => {
    const r = run({ ...base, conditionCheck: "met", lastMoveCheckmate: false });
    expect(r.decision.penalties[0].type).toBe("draw");
  });
  it("75 moves, last move checkmate → checkmate takes precedence", () => {
    const r = run({ ...base, conditionCheck: "met", lastMoveCheckmate: true });
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.conclusion).toContain("チェックメイトが優先");
  });
  it("automatic from a move list: 150 plies → draw; 149 → no intervention", () => {
    const met = run({
      ...base,
      conditionCheck: "auto",
      positionsText: "...",
      lastMoveCheckmate: false,
      analysis: analysis({ halfmoveClock: 150 }),
    });
    expect(met.decision.penalties[0].type).toBe("draw");
    const notMet = run({
      ...base,
      conditionCheck: "auto",
      positionsText: "...",
      lastMoveCheckmate: false,
      analysis: analysis({ halfmoveClock: 149 }),
    });
    expect(notMet.decision.intervention).toBe("no-intervention");
  });
  it("automatic from FENs is not trusted for 75 moves → consult CA", () => {
    const r = run({
      ...base,
      conditionCheck: "auto",
      positionsText: "...",
      lastMoveCheckmate: false,
      analysis: analysis({ halfmoveClock: 160, format: "fens" }),
    });
    expect(r.decision.kind).toBe("manual-review");
  });
});
