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
    gameEnded: false,
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

  describe("rapid / blitz", () => {
    it.each([
      ["rapid", "competition-rules", "FIDE A.4"],
      ["rapid", "basic-rules", "FIDE A.5.2"],
      ["blitz", "competition-rules", "FIDE B.2"],
      ["blitz", "basic-rules", "FIDE B.3"],
    ] as const)(
      "%s / %s → not supported, consult CA, cites %s, never applies the standard tree",
      (competitionType, supervisionRegime, article) => {
        const r = run({
          incident: incident(fullFacts),
          ruleset: {
            competitionType,
            supervisionRegime,
            rulesVersion: "FIDE-2023",
          },
          illegalMoveHistory: hist(1, 0),
        });
        expect(r.requiresFollowUp).toBe(false);
        expect(r.decision.kind).toBe("not-supported");
        expect(r.decision.intervention).toBe("consult-ca");
        expect(r.decision.penalties).toHaveLength(0);
        expect(r.decision.treeId).toBeUndefined();
        expect(r.decision.sources[0].article).toBe(article);
      }
    );
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
        "gameEnded",
        "clockPressed",
      ]);
      expect(r.decision.escalationRecommended).toBe(false);
    });

    it("re-evaluates the same incident after follow-up answers", () => {
      const engine = new DecisionEngine(fixedProviders());
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
        gameEnded: "false",
        clockPressed: "true",
      });
      const second = engine.processIncident({
        incident: inc,
        ruleset: STANDARD,
        illegalMoveHistory: hist(1, 0),
      });
      expect(second.followUpQuestions.map((q) => q.id)).toEqual([
        "opponentCanCheckmate",
      ]);

      inc = applyIncidentAnswers(inc, { opponentCanCheckmate: "true" });
      const third = engine.processIncident({
        incident: inc,
        ruleset: STANDARD,
        illegalMoveHistory: hist(1, 0),
      });
      expect(third.requiresFollowUp).toBe(false);
      expect(third.decision.incidentId).toBe("inc-1");
      expect(third.decision.penalties[0].type).toBe("game-loss");
    });

    it("missing history escalates instead of assuming zero", () => {
      const r = run({ incident: incident(fullFacts), ruleset: STANDARD });
      expect(r.decision.kind).toBe("manual-review");
      expect(r.decision.penalties).toHaveLength(0);
    });

    it("routes other categories to manual review", () => {
      const r = run({
        incident: incident({ category: "clock-time" }),
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
      incident({ illegalMoveFacts: { gameEnded: false } }),
      { playerColor: "green", clockPressed: "maybe", subtype: "bogus" }
    );
    expect(inc.playerColor).toBeUndefined();
    expect(inc.illegalMoveFacts).toEqual({ gameEnded: false });
  });

  it("maps an unrecognised checkmate answer to unknown", () => {
    const inc = applyIncidentAnswers(incident(), { opponentCanCheckmate: "?" });
    expect(inc.illegalMoveFacts?.opponentCanCheckmate).toBe("unknown");
  });
});
