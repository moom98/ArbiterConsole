// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { callLlmApi } from "@/lib/infrastructure/llm/llm-api-client";
import { createLlmAssistPort } from "@/lib/infrastructure/llm/llm-assist-port";
import { classifyIncidentText } from "@/lib/application/llm-classification";
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
    description: "スマートウォッチを着けている",
    arbiterObserved: true,
  },
  context: {
    competitionType: "standard",
    rulesVersion: "FIDE-2023",
    tournamentId: "t1",
  },
};

describe("createLlmAssistPort", () => {
  it("offline → no search, no server call", async () => {
    const search = vi.fn();
    const call = vi.fn();
    const port = createLlmAssistPort({ isOnline: () => false, search, call });
    expect(await port.assist(REQUEST)).toEqual({ status: "offline" });
    expect(search).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("no retrieved articles → no-articles without calling the server", async () => {
    const call = vi.fn();
    const port = createLlmAssistPort({
      isOnline: () => true,
      search: async () => [],
      call,
    });
    expect(await port.assist(REQUEST)).toEqual({ status: "no-articles" });
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
    const port = createLlmAssistPort({
      isOnline: () => true,
      search,
      call: call as never,
      storedRuleIds: async (ids) => ids.filter((id) => id !== "r2"),
    });
    const out = await port.assist(REQUEST);
    expect(search).toHaveBeenCalledWith("スマートウォッチを着けている", "t1");
    const body = (call.mock.calls[0] as unknown[])[1] as {
      articles: Array<{ id: string; content: string; sourceName?: string }>;
      context: unknown;
    };
    expect(body.context).toEqual(REQUEST.context);
    expect(body.articles.map((a) => a.id)).toEqual(["r1", "r2"]);
    expect(body.articles[0].sourceName).toBe("テスト大会 大会規定");
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
    const failing = createLlmAssistPort({
      isOnline: () => true,
      search: async () => [searchResult("r1", "本文本文本文本文")],
      call: (async () => ({
        ok: false,
        error: { code: "not-configured", message: "未設定" },
      })) as never,
    });
    expect(await failing.assist(REQUEST)).toEqual({
      status: "error",
      code: "not-configured",
      message: "未設定",
    });

    const searchFails = createLlmAssistPort({
      isOnline: () => true,
      search: async () => {
        throw new Error("index");
      },
    });
    expect(await searchFails.assist(REQUEST)).toMatchObject({
      status: "error",
      code: "search-failed",
    });
  });
});

describe("classifyIncidentText", () => {
  it("uses the LLM classification when available", async () => {
    const r = await classifyIncidentText("スマートウォッチを着けている", {
      call: (async () => ({
        ok: true,
        result: {
          category: "player-behavior",
          missingInformation: [],
          followUpQuestions: ["電源は切れていましたか？"],
          needsTournamentRules: true,
          confidence: "medium",
        },
        model: "m",
      })) as never,
    });
    expect(r.classification?.method).toBe("llm");
    expect(r.classification?.followUpQuestions).toEqual([
      "電源は切れていましたか？",
    ]);
    expect(r.notice).toBeUndefined();
  });

  it("falls back to keywords when offline, on errors and on invalid output", async () => {
    const offline = await classifyIncidentText("黒が両手でキャスリングした", {
      isOnline: () => false,
    });
    expect(offline.classification).toMatchObject({
      category: "illegal-move",
      method: "keyword",
    });
    expect(offline.notice).toMatch(/オフライン/);

    const failed = await classifyIncidentText("スマホが鳴った", {
      call: (async () => ({
        ok: false,
        error: { code: "upstream-timeout", message: "timeout" },
      })) as never,
    });
    expect(failed.classification?.category).toBe("player-behavior");
    expect(failed.notice).toMatch(/キーワード分類/);

    const invalid = await classifyIncidentText("フラッグが落ちた", {
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

  it("returns null for empty input", async () => {
    const call = vi.fn();
    expect(await classifyIncidentText("  ", { call })).toEqual({
      classification: null,
    });
    expect(call).not.toHaveBeenCalled();
  });
});
