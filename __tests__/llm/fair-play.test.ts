import { describe, it, expect, vi } from "vitest";
import { DecisionEngine } from "@/lib/domain/decision-engine";
import type { Incident } from "@/lib/domain/entities";
import { prepareIncidentClassification } from "@/lib/application/llm-classification";
import { FAIR_PLAY_CONCLUSION } from "@/lib/domain/services/fair-play";
import { mentionsFairPlay } from "@/lib/domain/llm/keyword-classifier";
import { createLlmAssistPort } from "@/lib/application/llm-assist";
import { NO_IDENTIFIERS } from "@/lib/domain/privacy";
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
    const step = await prepareIncidentClassification(
      "相手が不正をしている疑いがある",
      {},
      { call, identifiers: async () => NO_IDENTIFIERS }
    );
    expect(call).not.toHaveBeenCalled();
    if (step.status !== "done") throw new Error("must not ask to send");
    const r = step.result;
    expect(r.classification).toMatchObject({
      category: "fair-play",
      method: "keyword",
    });
    expect(r.notice).toMatch(/送信しません/);
  });

  const MIXED =
    "白がスマホを見て離席を繰り返し、相手に話しかけた。カンニングの疑い";

  it.each([
    [MIXED],
    ["Suspected engine assistance: white kept checking a phone"],
    ["Black reported a possible fair play issue"],
    ["Player refused a metal detector check"],
  ])("mentionsFairPlay detects: %s", (text) => {
    expect(mentionsFairPlay(text)).toBe(true);
  });

  it.each([
    "時計の表示が不正確だった",
    "白が不正な手を指した",
    "計算が不正解だった",
    "White's phone rang during the game",
    "player went outside used the toilet",
    "the engine of the clock is useless",
    "unfair playing conditions (lighting)",
    "asked the arbiter for help",
  ])("does not flag ordinary wording: %s", (text) => {
    expect(mentionsFairPlay(text)).toBe(false);
  });

  it("does not flag ordinary incidents", () => {
    expect(mentionsFairPlay("白のスマホが対局中に鳴った")).toBe(false);
    expect(mentionsFairPlay("Black's phone rang during the game")).toBe(false);
  });

  it("classification never sends text that mentions fair-play even if another category scores higher", async () => {
    const call = vi.fn();
    const deps = { call, identifiers: async () => NO_IDENTIFIERS };
    const step = await prepareIncidentClassification(MIXED, {}, deps);
    expect(call).not.toHaveBeenCalled();
    expect(step.status === "done" && step.result.notice).toMatch(
      /送信しません/
    );
    const english = await prepareIncidentClassification(
      "Suspected engine assistance by white",
      {},
      deps
    );
    expect(english.status).toBe("done");
    expect(call).not.toHaveBeenCalled();
  });

  it("another category with a cheating suspicion in the description never reaches the LLM", async () => {
    const assist = vi.fn();
    const r = await new DecisionEngine(fixedProviders(), {
      llm: { assist },
    }).evaluate({
      incident: {
        ...INCIDENT,
        category: "player-behavior",
        description: MIXED,
      },
      ruleset: { competitionType: "standard", rulesVersion: "FIDE-2023" },
    });
    expect(assist).not.toHaveBeenCalled();
    expect(r.decision.conclusion).toBe(FAIR_PLAY_CONCLUSION);
    expect(r.decision.escalationRecommended).toBe(true);
  });

  it("the assist port refuses fair-play text as a second guard (no search, no call)", async () => {
    const search = vi.fn();
    const call = vi.fn();
    const port = createLlmAssistPort({
      search,
      call,
      isOnline: () => true,
      identifiers: async () => NO_IDENTIFIERS,
    });
    const out = await port.assist({
      incident: {
        category: "player-behavior",
        description: MIXED,
        arbiterObserved: false,
      },
      context: { competitionType: "standard", rulesVersion: "FIDE-2023" },
    });
    expect(out).toMatchObject({ status: "error", code: "fair-play-not-sent" });
    expect(search).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });
});
