import { describe, it, expect, vi } from "vitest";
import {
  DecisionEngine,
  type RulesetContext,
} from "@/lib/domain/decision-engine";
import type { Incident } from "@/lib/domain/entities";
import type { LlmAssistOutcome, LlmAssistPort } from "@/lib/domain/llm/ports";
import { fixedProviders, FIXED_NOW } from "../helpers";
import { ARTICLES, validDraft } from "./fixtures";

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    gameId: "g1",
    category: "player-behavior",
    description: "黒がスマートウォッチを着けている",
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

const STANDARD: RulesetContext = {
  competitionType: "standard",
  rulesVersion: "FIDE-2023",
};

function port(outcome: LlmAssistOutcome) {
  const assist = vi.fn(async () => outcome);
  return { port: { assist } satisfies LlmAssistPort, assist };
}

const OK: LlmAssistOutcome = {
  status: "ok",
  raw: validDraft(),
  model: "gemini-test",
  articles: ARTICLES,
};

describe("DecisionEngine.evaluate – LLM routing", () => {
  it.each([
    [
      "illegal-move (standard)",
      { category: "illegal-move" as const, description: "スマートウォッチ" },
      STANDARD,
    ],
    [
      "illegal-move (rapid)",
      { category: "illegal-move" as const },
      {
        competitionType: "rapid",
        supervisionRegime: "basic-rules",
        rulesVersion: "FIDE-2023",
      } as RulesetContext,
    ],
    [
      "flag-fall",
      { category: "clock-time" as const, subtype: "flag-fall" },
      STANDARD,
    ],
    [
      "clock-time without subtype",
      { category: "clock-time" as const },
      STANDARD,
    ],
    [
      "threefold repetition",
      { category: "draw" as const, subtype: "threefold-repetition-claim" },
      STANDARD,
    ],
  ])(
    "never calls the LLM for tree-covered incidents: %s",
    async (_n, o, rs) => {
      const { port: p, assist } = port(OK);
      const r = await new DecisionEngine(fixedProviders(), { llm: p }).evaluate(
        {
          incident: incident(o),
          ruleset: rs,
        }
      );
      expect(assist).not.toHaveBeenCalled();
      expect(r.decision.generatedBy).toBe("decision-tree");
    }
  );

  it("never calls the LLM when the ruleset context is missing", async () => {
    const { port: p, assist } = port(OK);
    const r = await new DecisionEngine(fixedProviders(), { llm: p }).evaluate({
      incident: incident(),
    });
    expect(assist).not.toHaveBeenCalled();
    expect(r.decision.kind).toBe("context-required");
  });

  it("asks for a situation note before calling the LLM", async () => {
    const { port: p, assist } = port(OK);
    const r = await new DecisionEngine(fixedProviders(), { llm: p }).evaluate({
      incident: incident({ description: "  " }),
      ruleset: STANDARD,
    });
    expect(assist).not.toHaveBeenCalled();
    expect(r.requiresFollowUp).toBe(true);
  });

  it("routes uncovered incidents to the LLM port with explicit structured context", async () => {
    const { port: p, assist } = port(OK);
    const r = await new DecisionEngine(fixedProviders(), { llm: p }).evaluate({
      incident: incident({ playerColor: "black" }),
      ruleset: {
        competitionType: "blitz",
        supervisionRegime: "competition-rules",
        rulesVersion: "FIDE-2023",
      },
      tournamentId: "t1",
    });
    expect(assist).toHaveBeenCalledWith(
      {
        incident: {
          category: "player-behavior",
          subtype: undefined,
          playerColor: "black",
          description: "黒がスマートウォッチを着けている",
          arbiterObserved: true,
        },
        // 大会 ID は送る context に入れない（端末内の規則検索の範囲としてだけ渡す。§5.3）
        context: {
          competitionType: "blitz",
          supervisionRegime: "competition-rules",
          rulesVersion: "FIDE-2023",
        },
        tournamentId: "t1",
        doNotSend: false,
      },
      { approvalKey: undefined }
    );
    expect(r.requiresFollowUp).toBe(false);
    expect(r.decision.generatedBy).toBe("llm");
    expect(r.decision.validationPassed).toBe(true);
    expect(r.decision.incidentId).toBe("inc-1");
    expect(r.decision.rulesVersion).toBe("FIDE-2023");
  });

  it("routes clock-time 'other' and draw 'other' to the LLM", async () => {
    for (const o of [
      { category: "clock-time" as const, subtype: "other" },
      { category: "draw" as const, subtype: "other" },
    ]) {
      const { port: p, assist } = port(OK);
      await new DecisionEngine(fixedProviders(), { llm: p }).evaluate({
        incident: incident(o),
        ruleset: STANDARD,
      });
      expect(assist).toHaveBeenCalledOnce();
    }
  });

  it("offline → manual review with the CA message and the online note", async () => {
    const { port: p } = port({ status: "offline" });
    const r = await new DecisionEngine(fixedProviders(), { llm: p }).evaluate({
      incident: incident(),
      ruleset: STANDARD,
    });
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.generatedBy).toBe("decision-tree");
    expect(r.decision.intervention).toBe("consult-ca");
    expect(r.decision.escalationRecommended).toBe(true);
    expect(r.decision.escalationReason).toMatch(/オンライン必須/);
    expect(r.decision.actions).toContain(
      "オンライン時にAI参考情報を取得できます。"
    );
    expect(r.decision.llm?.status).toBe("offline");
  });

  it("port error or exception → manual review with the reason", async () => {
    const { port: p } = port({
      status: "error",
      code: "rate-limited",
      message: "リクエストが多すぎます",
    });
    const r = await new DecisionEngine(fixedProviders(), { llm: p }).evaluate({
      incident: incident(),
      ruleset: STANDARD,
    });
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.llm?.status).toBe("unavailable");
    expect(r.decision.escalationReason).toMatch(/リクエストが多すぎます/);

    const throwing: LlmAssistPort = {
      assist: async () => {
        throw new Error("boom");
      },
    };
    const r2 = await new DecisionEngine(fixedProviders(), {
      llm: throwing,
    }).evaluate({ incident: incident(), ruleset: STANDARD });
    expect(r2.decision.llm?.status).toBe("unavailable");
  });

  it("no articles → '該当する規則が見つかりませんでした' + CA", async () => {
    const { port: p } = port({ status: "no-articles" });
    const r = await new DecisionEngine(fixedProviders(), { llm: p }).evaluate({
      incident: incident(),
      ruleset: STANDARD,
    });
    expect(r.decision.conclusion).toBe("該当する規則が見つかりませんでした。");
    expect(r.decision.escalationRecommended).toBe(true);
    expect(r.decision.llm?.status).toBe("no-articles");
  });

  it("invalid LLM output → CA escalation with validation errors", async () => {
    const { port: p } = port({
      ...OK,
      raw: validDraft({
        citations: [
          {
            articleId: "rule-invented",
            quote: "The player shall be expelled immediately.",
            relevance: "x",
          },
        ],
      }),
    } as LlmAssistOutcome);
    const r = await new DecisionEngine(fixedProviders(), { llm: p }).evaluate({
      incident: incident(),
      ruleset: STANDARD,
    });
    expect(r.decision.generatedBy).toBe("llm");
    expect(r.decision.validationPassed).toBe(false);
    expect(r.decision.intervention).toBe("consult-ca");
    expect(r.decision.validationErrors?.join()).toMatch(/rule-invented/);
  });

  it("without a port, evaluate() behaves like processIncident()", async () => {
    const engine = new DecisionEngine(fixedProviders());
    const r = await engine.evaluate({
      incident: incident(),
      ruleset: STANDARD,
    });
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.llm).toBeUndefined();
  });
});

describe("DecisionEngine.evaluate – external AI confirmation and the Sensitive Gate (ADR-012)", () => {
  const PREVIEW = {
    destination: "AI参考情報（Gemini（Google））",
    fields: [{ label: "送る記述", text: "黒のスマホが鳴った" }],
    notes: [],
  };

  it("needs-confirmation → a manual-review decision now, with the preview and approval key for the store", async () => {
    const { port: p, assist } = port({
      status: "needs-confirmation",
      preview: PREVIEW,
      approvalKey: "key-1",
    });
    const engine = new DecisionEngine(fixedProviders(), { llm: p });
    const r = await engine.evaluate({
      incident: incident(),
      ruleset: STANDARD,
    });
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.generatedBy).toBe("decision-tree");
    expect(r.decision.llm?.status).toBe("awaiting-confirmation");
    expect(r.decision.intervention).toBe("consult-ca");
    expect(r.externalAiConfirmation).toEqual({
      preview: PREVIEW,
      approvalKey: "key-1",
    });

    // 確認後の評価では approvalKey をポートへ渡す
    await engine.evaluate(
      { incident: incident(), ruleset: STANDARD },
      { approvalKey: "key-1" }
    );
    expect(assist).toHaveBeenLastCalledWith(expect.anything(), {
      approvalKey: "key-1",
    });
  });

  it("not-sent → local manual review with the reason codes and the notice (no text)", async () => {
    const { port: p } = port({
      status: "not-sent",
      reasons: ["health", "context-uncertain"],
    });
    const r = await new DecisionEngine(fixedProviders(), { llm: p }).evaluate({
      incident: incident(),
      ruleset: STANDARD,
    });
    expect(r.externalAiConfirmation).toBeUndefined();
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.llm).toMatchObject({
      status: "not-sent",
      gateReasons: ["health", "context-uncertain"],
    });
    expect(r.decision.actions.join()).toContain(
      "外部AIには送信していません（理由: 健康・医療に関する記述、機微な内容か判断できない記述）"
    );
    expect(r.decision.escalationRecommended).toBe(true);
  });

  it("passes the opt-out switch to the port", async () => {
    const { port: p, assist } = port(OK);
    await new DecisionEngine(fixedProviders(), { llm: p }).evaluate({
      incident: incident({ externalAiOptOut: true }),
      ruleset: STANDARD,
    });
    expect(assist).toHaveBeenCalledWith(
      expect.objectContaining({ doNotSend: true }),
      { approvalKey: undefined }
    );
  });
});
