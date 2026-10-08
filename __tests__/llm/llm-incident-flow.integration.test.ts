// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ArbiterDatabase } from "@/lib/infrastructure/db/schema";
import { createIncidentStore } from "@/lib/stores/incident-store";
import { createLlmAssistPort } from "@/lib/application/llm-assist";
import { loadKnownIdentifiers } from "@/lib/infrastructure/privacy/known-identifiers";
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
      // 端末に登録済みの識別子（このテストの IndexedDB）
      identifiers: () => loadKnownIdentifiers(db),
      storedRuleIds: async (ids: string[]) =>
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

  /** 報告 → 送信内容の確認（D13）→ 確認して送信 */
  async function submitAndConfirm(
    store: ReturnType<typeof makeStore>,
    description = "黒のスマホが鳴った"
  ) {
    const res = await store.getState().submitIncident({
      context: CTX,
      category: "player-behavior",
      description,
      arbiterObserved: true,
    });
    expect(res.ok).toBe(true);
    const confirmation = store.getState().externalAiConfirmation;
    expect(confirmation).not.toBeNull();
    // 確認するまでは何も送らない
    expect(call).not.toHaveBeenCalled();
    expect(store.getState().currentDecision?.llm?.status).toBe(
      "awaiting-confirmation"
    );
    return store.getState().confirmExternalAiSend();
  }

  it("player-behaviour → confirmation, then a validated AI-assisted decision stored with generatedBy llm", async () => {
    const store = makeStore(makePort());
    const res = await submitAndConfirm(store);
    expect(res.ok).toBe(true);
    expect(store.getState().externalAiConfirmation).toBeNull();
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
    // AI 参考情報は裁定ではないため、アービターが確認するまで保留のまま
    expect(incident?.status).toBe("pending");
  });

  it("an article deleted from IndexedDB during the request → rejected, CA escalation", async () => {
    const store = makeStore(makePort());
    call.mockImplementationOnce(async () => {
      await db.rules.delete(RULE.id);
      return { ok: true, result: apiResult, model: "gemini-test" };
    });
    await submitAndConfirm(store);
    const d = store.getState().currentDecision!;
    expect(d.validationPassed).toBe(false);
    expect(d.escalationRecommended).toBe(true);
    expect(d.validationErrors?.join()).toMatch(/登録規則に存在しません/);
    const incident = await db.incidents.get(
      store.getState().currentIncident!.id
    );
    expect(incident?.status).toBe("pending"); // AI 参考情報は自動で確定しない
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
      description: "黒のスマホが鳴った",
      arbiterObserved: true,
    });
    const offline = store.getState().currentDecision!;
    expect(offline.llm?.status).toBe("offline");
    expect(offline.intervention).toBe("consult-ca");
    expect(call).not.toHaveBeenCalled();

    online = true;
    // 再取得でも、送る前に確認を求める
    await store.getState().retryEvaluation();
    expect(call).not.toHaveBeenCalled();
    const awaiting = store.getState().currentDecision!;
    expect(awaiting.llm?.status).toBe("awaiting-confirmation");
    const retried = await store.getState().confirmExternalAiSend();
    expect(retried.ok).toBe(true);
    const d = store.getState().currentDecision!;
    expect(d.generatedBy).toBe("llm");
    expect(d.id).not.toBe(offline.id);
    const incident = await db.incidents.get(
      store.getState().currentIncident!.id
    );
    expect(incident?.decisionId).toBe(d.id);
    // 置き換えた前回の判断は supersededBy で記録する（集計には使われない）
    expect((await db.decisions.get(awaiting.id))?.supersededBy).toBe(d.id);
  });

  it("a confirmed send that failed is retried without asking again (same payload)", async () => {
    const store = makeStore(makePort());
    call.mockImplementationOnce(async () => ({
      ok: false,
      error: { code: "unauthorized", message: "トークンが必要です" },
    }));
    await submitAndConfirm(store);
    expect(store.getState().currentDecision?.llm?.errorCode).toBe(
      "unauthorized"
    );
    await store.getState().retryEvaluation();
    expect(call).toHaveBeenCalledTimes(2);
    expect(store.getState().currentDecision?.generatedBy).toBe("llm");
  });

  it("an approval is scoped to the incident and payload: follow-up answers and other incidents ask again", async () => {
    const store = makeStore(makePort());
    call.mockImplementation(async () => ({
      ok: false,
      error: { code: "upstream-timeout", message: "timeout" },
    }));
    await submitAndConfirm(store);
    expect(call).toHaveBeenCalledTimes(1);

    // 追加回答の後の評価は承認を使わない（内容が変わりうる）
    await store.getState().answerFollowUp({});
    expect(call).toHaveBeenCalledTimes(1);
    expect(store.getState().currentDecision?.llm?.status).toBe(
      "awaiting-confirmation"
    );

    // 別の Incident（同じ記述）の再取得には、前の Incident の承認を使わない
    await store.getState().submitIncident({
      context: CTX,
      category: "player-behavior",
      description: "黒のスマホが鳴った",
      arbiterObserved: true,
    });
    await store.getState().retryEvaluation();
    expect(call).toHaveBeenCalledTimes(1);
    expect(store.getState().externalAiConfirmation).not.toBeNull();

    // reset で確認待ちも消える
    store.getState().reset();
    expect(store.getState().externalAiConfirmation).toBeNull();
  });

  it("sends placeholders for registered names, no tournament id, and re-identifies the output on the device", async () => {
    await db.players.add({
      id: "p1",
      tournamentId: "T-SECRET",
      name: "田中 太郎",
      createdAt: NOW,
      updatedAt: NOW,
    });
    apiResult = validDraft({
      conclusion: "〈選手A〉のスマホが鳴ったため、大会規定第5条を確認する。",
      actions: ["〈選手A〉に事情を聞く"],
      penalties: [],
      citations: [validDraft().citations[0]],
    });
    const store = makeStore(makePort());
    await store.getState().submitIncident({
      context: CTX,
      category: "player-behavior",
      description: "田中太郎のスマホが鳴った",
      arbiterObserved: true,
    });
    const preview = store.getState().externalAiConfirmation!.preview;
    expect(JSON.stringify(preview)).not.toContain("田中");
    expect(preview.fields[0].text).toBe("〈選手A〉のスマホが鳴った");
    await store.getState().confirmExternalAiSend();

    const body = JSON.stringify((call.mock.calls[0] as unknown[])[1]);
    expect(body).not.toContain("田中");
    expect(body).not.toContain("T-SECRET");
    expect(body).toContain("〈選手A〉");
    expect(body).not.toContain("tournamentId");
    const d = store.getState().currentDecision!;
    expect(d.conclusion).toBe(
      "田中 太郎のスマホが鳴ったため、大会規定第5条を確認する。"
    );
    expect(d.actions[0]).toBe("田中 太郎に事情を聞く");
    expect(d.llm?.needsReview).toBeUndefined();
    // 表示用の資料名は端末のもの（送ったのは「大会規定」だけ）
    expect(d.sources[0].edition).toBe("第1回テスト大会 大会規定 2026");
    expect(body).not.toContain("第1回テスト大会");
  });

  it("an unknown placeholder in the AI output is shown as is and marks the decision for review", async () => {
    apiResult = validDraft({
      conclusion: "〈選手C〉に確認する。",
      penalties: [],
      citations: [validDraft().citations[0]],
    });
    const store = makeStore(makePort());
    await submitAndConfirm(store);
    const d = store.getState().currentDecision!;
    expect(d.conclusion).toBe("〈選手C〉に確認する。");
    expect(d.llm?.needsReview).toBe(true);
    expect(d.escalationRecommended).toBe(true);
  });

  it("the opt-out switch and the Sensitive Gate keep the incident local (no confirmation, no call)", async () => {
    const store = makeStore(makePort());
    await store.getState().submitIncident({
      context: CTX,
      category: "player-behavior",
      description: "黒のスマホが鳴った",
      externalAiOptOut: true,
      arbiterObserved: true,
    });
    expect(store.getState().externalAiConfirmation).toBeNull();
    const optedOut = store.getState().currentDecision!;
    expect(optedOut.llm?.status).toBe("not-sent");
    expect(optedOut.llm?.gateReasons).toContain("arbiter-opt-out");
    expect(
      (await db.incidents.get(store.getState().currentIncident!.id))
        ?.externalAiOptOut
    ).toBe(true);

    await store.getState().submitIncident({
      context: CTX,
      category: "player-behavior",
      description: "白が対局中に具合が悪そうにしていた",
      arbiterObserved: true,
    });
    expect(store.getState().externalAiConfirmation).toBeNull();
    const held = store.getState().currentDecision!;
    expect(held.llm?.status).toBe("not-sent");
    expect(held.kind).toBe("manual-review");
    expect(held.actions.join()).toMatch(/外部AIには送信していません（理由: /);
    expect(call).not.toHaveBeenCalled();
  });

  it("without an LLM port the store keeps the manual-review behaviour", async () => {
    const store = makeStore();
    await store.getState().submitIncident({
      context: CTX,
      category: "player-behavior",
      description: "黒のスマホが鳴った",
      arbiterObserved: true,
    });
    expect(store.getState().currentDecision?.kind).toBe("manual-review");
    expect(store.getState().currentDecision?.llm).toBeUndefined();
  });
});
