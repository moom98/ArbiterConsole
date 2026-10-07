// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ArbiterDatabase } from "@/lib/infrastructure/db/schema";
import { createIncidentStore } from "@/lib/stores/incident-store";
import { createLlmAssistPort } from "@/lib/infrastructure/llm/llm-assist-port";
import type { LlmAssistPort } from "@/lib/domain/llm/ports";
import type { LlmApiResponse } from "@/lib/infrastructure/llm/contract";
import type { RuleSearchResult } from "@/lib/infrastructure/ai/hybrid-search";
import type { Rule } from "@/lib/domain/entities";
import type { ReportContext } from "@/lib/domain/services/game-context";
import { fixedProviders } from "../helpers";
import { ARTICLE_TOURNAMENT_5, validDraft } from "./fixtures";

const CTX: ReportContext = {
  competitionType: "standard",
  rulesVersion: "FIDE-2023",
  round: 2,
  boardNumber: 4,
};

const NOW = new Date("2026-01-01T10:00:00Z");

const RULE: Rule = {
  id: ARTICLE_TOURNAMENT_5.id,
  source: "tournament",
  sourceId: "src-t",
  article: ARTICLE_TOURNAMENT_5.article,
  title: ARTICLE_TOURNAMENT_5.title,
  content: ARTICLE_TOURNAMENT_5.content,
  page: 2,
  priority: 1000,
  createdAt: NOW,
  updatedAt: NOW,
};

let dbCounter = 0;

describe("LLM incident flow (store + engine + port + IndexedDB)", () => {
  let db: ArbiterDatabase;
  let online: boolean;
  let apiResult: unknown;
  let call: ReturnType<typeof vi.fn>;

  function makeStore(llm?: LlmAssistPort) {
    return createIncidentStore({
      db,
      providers: fixedProviders(`llm${dbCounter}`),
      llm,
    });
  }

  function makePort() {
    call = vi.fn(async (): Promise<LlmApiResponse> => ({
      ok: true,
      result: apiResult,
      model: "gemini-test",
    }));
    return createLlmAssistPort({
      isOnline: () => online,
      search: async (): Promise<RuleSearchResult[]> => {
        const rules = await db.rules.toArray();
        return rules.map((rule) => ({
          rule,
          source: {
            id: "src-t",
            name: "第1回テスト大会 大会規定",
            fileName: "t.pdf",
            sourceType: "tournament",
            version: "2026",
            status: "active",
            language: "ja",
            totalPages: 2,
            importedAt: NOW,
          },
          score: 1,
          methods: ["fulltext"],
        }));
      },
      storedRuleIds: async (ids) =>
        (await db.rules.bulkGet(ids)).flatMap((r) => (r ? [r.id] : [])),
      call: call as never,
    });
  }

  beforeEach(async () => {
    db = new ArbiterDatabase(`llm-test-db-${++dbCounter}`);
    await db.rules.add(RULE);
    online = true;
    apiResult = validDraft({
      penalties: [
        {
          type: "game-loss",
          playerColor: "black",
          description: "電子機器の着用により負け",
          sourceArticleIds: [RULE.id],
        },
      ],
      citations: [validDraft().citations[0]],
    });
  });

  afterEach(async () => {
    await db.delete();
  });

  it("player-behaviour (smartwatch) → validated AI-assisted decision stored with generatedBy llm", async () => {
    const store = makeStore(makePort());
    const res = await store.getState().submitIncident({
      context: CTX,
      category: "player-behavior",
      description: "黒がスマートウォッチを着けている",
      arbiterObserved: true,
    });
    expect(res.ok).toBe(true);
    const decision = store.getState().currentDecision!;
    expect(decision.generatedBy).toBe("llm");
    expect(decision.validationPassed).toBe(true);
    expect(decision.confidence).toBe("medium");
    expect(decision.sources[0]).toMatchObject({
      article: "大会規定 第5条",
      ruleId: RULE.id,
      edition: "第1回テスト大会 大会規定 2026",
    });
    expect(store.getState().llmPending).toBe(false);

    const stored = await db.decisions.get(decision.id);
    expect(stored?.generatedBy).toBe("llm");
    const incident = await db.incidents.get(
      store.getState().currentIncident!.id
    );
    expect(incident?.decisionId).toBe(decision.id);
  });

  it("an article deleted from IndexedDB during the request → rejected, CA escalation", async () => {
    const store = makeStore(makePort());
    call.mockImplementationOnce(async () => {
      await db.rules.delete(RULE.id);
      return { ok: true, result: apiResult, model: "gemini-test" };
    });
    await store.getState().submitIncident({
      context: CTX,
      category: "player-behavior",
      description: "黒がスマートウォッチを着けている",
      arbiterObserved: true,
    });
    const d = store.getState().currentDecision!;
    expect(d.validationPassed).toBe(false);
    expect(d.escalationRecommended).toBe(true);
    expect(d.validationErrors?.join()).toMatch(/登録規則に存在しません/);
    const incident = await db.incidents.get(
      store.getState().currentIncident!.id
    );
    expect(incident?.status).toBe("escalated");
    expect(incident?.escalatedToCA).toBe(true);
  });

  it("tree-covered incidents never reach the LLM even with a description", async () => {
    const store = makeStore(makePort());
    await store.getState().submitIncident({
      context: CTX,
      category: "illegal-move",
      description: "スマートウォッチを着けたまま両手でキャスリング",
      arbiterObserved: true,
    });
    expect(call).not.toHaveBeenCalled();
    expect(store.getState().currentDecision?.generatedBy).toBe("decision-tree");
  });

  it("offline → CA message with online note; retry when back online fetches AI reference", async () => {
    online = false;
    const store = makeStore(makePort());
    await store.getState().submitIncident({
      context: CTX,
      category: "player-behavior",
      description: "黒がスマートウォッチを着けている",
      arbiterObserved: true,
    });
    const offline = store.getState().currentDecision!;
    expect(offline.llm?.status).toBe("offline");
    expect(offline.intervention).toBe("consult-ca");
    expect(call).not.toHaveBeenCalled();

    online = true;
    const retried = await store.getState().retryEvaluation();
    expect(retried.ok).toBe(true);
    const d = store.getState().currentDecision!;
    expect(d.generatedBy).toBe("llm");
    expect(d.id).not.toBe(offline.id);
    const incident = await db.incidents.get(
      store.getState().currentIncident!.id
    );
    expect(incident?.decisionId).toBe(d.id);
  });

  it("without an LLM port the store keeps the manual-review behaviour", async () => {
    const store = makeStore();
    await store.getState().submitIncident({
      context: CTX,
      category: "player-behavior",
      description: "黒がスマートウォッチを着けている",
      arbiterObserved: true,
    });
    expect(store.getState().currentDecision?.kind).toBe("manual-review");
    expect(store.getState().currentDecision?.llm).toBeUndefined();
  });
});
