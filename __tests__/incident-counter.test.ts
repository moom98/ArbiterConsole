import { describe, it, expect } from "vitest";
import {
  IncidentCounter,
  type IncidentRecord,
} from "@/lib/domain/services/incident-counter";
import type {
  Decision,
  Incident,
  Penalty,
  PlayerColor,
} from "@/lib/domain/entities";
import { FIXED_NOW } from "./helpers";

let seq = 0;

function record(opts: {
  gameId?: string;
  color?: PlayerColor;
  category?: Incident["category"];
  penalties?: Penalty[];
  treeId?: Decision["treeId"] | null;
  noDecision?: boolean;
}): IncidentRecord {
  const id = `inc-${++seq}`;
  const incident: Incident = {
    id,
    gameId: opts.gameId ?? "g1",
    category: opts.category ?? "illegal-move",
    playerColor: opts.color ?? "white",
    description: "",
    arbiterObserved: true,
    reportedBy: "arbiter",
    reportedAt: FIXED_NOW,
    status: "resolved",
    escalatedToCA: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
  if (opts.noDecision) return { incident };
  const decision: Decision = {
    id: `dec-${seq}`,
    incidentId: id,
    treeId:
      opts.treeId === null
        ? undefined
        : (opts.treeId ?? "DT-001-illegal-move-standard"),
    conclusion: "",
    actions: [],
    intervention: "immediate",
    penalties: opts.penalties ?? [],
    sources: [],
    confidence: "high",
    escalationRecommended: false,
    generatedBy: "decision-tree",
    validationPassed: true,
    createdAt: FIXED_NOW,
  };
  return { incident: { ...incident, decisionId: decision.id }, decision };
}

const plus2: Penalty = {
  type: "time-addition-opponent",
  playerColor: "black",
  timeAdjustmentSeconds: 120,
  description: "",
};
const loss: Penalty = {
  type: "game-loss",
  playerColor: "white",
  description: "",
};
const draw: Penalty = { type: "draw", playerColor: "white", description: "" };

describe("IncidentCounter", () => {
  it("counts only incidents where an illegal-move penalty was applied", () => {
    const records = [
      record({ penalties: [plus2] }),
      record({ penalties: [] }), // clock not pressed / game ended
      record({ noDecision: true }), // pending follow-up
      record({ penalties: [draw] }), // draw is not an illegal-move penalty
    ];
    expect(IncidentCounter.countIllegalMoves(records, "g1", "white")).toBe(1);
  });

  it("counts game-loss as a penalised illegal move", () => {
    const records = [
      record({ penalties: [plus2] }),
      record({ penalties: [loss] }),
    ];
    expect(IncidentCounter.countIllegalMoves(records, "g1", "white")).toBe(2);
  });

  it("counts per player colour", () => {
    const records = [
      record({ color: "white", penalties: [plus2] }),
      record({ color: "black", penalties: [plus2] }),
      record({ color: "black", penalties: [plus2] }),
    ];
    expect(IncidentCounter.countIllegalMovesByColor(records, "g1")).toEqual({
      white: 1,
      black: 2,
    });
  });

  it("counts per game", () => {
    const records = [
      record({ gameId: "g1", penalties: [plus2] }),
      record({ gameId: "g2", penalties: [plus2] }),
    ];
    expect(IncidentCounter.countIllegalMoves(records, "g1", "white")).toBe(1);
    expect(IncidentCounter.countIllegalMoves(records, "g3", "white")).toBe(0);
  });

  it("ignores other categories and decisions not produced by the illegal-move tree", () => {
    const records = [
      record({ category: "clock-time", penalties: [plus2] }),
      record({ treeId: null, penalties: [plus2] }),
    ];
    expect(IncidentCounter.countIllegalMoves(records, "g1", "white")).toBe(0);
  });

  it("ignores incidents without a player colour", () => {
    const r = record({ penalties: [plus2] });
    r.incident.playerColor = undefined;
    expect(IncidentCounter.countIllegalMovesByColor([r], "g1")).toEqual({
      white: 0,
      black: 0,
    });
  });

  it("can exclude the incident currently being evaluated", () => {
    const r = record({ penalties: [plus2] });
    expect(
      IncidentCounter.countIllegalMoves([r], "g1", "white", {
        excludeIncidentId: r.incident.id,
      })
    ).toBe(0);
  });

  it("ignores a decision that belongs to a different incident", () => {
    const r = record({ penalties: [plus2] });
    r.decision!.incidentId = "other";
    expect(IncidentCounter.countIllegalMoves([r], "g1", "white")).toBe(0);
  });
});
