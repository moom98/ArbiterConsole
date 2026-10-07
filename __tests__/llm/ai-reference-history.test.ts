import { describe, it, expect } from "vitest";
import type { Decision, Incident } from "@/lib/domain/entities";
import {
  penaltyHistoryForGame,
  summarizePenalties,
} from "@/lib/domain/services/penalty-history";
import { incidentStatusAfterDecision } from "@/lib/domain/services/incident-status";
import {
  buildIncidentCsv,
  INCIDENT_CSV_HEADERS,
} from "@/lib/application/csv-export";
import { FIXED_NOW } from "../helpers";

function incident(id: string): Incident {
  return {
    id,
    gameId: "g1",
    category: "player-behavior",
    playerColor: "black",
    description: "スマートウォッチ",
    arbiterObserved: true,
    reportedBy: "arbiter",
    reportedAt: FIXED_NOW,
    status: "pending",
    decisionId: `d-${id}`,
    escalatedToCA: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

function decision(id: string, generatedBy: Decision["generatedBy"]): Decision {
  return {
    id: `d-${id}`,
    incidentId: id,
    conclusion: "x",
    actions: [],
    intervention: "immediate",
    penalties: [{ type: "warning", playerColor: "black", description: "警告" }],
    sources: [],
    confidence: "medium",
    escalationRecommended: false,
    generatedBy,
    validationPassed: true,
    createdAt: FIXED_NOW,
  };
}

const records = [
  { incident: incident("tree"), decision: decision("tree", "decision-tree") },
  { incident: incident("ai"), decision: decision("ai", "llm") },
];

describe("AI-assisted decisions are not treated as applied (ADR-007)", () => {
  it("keeps incidents with an LLM decision pending", () => {
    expect(
      incidentStatusAfterDecision({
        generatedBy: "llm",
        escalationRecommended: false,
      })
    ).toBe("pending");
    expect(
      incidentStatusAfterDecision({
        generatedBy: "llm",
        escalationRecommended: true,
      })
    ).toBe("pending");
    expect(
      incidentStatusAfterDecision({
        generatedBy: "decision-tree",
        escalationRecommended: false,
      })
    ).toBe("resolved");
  });

  it("excludes AI penalties from the summary and counts them separately", () => {
    const s = summarizePenalties(records);
    expect(s.penalties).toBe(1);
    expect(s.warnings).toBe(1);
    expect(s.aiReferencePenalties).toBe(1);
  });

  it("puts AI penalties in a separate history bucket", () => {
    const h = penaltyHistoryForGame(records, "g1");
    expect(h.black.penalties.map((p) => p.incidentId)).toEqual(["tree"]);
    expect(h.aiReference.map((p) => p.incidentId)).toEqual(["ai"]);
  });

  it("includes the generator in the CSV export", () => {
    const csv = buildIncidentCsv(records);
    const idx = INCIDENT_CSV_HEADERS.indexOf("生成元");
    expect(idx).toBeGreaterThan(-1);
    expect(csv).toContain("AI参考（未確定）");
    expect(csv).toContain("Decision Tree");
  });
});
