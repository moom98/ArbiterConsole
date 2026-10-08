import { describe, it, expect } from "vitest";
import {
  DrawClaimTree,
  DT_005_ID,
  FIFTY_MOVES_PLIES,
  type DrawClaimInput,
} from "@/lib/domain/decision-trees/dt-005-draw-claim";
import type { RepetitionAnalysis } from "@/lib/domain/services/position-analysis";
import { fixedProviders } from "./helpers";

const CLAIM: Partial<DrawClaimInput> = {
  subtype: "threefold-repetition-claim",
  competitionType: "standard",
  claimant: "white",
  // 黒が最後に指した → 白の手番
  lastMover: "black",
  claimMode: "just-appeared",
  touchedPiece: false,
};

const FIFTY: Partial<DrawClaimInput> = {
  ...CLAIM,
  subtype: "fifty-move-claim",
};

function analysis(
  over: Partial<RepetitionAnalysis>
): DrawClaimInput["analysis"] {
  return {
    ok: true,
    result: {
      targetOccurrences: 3,
      maxOccurrences: 3,
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
  positionsText: "1. Nf3 ...",
};

function run(input: Partial<DrawClaimInput>) {
  return new DrawClaimTree(fixedProviders()).evaluate(input);
}
function ids(r: ReturnType<typeof run>) {
  return r.status === "needs-input" ? r.questions.map((q) => q.id) : [];
}
function articles(r: ReturnType<typeof run>) {
  return r.decision.sources.map((s) => s.article);
}

describe("DT-005 Draw Claim: shared claim procedure (ADR-014 §1 / §2)", () => {
  it.each(["threefold-repetition-claim", "fifty-move-claim"] as const)(
    "%s asks the claim procedure first: claimant, last mover, timing, touched piece",
    (subtype) => {
      expect(ids(run({ subtype, competitionType: "standard" }))).toEqual([
        "claimant",
        "lastMover",
        "claimMode",
        "touchedPiece",
      ]);
    }
  );

  it("keeps the persisted tree id for stored decisions", () => {
    const r = run({ ...CLAIM, conditionCheck: "met" });
    expect(r.decision.treeId).toBe(DT_005_ID);
    expect(DT_005_ID).toBe("DT-005-repetition");
  });

  it.each([
    ["threefold-repetition-claim", "FIDE 9.2"],
    ["fifty-move-claim", "FIDE 9.3"],
  ] as const)(
    "%s: the claimant made the last move → not their move, no penalty",
    (subtype, article) => {
      const r = run({ ...CLAIM, subtype, lastMover: "white" });
      expect(r.status).toBe("decided");
      expect(r.decision.penalties).toHaveLength(0);
      expect(r.decision.conclusion).toContain("手番ではありません");
      expect(r.decision.conclusion).toContain("最後に手を指したのは白");
      expect(articles(r)).toEqual(
        expect.arrayContaining([article, "JCF NA p.67"])
      );
    }
  );

  it("never asks about the clock (the side to move is not derived from the clock)", () => {
    const r = run({ subtype: "fifty-move-claim", competitionType: "standard" });
    const labels =
      r.status === "needs-input" ? r.questions.map((q) => q.label) : [];
    expect(labels.join("\n")).not.toContain("時計");
  });

  it.each(["threefold-repetition-claim", "fifty-move-claim"] as const)(
    "%s: touched a piece → lost the right to claim on this move (9.4)",
    (subtype) => {
      const r = run({ ...CLAIM, subtype, touchedPiece: true });
      expect(articles(r)).toContain("FIDE 9.4");
      expect(r.decision.penalties).toHaveLength(0);
    }
  );

  it.each([
    ["threefold-repetition-claim", "9.2.1", "FIDE 9.2"],
    ["fifty-move-claim", "9.3.1", "FIDE 9.3"],
  ] as const)(
    "%s: intended move not written → 'Make your claim legal' (%s)",
    (subtype, para, article) => {
      const base = { ...CLAIM, subtype, claimMode: "about-to-appear" as const };
      expect(ids(run(base))).toEqual(["moveWritten"]);
      const r = run({ ...base, moveWritten: false });
      expect(r.decision.penalties).toHaveLength(0);
      expect(r.decision.conclusion).toContain("Make your claim legal");
      expect(r.decision.conclusion).toContain(para);
      expect(articles(r)).toContain(article);
    }
  );

  it("asks the basis-specific check (with optional move list) once the procedure is fine", () => {
    expect(ids(run(CLAIM))).toEqual(["repetitionCheck", "positionsText"]);
    expect(ids(run(FIFTY))).toEqual(["fiftyMoveCheck", "positionsText"]);
    expect(
      ids(run({ ...FIFTY, claimMode: "about-to-appear", moveWritten: true }))
    ).toEqual(["fiftyMoveCheck", "positionsText", "intendedMove"]);
  });

  it("a stray 75-move 'met-checkmate' check is not taken as a correct claim", () => {
    const r = run({ ...FIFTY, conditionCheck: "met-checkmate" });
    expect(r.status).toBe("needs-input");
    expect(ids(r)).toEqual(["fiftyMoveCheck", "positionsText"]);
  });
});

describe("DT-005 Draw Claim: threefold repetition (9.2 / 9.5)", () => {
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

  it("automatic check: 3 occurrences → draw with medium confidence and replay reminder", () => {
    const r = run({
      ...CLAIM,
      ...AUTO,
      analysis: analysis({ targetOccurrences: 3 }),
    });
    expect(r.decision.penalties[0].type).toBe("draw");
    expect(r.decision.confidence).toBe("medium");
    expect(r.decision.actions.join("\n")).toContain("両プレーヤーの面前");
  });

  it("automatic check: 2 occurrences → incorrect claim", () => {
    const r = run({
      ...CLAIM,
      ...AUTO,
      analysis: analysis({ targetOccurrences: 2 }),
    });
    expect(r.decision.penalties[0].type).toBe("time-addition-opponent");
  });

  it("automatic check without input or with a parse error → asks again with the error", () => {
    const noText = run({ ...CLAIM, conditionCheck: "auto" });
    expect(noText.status).toBe("needs-input");
    const bad = run({
      ...CLAIM,
      ...AUTO,
      positionsText: "1. e4 e5 2. Ke3",
      analysis: { ok: false, error: "3手目を指せません" },
    });
    expect(bad.status).toBe("needs-input");
    expect(bad.decision.conclusion).toContain("3手目を指せません");
  });

  it("automatic check finding a fivefold repetition flags it for CA", () => {
    const r = run({
      ...CLAIM,
      ...AUTO,
      analysis: analysis({ targetOccurrences: 5, maxOccurrences: 5 }),
    });
    expect(r.decision.escalationRecommended).toBe(true);
  });

  it("unknown → consult CA", () => {
    const r = run({ ...CLAIM, conditionCheck: "unknown" });
    expect(r.decision.kind).toBe("manual-review");
  });
});

describe("DT-005 Draw Claim: fifty-move rule (9.3 / 9.5)", () => {
  it("defines 50 moves as 100 plies", () => {
    expect(FIFTY_MOVES_PLIES).toBe(100);
  });

  it("correct claim confirmed on the board → draw, citing 9.3 and 9.5.2", () => {
    const r = run({ ...FIFTY, conditionCheck: "met" });
    expect(r.decision.penalties[0]).toEqual(
      expect.objectContaining({
        type: "draw",
        description: "ドロー（50手ルール）",
      })
    );
    expect(r.decision.confidence).toBe("high");
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE 9.3", "FIDE 9.5.2", "JCF NA p.67"])
    );
    expect(articles(r)).not.toContain("FIDE 9.2");
  });

  it("incorrect claim in Standard → opponent +2 minutes (9.5.3)", () => {
    const r = run({ ...FIFTY, conditionCheck: "not-met" });
    expect(r.decision.penalties[0]).toEqual(
      expect.objectContaining({
        type: "time-addition-opponent",
        playerColor: "black",
        timeAdjustmentSeconds: 120,
      })
    );
    expect(r.decision.conclusion).toContain("50手に達していない");
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE 9.3", "FIDE 9.5.3"])
    );
  });

  it.each([
    ["rapid", "competition-rules", 60],
    ["blitz", "basic-rules", 60],
    ["blitz", "competition-rules", undefined],
  ] as const)(
    "incorrect claim in %s / %s → %s seconds",
    (competitionType, supervisionRegime, seconds) => {
      const r = run({
        ...FIFTY,
        competitionType,
        supervisionRegime,
        conditionCheck: "not-met",
      });
      expect(r.decision.penalties[0].timeAdjustmentSeconds).toBe(seconds);
    }
  );

  it.each([
    [100, "draw"],
    [130, "draw"],
    [99, "time-addition-opponent"],
  ] as const)(
    "automatic (complete history): %s plies without pawn move or capture → %s",
    (plies, type) => {
      const r = run({
        ...FIFTY,
        ...AUTO,
        analysis: analysis({ halfmoveClock: plies, maxHalfmoveClock: plies }),
      });
      expect(r.decision.penalties[0].type).toBe(type);
    }
  );

  it("uses the target position's count, not the maximum in the game", () => {
    const r = run({
      ...FIFTY,
      ...AUTO,
      analysis: analysis({ halfmoveClock: 20, maxHalfmoveClock: 120 }),
    });
    expect(r.decision.penalties[0].type).toBe("time-addition-opponent");
  });

  it("incomplete history: 100 counted plies → draw; fewer → manual reconstruction (ADR-014 §4)", () => {
    const met = run({
      ...FIFTY,
      ...AUTO,
      analysis: analysis({
        complete: false,
        halfmoveClock: 100,
        maxHalfmoveClock: 100,
      }),
    });
    expect(met.decision.penalties[0].type).toBe("draw");
    const notMet = run({
      ...FIFTY,
      ...AUTO,
      analysis: analysis({ complete: false, halfmoveClock: 60 }),
    });
    expect(notMet.status).toBe("needs-input");
    expect(ids(notMet)).toContain("fiftyMoveCheck");
    expect(notMet.decision.conclusion).toContain("途中の局面");
  });

  it("position-only confirmation cannot decide 'not met'", () => {
    const r = run({
      ...FIFTY,
      ...AUTO,
      historyConfirmed: "position-only",
      analysis: analysis({ halfmoveClock: 60 }),
    });
    expect(r.status).toBe("needs-input");
    expect(r.decision.penalties).toHaveLength(0);
  });

  it("9.3.1 auto check without the intended move asks for it", () => {
    const r = run({
      ...FIFTY,
      claimMode: "about-to-appear",
      moveWritten: true,
      ...AUTO,
      analysis: analysis({ halfmoveClock: 100 }),
    });
    expect(r.status).toBe("needs-input");
    expect(ids(r)).toContain("intendedMove");
    expect(r.decision.conclusion).toContain("9.3.1");
  });

  it("a history that also reached 75 moves flags a possible 9.6.2 draw", () => {
    const r = run({
      ...FIFTY,
      ...AUTO,
      analysis: analysis({ halfmoveClock: 152, maxHalfmoveClock: 152 }),
    });
    expect(r.decision.penalties[0].type).toBe("draw");
    expect(r.decision.escalationRecommended).toBe(true);
    expect(r.decision.actions.join("\n")).toContain("9.6.2");
  });
});

describe("DT-005 Draw Claim: side to move from the history (ADR-014 §2)", () => {
  const NO_MOVER = { ...CLAIM, lastMover: undefined };

  it("does not ask the last mover when a history is being checked", () => {
    const r = run({
      ...NO_MOVER,
      conditionCheck: "auto",
      positionsText: "1. Nf3 ...",
      analysis: analysis({}),
    });
    expect(ids(r)).toEqual(["historyConfirmed"]);
  });

  it("confirmed history where the claimant is to move → decides from the history", () => {
    const r = run({
      ...NO_MOVER,
      ...AUTO,
      analysis: analysis({ targetOccurrences: 3, sideToMove: "white" }),
    });
    expect(r.decision.penalties[0].type).toBe("draw");
  });

  it("confirmed history where the opponent is to move → not the claimant's move", () => {
    const r = run({
      ...NO_MOVER,
      ...AUTO,
      analysis: analysis({ sideToMove: "black" }),
    });
    expect(r.status).toBe("decided");
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.conclusion).toContain("照合した棋譜");
    expect(r.decision.conclusion).toContain("手番ではありません");
  });

  it("S1: with a history pending, 9.4 is not ruled before the side to move is known", () => {
    const base = {
      ...NO_MOVER,
      touchedPiece: true,
      conditionCheck: "auto" as const,
      positionsText: "1. e4 e5 2. Nf3",
      analysis: analysis({ sideToMove: "black" }),
    };
    const ask = run(base);
    expect(ids(ask)).toEqual(["historyConfirmed"]);
    const r = run({ ...base, historyConfirmed: "match" });
    expect(r.decision.conclusion).toContain("手番ではありません");
    expect(articles(r)).not.toContain("FIDE 9.4");
  });

  it("history not confirmed (mismatch) → asks the manual check and the last mover", () => {
    const r = run({
      ...NO_MOVER,
      ...AUTO,
      historyConfirmed: "mismatch",
      analysis: analysis({}),
    });
    expect(ids(r)).toEqual(["repetitionCheck", "lastMover", "positionsText"]);
  });

  it("L5: the history's side to move contradicts the last-mover answer → asks again, including the last mover", () => {
    const r = run({
      ...CLAIM,
      claimant: "black",
      lastMover: "white",
      ...AUTO,
      analysis: analysis({ sideToMove: "white" }),
    });
    expect(r.status).toBe("needs-input");
    expect(r.decision.penalties).toHaveLength(0);
    expect(ids(r)).toContain("lastMover");
    expect(r.decision.conclusion).toContain("最後に盤上で指したのは白");
  });
});

describe("DT-005 review regressions", () => {
  it("B1: 9.2.1 auto check without the intended move asks for it instead of deciding", () => {
    const r = run({
      ...CLAIM,
      claimMode: "about-to-appear",
      moveWritten: true,
      ...AUTO,
      positionsText: "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1",
      analysis: analysis({ targetOccurrences: 2 }),
    });
    expect(r.status).toBe("needs-input");
    expect(r.decision.penalties).toHaveLength(0);
    expect(ids(r)).toContain("intendedMove");
    expect(r.decision.conclusion).toContain("記入した次の手");
  });

  it("R2: incorrect claim in Blitz B.2 suggests 2 minutes (literal reading) without applying it", () => {
    const r = run({
      ...CLAIM,
      competitionType: "blitz",
      supervisionRegime: "competition-rules",
      conditionCheck: "not-met",
    });
    expect(r.decision.penalties[0].timeAdjustmentSeconds).toBeUndefined();
    expect(r.decision.conclusion).toContain("2分（文言上の解釈・要確認）");
    expect(r.decision.escalationRecommended).toBe(true);
    expect(r.decision.confidence).toBe("medium");
  });
});
