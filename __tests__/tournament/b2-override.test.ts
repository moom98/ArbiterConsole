import { describe, it, expect } from "vitest";
import {
  DecisionEngine,
  type RulesetContext,
} from "@/lib/domain/decision-engine";
import type { Incident } from "@/lib/domain/entities";
import {
  DrawClaimTree,
  type DrawClaimInput,
} from "@/lib/domain/decision-trees/dt-005-draw-claim";
import { opponentTimePenalty } from "@/lib/domain/rules/time-penalty";
import { fixedProviders, FIXED_NOW } from "../helpers";
import { B2_OVERRIDE } from "./fixtures";

const OVERRIDES = { blitzCompetitionTimePenaltySeconds: B2_OVERRIDE };

const BLITZ_B2: RulesetContext = {
  competitionType: "blitz",
  supervisionRegime: "competition-rules",
  rulesVersion: "FIDE-2023",
};

function illegalMove(): Incident {
  return {
    id: "inc-1",
    gameId: "g1",
    category: "illegal-move",
    description: "",
    arbiterObserved: true,
    reportedBy: "arbiter",
    reportedAt: FIXED_NOW,
    status: "pending",
    escalatedToCA: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    playerColor: "white",
    illegalMoveFacts: {
      subtype: "illegal-move",
      endEvent: "in-progress",
      clockPressed: true,
    },
  };
}

function run(ruleset: RulesetContext, incident: Incident = illegalMove()) {
  return new DecisionEngine(fixedProviders()).processIncident({
    incident,
    ruleset,
    illegalMoveHistory: { white: [], black: [] },
  });
}

describe("opponentTimePenalty with tournament overrides (ADR-006)", () => {
  it("uses the tournament amount for Blitz B.2 with the regulation as source", () => {
    const rule = opponentTimePenalty("blitz", "competition-rules", OVERRIDES);
    expect(rule.kind).toBe("tournament");
    if (rule.kind !== "tournament") return;
    expect(rule.seconds).toBe(120);
    expect(rule.citation).toMatchObject({
      article: "大会規定 第5条",
      source: "tournament",
      edition: "第1回テストブリッツ大会要項",
    });
  });

  it("ignores the override outside Blitz B.2 (Rapid / Blitz B.3 / Standard)", () => {
    expect(
      opponentTimePenalty("rapid", "competition-rules", OVERRIDES)
    ).toMatchObject({
      kind: "fixed",
      seconds: 60,
    });
    expect(
      opponentTimePenalty("blitz", "basic-rules", OVERRIDES)
    ).toMatchObject({
      kind: "fixed",
      seconds: 60,
    });
    expect(opponentTimePenalty("standard", undefined, OVERRIDES)).toMatchObject(
      {
        kind: "fixed",
        seconds: 120,
      }
    );
  });

  it("ignores an override without a source document", () => {
    const rule = opponentTimePenalty("blitz", "competition-rules", {
      blitzCompetitionTimePenaltySeconds: {
        value: 60,
        source: { document: " " },
      },
    });
    expect(rule.kind).toBe("unverified");
  });
});

describe("DT-002 Blitz B.2 first illegal move with a tournament override", () => {
  it("applies the tournament amount, cites the tournament regulation first and does not escalate", () => {
    const r = run({ ...BLITZ_B2, tournamentOverrides: OVERRIDES });
    const d = r.decision;
    expect(d.treeId).toBe("DT-002-illegal-move-fast-competition");
    expect(d.penalties[0]).toMatchObject({
      type: "time-addition-opponent",
      playerColor: "black",
      timeAdjustmentSeconds: 120,
    });
    expect(d.conclusion).toContain(
      "大会規定: 2分（出典: 大会規定 第5条 / 第1回テストブリッツ大会要項）"
    );
    expect(d.conclusion).not.toContain("要確認");
    expect(d.sources[0]).toMatchObject({ source: "tournament" });
    expect(d.sources.map((s) => s.article)).toContain("FIDE B.2");
    expect(d.escalationRecommended).toBe(false);
    expect(d.confidence).toBe("high");
  });

  it("uses a different tournament amount (1 minute)", () => {
    const r = run({
      ...BLITZ_B2,
      tournamentOverrides: {
        blitzCompetitionTimePenaltySeconds: { ...B2_OVERRIDE, value: 60 },
      },
    });
    expect(r.decision.penalties[0].timeAdjustmentSeconds).toBe(60);
    expect(r.decision.conclusion).toContain("大会規定: 1分");
  });

  it("keeps the current behaviour without an override (2分・要確認, not applied)", () => {
    const r = run(BLITZ_B2);
    expect(r.decision.penalties[0].timeAdjustmentSeconds).toBeUndefined();
    expect(r.decision.conclusion).toContain("2分（文言上の解釈・要確認）");
    expect(r.decision.escalationRecommended).toBe(true);
    expect(r.decision.sources.some((s) => s.source === "tournament")).toBe(
      false
    );
  });

  it("Blitz B.3 ignores the override (1 minute, A.3)", () => {
    const base = illegalMove();
    const r = run(
      {
        ...BLITZ_B2,
        supervisionRegime: "basic-rules",
        tournamentOverrides: OVERRIDES,
      },
      {
        ...base,
        illegalMoveFacts: {
          ...base.illegalMoveFacts!,
          opponentMadeNextMove: false,
          detectedBy: "arbiter",
        },
      }
    );
    expect(r.requiresFollowUp).toBe(false);
    expect(r.decision.penalties[0].timeAdjustmentSeconds).toBe(60);
    expect(r.decision.sources.some((s) => s.source === "tournament")).toBe(
      false
    );
  });
});

describe("DT-005 incorrect threefold claim in Blitz B.2 with a tournament override", () => {
  const CLAIM: Partial<DrawClaimInput> = {
    subtype: "threefold-repetition-claim",
    competitionType: "blitz",
    supervisionRegime: "competition-rules",
    claimant: "white",
    lastMover: "black",
    claimMode: "just-appeared",
    touchedPiece: false,
    conditionCheck: "not-met",
  };

  it("applies the tournament amount with the regulation as source", () => {
    const r = new DrawClaimTree(fixedProviders()).evaluate({
      ...CLAIM,
      tournamentOverrides: OVERRIDES,
    });
    expect(r.decision.penalties[0].timeAdjustmentSeconds).toBe(120);
    expect(r.decision.conclusion).toContain("大会規定: 2分（出典: 大会規定");
    expect(r.decision.sources[0].source).toBe("tournament");
    expect(r.decision.escalationRecommended).toBe(false);
  });

  it("is wired through the DecisionEngine ruleset", () => {
    const incident: Incident = {
      ...illegalMove(),
      category: "draw",
      subtype: "threefold-repetition-claim",
      playerColor: "white",
      illegalMoveFacts: undefined,
      drawClaimFacts: { ...CLAIM, subtype: "threefold-repetition-claim" },
    };
    const r = new DecisionEngine(fixedProviders()).processIncident({
      incident,
      ruleset: { ...BLITZ_B2, tournamentOverrides: OVERRIDES },
    });
    expect(r.decision.penalties[0]?.timeAdjustmentSeconds).toBe(120);
  });
});
