// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { callLlmApi } from "@/lib/infrastructure/llm/llm-api-client";
import {
  createLlmAssistPort,
  type LlmAssistDeps,
} from "@/lib/application/llm-assist";
import {
  prepareIncidentClassification,
  type ClassifyTextResult,
} from "@/lib/application/llm-classification";
import type { ExternalAiGuardDeps } from "@/lib/application/external-ai-guard";
import { NO_IDENTIFIERS } from "@/lib/domain/privacy";
import type { LlmApiResponse } from "@/lib/infrastructure/llm/contract";
import type { RuleSearchResult } from "@/lib/infrastructure/ai/hybrid-search";
import type { LlmAssistRequest } from "@/lib/domain/llm/ports";
import { LLM_LIMITS } from "@/lib/infrastructure/llm/contract";
import { validDraft } from "./fixtures";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("callLlmApi", () => {
  it("does not call the server when offline", async () => {
    const fetch = vi.fn();
    const res = await callLlmApi(
      "reason",
      {},
      { fetch, isOnline: () => false }
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, error: { code: "offline" } });
  });

  it("posts JSON to the same-origin route and returns the typed body", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ ok: true, result: { a: 1 }, model: "m" })
    );
    const res = await callLlmApi(
      "classify",
      { text: "x" },
      {
        fetch: fetch as unknown as typeof globalThis.fetch,
        isOnline: () => true,
      }
    );
    expect(res).toEqual({ ok: true, result: { a: 1 }, model: "m" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/llm/classify");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    // API キーはクライアントから送らない
    expect(JSON.stringify(init)).not.toMatch(/key/i);
  });

  it("sends the stored access token header only when one is set", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ ok: true, result: {}, model: "m" })
    );
    await callLlmApi(
      "reason",
      {},
      {
        fetch: fetch as unknown as typeof globalThis.fetch,
        isOnline: () => true,
        accessToken: () => "tok-1",
      }
    );
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(
      (init.headers as Record<string, string>)["x-arbiter-access-token"]
    ).toBe("tok-1");
  });

  it("passes typed server errors through and handles malformed / network failures", async () => {
    const err = {
      ok: false,
      error: { code: "rate-limited", message: "多すぎ" },
    };
    expect(
      await callLlmApi(
        "reason",
        {},
        {
          fetch: (async () =>
            jsonResponse(err, 429)) as unknown as typeof fetch,
          isOnline: () => true,
        }
      )
    ).toEqual(err);

    expect(
      await callLlmApi(
        "reason",
        {},
        {
          fetch: (async () =>
            new Response("<html>", { status: 500 })) as unknown as typeof fetch,
          isOnline: () => true,
        }
      )
    ).toMatchObject({ ok: false, error: { code: "upstream-error" } });

    expect(
      await callLlmApi(
        "reason",
        {},
        {
          fetch: (async () => {
            throw new TypeError("Failed to fetch");
          }) as unknown as typeof fetch,
          isOnline: () => true,
        }
      )
    ).toMatchObject({ ok: false, error: { code: "network-error" } });
  });

  it("aborts after the client timeout", async () => {
    const res = await callLlmApi(
      "reason",
      {},
      {
        isOnline: () => true,
        timeoutMs: 5,
        fetch: ((_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" })
              )
            );
          })) as unknown as typeof fetch,
      }
    );
    expect(res).toMatchObject({
      ok: false,
      error: { code: "upstream-timeout" },
    });
  });
});

function searchResult(id: string, content: string): RuleSearchResult {
  const now = new Date();
  return {
    rule: {
      id,
      source: "tournament",
      sourceId: "src-1",
      tournamentId: "t1",
      article: "第5条",
      title: "電子機器",
      content,
      page: 2,
      priority: 1000,
      createdAt: now,
      updatedAt: now,
    },
    source: {
      id: "src-1",
      name: "テスト大会 大会規定",
      fileName: "t.pdf",
      sourceType: "tournament",
      version: "2026",
      status: "active",
      language: "ja",
      tournamentId: "t1",
      totalPages: 3,
      importedAt: now,
    },
    score: 1,
    methods: ["fulltext"],
  };
}

const REQUEST: LlmAssistRequest = {
  incident: {
    category: "player-behavior",
    description: "黒のスマホが鳴った",
    arbiterObserved: true,
  },
  context: {
    competitionType: "standard",
    rulesVersion: "FIDE-2023",
  },
  tournamentId: "t1",
};

const NO_IDS = { identifiers: async () => NO_IDENTIFIERS };

/** 確認を求められたら、その approvalKey で送る（アービターが確認した場合） */
async function assistConfirmed(
  deps: LlmAssistDeps,
  request: LlmAssistRequest = REQUEST
) {
  const port = createLlmAssistPort({ ...NO_IDS, ...deps });
  const first = await port.assist(request);
  if (first.status !== "needs-confirmation") return first;
  return port.assist(request, { approvalKey: first.approvalKey });
}

describe("createLlmAssistPort", () => {
  it("offline → no search, no server call", async () => {
    const search = vi.fn();
    const call = vi.fn();
    const port = createLlmAssistPort({
      ...NO_IDS,
      isOnline: () => false,
      search,
      call,
    });
    expect(await port.assist(REQUEST)).toEqual({ status: "offline" });
    expect(search).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("asks for confirmation first: no search and no call until the arbiter confirms (D13)", async () => {
    const search = vi.fn(async () => []);
    const call = vi.fn();
    const port = createLlmAssistPort({
      ...NO_IDS,
      isOnline: () => true,
      search,
      call,
    });
    const first = await port.assist(REQUEST);
    expect(first.status).toBe("needs-confirmation");
    expect(search).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    // 違う approvalKey では送らずに、もう一度確認を求める
    expect(
      (await port.assist(REQUEST, { approvalKey: "something else" })).status
    ).toBe("needs-confirmation");
    expect(search).not.toHaveBeenCalled();
  });

  it("no retrieved articles → no-articles without calling the server", async () => {
    const call = vi.fn();
    const out = await assistConfirmed({
      isOnline: () => true,
      search: async () => [],
      call,
    });
    expect(out).toEqual({ status: "no-articles" });
    expect(call).not.toHaveBeenCalled();
  });

  it("sends only the retrieved articles and structured context; re-checks storage", async () => {
    const search = vi.fn(async () => [
      searchResult("r1", "対局中、選手は電子機器を身に着けてはならない。"),
      searchResult("r2", "x".repeat(LLM_LIMITS.maxArticleContentChars + 50)),
    ]);
    const call = vi.fn(async (): Promise<LlmApiResponse> => ({
      ok: true,
      result: validDraft(),
      model: "gemini-test",
    }));
    const out = await assistConfirmed({
      isOnline: () => true,
      search,
      call: call as never,
      storedRuleIds: async (ids) => ids.filter((id) => id !== "r2"),
    });
    // キーワード検索は元の記述（端末内）。意味検索は確認済みの検索語の埋め込みだけ
    expect(search).toHaveBeenCalledWith(
      "黒のスマホが鳴った",
      "t1",
      expect.any(Function)
    );
    const body = (call.mock.calls[0] as unknown[])[1] as {
      articles: Array<Record<string, unknown>>;
      context: unknown;
    };
    expect(body.context).toEqual(REQUEST.context);
    expect(body.articles.map((a) => a.id)).toEqual(["r1", "r2"]);
    // 大会規定: 資料名は固定、版と大会 ID は送らない
    expect(body.articles[0].sourceName).toBe("大会規定");
    expect(body.articles[0]).not.toHaveProperty("sourceVersion");
    expect(JSON.stringify(body)).not.toContain("t1");
    expect(body.articles[1].content).toHaveLength(
      LLM_LIMITS.maxArticleContentChars
    );
    expect(out).toMatchObject({
      status: "ok",
      model: "gemini-test",
      storedArticleIds: ["r1"],
    });
  });

  it("maps server errors and search failures", async () => {
    expect(
      await assistConfirmed({
        isOnline: () => true,
        search: async () => [searchResult("r1", "本文本文本文本文")],
        call: (async () => ({
          ok: false,
          error: { code: "not-configured", message: "未設定" },
        })) as never,
      })
    ).toEqual({
      status: "error",
      code: "not-configured",
      message: "未設定",
    });

    expect(
      await assistConfirmed({
        isOnline: () => true,
        search: async () => {
          throw new Error("index");
        },
      })
    ).toMatchObject({
      status: "error",
      code: "search-failed",
    });
  });
});

/** 分類: 確認を求められたら送る（アービターが確認した場合） */
async function classifyConfirmed(
  text: string,
  deps: ExternalAiGuardDeps
): Promise<ClassifyTextResult> {
  const step = await prepareIncidentClassification(
    text,
    {},
    {
      ...NO_IDS,
      ...deps,
    }
  );
  return step.status === "done" ? step.result : step.send();
}

describe("prepareIncidentClassification", () => {
  it("uses the LLM classification after confirmation, sending only the narrative", async () => {
    const call = vi.fn(async () => ({
      ok: true,
      result: {
        category: "player-behavior",
        missingInformation: [],
        followUpQuestions: ["電源は切れていましたか？"],
        needsTournamentRules: true,
        confidence: "medium",
      },
      model: "m",
    }));
    const r = await classifyConfirmed("黒のスマホが鳴った", {
      call: call as never,
      isOnline: () => true,
    });
    expect(r.classification?.method).toBe("llm");
    expect(r.classification?.followUpQuestions).toEqual([
      "電源は切れていましたか？",
    ]);
    expect(r.notice).toBeUndefined();
    expect((call.mock.calls[0] as unknown[]).slice(0, 2)).toEqual([
      "classify",
      { narrative: "黒のスマホが鳴った" },
    ]);
  });

  it("re-identifies placeholders in the follow-up questions and missing information", async () => {
    const r = await classifyConfirmed("田中太郎のスマホが鳴った", {
      identifiers: async () => ({
        ...NO_IDENTIFIERS,
        players: [{ name: "田中 太郎" }],
      }),
      isOnline: () => true,
      call: (async () => ({
        ok: true,
        result: {
          category: "player-behavior",
          missingInformation: ["〈選手A〉の手番"],
          followUpQuestions: ["〈選手A〉の電源は切れていましたか？"],
          needsTournamentRules: false,
          confidence: "medium",
        },
        model: "m",
      })) as never,
    });
    expect(r.classification?.followUpQuestions).toEqual([
      "田中 太郎の電源は切れていましたか？",
    ]);
    expect(r.classification?.missingInformation).toEqual(["田中 太郎の手番"]);
  });

  it("declining sends nothing and shows the keyword classification", async () => {
    const call = vi.fn();
    const step = await prepareIncidentClassification(
      "黒のスマホが鳴った",
      {},
      { ...NO_IDS, call, isOnline: () => true }
    );
    if (step.status !== "needs-confirmation") throw new Error("expected");
    expect(step.preview.fields.map((f) => f.text)).toEqual([
      "黒のスマホが鳴った",
    ]);
    const r = step.decline();
    expect(call).not.toHaveBeenCalled();
    expect(r.classification?.method).toBe("keyword");
    expect(r.notice).toMatch(/送信していません/);
  });

  it("falls back to keywords when offline, on errors and on invalid output", async () => {
    const offline = await classifyConfirmed("黒が両手でキャスリングした", {
      isOnline: () => false,
    });
    expect(offline.classification).toMatchObject({
      category: "illegal-move",
      method: "keyword",
    });
    expect(offline.notice).toMatch(/オフライン/);

    const failed = await classifyConfirmed("黒のスマホが鳴った", {
      isOnline: () => true,
      call: (async () => ({
        ok: false,
        error: { code: "upstream-timeout", message: "timeout" },
      })) as never,
    });
    expect(failed.classification?.category).toBe("player-behavior");
    expect(failed.notice).toMatch(/キーワード分類/);

    const invalid = await classifyConfirmed("フラッグが落ちた", {
      isOnline: () => true,
      call: (async () => ({
        ok: true,
        result: { category: "nonsense" },
        model: "m",
      })) as never,
    });
    expect(invalid.classification).toMatchObject({
      category: "clock-time",
      subtype: "flag-fall",
      method: "keyword",
    });
  });

  it("text the gate holds back is classified locally with the reason (not sent)", async () => {
    const call = vi.fn();
    const r = await classifyConfirmed("白が会場で具合が悪そうにしていた", {
      call,
      isOnline: () => true,
    });
    expect(call).not.toHaveBeenCalled();
    expect(r.notice).toMatch(/外部AIには送信していません（理由: /);
  });

  it("the opt-out switch keeps everything local", async () => {
    const call = vi.fn();
    const step = await prepareIncidentClassification(
      "黒のスマホが鳴った",
      { doNotSend: true },
      { ...NO_IDS, call, isOnline: () => true }
    );
    expect(step.status).toBe("done");
    expect(step.status === "done" && step.result.notice).toMatch(
      /「外部AIに送らない」がオン/
    );
    expect(call).not.toHaveBeenCalled();
  });

  it("returns null for empty input", async () => {
    const call = vi.fn();
    expect(await classifyConfirmed("  ", { call })).toEqual({
      classification: null,
    });
    expect(call).not.toHaveBeenCalled();
  });
});

/** サーバーの再確認（L5）で止まった応答（J1a-3, external-ai-data-protection.md §12） */
describe("not-sendable from the server (L5)", () => {
  const notSendable = () =>
    vi.fn(async (): Promise<LlmApiResponse> => ({
      ok: false,
      error: {
        code: "not-sendable",
        message: "送信前の確認（サーバー）で止めました",
      },
    }));

  it("reasoning: becomes not-sent (local handling), not a retryable error", async () => {
    const call = notSendable();
    const res = await assistConfirmed({
      isOnline: () => true,
      search: async () => [
        searchResult("r1", "対局中、電子機器を持ち込んではならない。"),
      ],
      storedRuleIds: async (ids) => ids,
      call: call as never,
    });
    expect(res).toEqual({ status: "not-sent", reasons: ["residual"] });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("classification: falls back to the keyword classification", async () => {
    const r = await classifyConfirmed("黒のスマホが鳴った", {
      call: notSendable() as never,
      isOnline: () => true,
    });
    expect(r.classification?.method).toBe("keyword");
  });
});
