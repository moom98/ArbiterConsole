import { describe, it, expect } from "vitest";
import {
  DecisionEngine,
  type DecisionEngineContext,
  type RulesetContext,
} from "@/lib/domain/decision-engine";
import type { Incident } from "@/lib/domain/entities";
import type { PriorIllegalMove } from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";
import { applyIncidentAnswers } from "@/lib/domain/follow-up";
import { fixedProviders, FIXED_NOW } from "./helpers";
import { chessJsPositionPort as chessPort } from "@/lib/infrastructure/chess/chess-js-position-port";
import { runHelpmateSearch } from "@/lib/infrastructure/chess/helpmate/run";
import { matePositionRequest } from "@/lib/domain/services/mate-possibility";

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    gameId: "g1",
    category: "illegal-move",
    description: "白が時計を押した。黒は2回目",
    arbiterObserved: true,
    reportedBy: "arbiter",
    reportedAt: FIXED_NOW,
    status: "pending",
    escalatedToCA: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function priors(color: string, n: number): PriorIllegalMove[] {
  return Array.from({ length: n }, (_, i) => ({
    incidentId: `prior-${color}-${i}`,
    reportedAt: FIXED_NOW,
    subtype: "illegal-move" as const,
  }));
}

function hist(white: number, black: number) {
  return { white: priors("white", white), black: priors("black", black) };
}

const STANDARD: RulesetContext = {
  competitionType: "standard",
  rulesVersion: "FIDE-2023",
};

const fullFacts: Partial<Incident> = {
  playerColor: "white",
  illegalMoveFacts: {
    subtype: "illegal-move",
    endEvent: "in-progress",
    clockPressed: true,
  },
};

function run(ctx: Partial<DecisionEngineContext>) {
  return new DecisionEngine(fixedProviders()).processIncident({
    incident: incident(),
    ...ctx,
  });
}

describe("DecisionEngine", () => {
  describe("explicit ruleset is required", () => {
    it("returns context-required when no ruleset is given (never defaults to standard)", () => {
      const r = run({
        incident: incident(fullFacts),
        illegalMoveHistory: hist(0, 0),
      });
      expect(r.requiresFollowUp).toBe(true);
      expect(r.decision.kind).toBe("context-required");
      expect(r.decision.penalties).toHaveLength(0);
      expect(r.followUpQuestions.map((q) => q.id)).toEqual(["competitionType"]);
      expect(r.followUpQuestions[0].scope).toBe("game-context");
    });

    it("requires a rules version", () => {
      const r = run({
        incident: incident(fullFacts),
        ruleset: { competitionType: "standard" },
        illegalMoveHistory: hist(0, 0),
      });
      expect(r.decision.kind).toBe("context-required");
      expect(r.decision.missingFields).toContain("規則バージョン");
    });

    it.each(["rapid", "blitz"] as const)(
      "requires the supervision regime for %s",
      (competitionType) => {
        const r = run({
          ruleset: { competitionType, rulesVersion: "FIDE-2023" },
        });
        expect(r.decision.kind).toBe("context-required");
        expect(r.followUpQuestions.map((q) => q.id)).toEqual([
          "supervisionRegime",
        ]);
      }
    );

    it("rejects an unsupported rules version", () => {
      const r = run({
        incident: incident(fullFacts),
        ruleset: { competitionType: "standard", rulesVersion: "FIDE-2018" },
        illegalMoveHistory: hist(0, 0),
      });
      expect(r.requiresFollowUp).toBe(false);
      expect(r.decision.kind).toBe("not-supported");
      expect(r.decision.penalties).toHaveLength(0);
      expect(r.decision.escalationRecommended).toBe(true);
    });
  });

  describe("rapid / blitz routing", () => {
    it.each([
      [
        "rapid",
        "competition-rules",
        "DT-002-illegal-move-fast-competition",
        "FIDE A.4",
        60,
      ],
      [
        "rapid",
        "basic-rules",
        "DT-003-illegal-move-fast-basic",
        "FIDE A.5.2",
        60,
      ],
      [
        "blitz",
        "competition-rules",
        "DT-002-illegal-move-fast-competition",
        "FIDE B.2",
        undefined,
      ],
      [
        "blitz",
        "basic-rules",
        "DT-003-illegal-move-fast-basic",
        "FIDE B.3",
        60,
      ],
    ] as const)(
      "%s / %s → %s (cites %s), never the standard tree",
      (competitionType, supervisionRegime, treeId, article, seconds) => {
        const r = run({
          incident: incident({
            ...fullFacts,
            illegalMoveFacts: {
              ...fullFacts.illegalMoveFacts,
              opponentMadeNextMove: false,
              detectedBy: "arbiter",
            },
          }),
          ruleset: {
            competitionType,
            supervisionRegime,
            rulesVersion: "FIDE-2023",
          },
          illegalMoveHistory: hist(0, 0),
        });
        expect(r.requiresFollowUp).toBe(false);
        expect(r.decision.treeId).toBe(treeId);
        expect(r.decision.sources[0].article).toBe(article);
        expect(r.decision.penalties[0].type).toBe("time-addition-opponent");
        expect(r.decision.penalties[0].timeAdjustmentSeconds).toBe(seconds);
        expect(r.decision.penalties[0].timeAdjustmentSeconds).not.toBe(120);
      }
    );

    it("A.5 asks the opponent-moved and detection questions together with the basic facts", () => {
      const r = run({
        ruleset: {
          competitionType: "rapid",
          supervisionRegime: "basic-rules",
          rulesVersion: "FIDE-2023",
        },
        illegalMoveHistory: hist(0, 0),
      });
      expect(r.followUpQuestions.map((q) => q.id)).toEqual([
        "playerColor",
        "subtype",
        "gameEndEvent",
        "gameRecordState",
        "clockPressed",
        "opponentMadeNextMove",
        "detectedBy",
      ]);
    });

    it("A.4 does not ask whether the opponent has moved", () => {
      const r = run({
        ruleset: {
          competitionType: "rapid",
          supervisionRegime: "competition-rules",
          rulesVersion: "FIDE-2023",
        },
        illegalMoveHistory: hist(0, 0),
      });
      expect(r.followUpQuestions.map((q) => q.id)).not.toContain(
        "opponentMadeNextMove"
      );
    });
  });

  describe("routing (clock-time / draw)", () => {
    it("clock-time asks for the subtype, then routes flag-fall to DT-004", () => {
      const first = run({
        incident: incident({ category: "clock-time" }),
        ruleset: STANDARD,
      });
      expect(first.requiresFollowUp).toBe(true);
      expect(first.followUpQuestions.map((q) => q.id)).toEqual([
        "clockTimeSubtype",
      ]);
      const answered = applyIncidentAnswers(
        incident({ category: "clock-time" }),
        {
          clockTimeSubtype: "flag-fall",
        }
      );
      const second = run({ incident: answered, ruleset: STANDARD });
      expect(second.decision.treeId).toBe("DT-004-flag-fall");
      expect(second.followUpQuestions.map((q) => q.id)).toContain("flagFallen");
    });

    it("draw asks for the subtype, then routes claims to DT-005 and automatic draws to DT-006 (ADR-014 §1)", () => {
      const first = run({
        incident: incident({ category: "draw" }),
        ruleset: STANDARD,
      });
      expect(first.followUpQuestions.map((q) => q.id)).toEqual(["drawSubtype"]);
      const treeFor = (drawSubtype: string) =>
        run({
          incident: applyIncidentAnswers(incident({ category: "draw" }), {
            drawSubtype,
          }),
          ruleset: STANDARD,
        }).decision.treeId;
      expect(treeFor("threefold-repetition-claim")).toBe("DT-005-repetition");
      expect(treeFor("fifty-move-claim")).toBe("DT-005-repetition");
      expect(treeFor("fivefold-repetition")).toBe("DT-006-automatic-draw");
      expect(treeFor("75-move-rule")).toBe("DT-006-automatic-draw");
    });

    it.each(["agreement", "stalemate", "dead-position", "other"])(
      "draw subtype %s has no Decision Tree (asks for a situation note)",
      (drawSubtype) => {
        const r = run({
          incident: applyIncidentAnswers(
            incident({ category: "draw", description: "" }),
            { drawSubtype }
          ),
          ruleset: STANDARD,
        });
        expect(r.decision.treeId).toBeUndefined();
        expect(r.followUpQuestions.map((q) => q.id)).toEqual(["situationNote"]);
      }
    );

    it("M2: 'other' without a note asks for a required situation note", () => {
      const r = run({
        incident: incident({
          category: "draw",
          subtype: "other",
          description: "",
        }),
        ruleset: STANDARD,
      });
      expect(r.requiresFollowUp).toBe(true);
      expect(r.followUpQuestions.map((q) => q.id)).toEqual(["situationNote"]);
      expect(r.followUpQuestions[0].optional).toBeFalsy();
      const answered = applyIncidentAnswers(
        incident({ category: "draw", subtype: "other", description: "" }),
        { situationNote: "合意ドローの手順に疑義" }
      );
      expect(answered.description).toBe("合意ドローの手順に疑義");
      expect(run({ incident: answered, ruleset: STANDARD }).decision.kind).toBe(
        "manual-review"
      );
    });

    it("draw 'other' and other clock problems go to manual review", () => {
      for (const inc of [
        incident({ category: "draw", subtype: "other" }),
        incident({ category: "clock-time", subtype: "other" }),
        incident({ category: "player-behavior" }),
      ]) {
        const r = run({ incident: inc, ruleset: STANDARD });
        expect(r.decision.kind).toBe("manual-review");
        expect(r.decision.intervention).toBe("consult-ca");
      }
    });

    it("flag fall still requires an explicit ruleset", () => {
      const r = run({ incident: incident({ category: "clock-time" }) });
      expect(r.decision.kind).toBe("context-required");
    });
  });

  describe("routing (standard)", () => {
    it("routes illegal-move to DT-001 using structured facts", () => {
      const r = run({
        incident: incident(fullFacts),
        ruleset: STANDARD,
        illegalMoveHistory: hist(0, 1),
      });
      expect(r.requiresFollowUp).toBe(false);
      expect(r.decision.treeId).toBe("DT-001-illegal-move-standard");
      expect(r.decision.incidentId).toBe("inc-1");
      expect(r.decision.rulesVersion).toBe("FIDE-2023");
      expect(r.decision.penalties[0].type).toBe("time-addition-opponent");
    });

    it("uses the history of the offending colour only", () => {
      const r = run({
        incident: incident({ ...fullFacts, playerColor: "black" }),
        ruleset: STANDARD,
        illegalMoveHistory: hist(1, 0),
      });
      expect(r.decision.penalties[0].type).toBe("time-addition-opponent");
      expect(r.decision.penalties[0].playerColor).toBe("white");
    });

    it("does not parse the free-text description to decide anything", () => {
      // 説明文に「白」「時計を押した」とあっても、構造化回答がなければ質問する
      const r = run({
        ruleset: STANDARD,
        illegalMoveHistory: hist(0, 0),
      });
      expect(r.requiresFollowUp).toBe(true);
      expect(r.followUpQuestions.map((q) => q.id)).toEqual([
        "playerColor",
        "subtype",
        "gameEndEvent",
        "gameRecordState",
        "clockPressed",
      ]);
      expect(r.decision.escalationRecommended).toBe(false);
    });

    it("re-evaluates the same incident after follow-up answers", () => {
      const engine = new DecisionEngine(fixedProviders(), {
        positions: chessPort,
      });
      let inc = incident();
      const first = engine.processIncident({
        incident: inc,
        ruleset: STANDARD,
        illegalMoveHistory: hist(1, 0),
      });
      expect(first.requiresFollowUp).toBe(true);

      inc = applyIncidentAnswers(inc, {
        playerColor: "white",
        subtype: "two-hands",
        gameEndEvent: "in-progress",
        clockPressed: "true",
      });
      const second = engine.processIncident({
        incident: inc,
        ruleset: STANDARD,
        illegalMoveHistory: hist(1, 0),
      });
      expect(second.followUpQuestions.map((q) => q.id)).toEqual([
        "matePosition",
        "reinstatedFen",
      ]);

      // 違法手の直前に戻した局面（白の手番）。黒は K+Q
      inc = applyIncidentAnswers(inc, {
        matePosition: "fen",
        reinstatedFen: "6k1/8/8/8/8/8/5q2/6K1 w - - 0 40",
      });
      // 探索前: 手順がないので結論は出ない（駒数からメイト可能とはしない）
      const unsearched = engine.processIncident({
        incident: inc,
        ruleset: STANDARD,
        illegalMoveHistory: hist(1, 0),
      });
      expect(unsearched.decision.kind).toBe("manual-review");
      expect(unsearched.decision.penalties).toHaveLength(0);

      inc = {
        ...inc,
        mateSearch: runHelpmateSearch(matePositionRequest(inc)!),
      };
      const third = engine.processIncident({
        incident: inc,
        ruleset: STANDARD,
        illegalMoveHistory: hist(1, 0),
      });
      expect(third.requiresFollowUp).toBe(false);
      expect(third.decision.incidentId).toBe("inc-1");
      expect(third.decision.penalties[0].type).toBe("game-loss");
      expect(third.decision.conclusion).toContain("40. ");
    });

    it("a reinstated position with the wrong side to move is asked again", () => {
      const engine = new DecisionEngine(fixedProviders(), {
        positions: chessPort,
      });
      const inc = applyIncidentAnswers(incident(fullFacts), {
        matePosition: "fen",
        reinstatedFen: "6k1/8/8/8/8/8/5q2/6K1 b - - 0 40",
      });
      const r = engine.processIncident({
        incident: inc,
        ruleset: STANDARD,
        illegalMoveHistory: hist(1, 0),
      });
      expect(r.requiresFollowUp).toBe(true);
      expect(r.decision.conclusion).toContain("手番");
    });

    it("missing history escalates instead of assuming zero", () => {
      const r = run({ incident: incident(fullFacts), ruleset: STANDARD });
      expect(r.decision.kind).toBe("manual-review");
      expect(r.decision.penalties).toHaveLength(0);
    });

    it("routes other categories to manual review", () => {
      const r = run({
        incident: incident({ category: "scoresheet" }),
        ruleset: STANDARD,
      });
      expect(r.decision.kind).toBe("manual-review");
      expect(r.decision.intervention).toBe("consult-ca");
    });
  });
});

describe("applyIncidentAnswers", () => {
  it("ignores invalid values and keeps existing facts", () => {
    const inc = applyIncidentAnswers(
      incident({ illegalMoveFacts: { endEvent: "in-progress" } }),
      { playerColor: "green", clockPressed: "maybe", subtype: "bogus" }
    );
    expect(inc.playerColor).toBeUndefined();
    expect(inc.illegalMoveFacts).toEqual({ endEvent: "in-progress" });
  });

  it("stores the reinstated position and ignores an unknown input method", () => {
    const inc = applyIncidentAnswers(incident(), {
      matePosition: "maybe",
      reinstatedFen: "  8/8/8/8/8/8/8/K6k w - - 0 1 ",
    });
    expect(inc.illegalMoveFacts?.matePosition).toBeUndefined();
    expect(inc.illegalMoveFacts?.positionFen).toBe(
      "8/8/8/8/8/8/8/K6k w - - 0 1"
    );
  });
});

describe("applyIncidentAnswers (M4 questions)", () => {
  it("stores the flag-fall position (no material counts any more)", () => {
    const inc = applyIncidentAnswers(
      incident({ category: "clock-time", subtype: "flag-fall" }),
      {
        flagFallen: "black",
        endedBeforeFlag: "none",
        movesNotCompleted: "true",
        matePosition: "fen",
        positionFen: "  ",
      }
    );
    expect(inc.playerColor).toBe("black");
    expect(inc.flagFallFacts?.flagFallen).toBe("black");
    expect(inc.flagFallFacts?.matePosition).toBe("fen");
    expect(inc.flagFallFacts?.fen).toBeUndefined();
    expect(inc.illegalMoveFacts).toBeUndefined();
  });

  it("stores draw-claim answers and the subtype", () => {
    const inc = applyIncidentAnswers(incident({ category: "draw" }), {
      drawSubtype: "threefold-repetition-claim",
      claimant: "white",
      claimMode: "about-to-appear",
      repetitionCheck: "auto",
      positionsText: " 1. Nf3 Nf6 ",
      intendedMove: "",
    });
    expect(inc.subtype).toBe("threefold-repetition-claim");
    expect(inc.drawClaimFacts).toEqual({
      subtype: "threefold-repetition-claim",
      claimant: "white",
      claimMode: "about-to-appear",
      conditionCheck: "auto",
      positionsText: "1. Nf3 Nf6",
      intendedMove: undefined,
    });
  });

  it("stores A.5.2 answers on illegal-move facts", () => {
    const inc = applyIncidentAnswers(incident(), {
      opponentMadeNextMove: "true",
      detectedBy: "opponent-claim",
    });
    expect(inc.illegalMoveFacts).toEqual({
      opponentMadeNextMove: true,
      detectedBy: "opponent-claim",
    });
  });
});

describe("DecisionEngine — DT-005 automatic repetition check via injected port", () => {
  it("analyses the move list with the port and draws on a correct claim", async () => {
    const { chessJsPositionPort } =
      await import("@/lib/infrastructure/chess/chess-js-position-port");
    const engine = new DecisionEngine(fixedProviders(), {
      positions: chessJsPositionPort,
    });
    const inc = applyIncidentAnswers(incident({ category: "draw" }), {
      drawSubtype: "threefold-repetition-claim",
      claimant: "black",
      lastMover: "white",
      claimMode: "about-to-appear",
      touchedPiece: "false",
      moveWritten: "true",
      repetitionCheck: "auto",
      positionsText: "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1",
      intendedMove: "Ng8",
    });
    // 再生した最終局面を盤上と照合してもらう（ADR-014 §4）
    const ask = engine.processIncident({ incident: inc, ruleset: STANDARD });
    expect(ask.requiresFollowUp).toBe(true);
    expect(ask.followUpQuestions.map((q) => q.id)).toEqual([
      "historyConfirmed",
    ]);
    expect(ask.decision.conclusion).toContain("初期配置から7半手");
    expect(ask.decision.conclusion).toContain("4. Ng1");
    expect(ask.decision.conclusion).toContain("黒の手番");
    expect(ask.decision.penalties).toHaveLength(0);

    const confirmed = applyIncidentAnswers(inc, { historyConfirmed: "match" });
    const r = engine.processIncident({
      incident: confirmed,
      ruleset: STANDARD,
    });
    expect(r.decision.treeId).toBe("DT-005-repetition");
    expect(r.decision.penalties[0].type).toBe("draw");
  });

  it("B1 regression: 9.2.1 auto check with a blank intended move is a follow-up, not a penalty", async () => {
    const { chessJsPositionPort } =
      await import("@/lib/infrastructure/chess/chess-js-position-port");
    const engine = new DecisionEngine(fixedProviders(), {
      positions: chessJsPositionPort,
    });
    const inc = applyIncidentAnswers(incident({ category: "draw" }), {
      drawSubtype: "threefold-repetition-claim",
      claimant: "black",
      lastMover: "white",
      claimMode: "about-to-appear",
      touchedPiece: "false",
      moveWritten: "true",
      repetitionCheck: "auto",
      positionsText: "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1",
      intendedMove: "",
    });
    const r = engine.processIncident({ incident: inc, ruleset: STANDARD });
    expect(r.requiresFollowUp).toBe(true);
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.followUpQuestions.map((q) => q.id)).toContain("intendedMove");
  });

  it("without a port, the automatic check is reported as unavailable", () => {
    const inc = applyIncidentAnswers(incident({ category: "draw" }), {
      drawSubtype: "fivefold-repetition",
      fivefoldCheck: "auto",
      positionsText: "1. Nf3 Nf6",
    });
    const r = run({ incident: inc, ruleset: STANDARD });
    expect(r.requiresFollowUp).toBe(true);
    expect(r.decision.conclusion).toContain("利用できません");
  });
});
