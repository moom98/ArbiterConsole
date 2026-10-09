// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { prepareIncidentClassification } from "@/lib/application/llm-classification";
import { DecisionEngine } from "@/lib/domain/decision-engine";
import type { Incident } from "@/lib/domain/entities";
import { INCIDENT_CATEGORIES } from "@/lib/domain/llm/classification";
import { NO_IDENTIFIERS } from "@/lib/domain/privacy";
import {
  LLM_API_PATHS,
  type LlmApiKind,
  type LlmApiResponse,
} from "@/lib/infrastructure/llm/contract";
import { createLlmRouteHandler } from "@/lib/infrastructure/llm/server/handler";
import { readLlmConfig } from "@/lib/infrastructure/llm/server/config";
import { DailyRequestCounter } from "@/lib/infrastructure/llm/server/rate-limiter";
import { fixedProviders, FIXED_NOW } from "../helpers";

/**
 * Jev の分類 → 提案（プレフィル）→ 決定木の質問が優先される（jev-classifier-design §11 Integration）。
 * クライアントの外部AIガード → サーバーのハンドラー（Jev。fetch はモック）→ ドメインの解釈を通す
 */

function jevAnswers(category: string, p: number) {
  const rest = (1 - p) / (INCIDENT_CATEGORIES.length - 1);
  return {
    category: {
      type: "choice",
      choice: category,
      confidence: p,
      probabilities: Object.fromEntries(
        INCIDENT_CATEGORIES.map((c) => [c, c === category ? p : rest])
      ),
    },
    needsTournamentRules: { type: "noul", noul: 0.05 },
  };
}

function wiring(answers: unknown) {
  const upstream = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({ model: "jev-1.13.0", answers, usage: {} }),
        { status: 200 }
      )
  );
  const handler = createLlmRouteHandler("classify", {
    config: () =>
      readLlmConfig({
        LLM_CLASSIFIER_PROVIDER: "jev",
        TYPESAFE_API_KEY: "ts-test-key",
      }),
    fetch: upstream,
    dailyCounter: new DailyRequestCounter(),
    log: () => {},
  });
  // クライアントの callLlmApi の代わりに、同じプロセスのハンドラーへ送る
  const call = vi.fn(
    async (kind: LlmApiKind, body: unknown): Promise<LlmApiResponse> => {
      const res = await handler(
        new Request(`http://localhost${LLM_API_PATHS[kind]}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      );
      return res.json();
    }
  );
  return {
    upstream,
    call,
    deps: {
      call: call as never,
      identifiers: async () => NO_IDENTIFIERS,
      isOnline: () => true,
    },
  };
}

describe("Jev classification flow (guard → handler → domain → decision tree)", () => {
  it("a Jev suggestion (uncalibrated) is low-confidence with candidates, and the decision tree still asks its questions", async () => {
    const { upstream, call, deps } = wiring(jevAnswers("illegal-move", 0.97));
    const text = "黒が両手でキャスリングし、その後時計を押した";
    const step = await prepareIncidentClassification(text, {}, deps);
    if (step.status !== "needs-confirmation")
      throw new Error("must ask before sending");
    // 確認するまで何も送らない（D13）
    expect(call).not.toHaveBeenCalled();
    const result = await step.send();

    expect(upstream).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(upstream.mock.calls[0][1]?.body));
    expect(sent.state).toEqual({ deidentified_incident: text });
    expect(result.classification).toMatchObject({
      category: "illegal-move",
      method: "llm",
      provider: "jev",
      probability: 0.97,
      // 較正前（J3 前）は未較正モード
      confidence: "low",
      prefill: false,
    });
    expect(result.classification?.alternatives).toHaveLength(2);

    // アービターがカテゴリを確定した後は決定木が判断する（LLM は呼ばない。ADR-002）
    const assist = vi.fn();
    const incident: Incident = {
      id: "inc-jev",
      gameId: "g1",
      category: result.classification!.category,
      description: text,
      arbiterObserved: true,
      reportedBy: "arbiter",
      reportedAt: FIXED_NOW,
      status: "pending",
      escalatedToCA: false,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    };
    const r = await new DecisionEngine(fixedProviders(), {
      llm: { assist },
    }).evaluate({
      incident,
      ruleset: { competitionType: "standard", rulesVersion: "FIDE-2023" },
    });
    expect(assist).not.toHaveBeenCalled();
    expect(r.decision.generatedBy).toBe("decision-tree");
  });

  it("invalid Jev output falls back to the keyword classifier", async () => {
    const { deps } = wiring({
      category: { type: "choice", choice: "cheating", probabilities: {} },
    });
    const step = await prepareIncidentClassification(
      "白のフラッグが落ちた",
      {},
      deps
    );
    if (step.status !== "needs-confirmation") throw new Error("expected send");
    const result = await step.send();
    expect(result.classification).toMatchObject({
      category: "clock-time",
      method: "keyword",
    });
    expect(result.notice).toMatch(/キーワード分類/);
  });
});
