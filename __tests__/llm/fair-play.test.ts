import { describe, it, expect, vi } from "vitest";
import { DecisionEngine } from "@/lib/domain/decision-engine";
import type { Incident } from "@/lib/domain/entities";
import { classifyIncidentText } from "@/lib/application/llm-classification";
import { FAIR_PLAY_CONCLUSION } from "@/lib/domain/services/fair-play";
import { fixedProviders, FIXED_NOW } from "../helpers";

const INCIDENT: Incident = {
  id: "inc-fp",
  gameId: "g1",
  category: "fair-play",
  description: "白がトイレでスマホを見ていたと黒が申告",
  arbiterObserved: false,
  reportedBy: "player-black",
  reportedAt: FIXED_NOW,
  status: "pending",
  escalatedToCA: false,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

describe("fair-play incidents (§23)", () => {
  it("never reach the LLM; deterministic CA escalation with a fact-recording checklist", async () => {
    const assist = vi.fn();
    const r = await new DecisionEngine(fixedProviders(), {
      llm: { assist },
    }).evaluate({
      incident: INCIDENT,
      ruleset: { competitionType: "standard", rulesVersion: "FIDE-2023" },
    });
    expect(assist).not.toHaveBeenCalled();
    expect(r.decision.generatedBy).toBe("decision-tree");
    expect(r.decision.conclusion).toBe(FAIR_PLAY_CONCLUSION);
    expect(r.decision.intervention).toBe("consult-ca");
    expect(r.decision.escalationRecommended).toBe(true);
    expect(r.decision.penalties).toEqual([]);
    expect(r.decision.actions.join()).toMatch(/事実のみを記録/);
  });

  it("free text that looks like fair-play is classified locally only (not sent)", async () => {
    const call = vi.fn();
    const r = await classifyIncidentText("相手が不正をしている疑いがある", {
      call,
    });
    expect(call).not.toHaveBeenCalled();
    expect(r.classification).toMatchObject({
      category: "fair-play",
      method: "keyword",
    });
    expect(r.notice).toMatch(/送信しません/);
  });
});
