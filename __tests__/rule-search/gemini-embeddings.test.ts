import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_MODEL_ID,
  EmbeddingUnavailableError,
  generateEmbeddings,
  generateQueryEmbedding,
} from "@/lib/infrastructure/embeddings/generator";
import {
  EMBEDDING_MODEL,
  LLM_LIMITS,
  type LlmApiResponse,
} from "@/lib/infrastructure/llm/contract";
import type { callLlmApi } from "@/lib/infrastructure/llm/llm-api-client";
import {
  findRulesMissingEmbeddings,
  generateMissingEmbeddings,
  type BackfillDeps,
} from "@/lib/application/embedding-backfill";
import { getRuleStatistics } from "@/lib/application/rule-library";
import { ArbiterDatabase, db } from "@/lib/infrastructure/db";
import { hybridSearch } from "@/lib/infrastructure/ai/hybrid-search";
import { clearFulltextIndex } from "@/lib/infrastructure/ai/fulltext-search";
import type { Embedding } from "@/lib/domain/entities";
import { makeRule, makeSource } from "./fixtures";

const DIM = EMBEDDING_MODEL.dimensions;
const vec = (x: number) =>
  Array.from({ length: DIM }, (_, i) => (i === 0 ? x : 0.01));

type Call = typeof callLlmApi;

function okCall(): ReturnType<typeof vi.fn<Call>> {
  return vi.fn<Call>(async (_kind, body) => {
    const texts = (body as { texts: string[] }).texts;
    return {
      ok: true,
      result: { vectors: texts.map((_, i) => vec(i + 1)) },
      model: EMBEDDING_MODEL.key,
    };
  });
}

const fail = (code: string): LlmApiResponse =>
  ({ ok: false, error: { code, message: code } }) as LlmApiResponse;

describe("Gemini embeddings client (ADR-010)", () => {
  it("sends documents in batches of 16 with progress, truncating long texts", async () => {
    const call = okCall();
    const texts = Array.from({ length: 20 }, (_, i) =>
      i === 0 ? "x".repeat(LLM_LIMITS.maxEmbedTextChars + 100) : `rule ${i}`
    );
    const progress: Array<[number, number]> = [];
    const vectors = await generateEmbeddings(texts, {
      onProgress: (d, t) => progress.push([d, t]),
      deps: { call },
    });
    expect(vectors).toHaveLength(20);
    expect(call).toHaveBeenCalledTimes(2);
    const first = call.mock.calls[0][1] as {
      taskType: string;
      texts: string[];
    };
    expect(first.taskType).toBe("document");
    expect(first.texts).toHaveLength(16);
    expect(first.texts[0]).toHaveLength(LLM_LIMITS.maxEmbedTextChars);
    expect(progress).toEqual([
      [16, 20],
      [20, 20],
    ]);
  });

  it("waits and retries transient failures for documents, then gives up with a typed error", async () => {
    const sleep = vi.fn(async () => {});
    const call = vi
      .fn<Call>()
      .mockResolvedValueOnce(fail("rate-limited"))
      .mockResolvedValueOnce(fail("upstream-unavailable"))
      .mockImplementation(okCall());
    await expect(
      generateEmbeddings(["a"], { deps: { call, sleep } })
    ).resolves.toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(2);

    const always = vi.fn<Call>(async () => fail("rate-limited"));
    await expect(
      generateEmbeddings(["a"], { deps: { call: always, sleep } })
    ).rejects.toMatchObject({ code: "rate-limited" });

    // 再試行しても直らない失敗（未認証など）はすぐに終了する
    const unauthorized = vi.fn<Call>(async () => fail("unauthorized"));
    await expect(
      generateEmbeddings(["a"], { deps: { call: unauthorized, sleep } })
    ).rejects.toBeInstanceOf(EmbeddingUnavailableError);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it("rejects a response with the wrong model key or dimensions", async () => {
    const wrongModel = vi.fn<Call>(async () => ({
      ok: true,
      result: { vectors: [vec(1)] },
      model: "other@768",
    }));
    await expect(
      generateQueryEmbedding("違法手", { call: wrongModel })
    ).rejects.toMatchObject({ code: "invalid-response" });
    const wrongDim = vi.fn<Call>(async () => ({
      ok: true,
      result: { vectors: [[1, 2, 3]] },
      model: EMBEDDING_MODEL.key,
    }));
    await expect(
      generateQueryEmbedding("違法手", { call: wrongDim })
    ).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("returns the vectors created before a failed batch on the error", async () => {
    const sleep = vi.fn(async () => {});
    const call = vi
      .fn<Call>()
      .mockImplementationOnce(okCall())
      .mockResolvedValue(fail("unauthorized"));
    const texts = Array.from({ length: 20 }, (_, i) => `rule ${i}`);
    const error = await generateEmbeddings(texts, {
      deps: { call, sleep },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmbeddingUnavailableError);
    expect((error as EmbeddingUnavailableError).partialVectors).toHaveLength(
      16
    );
  });

  it("uses a short client timeout for queries and checks fair play on the full query", async () => {
    const call = okCall();
    await generateQueryEmbedding("違法手", { call });
    expect(call.mock.calls[0][2]).toMatchObject({ timeoutMs: 5_000 });

    const long = `${"a".repeat(LLM_LIMITS.maxEmbedTextChars + 10)} カンニング`;
    await expect(generateQueryEmbedding(long, { call })).rejects.toMatchObject({
      code: "fair-play",
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("never sends a fair-play query, and does not retry queries", async () => {
    const call = vi.fn<Call>(async () => fail("rate-limited"));
    await expect(
      generateQueryEmbedding("相手がカンニングしている疑い", { call })
    ).rejects.toMatchObject({ code: "fair-play" });
    expect(call).not.toHaveBeenCalled();

    await expect(
      generateQueryEmbedding("違法手", { call, sleep: async () => {} })
    ).rejects.toMatchObject({ code: "rate-limited" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][1]).toEqual({
      taskType: "query",
      texts: ["違法手"],
    });
  });
});

describe("generateMissingEmbeddings (backfill)", () => {
  let database: ArbiterDatabase;
  beforeEach(async () => {
    database = new ArbiterDatabase();
    await database.open();
  });
  afterEach(async () => {
    await database.delete();
  });

  function backfillDeps(overrides: Partial<BackfillDeps> = {}): BackfillDeps {
    let n = 0;
    return {
      database,
      embed: async (texts) => texts.map(() => vec(1)),
      modelId: EMBEDDING_MODEL_ID,
      now: () => new Date(0),
      newId: () => `emb-${++n}`,
      ...overrides,
    };
  }

  async function seed(count: number) {
    const active = makeSource();
    const old = makeSource({ status: "superseded" });
    const rules = Array.from({ length: count }, () =>
      makeRule({ sourceId: active.id })
    );
    const oldRule = makeRule({ sourceId: old.id });
    await database.ruleSources.bulkAdd([active, old]);
    await database.rules.bulkAdd([...rules, oldRule]);
    return { active, rules, oldRule };
  }

  it("creates embeddings only for searchable rules and removes other models' vectors", async () => {
    const { rules, oldRule } = await seed(3);
    const stale: Embedding = {
      id: "stale",
      ruleId: rules[0].id,
      vector: [1, 2, 3],
      model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
      createdAt: new Date(0),
    };
    await database.embeddings.add(stale);

    const result = await generateMissingEmbeddings(undefined, backfillDeps());
    expect(result).toEqual({ created: 3, total: 3 });
    const stored = await database.embeddings.toArray();
    expect(stored.every((e) => e.model === EMBEDDING_MODEL_ID)).toBe(true);
    expect(stored.map((e) => e.ruleId).sort()).toEqual(
      rules.map((r) => r.id).sort()
    );
    expect(stored.some((e) => e.ruleId === oldRule.id)).toBe(false);
    expect(await findRulesMissingEmbeddings(database)).toEqual([]);
  });

  it("keeps the batches saved before a failure, and resumes later", async () => {
    await seed(20);
    let calls = 0;
    const flaky = backfillDeps({
      embed: async (texts) => {
        calls++;
        if (calls === 2) throw new Error("rate limited");
        return texts.map(() => vec(1));
      },
    });
    const first = await generateMissingEmbeddings(undefined, flaky);
    expect(first).toEqual({ created: 16, total: 20, error: "rate limited" });
    expect(await database.embeddings.count()).toBe(16);

    const second = await generateMissingEmbeddings(undefined, flaky);
    expect(second).toEqual({ created: 4, total: 4 });
    expect(await database.embeddings.count()).toBe(20);
  });

  it("does not save vectors for rules deleted while their batch was being embedded, and shares a running backfill", async () => {
    const { rules } = await seed(2);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const embed = vi.fn(async (texts: readonly string[]) => {
      await gate;
      return texts.map(() => vec(1));
    });
    const deps = backfillDeps({ embed });
    const a = generateMissingEmbeddings(undefined, deps);
    const b = generateMissingEmbeddings(undefined, deps);
    expect(b).toBe(a);
    // 埋め込み完了前の時点で資料（条文）を削除する
    await vi.waitFor(() => expect(embed).toHaveBeenCalled());
    await database.rules.delete(rules[0].id);
    release();
    expect(await a).toEqual({ created: 1, total: 2 });
    expect(embed).toHaveBeenCalledTimes(1);
    expect((await database.embeddings.toArray()).map((e) => e.ruleId)).toEqual([
      rules[1].id,
    ]);
  });
});

describe("rule statistics and search with Gemini embeddings", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    clearFulltextIndex();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("counts searchable rules without current-model embeddings", async () => {
    const source = makeSource();
    const [a, b] = [
      makeRule({ sourceId: source.id }),
      makeRule({ sourceId: source.id }),
    ];
    await db.ruleSources.add(source);
    await db.rules.bulkAdd([a, b]);
    await db.embeddings.add({
      id: "e1",
      ruleId: a.id,
      vector: vec(1),
      model: EMBEDDING_MODEL_ID,
      createdAt: new Date(0),
    });
    const stats = await getRuleStatistics();
    expect(stats.missingEmbeddingCount).toBe(1);
    expect(stats.sources[0].embeddingCount).toBe(1);
  });

  it("does not call the server when no embeddings exist, and uses the query vector when they do", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { texts: string[] };
      return new Response(
        JSON.stringify({
          ok: true,
          result: { vectors: body.texts.map(() => vec(1)) },
          model: EMBEDDING_MODEL.key,
        }),
        { headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const source = makeSource();
    const rule = makeRule({
      sourceId: source.id,
      title: "Illegal move",
      content: "An illegal move is completed",
    });
    await db.ruleSources.add(source);
    await db.rules.add(rule);

    const keywordOnly = await hybridSearch("illegal", {
      tournamentId: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keywordOnly.failures.vector).toMatch(/意味検索用データがありません/);

    await db.embeddings.add({
      id: "e1",
      ruleId: rule.id,
      vector: vec(1),
      model: EMBEDDING_MODEL_ID,
      createdAt: new Date(0),
    });
    const both = await hybridSearch("違法な手を指した", {
      tournamentId: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(both.failures.vector).toBeUndefined();
    expect(both.results[0]?.rule.id).toBe(rule.id);
    expect(both.results[0]?.methods).toContain("vector");
  });
});
