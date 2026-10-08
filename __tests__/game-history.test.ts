import { describe, it, expect, vi } from "vitest";
import {
  isStandardStart,
  parseGameHistoryText,
  STANDARD_START_FEN,
  summarizeGameHistory,
  trustedHalfmoveClock,
  validateGameHistory,
  type GameHistory,
} from "@/lib/domain/services/game-history";
import { analyzeRepetition } from "@/lib/domain/services/position-analysis";
import { chessJsPositionPort as port } from "@/lib/infrastructure/chess/chess-js-position-port";
import {
  DecisionEngine,
  type RulesetContext,
} from "@/lib/domain/decision-engine";
import type { Incident } from "@/lib/domain/entities";
import {
  applyIncidentAnswers,
  isGenericUnknownAnswer,
  QUESTIONS,
} from "@/lib/domain/follow-up";
import type { LlmAssistPort } from "@/lib/domain/llm/ports";
import { fixedProviders, FIXED_NOW } from "./helpers";

function parse(text: string): GameHistory {
  const r = parseGameHistoryText(text);
  if (!r.ok) throw new Error(r.error);
  return r.history;
}

function validate(text: string) {
  return validateGameHistory(port, parse(text));
}

function validOrThrow(text: string) {
  const v = validate(text);
  if (!v.ok) throw new Error(v.error);
  return v;
}

const KNIGHT_DANCE = "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8";
/** 白: Ke1 Ra1 Rh1、黒: Ke8（白はキャスリング可能） */
const CASTLE_FEN = "4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1";
/** 白ナイト b1・f1 の両方が d2 へ行ける */
const TWO_KNIGHTS_FEN = "k7/8/8/8/8/8/8/1N3N1K w - - 0 1";
/** K+R vs K（ポーンなし）。halfmove clock 90 から */
const ROOK_ENDING_FEN = "7k/8/8/8/8/8/8/R6K w - - 90 60";

describe("parseGameHistoryText (ADR-014 §4)", () => {
  it("keeps only SAN moves: headers, comments, variations, NAGs, move numbers, results and !? are removed", () => {
    expect(
      parse(
        '[Event "Test"]\n[White "A"]\n１．Ｎｆ３ Nf6 (1... d5 (1... e5)) {comment} 2. Ng1! Ng8?! $1 ; note\n3.Nf3 1-0'
      )
    ).toEqual({ moves: ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3"] });
  });

  it("reads the start position only from a [FEN] header", () => {
    expect(parse(`[SetUp "1"]\n[FEN "${CASTLE_FEN}"]\n1. O-O Kd7`)).toEqual({
      startFen: CASTLE_FEN,
      moves: ["O-O", "Kd7"],
    });
  });

  it("rejects a list of FENs, even one per line", () => {
    const r = parseGameHistoryText(
      "4k3/8/8/8/8/8/8/4K3 w - - 0 1\n4k3/8/8/8/8/8/8/4K3 b - - 0 1"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("FEN（局面）の列は使えません");
  });

  it("rejects a FEN written before the moves without a [FEN] header", () => {
    expect(parseGameHistoryText(`${CASTLE_FEN} 1. O-O`).ok).toBe(false);
  });

  it("rejects two [FEN] headers and an empty one", () => {
    expect(
      parseGameHistoryText(`[FEN "${CASTLE_FEN}"][FEN "${CASTLE_FEN}"] O-O`).ok
    ).toBe(false);
    expect(parseGameHistoryText('[FEN ""] e4').ok).toBe(false);
  });
});

describe("validateGameHistory — strict SAN (ADR-014 §4)", () => {
  it("replays a legal game from the initial position", () => {
    const v = validOrThrow(KNIGHT_DANCE);
    expect(v.complete).toBe(true);
    expect(v.plies).toBe(8);
    expect(v.positions).toHaveLength(9);
    expect(v.sans[0]).toBe("Nf3");
  });

  it("rejects ambiguous SAN (two knights can reach d2)", () => {
    const v = validateGameHistory(port, {
      startFen: TWO_KNIGHTS_FEN,
      moves: ["Nd2"],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("Nd2");
    // 正しく曖昧さを回避した表記は受け付ける
    expect(
      validateGameHistory(port, { startFen: TWO_KNIGHTS_FEN, moves: ["Nbd2"] })
        .ok
    ).toBe(true);
  });

  it("rejects over-disambiguated, coordinate and zero-castling notation, with a hint", () => {
    const over = validate("1. Ngf3");
    expect(over.ok).toBe(false);

    const coord = validate("1. e2e4");
    expect(coord.ok).toBe(false);
    if (!coord.ok) expect(coord.error).toContain("座標表記");

    const zero = validateGameHistory(port, {
      startFen: CASTLE_FEN,
      moves: ["0-0"],
    });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error).toContain("O-O");

    expect(
      validateGameHistory(port, { startFen: CASTLE_FEN, moves: ["O-O"] }).ok
    ).toBe(true);
  });

  it("an illegal move fails and names the move and ply (never guessed)", () => {
    const v = validate("1. e4 e5 2. Ke3");
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.error).toContain("2. Ke3");
      expect(v.error).toContain("3半手目");
    }
  });

  it("an invalid start FEN fails", () => {
    const v = validateGameHistory(port, { startFen: "8/8/8 w", moves: [] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("開始局面");
  });

  it("a history that starts at the standard initial position is complete", () => {
    expect(isStandardStart(undefined)).toBe(true);
    expect(
      isStandardStart(`  ${STANDARD_START_FEN.replace(/ /g, "  ")} `)
    ).toBe(true);
    expect(isStandardStart(CASTLE_FEN)).toBe(false);
    expect(
      validOrThrow(`[FEN "${STANDARD_START_FEN}"] ${KNIGHT_DANCE}`).complete
    ).toBe(true);
    expect(validOrThrow(`[FEN "${CASTLE_FEN}"] 1. O-O`).complete).toBe(false);
  });
});

describe("trustedHalfmoveClock and summary", () => {
  it("does not trust the start FEN halfmove clock of an incomplete history", () => {
    const v = validOrThrow(`[FEN "${ROOK_ENDING_FEN}"] 60. Ra2 Kg8 61. Ra1`);
    const last = v.positions[v.positions.length - 1];
    expect(last.halfmoveClock).toBe(93);
    expect(trustedHalfmoveClock(v, last, v.positions.length - 1)).toBe(3);
  });

  it("is exact after a capture or pawn move inside an incomplete history", () => {
    // 開始局面の halfmove clock 50。b5 の後は 0 から数える
    const v = validOrThrow(
      '[FEN "k7/8/8/8/8/8/1P6/K7 w - - 50 70"] 70. b4 Ka7 71. b5 Ka8 72. Ka2'
    );
    const last = v.positions[v.positions.length - 1];
    expect(trustedHalfmoveClock(v, last, v.positions.length - 1)).toBe(2);
  });

  it("trusts the clock of a complete history", () => {
    const v = validOrThrow(KNIGHT_DANCE);
    const last = v.positions[8];
    expect(trustedHalfmoveClock(v, last, 8)).toBe(8);
  });

  it("summarises the final position for the arbiter", () => {
    expect(summarizeGameHistory(validOrThrow("1. e4 e5 2. Nf3"))).toEqual(
      expect.objectContaining({
        complete: true,
        plies: 3,
        lastMove: "2. Nf3",
        sideToMove: "black",
      })
    );
    expect(summarizeGameHistory(validOrThrow("1. e4 e5")).lastMove).toBe(
      "1... e5"
    );
    expect(summarizeGameHistory(validOrThrow("")).lastMove).toBeUndefined();
  });
});

describe("analyzeRepetition on an incomplete history", () => {
  it("still finds a repetition (finding it is proof)", () => {
    const v = validOrThrow(
      `[FEN "${ROOK_ENDING_FEN}"] 60. Ra2 Kg8 61. Ra1 Kh8 62. Ra2 Kg8 63. Ra1 Kh8`
    );
    const r = analyzeRepetition(port, v);
    if (!r.ok) throw new Error(r.error);
    expect(r.complete).toBe(false);
    expect(r.targetOccurrences).toBe(3);
  });

  it("75 moves: counts only plies inside the history", () => {
    const v = validOrThrow(`[FEN "7k/8/8/8/8/8/8/R6K w - - 149 80"] 80. Ra2`);
    const r = analyzeRepetition(port, v);
    if (!r.ok) throw new Error(r.error);
    expect(r.maxHalfmoveClock).toBe(1);
    expect(r.seventyFiveReachedWithCheckmate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DecisionEngine + DT-005
// ---------------------------------------------------------------------------

const STANDARD: RulesetContext = {
  competitionType: "standard",
  rulesVersion: "FIDE-2023",
};

function drawIncident(): Incident {
  return {
    id: "inc-h",
    gameId: "g1",
    category: "draw",
    description: "",
    arbiterObserved: true,
    reportedBy: "arbiter",
    reportedAt: FIXED_NOW,
    status: "pending",
    escalatedToCA: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

const engine = new DecisionEngine(fixedProviders(), { positions: port });

function claim(positionsText: string, extra: Record<string, string> = {}) {
  return applyIncidentAnswers(drawIncident(), {
    drawSubtype: "threefold-repetition-claim",
    claimant: "white",
    claimantHasMove: "true",
    claimMode: "just-appeared",
    touchedPiece: "false",
    repetitionCheck: "auto",
    positionsText,
    ...extra,
  });
}

function process(inc: Incident) {
  return engine.processIncident({ incident: inc, ruleset: STANDARD });
}

function qids(r: ReturnType<typeof process>) {
  return r.followUpQuestions.map((q) => q.id);
}

/** 白番で、初期局面が3回目に出現する（正しいクレーム） */
const THREEFOLD = KNIGHT_DANCE;
/** 白番で、初期局面が2回目（誤ったクレーム） */
const TWOFOLD = "1. Nf3 Nf6 2. Ng1 Ng8";
const PARTIAL_THREEFOLD = `[FEN "${ROOK_ENDING_FEN}"] 60. Ra2 Kg8 61. Ra1 Kh8 62. Ra2 Kg8 63. Ra1 Kh8`;
const PARTIAL_TWOFOLD = `[FEN "${ROOK_ENDING_FEN}"] 60. Ra2 Kg8 61. Ra1 Kh8`;

describe("DT-005 with game.history: confirmation against the board", () => {
  it("asks the arbiter to compare the final position before deciding", () => {
    const r = process(claim(THREEFOLD));
    expect(r.requiresFollowUp).toBe(true);
    expect(qids(r)).toEqual(["historyConfirmed"]);
    expect(r.decision.conclusion).toContain("初期配置から8半手");
    expect(r.decision.conclusion).toContain("4... Ng8");
    expect(r.decision.conclusion).toContain("白の手番");
    expect(r.decision.conclusion).toContain(
      `FEN: ${STANDARD_START_FEN.replace(" 0 1", " 8 5")}`
    );
    expect(r.decision.penalties).toHaveLength(0);
  });

  it("match + complete history: correct claim → draw; too few → incorrect claim", () => {
    const met = process(
      applyIncidentAnswers(claim(THREEFOLD), { historyConfirmed: "match" })
    );
    expect(met.decision.penalties[0].type).toBe("draw");
    const notMet = process(
      applyIncidentAnswers(claim(TWOFOLD), { historyConfirmed: "match" })
    );
    expect(notMet.decision.penalties[0].type).toBe("time-addition-opponent");
  });

  it("mismatch or 'cannot compare' → no automatic decision; asks for the manual check", () => {
    for (const answer of ["mismatch", "unknown"]) {
      const r = process(
        applyIncidentAnswers(claim(THREEFOLD), { historyConfirmed: answer })
      );
      expect(r.requiresFollowUp).toBe(true);
      expect(r.decision.penalties).toHaveLength(0);
      expect(qids(r)).toContain("repetitionCheck");
      expect(r.decision.conclusion).toContain("盤上で手順を再現");
    }
  });

  it("after a mismatch the arbiter's manual reconstruction decides", () => {
    const inc = applyIncidentAnswers(claim(THREEFOLD), {
      historyConfirmed: "mismatch",
    });
    const r = process(applyIncidentAnswers(inc, { repetitionCheck: "met" }));
    expect(r.decision.penalties[0].type).toBe("draw");
  });

  it("the confirmation's 'unknown' is the tree's own value, not the enumerated generic unknown", () => {
    expect(isGenericUnknownAnswer("historyConfirmed", "unknown")).toBe(false);
    expect(QUESTIONS.historyConfirmed.onUnknown).toBeUndefined();
    const inc = applyIncidentAnswers(claim(THREEFOLD), {
      historyConfirmed: "unknown",
    });
    expect(inc.unknownAnswers).toBeUndefined();
    expect(inc.drawClaimFacts?.historyConfirmed).toBe("unknown");
  });
});

describe("DT-005 with game.history: incomplete histories (ADR-014 §4)", () => {
  it("a repetition found in a history starting at a FEN decides 'met'", () => {
    const r = process(
      applyIncidentAnswers(claim(PARTIAL_THREEFOLD), {
        historyConfirmed: "match",
      })
    );
    expect(r.decision.penalties[0].type).toBe("draw");
    expect(r.decision.actions.join("\n")).toContain("途中の局面から");
  });

  it("'not met' from a history starting at a FEN is inconclusive → manual reconstruction", () => {
    const r = process(
      applyIncidentAnswers(claim(PARTIAL_TWOFOLD), {
        historyConfirmed: "match",
      })
    );
    expect(r.requiresFollowUp).toBe(true);
    expect(r.decision.penalties).toHaveLength(0);
    expect(qids(r)).toContain("repetitionCheck");
    expect(r.decision.conclusion).toContain("途中の局面から始まる棋譜");
  });

  it("move count not confirmed: 'met' is decided, 'not met' is inconclusive", () => {
    const met = process(
      applyIncidentAnswers(claim(THREEFOLD), {
        historyConfirmed: "position-only",
      })
    );
    expect(met.decision.penalties[0].type).toBe("draw");
    const notMet = process(
      applyIncidentAnswers(claim(TWOFOLD), {
        historyConfirmed: "position-only",
      })
    );
    expect(notMet.requiresFollowUp).toBe(true);
    expect(notMet.decision.penalties).toHaveLength(0);
    expect(notMet.decision.conclusion).toContain("手数を確認できない");
  });

  it("fivefold: fewer than five in an incomplete history is inconclusive", () => {
    const inc = applyIncidentAnswers(drawIncident(), {
      drawSubtype: "fivefold-repetition",
      fivefoldCheck: "auto",
      positionsText: PARTIAL_THREEFOLD,
    });
    const r = process(applyIncidentAnswers(inc, { historyConfirmed: "match" }));
    expect(r.requiresFollowUp).toBe(true);
    expect(qids(r)).toContain("fivefoldCheck");
    expect(r.decision.intervention).not.toBe("no-intervention");
  });

  it("75 moves: the start FEN's halfmove clock is not trusted", () => {
    const inc = applyIncidentAnswers(drawIncident(), {
      drawSubtype: "75-move-rule",
      seventyFiveCheck: "auto",
      positionsText: '[FEN "7k/8/8/8/8/8/8/R6K w - - 149 80"] 80. Ra2',
    });
    const r = process(applyIncidentAnswers(inc, { historyConfirmed: "match" }));
    expect(r.requiresFollowUp).toBe(true);
    expect(r.decision.penalties).toHaveLength(0);
    expect(qids(r)).toContain("seventyFiveCheck");
  });
});

describe("DT-005 with game.history: invalid input never decides", () => {
  it.each([
    [
      "a FEN list",
      "4k3/8/8/8/8/8/8/4K3 w - - 0 1\n4k3/8/8/8/8/8/8/4K3 b - - 0 1",
      "FEN",
    ],
    ["an illegal move", "1. e4 e5 2. Ke3", "Ke3"],
    ["non-standard castling", `[FEN "${CASTLE_FEN}"] 1. 0-0`, "O-O"],
    ["free text", "白がナイトを行ったり来たりした", "棋譜を検証できません"],
  ])("%s → asks again with the reason", (_label, text, reason) => {
    const r = process(claim(text));
    expect(r.requiresFollowUp).toBe(true);
    expect(r.decision.penalties).toHaveLength(0);
    expect(qids(r)).not.toContain("historyConfirmed");
    expect(r.decision.conclusion).toContain(reason);
  });
});

describe("historyConfirmed is tied to the history it was given for", () => {
  it("changing the move list clears the confirmation", () => {
    const confirmed = applyIncidentAnswers(claim(THREEFOLD), {
      historyConfirmed: "match",
    });
    expect(confirmed.drawClaimFacts?.historyConfirmed).toBe("match");
    const changed = applyIncidentAnswers(confirmed, {
      positionsText: TWOFOLD,
    });
    expect(changed.drawClaimFacts?.historyConfirmed).toBeUndefined();
    expect(qids(process(changed))).toEqual(["historyConfirmed"]);
  });

  it("re-sending the same move list keeps it", () => {
    const confirmed = applyIncidentAnswers(claim(THREEFOLD), {
      historyConfirmed: "match",
    });
    const same = applyIncidentAnswers(confirmed, {
      positionsText: ` ${THREEFOLD} `,
    });
    expect(same.drawClaimFacts?.historyConfirmed).toBe("match");
  });

  it("a new move list sent together with a confirmation does not inherit it", () => {
    const changed = applyIncidentAnswers(claim(THREEFOLD), {
      positionsText: TWOFOLD,
      historyConfirmed: "match",
    });
    expect(changed.drawClaimFacts?.historyConfirmed).toBeUndefined();
  });
});

describe("game.history is never sent externally (ADR-012)", () => {
  it("the LLM payload of an uncovered draw incident has no move list", async () => {
    const assist = vi.fn(async () => ({
      status: "error" as const,
      code: "port-error" as const,
      message: "stub",
    }));
    const llmEngine = new DecisionEngine(fixedProviders(), {
      positions: port,
      llm: { assist } satisfies LlmAssistPort,
    });
    const withHistory = claim(THREEFOLD);
    const inc = applyIncidentAnswers(
      { ...withHistory, description: "その他のドローの件" },
      { drawSubtype: "other" }
    );
    expect(inc.drawClaimFacts?.positionsText).toBe(THREEFOLD);
    await llmEngine.evaluate({ incident: inc, ruleset: STANDARD });
    expect(assist).toHaveBeenCalledTimes(1);
    const payload = JSON.stringify(assist.mock.calls[0]);
    expect(payload).not.toContain("Nf3");
    expect(payload).not.toContain("positionsText");
  });
});

// ---------------------------------------------------------------------------
// Review fixes (J1b-3)
// ---------------------------------------------------------------------------

/** analyzeRepetition 用の合成した検証済み履歴（最後の局面がメイト） */
function syntheticHistory(
  complete: boolean,
  length: number,
  clockAt: (i: number) => number
) {
  const positions = Array.from({ length }, (_, i) => ({
    key: `k${i}`,
    halfmoveClock: clockAt(i),
    fullmoveNumber: 1,
    isCheckmate: i === length - 1,
    sideToMove: (i % 2 === 0 ? "white" : "black") as "white" | "black",
    opponentInCheck: false,
  }));
  return {
    history: { moves: [] },
    complete,
    positions,
    fens: positions.map(() => "fen"),
    sans: positions.slice(1).map(() => "Ra2"),
    plies: length - 1,
  };
}

describe("J1b-3 review fixes", () => {
  it("M1: re-selecting 'auto' after a mis-tapped 'mismatch' asks the confirmation again", () => {
    const mistapped = applyIncidentAnswers(claim(THREEFOLD), {
      historyConfirmed: "mismatch",
    });
    expect(qids(process(mistapped))).toContain("repetitionCheck");
    const again = applyIncidentAnswers(mistapped, {
      repetitionCheck: "auto",
      positionsText: THREEFOLD,
    });
    expect(again.drawClaimFacts?.historyConfirmed).toBeUndefined();
    expect(qids(process(again))).toEqual(["historyConfirmed"]);
    const r = process(
      applyIncidentAnswers(again, { historyConfirmed: "match" })
    );
    expect(r.decision.penalties[0].type).toBe("draw");
  });

  it("M1: a manual check answer does not clear the confirmation", () => {
    const inc = applyIncidentAnswers(
      applyIncidentAnswers(claim(THREEFOLD), { historyConfirmed: "match" }),
      { repetitionCheck: "met" }
    );
    expect(inc.drawClaimFacts?.historyConfirmed).toBe("match");
  });

  it("M2: with claimMode unknown, the confirmation still shows the final position", () => {
    const inc = claim(THREEFOLD, {
      claimMode: "unknown",
      moveWritten: "true",
      intendedMove: "Nf3",
    });
    const r = process(inc);
    expect(qids(r)).toEqual(["historyConfirmed"]);
    expect(r.decision.conclusion).toContain("4... Ng8");
    expect(r.decision.conclusion).toContain("FEN: ");
    // 9.2.1（Nf3 の後の局面が3回目）でも 9.2.2（初期局面が3回目）でもドロー
    const decided = process(
      applyIncidentAnswers(inc, { historyConfirmed: "match" })
    );
    expect(decided.decision.penalties[0]?.type).toBe("draw");
  });

  it("S3: 75 moves reached at a checkmate without a reset in an incomplete history is uncertain", () => {
    const noReset = analyzeRepetition(
      port,
      syntheticHistory(false, 151, (i) => 20 + i)
    );
    if (!noReset.ok) throw new Error(noReset.error);
    expect(noReset.seventyFiveReachedWithCheckmate).toBe(true);
    expect(noReset.seventyFiveCheckmateUncertain).toBe(true);

    // ply 1 でリセット（ポーンの移動・駒取り）があれば、その後の値は正確
    const reset = analyzeRepetition(
      port,
      syntheticHistory(false, 152, (i) => (i === 0 ? 20 : i - 1))
    );
    if (!reset.ok) throw new Error(reset.error);
    expect(reset.seventyFiveReachedWithCheckmate).toBe(true);
    expect(reset.seventyFiveCheckmateUncertain).toBeUndefined();

    const complete = analyzeRepetition(
      port,
      syntheticHistory(true, 151, (i) => i)
    );
    if (!complete.ok) throw new Error(complete.error);
    expect(complete.seventyFiveCheckmateUncertain).toBeUndefined();
  });

  it("S4: the claimant's side-to-move mismatch is reported before the confirmation", () => {
    const r = process(claim(THREEFOLD, { claimant: "black" }));
    expect(r.requiresFollowUp).toBe(true);
    expect(qids(r)).not.toContain("historyConfirmed");
    expect(r.decision.conclusion).toContain("白の手番");
  });

  it("S4: position-only with a complete history and fewer than 150 plies is inconclusive (75 moves)", () => {
    const inc = applyIncidentAnswers(drawIncident(), {
      drawSubtype: "75-move-rule",
      seventyFiveCheck: "auto",
      positionsText: KNIGHT_DANCE,
    });
    const r = process(
      applyIncidentAnswers(inc, { historyConfirmed: "position-only" })
    );
    expect(r.requiresFollowUp).toBe(true);
    expect(qids(r)).toContain("seventyFiveCheck");
    expect(r.decision.conclusion).toContain("手数を確認できない");
  });

  it("S5: the confirmation leads with the move number; a history without moves shows the start move number", () => {
    const r = process(claim(THREEFOLD));
    expect(r.decision.conclusion).toContain("4... Ng8 まで");
    expect(r.decision.conclusion).toContain("5手目の白の手番");
    const empty = process(claim('[FEN "7k/8/8/8/8/8/8/R6K w - - 0 60"]'));
    expect(empty.decision.conclusion).toContain("指し手はありません");
    expect(empty.decision.conclusion).toContain("60手目の白の手番");
  });

  it("nit: 'position-only' is labelled as not fully confirmed in the decision", () => {
    const r = process(
      applyIncidentAnswers(claim(THREEFOLD), {
        historyConfirmed: "position-only",
      })
    );
    expect(r.decision.actions.join("\n")).toContain("局面のみ照合");
  });

  it("nit: strict mode accepts a wrong check suffix (the move is still identified)", () => {
    expect(
      validateGameHistory(port, {
        startFen: "k7/8/8/8/8/8/8/K6R w - - 0 1",
        moves: ["Rh8#"],
      }).ok
    ).toBe(true);
  });

  it("nit: the Unicode ellipsis move number is understood; 'e.p.' gets a specific hint", () => {
    expect(parse("1. e4 1…e5")).toEqual({ moves: ["e4", "e5"] });
    const ep = validate("1. e4 a6 2. e5 d5 3. exd6 e.p.");
    expect(ep.ok).toBe(false);
    if (!ep.ok) expect(ep.error).toContain("e.p.");
  });
});
