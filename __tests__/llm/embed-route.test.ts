// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  createEmbedRouteHandler,
  type EmbedHandlerDeps,
} from "@/lib/infrastructure/llm/server/handler";
import {
  InvalidEmbeddingOutput,
  UpstreamError,
  type EmbedTextsFn,
} from "@/lib/infrastructure/llm/server/generate";
import {
  DailyRequestCounter,
  TokenBucketRateLimiter,
} from "@/lib/infrastructure/llm/server/rate-limiter";
import { readLlmConfig } from "@/lib/infrastructure/llm/server/config";
import { EMBEDDING_MODEL, LLM_LIMITS } from "@/lib/infrastructure/llm/contract";

const SECRET = "AIzaSy-test-secret-key";
const DIM = EMBEDDING_MODEL.dimensions;

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/llm/embed", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const okEmbed = vi.fn<EmbedTextsFn>(async (req) =>
  req.texts.map((_, i) => Array.from({ length: DIM }, () => i / 10))
);

function makeDeps(
  embed: EmbedTextsFn,
  overrides: Partial<EmbedHandlerDeps> = {}
): Partial<EmbedHandlerDeps> {
  return {
    config: () => readLlmConfig({ GEMINI_API_KEY: SECRET }),
    embed,
    rateLimiter: new TokenBucketRateLimiter({
      capacity: 100,
      refillIntervalMs: 60_000,
    }),
    retry: {
      attempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 40,
      totalDeadlineMs: 10_000,
      minRemainingForRetryMs: 0,
      now: () => 0,
      sleep: async () => {},
      random: () => 0.5,
    },
    timeoutMs: 50,
    dailyCounter: new DailyRequestCounter(),
    log: () => {},
    ...overrides,
  };
}

async function errorOf(res: Response) {
  const body = await res.json();
  expect(body.ok).toBe(false);
  return body.error as { code: string; message: string };
}

describe("/api/llm/embed (ADR-010)", () => {
  it("returns one vector per text with the fixed model key, using the fixed model and dimensions", async () => {
    const embed = vi.fn<EmbedTextsFn>(okEmbed);
    const handler = createEmbedRouteHandler(makeDeps(embed));
    const res = await handler(
      request({ taskType: "document", texts: ["7.5.4 違法手", "6.9 時間切れ"] })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, model: EMBEDDING_MODEL.key });
    expect(body.result.vectors).toHaveLength(2);
    expect(body.result.vectors[0]).toHaveLength(DIM);
    expect(embed).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: SECRET,
        model: EMBEDDING_MODEL.id,
        dimensions: DIM,
        taskType: "document",
        texts: ["7.5.4 違法手", "6.9 時間切れ"],
      })
    );
  });

  it.each([
    [{ taskType: "other", texts: ["a"] }],
    [{ taskType: "document", texts: [] }],
    [{ taskType: "document", texts: ["ok", ""] }],
    [{ taskType: "document", texts: [1] }],
    [{ taskType: "query", texts: ["a", "b"] }],
    [
      {
        taskType: "document",
        texts: Array.from({ length: LLM_LIMITS.maxEmbedTexts + 1 }, () => "x"),
      },
    ],
    [
      {
        taskType: "document",
        texts: ["x".repeat(LLM_LIMITS.maxEmbedTextChars + 1)],
      },
    ],
  ])("rejects invalid input %j without calling Gemini", async (body) => {
    const embed = vi.fn<EmbedTextsFn>(okEmbed);
    const res = await createEmbedRouteHandler(makeDeps(embed))(request(body));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("invalid-request");
    expect(embed).not.toHaveBeenCalled();
  });

  it("never sends a fair-play query, but accepts rule text that mentions fair play", async () => {
    const embed = vi.fn<EmbedTextsFn>(okEmbed);
    const handler = createEmbedRouteHandler(makeDeps(embed));
    const q = await handler(
      request({ taskType: "query", texts: ["相手がカンニングしている疑い"] })
    );
    expect(q.status).toBe(400);
    expect(embed).not.toHaveBeenCalled();

    // 公開された規則の条文（例: FIDE 11.3 の電子機器・不正行為）は送ってよい
    const doc = await handler(
      request({
        taskType: "document",
        texts: ["11.3 Fair play: suspected engine assistance is forbidden"],
      })
    );
    expect(doc.status).toBe(200);
  });

  it("uses the same access-token guard as the other AI routes", async () => {
    const embed = vi.fn<EmbedTextsFn>(okEmbed);
    const prod = () =>
      readLlmConfig({ GEMINI_API_KEY: SECRET, NODE_ENV: "production" });
    const closed = await createEmbedRouteHandler(
      makeDeps(embed, { config: prod })
    )(request({ taskType: "query", texts: ["違法手"] }));
    expect(closed.status).toBe(503);

    const withToken = () =>
      readLlmConfig({ GEMINI_API_KEY: SECRET, LLM_ACCESS_TOKEN: "tok" });
    const handler = createEmbedRouteHandler(
      makeDeps(embed, { config: withToken })
    );
    expect(
      (await handler(request({ taskType: "query", texts: ["違法手"] }))).status
    ).toBe(401);
    expect(
      (
        await handler(
          request(
            { taskType: "query", texts: ["違法手"] },
            { "x-arbiter-access-token": "tok" }
          )
        )
      ).status
    ).toBe(200);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("counts embed requests against their own daily cap", async () => {
    const handler = createEmbedRouteHandler(
      makeDeps(okEmbed, {
        config: () =>
          readLlmConfig({
            GEMINI_API_KEY: SECRET,
            LLM_DAILY_EMBED_REQUEST_LIMIT: "1",
            LLM_DAILY_REQUEST_LIMIT: "0",
          }),
      })
    );
    const body = { taskType: "query", texts: ["違法手"] };
    expect((await handler(request(body))).status).toBe(200);
    const capped = await handler(request(body));
    expect(capped.status).toBe(429);
    expect((await errorOf(capped)).code).toBe("quota-exceeded");
  });

  it("tries a query only once with a short per-attempt timeout", async () => {
    const flaky = vi.fn<EmbedTextsFn>(async () => {
      throw new UpstreamError("status", 503);
    });
    const res = await createEmbedRouteHandler(
      makeDeps(flaky, { timeoutMs: 15_000 })
    )(request({ taskType: "query", texts: ["違法手"] }));
    expect(res.status).toBe(503);
    expect(flaky).toHaveBeenCalledTimes(1);
    expect(flaky.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(4_000);
  });

  it("retries transient upstream errors and maps a malformed response to invalid-model-output without retrying", async () => {
    let calls = 0;
    const flaky = vi.fn<EmbedTextsFn>(async (req) => {
      calls++;
      if (calls === 1) throw new UpstreamError("status", 429);
      return okEmbed(req);
    });
    const ok = await createEmbedRouteHandler(makeDeps(flaky))(
      request({ taskType: "document", texts: ["7.5.4 違法手"] })
    );
    expect(ok.status).toBe(200);
    expect(flaky).toHaveBeenCalledTimes(2);

    const broken = vi.fn<EmbedTextsFn>(async () => {
      throw new InvalidEmbeddingOutput();
    });
    const bad = await createEmbedRouteHandler(makeDeps(broken))(
      request({ taskType: "query", texts: ["違法手"] })
    );
    expect(bad.status).toBe(502);
    expect((await errorOf(bad)).code).toBe("invalid-model-output");
    expect(broken).toHaveBeenCalledTimes(1);
  });
});
