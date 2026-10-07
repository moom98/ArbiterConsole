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
import { TokenBucketRateLimiter } from "@/lib/infrastructure/llm/server/rate-limiter";
import { readLlmConfig } from "@/lib/infrastructure/llm/server/config";
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
  init: { contentType?: string; ip?: string; raw?: string } = {}
) {
  return new Request("http://localhost/api/llm/reason", {
    method: "POST",
    headers: {
      "content-type": init.contentType ?? "application/json",
      "x-forwarded-for": init.ip ?? "203.0.113.1",
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
      now: () => 0,
      sleep: async () => {},
      random: () => 0.5,
    },
    timeoutMs: { reason: 50, classify: 50 },
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
      makeDeps(okGenerate, { rateLimiter: limiter })
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
  it("falls back to defaults for missing or malformed model ids", () => {
    expect(
      readLlmConfig({
        GEMINI_API_KEY: "  ",
        GEMINI_MODEL_CLASSIFIER: "bad model id!",
      })
    ).toEqual({
      apiKey: undefined,
      reasoningModel: "gemini-flash-latest",
      classifierModel: "gemini-flash-lite-latest",
    });
  });
});
