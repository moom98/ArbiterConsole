import { describe, it, expect } from "vitest";
import {
  DecisionEngine,
  type RulesetContext,
} from "@/lib/domain/decision-engine";
import type { Incident } from "@/lib/domain/entities";
import { applyIncidentAnswers, QUESTIONS } from "@/lib/domain/follow-up";
import { chessJsPositionPort as port } from "@/lib/infrastructure/chess/chess-js-position-port";
import { fixedProviders, FIXED_NOW } from "./helpers";

/**
 * DT-005 Draw Claim（50手 9.3）と DT-006 Automatic Draw を、chess.js の ChessPositionPort
 * を通して判定する（ADR-014 §1 / §4）。
 */

const STANDARD: RulesetContext = {
  competitionType: "standard",
  rulesVersion: "FIDE-2023",
};

const engine = new DecisionEngine(fixedProviders(), { positions: port });

function drawIncident(): Incident {
  return {
    id: "inc-d",
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

/** ルークの終盤（ポーンなし）。ここからポーンの移動・駒取り・同一局面のない100半手 */
const ROOK_FEN = "4k3/r7/8/8/8/8/R7/4K3 w - - 0 1";
const QUIET_PLIES = [
  "Ra3",
  "Kf8",
  "Ra4",
  "Kg8",
  "Ra5",
  "Kh8",
  "Ra6",
  "Kh7",
  "Rb6",
  "Ra8",
  "Rb8",
  "Ra7",
  "Rc8",
  "Ra8",
  "Rd8",
  "Rb8",
  "Re8",
  "Rc8",
  "Rf8",
  "Rd8",
  "Rg8",
  "Rf8",
  "Rg6",
  "Rg8",
  "Rg5",
  "Rh8",
  "Rg6",
  "Rf8",
  "Rg8",
  "Rf7",
  "Rg6",
  "Rg7",
  "Rg5",
  "Rg8",
  "Rg6",
  "Rh8",
  "Rg8",
  "Kh6",
  "Rg7",
  "Rh7",
  "Rg8",
  "Rg7",
  "Rf8",
  "Rg8",
  "Rf7",
  "Rh8",
  "Rf8",
  "Rh7",
  "Rh8",
  "Kg7",
  "Rf8",
  "Kg6",
  "Rh8",
  "Rh6",
  "Rh7",
  "Kh5",
  "Rh8",
  "Rh7",
  "Rg8",
  "Rh8",
  "Rg7",
  "Rh7",
  "Rg6",
  "Rh8",
  "Rg8",
  "Rh7",
  "Rh8",
  "Rh6",
  "Rh7",
  "Kg6",
  "Rh8",
  "Kf7",
  "Rg8",
  "Kf6",
  "Rh8",
  "Ke7",
  "Rg8",
  "Kf7",
  "Rh8",
  "Kg7",
  "Rf8",
  "Kh7",
  "Rg8",
  "Rh5",
  "Rg6",
  "Kh8",
  "Rg7",
  "Rh6",
  "Rg6",
  "Kh7",
  "Rg5",
  "Kh8",
  "Rg7",
  "Rh7",
  "Rg6",
  "Rh6",
  "Rg5",
  "Kh7",
  "Rg6",
  "Rh5",
];

/** 白番から始まる SAN 列を手数付きの棋譜にする */
function pgn(sans: string[]): string {
  const parts: string[] = [];
  sans.forEach((san, i) => {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`);
    parts.push(san);
  });
  return `[FEN "${ROOK_FEN}"] ${parts.join(" ")}`;
}

function fiftyClaim(answers: Record<string, string>): Incident {
  return applyIncidentAnswers(drawIncident(), {
    drawSubtype: "fifty-move-claim",
    claimMode: "just-appeared",
    touchedPiece: "false",
    fiftyMoveCheck: "auto",
    ...answers,
  });
}

function process(inc: Incident) {
  return engine.processIncident({ incident: inc, ruleset: STANDARD });
}

function confirmAndProcess(inc: Incident) {
  const ask = process(inc);
  expect(ask.followUpQuestions.map((q) => q.id)).toEqual(["historyConfirmed"]);
  return process(applyIncidentAnswers(inc, { historyConfirmed: "match" }));
}

describe("DT-005 50-move claim with game.history (9.3, ADR-014 §4)", () => {
  it("fixture: 100 quiet plies", () => {
    expect(QUIET_PLIES).toHaveLength(100);
  });

  it("9.3.2: 50 moves each without pawn move or capture → draw (counted inside the history)", () => {
    const r = confirmAndProcess(
      fiftyClaim({
        claimant: "white",
        lastMover: "black",
        positionsText: pgn(QUIET_PLIES),
      })
    );
    expect(r.decision.treeId).toBe("DT-005-repetition");
    expect(r.decision.penalties[0]).toEqual(
      expect.objectContaining({
        type: "draw",
        description: "ドロー（50手ルール）",
      })
    );
    expect(r.decision.actions.join("\n")).toContain("対象局面 100半手");
    expect(r.decision.escalationRecommended).toBe(false);
  });

  it("9.3.1: the written move completes the 50 moves → draw", () => {
    const r = confirmAndProcess(
      fiftyClaim({
        claimant: "black",
        lastMover: "white",
        claimMode: "about-to-appear",
        moveWritten: "true",
        positionsText: pgn(QUIET_PLIES.slice(0, 99)),
        intendedMove: "Rh5",
      })
    );
    expect(r.decision.penalties[0].type).toBe("draw");
  });

  it("9.3.1: a written pawn-free but illegal move is reported, not decided", () => {
    const r = process(
      fiftyClaim({
        claimant: "black",
        lastMover: "white",
        claimMode: "about-to-appear",
        moveWritten: "true",
        positionsText: pgn(QUIET_PLIES.slice(0, 99)),
        intendedMove: "Ra1",
      })
    );
    expect(r.requiresFollowUp).toBe(true);
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.conclusion).toContain("Ra1");
  });

  it("99 counted plies from a FEN: not decidable from the history → manual reconstruction", () => {
    const r = confirmAndProcess(
      fiftyClaim({
        claimant: "black",
        lastMover: "white",
        positionsText: pgn(QUIET_PLIES.slice(0, 99)),
      })
    );
    expect(r.requiresFollowUp).toBe(true);
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.followUpQuestions.map((q) => q.id)).toContain("fiftyMoveCheck");
    expect(r.decision.conclusion).toContain("途中の局面");
  });

  it("the history says the opponent is to move, contradicting the last-mover answer → no decision", () => {
    const r = process(
      fiftyClaim({
        claimant: "white",
        lastMover: "black",
        positionsText: pgn(QUIET_PLIES.slice(0, 99)),
      })
    );
    expect(r.requiresFollowUp).toBe(true);
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.followUpQuestions.map((q) => q.id)).toContain("lastMover");
  });
});

describe("Draw answers (J1b-5)", () => {
  it("lastMover is stored as the observed color; there is no clock-based question", () => {
    const inc = fiftyClaim({ lastMover: "black" });
    expect(inc.drawClaimFacts?.lastMover).toBe("black");
    expect(
      (QUESTIONS as Record<string, unknown>).claimantHasMove
    ).toBeUndefined();
  });

  it("'met-checkmate' is accepted only for the 75-move check", () => {
    const seventyFive = applyIncidentAnswers(drawIncident(), {
      drawSubtype: "75-move-rule",
      seventyFiveCheck: "met-checkmate",
    });
    expect(seventyFive.drawClaimFacts?.conditionCheck).toBe("met-checkmate");
    const fifty = applyIncidentAnswers(drawIncident(), {
      drawSubtype: "fifty-move-claim",
      fiftyMoveCheck: "met-checkmate",
    });
    expect(fifty.drawClaimFacts?.conditionCheck).toBeUndefined();
  });

  it("changing the draw kind clears the previous check and confirmation", () => {
    const threefold = applyIncidentAnswers(drawIncident(), {
      drawSubtype: "threefold-repetition-claim",
      repetitionCheck: "met",
    });
    expect(threefold.drawClaimFacts?.conditionCheck).toBe("met");
    const changed = applyIncidentAnswers(threefold, {
      drawSubtype: "fivefold-repetition",
    });
    expect(changed.drawClaimFacts?.conditionCheck).toBeUndefined();
    // 同じ送信で新しい種類の確認結果が届いた場合は、それを使う（回答の順序に依存しない）
    const both = applyIncidentAnswers(threefold, {
      fivefoldCheck: "not-met",
      drawSubtype: "fivefold-repetition",
    });
    expect(both.drawClaimFacts?.conditionCheck).toBe("not-met");
    const r = process(changed);
    expect(r.decision.treeId).toBe("DT-006-automatic-draw");
    expect(r.followUpQuestions.map((q) => q.id)).toEqual([
      "fivefoldCheck",
      "positionsText",
    ]);
  });

  it("re-selecting 判定する on the 50-move check restarts the board confirmation", () => {
    const inc = applyIncidentAnswers(
      fiftyClaim({
        claimant: "white",
        lastMover: "black",
        positionsText: pgn(QUIET_PLIES),
      }),
      { historyConfirmed: "mismatch" }
    );
    expect(inc.drawClaimFacts?.historyConfirmed).toBe("mismatch");
    const again = applyIncidentAnswers(inc, { fiftyMoveCheck: "auto" });
    expect(again.drawClaimFacts?.historyConfirmed).toBeUndefined();
  });

  it("M1: a legacy 'わからない' to the old checkmate question is never a draw; a new answer replaces it", () => {
    const legacy: Incident = {
      ...drawIncident(),
      subtype: "75-move-rule",
      drawClaimFacts: { subtype: "75-move-rule", conditionCheck: "met" },
      unknownAnswers: ["lastMoveCheckmate"],
    };
    const r = process(legacy);
    expect(r.requiresFollowUp).toBe(true);
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.followUpQuestions.map((q) => q.id)).toContain("seventyFiveCheck");
    const answered = applyIncidentAnswers(legacy, { seventyFiveCheck: "met" });
    expect(answered.unknownAnswers).toBeUndefined();
    expect(answered.drawClaimFacts?.lastMoveCheckmate).toBe(false);
    expect(process(answered).decision.penalties[0].type).toBe("draw");
  });

  it("75-move rule via the engine: checkmate is part of the reconstruction result", () => {
    const r = process(
      applyIncidentAnswers(drawIncident(), {
        drawSubtype: "75-move-rule",
        seventyFiveCheck: "met-checkmate",
      })
    );
    expect(r.decision.treeId).toBe("DT-006-automatic-draw");
    expect(r.decision.penalties).toHaveLength(0);
  });
});
