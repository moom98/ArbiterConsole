// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  createLlmRouteHandler,
  type LlmHandlerDeps,
} from "@/lib/infrastructure/llm/server/handler";
import type {
  GenerateJsonFn,
  GenerateJsonRequest,
} from "@/lib/infrastructure/llm/server/generate";
import {
  clientKey,
  DailyRequestCounter,
  TokenBucketRateLimiter,
} from "@/lib/infrastructure/llm/server/rate-limiter";
import {
  readLlmConfig,
  resolveThinking,
} from "@/lib/infrastructure/llm/server/config";
import { LLM_LIMITS } from "@/lib/infrastructure/llm/contract";
import { ARTICLES, validDraft } from "./fixtures";

const SECRET = "AIzaSy-test-secret-key";

function reasonBody(overrides: Record<string, unknown> = {}) {
  return {
    incident: {
      category: "player-behavior",
      description: "黒がスマートウォッチを着けている",
      arbiterObserved: true,
    },
    context: { competitionType: "standard", rulesVersion: "FIDE-2023" },
    articles: ARTICLES,
    ...overrides,
  };
}

function request(
  body: unknown,
  init: {
    contentType?: string;
    ip?: string;
    raw?: string;
    headers?: Record<string, string>;
  } = {}
) {
  return new Request("http://localhost/api/llm/reason", {
    method: "POST",
    headers: {
      "content-type": init.contentType ?? "application/json",
      "x-forwarded-for": init.ip ?? "203.0.113.1",
      ...init.headers,
    },
    body: init.raw ?? JSON.stringify(body),
  });
}

function makeDeps(
  generate: GenerateJsonFn,
  overrides: Partial<LlmHandlerDeps> = {}
): Partial<LlmHandlerDeps> {
  return {
    config: () => readLlmConfig({ GEMINI_API_KEY: SECRET }),
    generate,
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
    timeoutMs: { reason: 50, classify: 50 },
    dailyCounter: new DailyRequestCounter(),
    log: () => {},
    ...overrides,
  };
}

const okGenerate = vi.fn<GenerateJsonFn>(async () => ({
  text: JSON.stringify(validDraft()),
}));

async function errorOf(res: Response) {
  const body = await res.json();
  expect(body.ok).toBe(false);
  return body.error as { code: string; message: string };
}

describe("LLM route handler – reason", () => {
  it("returns the parsed model JSON and the model id", async () => {
    const generate = vi.fn<GenerateJsonFn>(async () => ({
      text: JSON.stringify(validDraft()),
    }));
    const handler = createLlmRouteHandler("reason", makeDeps(generate));
    const res = await handler(request(reasonBody()));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      result: validDraft(),
      model: "gemini-flash-latest",
    });

    const req = generate.mock.calls[0][0] as GenerateJsonRequest;
    expect(req.apiKey).toBe(SECRET);
    expect(req.model).toBe("gemini-flash-latest");
    // 引用できる条文 ID は提示した ID に限定する
    const schema = req.responseJsonSchema as {
      properties: {
        citations: { items: { properties: { articleId: { enum: string[] } } } };
      };
    };
    expect(schema.properties.citations.items.properties.articleId.enum).toEqual(
      ARTICLES.map((a) => a.id)
    );
    expect(req.userContent).toContain("rule-tournament-5");
    expect(req.systemInstruction).toMatch(/提示された条文/);
  });

  it("uses model ids from the environment", async () => {
    const generate = vi.fn<GenerateJsonFn>(async () => ({ text: "{}" }));
    const handler = createLlmRouteHandler(
      "reason",
      makeDeps(generate, {
        config: () =>
          readLlmConfig({
            GEMINI_API_KEY: SECRET,
            GEMINI_MODEL_REASONING: "gemini-pro-latest",
          }),
      })
    );
    await handler(request(reasonBody()));
    expect(generate.mock.calls[0][0].model).toBe("gemini-pro-latest");
  });

  describe("input validation", () => {
    it("rejects a non-JSON content type with 415", async () => {
      const handler = createLlmRouteHandler("reason", makeDeps(okGenerate));
      const res = await handler(
        request(reasonBody(), { contentType: "text/plain" })
      );
      expect(res.status).toBe(415);
    });

    it("rejects malformed JSON with 400", async () => {
      const handler = createLlmRouteHandler("reason", makeDeps(okGenerate));
      const res = await handler(request(null, { raw: "{not json" }));
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe("invalid-request");
    });

    it.each([
      ["missing incident", { incident: undefined }],
      [
        "unknown category",
        {
          incident: {
            category: "cheating",
            description: "x",
            arbiterObserved: true,
          },
        },
      ],
      [
        "missing description",
        {
          incident: {
            category: "player-behavior",
            description: " ",
            arbiterObserved: true,
          },
        },
      ],
      [
        "rapid without regime",
        { context: { competitionType: "rapid", rulesVersion: "FIDE-2023" } },
      ],
      ["no articles", { articles: [] }],
      [
        "too many articles",
        {
          articles: Array.from(
            { length: LLM_LIMITS.maxArticles + 1 },
            (_, i) => ({
              ...ARTICLES[0],
              id: `r${i}`,
            })
          ),
        },
      ],
      [
        "duplicate article ids",
        { articles: [ARTICLES[0], { ...ARTICLES[1], id: ARTICLES[0].id }] },
      ],
      [
        "article content too long",
        {
          articles: [
            {
              ...ARTICLES[0],
              content: "x".repeat(LLM_LIMITS.maxArticleContentChars + 1),
            },
          ],
        },
      ],
    ])("rejects %s with 400 and does not call the model", async (_n, o) => {
      const generate = vi.fn<GenerateJsonFn>();
      const handler = createLlmRouteHandler("reason", makeDeps(generate));
      const res = await handler(request(reasonBody(o)));
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe("invalid-request");
      expect(generate).not.toHaveBeenCalled();
    });

    it("rejects an oversized body with 413", async () => {
      const handler = createLlmRouteHandler("reason", makeDeps(okGenerate));
      const res = await handler(
        request(null, {
          raw: JSON.stringify({ pad: "x".repeat(LLM_LIMITS.maxBodyBytes) }),
        })
      );
      expect(res.status).toBe(413);
    });
  });

  it("rate limits per client IP with Retry-After", async () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter({
      capacity: 10,
      refillIntervalMs: 60_000,
      now: () => now,
    });
    const handler = createLlmRouteHandler(
      "reason",
      makeDeps(okGenerate, {
        rateLimiter: limiter,
        config: () =>
          readLlmConfig({ GEMINI_API_KEY: SECRET, TRUST_PROXY: "1" }),
      })
    );
    for (let i = 0; i < 10; i++) {
      expect((await handler(request(reasonBody()))).status).toBe(200);
    }
    const limited = await handler(request(reasonBody()));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("6");
    expect((await errorOf(limited)).code).toBe("rate-limited");

    // 別の IP は影響を受けない
    expect(
      (await handler(request(reasonBody(), { ip: "198.51.100.7" }))).status
    ).toBe(200);
    // 6秒後に1件分回復する
    now = 6_000;
    expect((await handler(request(reasonBody()))).status).toBe(200);
  });

  it("missing key → 503 not-configured without leaking configuration", async () => {
    const generate = vi.fn<GenerateJsonFn>();
    const log = vi.fn();
    const handler = createLlmRouteHandler(
      "reason",
      makeDeps(generate, { config: () => readLlmConfig({}), log })
    );
    const res = await handler(request(reasonBody()));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("not-configured");
    expect(text).not.toMatch(/GEMINI|API_KEY|AIza/);
    expect(generate).not.toHaveBeenCalled();
  });

  it("never echoes the API key or the incident text in responses or logs", async () => {
    const log = vi.fn();
    const handler = createLlmRouteHandler(
      "reason",
      makeDeps(
        async () => {
          throw Object.assign(new Error(`bad key ${SECRET}`), { status: 400 });
        },
        { log }
      )
    );
    const res = await handler(request(reasonBody()));
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("スマートウォッチ");
  });

  describe("upstream error mapping", () => {
    it.each([
      [400, 502, "upstream-error", 1],
      [403, 502, "upstream-error", 1],
      [429, 503, "upstream-unavailable", 3],
      [500, 503, "upstream-unavailable", 3],
      [503, 503, "upstream-unavailable", 3],
    ])(
      "SDK ApiError status %i → HTTP %i %s after %i attempt(s)",
      async (status, http, code, attempts) => {
        const generate = vi.fn<GenerateJsonFn>(async () => {
          throw Object.assign(new Error("api error"), {
            name: "ApiError",
            status,
          });
        });
        const handler = createLlmRouteHandler("reason", makeDeps(generate));
        const res = await handler(request(reasonBody()));
        expect(res.status).toBe(http);
        expect((await errorOf(res)).code).toBe(code);
        expect(generate).toHaveBeenCalledTimes(attempts);
      }
    );

    it("retries transient errors with backoff and succeeds", async () => {
      const sleep = vi.fn(async () => {});
      let calls = 0;
      const generate = vi.fn<GenerateJsonFn>(async () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error("x"), { status: 503 });
        if (calls === 2) throw new TypeError("fetch failed");
        return { text: JSON.stringify(validDraft()) };
      });
      const deps = makeDeps(generate);
      const handler = createLlmRouteHandler("reason", {
        ...deps,
        retry: { ...deps.retry!, sleep },
      });
      const res = await handler(request(reasonBody()));
      expect(res.status).toBe(200);
      expect(generate).toHaveBeenCalledTimes(3);
      // 指数バックオフ: 10ms → 20ms の [exp/2, exp) に jitter
      expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([8, 15]);
    });

    it("times out each attempt and maps to 504 upstream-timeout", async () => {
      const signals: AbortSignal[] = [];
      const generate = vi.fn<GenerateJsonFn>(
        (req) =>
          new Promise(() => {
            signals.push(req.signal);
          })
      );
      const handler = createLlmRouteHandler("reason", makeDeps(generate));
      const res = await handler(request(reasonBody()));
      expect(res.status).toBe(504);
      expect((await errorOf(res)).code).toBe("upstream-timeout");
      expect(generate).toHaveBeenCalledTimes(3);
      expect(signals.every((s) => s.aborted)).toBe(true);
    });

    it("stops retrying when the total deadline would be exceeded", async () => {
      const generate = vi.fn<GenerateJsonFn>(async () => {
        throw Object.assign(new Error("x"), { status: 503 });
      });
      const deps = makeDeps(generate);
      const handler = createLlmRouteHandler("reason", {
        ...deps,
        retry: { ...deps.retry!, totalDeadlineMs: 5 },
      });
      await handler(request(reasonBody()));
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("blocked / empty output → 422", async () => {
      const handler = createLlmRouteHandler(
        "reason",
        makeDeps(async () => ({ text: undefined, blocked: true }))
      );
      const res = await handler(request(reasonBody()));
      expect(res.status).toBe(422);
      expect((await errorOf(res)).code).toBe("blocked");
    });

    it("non-JSON model output → 502 invalid-model-output", async () => {
      const handler = createLlmRouteHandler(
        "reason",
        makeDeps(async () => ({
          text: '{"conclusion": "trunc',
          truncated: true,
        }))
      );
      const res = await handler(request(reasonBody()));
      expect(res.status).toBe(502);
      expect((await errorOf(res)).code).toBe("invalid-model-output");
    });
  });
});

describe("LLM route handler – classify", () => {
  it("uses the classifier model and validates the text", async () => {
    const generate = vi.fn<GenerateJsonFn>(async () => ({
      text: JSON.stringify({ category: "player-behavior" }),
    }));
    const handler = createLlmRouteHandler("classify", makeDeps(generate));
    const res = await handler(
      request({ text: "スマートウォッチを着けている" })
    );
    expect(res.status).toBe(200);
    expect(generate.mock.calls[0][0].model).toBe("gemini-flash-lite-latest");

    const bad = await handler(request({ text: "" }));
    expect(bad.status).toBe(400);
    const long = await handler(
      request({ text: "x".repeat(LLM_LIMITS.maxClassifyTextChars + 1) })
    );
    expect(long.status).toBe(400);
  });
});

describe("readLlmConfig", () => {
  it("falls back to defaults for missing or malformed values", () => {
    expect(
      readLlmConfig({
        GEMINI_API_KEY: "  ",
        GEMINI_MODEL_CLASSIFIER: "bad model id!",
        LLM_DAILY_REQUEST_LIMIT: "-3",
        GEMINI_THINKING_LEVEL: "huge",
      })
    ).toEqual({
      apiKey: undefined,
      reasoningModel: "gemini-flash-latest",
      classifierModel: "gemini-flash-lite-latest",
      accessToken: undefined,
      requireAccessToken: false,
      trustProxy: false,
      rateLimitPerMinute: { reason: 10, classify: 10 },
      dailyRequestLimit: 500,
      thinkingLevel: "low",
      thinkingBudget: undefined,
    });
  });

  it("reads overrides", () => {
    const c = readLlmConfig({
      LLM_ACCESS_TOKEN: "tok",
      TRUST_PROXY: "1",
      LLM_RATE_LIMIT_REASON_PER_MINUTE: "3",
      LLM_RATE_LIMIT_CLASSIFY_PER_MINUTE: "20",
      LLM_DAILY_REQUEST_LIMIT: "0",
      GEMINI_THINKING_LEVEL: "off",
    });
    expect(c).toMatchObject({
      accessToken: "tok",
      trustProxy: true,
      rateLimitPerMinute: { reason: 3, classify: 20 },
      dailyRequestLimit: 0,
      thinkingLevel: "off",
    });
  });
});

describe("resolveThinking (per model family)", () => {
  const cfg = (level: "off" | "low" | "medium", budget?: number) => ({
    thinkingLevel: level,
    thinkingBudget: budget,
  });
  it.each([
    ["gemini-3.5-flash", cfg("low"), { mode: "level", level: "low" }],
    ["gemini-flash-latest", cfg("medium"), { mode: "level", level: "medium" }],
    ["gemini-flash-latest", cfg("off"), null],
    ["gemini-2.5-flash", cfg("low"), { mode: "budget", tokens: 1024 }],
    ["gemini-2.5-flash-lite", cfg("off"), { mode: "budget", tokens: 0 }],
    ["gemini-2.5-pro", cfg("off"), null],
    ["gemini-2.0-flash", cfg("low"), null],
    ["gemini-3.5-flash", cfg("low", 256), { mode: "budget", tokens: 256 }],
  ])("%s %o → %o", (model, c, expected) => {
    expect(resolveThinking(model, c)).toEqual(expected);
  });

  it("reads GEMINI_THINKING_BUDGET", () => {
    expect(
      readLlmConfig({ GEMINI_THINKING_BUDGET: "2048" }).thinkingBudget
    ).toBe(2048);
    expect(readLlmConfig({ GEMINI_THINKING_BUDGET: "x" }).thinkingBudget).toBe(
      undefined
    );
  });
});

describe("access control and cost caps (S-H1)", () => {
  const withToken = () =>
    readLlmConfig({ GEMINI_API_KEY: SECRET, LLM_ACCESS_TOKEN: "s3cret-token" });

  it("requires the access token header when LLM_ACCESS_TOKEN is set", async () => {
    const generate = vi.fn<GenerateJsonFn>(async () => ({ text: "{}" }));
    const handler = createLlmRouteHandler(
      "reason",
      makeDeps(generate, { config: withToken })
    );
    const missing = await handler(request(reasonBody()));
    expect(missing.status).toBe(401);
    expect((await errorOf(missing)).code).toBe("unauthorized");
    const wrong = await handler(
      request(reasonBody(), {
        headers: { "x-arbiter-access-token": "s3cret-tokeN" },
      })
    );
    expect(wrong.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();

    const ok = await handler(
      request(reasonBody(), {
        headers: { "x-arbiter-access-token": "s3cret-token" },
      })
    );
    expect(ok.status).toBe(200);
  });

  it("enforces the per-process daily cap", async () => {
    const handler = createLlmRouteHandler(
      "reason",
      makeDeps(okGenerate, {
        config: () =>
          readLlmConfig({
            GEMINI_API_KEY: SECRET,
            LLM_DAILY_REQUEST_LIMIT: "2",
          }),
        dailyCounter: new DailyRequestCounter(() => Date.UTC(2026, 0, 1)),
      })
    );
    expect((await handler(request(reasonBody()))).status).toBe(200);
    expect((await handler(request(reasonBody()))).status).toBe(200);
    const capped = await handler(request(reasonBody()));
    expect(capped.status).toBe(429);
    expect((await errorOf(capped)).code).toBe("quota-exceeded");
  });

  it("resets the daily counter on a new UTC day", () => {
    let now = Date.UTC(2026, 0, 1, 23);
    const c = new DailyRequestCounter(() => now);
    expect(c.take(1)).toBe(true);
    expect(c.take(1)).toBe(false);
    now = Date.UTC(2026, 0, 2, 0, 1);
    expect(c.take(1)).toBe(true);
    expect(new DailyRequestCounter().take(0)).toBe(true);
  });

  it("only trusts X-Forwarded-For when TRUST_PROXY=1", () => {
    const h = new Headers({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" });
    expect(clientKey(h, false)).toBe("process");
    expect(clientKey(h, true)).toBe("ip:198.51.100.9");
    expect(clientKey(new Headers(), true)).toBe("process");
  });

  it("uses separate env-configured buckets per route by default", async () => {
    const config = () =>
      readLlmConfig({
        GEMINI_API_KEY: SECRET,
        LLM_RATE_LIMIT_REASON_PER_MINUTE: "1",
        LLM_RATE_LIMIT_CLASSIFY_PER_MINUTE: "2",
      });
    const deps = makeDeps(okGenerate, { config });
    delete deps.rateLimiter;
    const reason = createLlmRouteHandler("reason", deps);
    const classify = createLlmRouteHandler("classify", deps);
    expect((await reason(request(reasonBody()))).status).toBe(200);
    expect((await reason(request(reasonBody()))).status).toBe(429);
    // 分類は別のバケット
    expect((await classify(request({ text: "スマホ" }))).status).toBe(200);
    expect((await classify(request({ text: "スマホ" }))).status).toBe(200);
    expect((await classify(request({ text: "スマホ" }))).status).toBe(429);
  });

  it("fails closed in production when no access token is configured", async () => {
    const generate = vi.fn<GenerateJsonFn>(async () => ({ text: "{}" }));
    const prod =
      (extra: Record<string, string> = {}) =>
      () =>
        readLlmConfig({
          GEMINI_API_KEY: SECRET,
          NODE_ENV: "production",
          ...extra,
        });
    const closed = await createLlmRouteHandler(
      "reason",
      makeDeps(generate, { config: prod() })
    )(request(reasonBody()));
    expect(closed.status).toBe(503);
    expect((await errorOf(closed)).code).toBe("not-configured");
    expect(generate).not.toHaveBeenCalled();

    // プラットフォーム側で保護している場合の明示的な解除
    const optedOut = await createLlmRouteHandler(
      "reason",
      makeDeps(okGenerate, { config: prod({ LLM_ALLOW_UNAUTHENTICATED: "1" }) })
    )(request(reasonBody()));
    expect(optedOut.status).toBe(200);

    // トークンを設定すれば本番でも利用できる
    const withTok = await createLlmRouteHandler(
      "reason",
      makeDeps(okGenerate, { config: prod({ LLM_ACCESS_TOKEN: "t0k" }) })
    )(request(reasonBody(), { headers: { "x-arbiter-access-token": "t0k" } }));
    expect(withTok.status).toBe(200);
  });

  it("unauthenticated requests do not consume the rate-limit bucket", async () => {
    const deps = makeDeps(okGenerate, {
      config: () =>
        readLlmConfig({
          GEMINI_API_KEY: SECRET,
          LLM_ACCESS_TOKEN: "s3cret-token",
        }),
      rateLimiter: new TokenBucketRateLimiter({
        capacity: 1,
        refillIntervalMs: 60_000,
      }),
    });
    const handler = createLlmRouteHandler("reason", deps);
    for (let i = 0; i < 5; i++)
      expect((await handler(request(reasonBody()))).status).toBe(401);
    const ok = await handler(
      request(reasonBody(), {
        headers: { "x-arbiter-access-token": "s3cret-token" },
      })
    );
    expect(ok.status).toBe(200);
  });

  it("rejects fair-play incidents on the server", async () => {
    const generate = vi.fn<GenerateJsonFn>(async () => ({ text: "{}" }));
    const handler = createLlmRouteHandler("reason", makeDeps(generate));
    const body = reasonBody();
    const res = await handler(
      request({
        ...body,
        incident: { ...(body.incident as object), category: "fair-play" },
      })
    );
    expect(res.status).toBe(400);
    const res2 = await handler(
      request({
        ...body,
        incident: {
          ...(body.incident as object),
          description: "相手がカンニングしている疑い",
        },
      })
    );
    expect(res2.status).toBe(400);
    const classify = createLlmRouteHandler("classify", makeDeps(generate));
    expect(
      (await classify(request({ text: "Suspected engine assistance" }))).status
    ).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("request body streaming limit (S-M2)", () => {
  it("aborts reading once the body exceeds the limit even without Content-Length", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(32_000).fill(0x61);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
        if (pulled > 100) controller.close();
      },
    });
    const req = new Request("http://localhost/api/llm/reason", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      // @ts-expect-error Node の fetch 実装ではストリーム本文に duplex が必要
      duplex: "half",
    });
    const handler = createLlmRouteHandler("reason", makeDeps(okGenerate));
    const res = await handler(req);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });
});

describe("total deadline (S-H2)", () => {
  it("limits the retry attempt to the remaining time", async () => {
    let now = 0;
    const timeouts: number[] = [];
    let calls = 0;
    const generate = vi.fn<GenerateJsonFn>(async (req) => {
      timeouts.push(req.timeoutMs);
      calls++;
      if (calls === 1) {
        now += 25_000; // 遅い1回目
        throw Object.assign(new Error("x"), { status: 503 });
      }
      return { text: JSON.stringify(validDraft()) };
    });
    const deps = makeDeps(generate, {
      timeoutMs: { reason: 20_000, classify: 8_000 },
    });
    const handler = createLlmRouteHandler("reason", {
      ...deps,
      retry: {
        ...deps.retry!,
        totalDeadlineMs: 30_000,
        minRemainingForRetryMs: 3_000,
        now: () => now,
      },
    });
    const res = await handler(request(reasonBody()));
    expect(res.status).toBe(200);
    expect(timeouts[0]).toBe(20_000);
    // 残り 5 秒 − バックオフ ≒ 5 秒以内に収める
    expect(timeouts[1]).toBeLessThanOrEqual(5_000);
  });

  it("does not retry when less than the minimum remains", async () => {
    let now = 0;
    const generate = vi.fn<GenerateJsonFn>(async () => {
      now += 28_000;
      throw Object.assign(new Error("x"), { status: 503 });
    });
    const deps = makeDeps(generate);
    const handler = createLlmRouteHandler("reason", {
      ...deps,
      retry: {
        ...deps.retry!,
        totalDeadlineMs: 30_000,
        minRemainingForRetryMs: 3_000,
        now: () => now,
      },
    });
    const res = await handler(request(reasonBody()));
    expect(res.status).toBe(503);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("does not retry unknown (non-transport) errors (S-L3)", async () => {
    const generate = vi.fn<GenerateJsonFn>(async () => {
      throw new RangeError("bug");
    });
    const res = await createLlmRouteHandler(
      "reason",
      makeDeps(generate)
    )(request(reasonBody()));
    expect(res.status).toBe(502);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("passes the thinking level and a larger output budget for reasoning", async () => {
    const generate = vi.fn<GenerateJsonFn>(async () => ({ text: "{}" }));
    await createLlmRouteHandler(
      "reason",
      makeDeps(generate)
    )(request(reasonBody()));
    expect(generate.mock.calls[0][0]).toMatchObject({
      thinking: { mode: "level", level: "low" },
      maxOutputTokens: 6_000,
    });
  });
});
