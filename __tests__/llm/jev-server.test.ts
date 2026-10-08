// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  createEmbedRouteHandler,
  createFactsRouteHandler,
  createLlmRouteHandler,
  JEV_ATTEMPT_TIMEOUT_MS,
  routeKeyConfigured,
  type FactsHandlerDeps,
  type LlmHandlerDeps,
} from "@/lib/infrastructure/llm/server/handler";
import {
  UpstreamError,
  type GenerateJsonFn,
  type RetryOptions,
} from "@/lib/infrastructure/llm/server/generate";
import {
  DailyRequestCounter,
  TokenBucketRateLimiter,
} from "@/lib/infrastructure/llm/server/rate-limiter";
import { readLlmConfig } from "@/lib/infrastructure/llm/server/config";
import {
  createJevEvaluate,
  InvalidProviderOutput,
  JEV_API_URL,
} from "@/lib/infrastructure/llm/server/jev-client";
import {
  buildJevClassificationQuestions,
  buildJevState,
  jevAnswersToRawClassification,
  JEV_DATA_NOTE,
} from "@/lib/infrastructure/llm/server/jev-questions";
import {
  buildJevPresenceQuestions,
  isPresenceCheckableFact,
  jevAnswersToRawPresence,
} from "@/lib/infrastructure/llm/server/jev-presence";
import { CLASSIFIER_SYSTEM_PROMPT } from "@/lib/infrastructure/llm/server/prompts";
import type { ClassifyIncidentFn } from "@/lib/infrastructure/llm/server/classify-port";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_DESCRIPTIONS,
  parseLlmClassification,
} from "@/lib/domain/llm/classification";
import {
  CLOCK_TIME_SUBTYPE_LABELS,
  DRAW_SUBTYPE_LABELS,
} from "@/lib/domain/follow-up";
import { getFactDefinition } from "@/lib/domain/facts/catalog";
import { LLM_LIMITS } from "@/lib/infrastructure/llm/contract";

/**
 * J1c: 分類のポート・Jev クライアント・/api/llm/facts（ADR-011, jev-classifier-design §11,
 * fact-model.md §7）。fetch はすべてモック（CI で実 API は呼ばない）
 */

const GEMINI_KEY = "AIzaSy-test-gemini-key";
const TYPESAFE_KEY = "ts-test-typesafe-secret";
const NARRATIVE = "白の時計のフラッグが落ちたと黒が申し立てた";

const JEV_ENV = {
  LLM_CLASSIFIER_PROVIDER: "jev",
  TYPESAFE_API_KEY: TYPESAFE_KEY,
};

function request(body: unknown, raw?: string) {
  return new Request("http://localhost/api/llm/x", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.9",
    },
    body: raw ?? JSON.stringify(body),
  });
}

async function errorOf(res: Response) {
  const body = await res.json();
  expect(body.ok).toBe(false);
  return body.error as { code: string; message: string };
}

const fastRetry = (over: Partial<RetryOptions> = {}): RetryOptions => ({
  attempts: 3,
  baseDelayMs: 0,
  maxDelayMs: 0,
  totalDeadlineMs: 10_000,
  minRemainingForRetryMs: 0,
  now: () => 0,
  sleep: async () => {},
  random: () => 0,
  ...over,
});

function baseDeps(env: Record<string, string>) {
  return {
    config: () => readLlmConfig(env),
    rateLimiter: new TokenBucketRateLimiter({
      capacity: 100,
      refillIntervalMs: 60_000,
    }),
    retry: fastRetry(),
    dailyCounter: new DailyRequestCounter(),
    log: vi.fn(),
  };
}

function choice(choice: string, probabilities: Record<string, number>) {
  return { type: "choice", choice, confidence: 0.9, probabilities };
}

function categoryProbs(top: string, p = 0.91): Record<string, number> {
  const rest = (1 - p) / (INCIDENT_CATEGORIES.length - 1);
  return Object.fromEntries(
    INCIDENT_CATEGORIES.map((c) => [c, c === top ? p : rest])
  );
}

function jevClassifyAnswers(category = "clock-time") {
  return {
    category: choice(category, categoryProbs(category)),
    clockTimeSubtype: choice("flag-fall", { "flag-fall": 0.97, other: 0.03 }),
    drawSubtype: choice("fifty-move-claim", {
      "threefold-repetition-claim": 0.1,
      "fifty-move-claim": 0.9,
    }),
    needsTournamentRules: { type: "noul", noul: 0.12 },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jevFetch(
  answers: unknown = jevClassifyAnswers(),
  model = "jev-1.13.0"
) {
  return vi.fn<typeof fetch>(async () =>
    jsonResponse({
      model,
      answers,
      usage: { input_tokens: 820, output_tokens: 120 },
    })
  );
}

function classifyHandler(
  env: Record<string, string>,
  over: Partial<LlmHandlerDeps> = {}
) {
  const generate = vi.fn<GenerateJsonFn>(async () => ({
    text: JSON.stringify({ category: "clock-time" }),
  }));
  const fetchMock = over.fetch ?? jevFetch();
  const deps = {
    ...baseDeps(env),
    generate,
    fetch: fetchMock,
    timeoutMs: { reason: 8_000, classify: 8_000 },
    ...over,
  };
  return {
    handler: createLlmRouteHandler("classify", deps),
    generate,
    fetch: fetchMock as ReturnType<typeof vi.fn<typeof fetch>>,
    log: deps.log as ReturnType<typeof vi.fn>,
  };
}

function sentBody(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, i = 0) {
  return JSON.parse(String(fetchMock.mock.calls[i][1]?.body));
}

// ---------------------------------------------------------------------------

describe("Gemini classifier prompt (moved descriptions)", () => {
  it("is byte-identical to the prompt before J1c", () => {
    expect(
      createHash("sha256").update(CLASSIFIER_SYSTEM_PROMPT).digest("hex")
    ).toBe("db61a1302f2fc8fde7e27f14d4e1e368798596459171f8853b7e8c1efa78e847");
  });
});

describe("jev-questions", () => {
  it("builds the question set from the domain constants only", () => {
    const q = buildJevClassificationQuestions();
    expect(Object.keys(q)).toEqual([
      "category",
      "clockTimeSubtype",
      "drawSubtype",
      "needsTournamentRules",
    ]);
    expect(q.category.type).toBe("choice");
    expect(q.category.criteria).toEqual(
      Object.fromEntries(
        INCIDENT_CATEGORIES.map((c) => [c, INCIDENT_CATEGORY_DESCRIPTIONS[c]])
      )
    );
    expect(Object.keys(q.category.criteria)).toHaveLength(10);
    expect(q.clockTimeSubtype.criteria).toEqual(CLOCK_TIME_SUBTYPE_LABELS);
    expect(q.drawSubtype.criteria).toEqual(DRAW_SUBTYPE_LABELS);
    expect(q.needsTournamentRules.type).toBe("noul");
    for (const question of Object.values(q))
      expect(question.instructions).toContain(JEV_DATA_NOTE);
  });

  it("state holds the narrative only", () => {
    expect(buildJevState(NARRATIVE)).toEqual({
      deidentified_incident: NARRATIVE,
    });
  });

  it("maps answers to the provider-neutral raw shape", () => {
    expect(jevAnswersToRawClassification(jevClassifyAnswers())).toEqual({
      category: "clock-time",
      categoryProbabilities: categoryProbs("clock-time"),
      subtype: "flag-fall",
      subtypeProbability: 0.97,
      needsTournamentRulesProbability: 0.12,
      provider: "jev",
    });
  });

  it("uses only the chosen category's subtype answer", () => {
    expect(
      jevAnswersToRawClassification(jevClassifyAnswers("draw"))
    ).toMatchObject({ subtype: "fifty-move-claim", subtypeProbability: 0.9 });
    expect(
      jevAnswersToRawClassification(jevClassifyAnswers("player-behavior"))
    ).toMatchObject({ subtype: null, subtypeProbability: null });
  });

  it("drops a malformed or unknown subtype answer without failing", () => {
    const answers = {
      ...jevClassifyAnswers(),
      clockTimeSubtype: choice("toString", { toString: 1 }),
    };
    expect(jevAnswersToRawClassification(answers)).toMatchObject({
      category: "clock-time",
      subtype: null,
    });
    expect(
      jevAnswersToRawClassification({
        ...jevClassifyAnswers(),
        clockTimeSubtype: { type: "noul", noul: 1 },
        needsTournamentRules: { type: "noul", probability: 0.5 },
      })
    ).toMatchObject({ subtype: null, needsTournamentRulesProbability: null });
  });

  it("an unknown label or a missing category answer is invalid output", () => {
    expect(
      jevAnswersToRawClassification({
        category: choice("cheating", { cheating: 1 }),
      })
    ).toBeNull();
    expect(jevAnswersToRawClassification({})).toBeNull();
    expect(
      jevAnswersToRawClassification({ category: { type: "noul", noul: 1 } })
    ).toBeNull();
  });
});

describe("jev-presence", () => {
  it("only catalogue facts that are presence-checkable and not local-only", () => {
    expect(isPresenceCheckableFact("im.clock-pressed")).toBe(true);
    expect(isPresenceCheckableFact("game.history")).toBe(false); // local-only
    expect(isPresenceCheckableFact("im.count")).toBe(false); // derived
    expect(isPresenceCheckableFact("no.such-fact")).toBe(false);
    expect(isPresenceCheckableFact("__proto__")).toBe(false);
  });

  it("builds one noul per fact from the catalogue question", () => {
    const q = buildJevPresenceQuestions(["im.clock-pressed", "im.player"]);
    expect(Object.keys(q)).toEqual(["im.clock-pressed", "im.player"]);
    const question = getFactDefinition("im.clock-pressed")?.question as string;
    expect(q["im.clock-pressed"]).toMatchObject({ type: "noul" });
    expect(q["im.clock-pressed"].instructions).toContain(question);
    expect(q["im.clock-pressed"].instructions).toContain("explicitly");
    expect(q["im.clock-pressed"].instructions).toContain(JEV_DATA_NOTE);
    expect(() => buildJevPresenceQuestions(["game.history"])).toThrow();
  });

  it("maps requested answers only and skips malformed ones", () => {
    expect(
      jevAnswersToRawPresence(
        {
          "im.clock-pressed": { type: "noul", noul: 0.91 },
          "im.player": { type: "choice", choice: "white" },
          "im.opponent-moved": { type: "noul", noul: 0.5 },
        },
        ["im.clock-pressed", "im.player"]
      )
    ).toEqual({ presence: { "im.clock-pressed": 0.91 }, provider: "jev" });
  });
});

describe("jev-client (mocked fetch)", () => {
  const signal = new AbortController().signal;
  const call = (fetchMock: typeof fetch) =>
    createJevEvaluate(fetchMock)({
      apiKey: TYPESAFE_KEY,
      model: "jev-1.13.0",
      state: buildJevState(NARRATIVE),
      questions: buildJevClassificationQuestions(),
      signal,
    });

  it("posts model, state and questions with the Bearer header", async () => {
    const fetchMock = jevFetch();
    const out = await call(fetchMock);
    expect(fetchMock.mock.calls[0][0]).toBe(JEV_API_URL);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TYPESAFE_KEY}`
    );
    expect(init.signal).toBe(signal);
    expect(Object.keys(sentBody(fetchMock))).toEqual([
      "model",
      "state",
      "questions",
    ]);
    expect(out).toMatchObject({
      model: "jev-1.13.0",
      usage: { inputTokens: 820, outputTokens: 120 },
    });
  });

  it.each([401, 408, 422, 429, 500, 503])(
    "HTTP %s → UpstreamError with that status; the body is not read",
    async (status) => {
      const text = vi.fn();
      const res = new Response(`{"detail":[{"input":"${NARRATIVE}"}]}`, {
        status,
      });
      res.text = text;
      const error = await call(vi.fn(async () => res)).catch((e) => e);
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error.status).toBe(status);
      expect(error.transient).toBe(status === 408 || status >= 429);
      expect(text).not.toHaveBeenCalled();
      expect(String(error.message)).not.toContain(TYPESAFE_KEY);
    }
  );

  it.each([
    ["malformed JSON", new Response("not json", { status: 200 })],
    ["no answers", jsonResponse({ model: "jev-1.13.0" })],
    [
      "answers not an object",
      jsonResponse({ model: "jev-1.13.0", answers: [] }),
    ],
    ["no model", jsonResponse({ answers: {} })],
    ["a model id with spaces", jsonResponse({ model: "jev 1", answers: {} })],
  ])("%s → InvalidProviderOutput", async (_n, res) => {
    const error = await call(vi.fn(async () => res)).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidProviderOutput);
  });

  it("a network failure or an abort is rethrown for the retry policy", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    await expect(
      call(
        vi.fn(async () => {
          throw abort;
        })
      )
    ).rejects.toBe(abort);
  });
});

describe("classify handler – provider switch (ADR-011)", () => {
  it("default provider stays gemini even with a TypeSafe key", async () => {
    const { handler, generate, fetch } = classifyHandler({
      GEMINI_API_KEY: GEMINI_KEY,
      TYPESAFE_API_KEY: TYPESAFE_KEY,
    });
    const res = await handler(request({ narrative: NARRATIVE }));
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect((await res.json()).model).toBe("gemini-flash-lite-latest");
  });

  it("unknown provider values fall back to gemini", () => {
    expect(
      readLlmConfig({ LLM_CLASSIFIER_PROVIDER: "openai" }).classifierProvider
    ).toBe("gemini");
    expect(readLlmConfig({ LLM_CLASSIFIER_PROVIDER: " JEV " })).toMatchObject({
      classifierProvider: "jev",
    });
    expect(readLlmConfig({ JEV_MODEL: "jev latest!" }).jevModel).toBe(
      "jev-1.13.0"
    );
  });

  it("jev: sends only the narrative state and returns the raw probabilities with the resolved model", async () => {
    const fetchMock = jevFetch(jevClassifyAnswers(), "jev-1.13.1");
    const { handler, generate } = classifyHandler(JEV_ENV, {
      fetch: fetchMock,
    });
    const res = await handler(request({ narrative: NARRATIVE }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe("jev-1.13.1");
    expect(body.result).toMatchObject({
      category: "clock-time",
      provider: "jev",
      subtype: "flag-fall",
    });
    expect(generate).not.toHaveBeenCalled();
    const sent = sentBody(fetchMock);
    expect(sent.model).toBe("jev-1.13.0");
    expect(sent.state).toEqual({ deidentified_incident: NARRATIVE });
    // クライアントのドメインが解釈できる（未較正モード）
    expect(
      parseLlmClassification(body.result, { model: body.model })
    ).toMatchObject({
      category: "clock-time",
      confidence: "low",
      prefill: false,
    });
  });

  it("jev without TYPESAFE_API_KEY → 503 not-configured, nothing sent", async () => {
    const { handler, fetch, generate } = classifyHandler({
      GEMINI_API_KEY: GEMINI_KEY,
      LLM_CLASSIFIER_PROVIDER: "jev",
    });
    const res = await handler(request({ narrative: NARRATIVE }));
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe("not-configured");
    expect(fetch).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("jev without GEMINI_API_KEY: classify works, reason and embed return 503", async () => {
    const { handler } = classifyHandler(JEV_ENV);
    expect((await handler(request({ narrative: NARRATIVE }))).status).toBe(200);

    const generate = vi.fn<GenerateJsonFn>();
    const reason = createLlmRouteHandler("reason", {
      ...baseDeps(JEV_ENV),
      generate,
    });
    const r = await reason(request({}));
    expect(r.status).toBe(503);
    expect((await errorOf(r)).code).toBe("not-configured");

    const embed = vi.fn();
    const e = await createEmbedRouteHandler({
      ...baseDeps(JEV_ENV),
      embed,
      timeoutMs: 100,
    })(request({ taskType: "query", texts: ["x"] }));
    expect(e.status).toBe(503);
    expect(generate).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it("gemini provider without GEMINI_API_KEY → 503 (TypeSafe key is not enough)", async () => {
    const { handler } = classifyHandler({ TYPESAFE_API_KEY: TYPESAFE_KEY });
    expect((await handler(request({ narrative: NARRATIVE }))).status).toBe(503);
  });

  it.each([
    ["fair play", { narrative: "相手がエンジンを使っている疑いがある" }],
    [
      "a narrative the server pattern pass would change",
      { narrative: "白の時計のフラッグが13時に落ちたと黒が申し立てた" },
    ],
    ["the legacy { text } body", { text: NARRATIVE }],
  ])("jev: %s is rejected before any provider runs", async (_n, body) => {
    const { handler, fetch } = classifyHandler(JEV_ENV);
    const res = await handler(request(body));
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("jev: invalid output → 502 invalid-model-output, not retried", async () => {
    const fetchMock = jevFetch({
      category: choice("cheating", { cheating: 1 }),
    });
    const { handler } = classifyHandler(JEV_ENV, { fetch: fetchMock });
    const res = await handler(request({ narrative: NARRATIVE }));
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe("invalid-model-output");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const malformed = vi.fn<typeof fetch>(async () =>
      jsonResponse({ model: "jev-1.13.0" })
    );
    const res2 = await classifyHandler(JEV_ENV, { fetch: malformed }).handler(
      request({ narrative: NARRATIVE })
    );
    expect((await errorOf(res2)).code).toBe("invalid-model-output");
    expect(malformed).toHaveBeenCalledTimes(1);
  });

  it("jev: 401 is not retried; 429 and 5xx are retried", async () => {
    const unauthorized = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 401 })
    );
    const res = await classifyHandler(JEV_ENV, { fetch: unauthorized }).handler(
      request({ narrative: NARRATIVE })
    );
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe("upstream-error");
    expect(unauthorized).toHaveBeenCalledTimes(1);

    const busy = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 429 })
    );
    const res2 = await classifyHandler(JEV_ENV, { fetch: busy }).handler(
      request({ narrative: NARRATIVE })
    );
    expect(res2.status).toBe(503);
    expect(busy).toHaveBeenCalledTimes(3);
  });

  it("jev: per-call deadline (3 s per attempt, 10 s total, 1 s minimum for a retry)", async () => {
    let t = 0;
    const timeouts: number[] = [];
    const failing: ClassifyIncidentFn = async ({ timeoutMs }) => {
      timeouts.push(timeoutMs);
      throw new UpstreamError("status", 503);
    };
    const retry = fastRetry({
      attempts: 10,
      totalDeadlineMs: 30_000,
      minRemainingForRetryMs: 3_000,
      now: () => t,
      sleep: async () => {
        t += 4_000;
      },
    });
    const run = async (env: Record<string, string>) => {
      t = 0;
      timeouts.length = 0;
      const res = await classifyHandler(env, {
        retry,
        classifierFor: () => failing,
      }).handler(request({ narrative: NARRATIVE }));
      expect(res.status).toBe(503);
      return [...timeouts];
    };
    const jev = await run(JEV_ENV);
    expect(jev[0]).toBe(JEV_ATTEMPT_TIMEOUT_MS);
    expect(jev.every((ms) => ms <= JEV_ATTEMPT_TIMEOUT_MS)).toBe(true);
    // 0 / 4 / 8 / 12 秒に試行し、10 秒の締め切りを過ぎた後は再試行しない
    expect(jev).toHaveLength(4);

    // gemini は従来どおり（1回 8 秒・全体 30 秒）
    const gemini = await run({ GEMINI_API_KEY: GEMINI_KEY });
    expect(gemini[0]).toBe(8_000);
    expect(gemini.length).toBeGreaterThan(jev.length);
  });

  it("logs codes only: never the narrative, the keys or upstream bodies", async () => {
    const leaky = vi.fn<typeof fetch>(
      async () =>
        new Response(`{"detail":[{"input":"${NARRATIVE}"}]}`, { status: 422 })
    );
    const ok = classifyHandler(JEV_ENV);
    await ok.handler(request({ narrative: NARRATIVE }));
    const bad = classifyHandler(JEV_ENV, { fetch: leaky });
    await bad.handler(request({ narrative: NARRATIVE }));
    const logged = JSON.stringify([
      ...ok.log.mock.calls,
      ...bad.log.mock.calls,
    ]);
    expect(logged).toContain("jev-1.13.0");
    expect(logged).toContain("820");
    expect(logged).not.toContain(NARRATIVE);
    expect(logged).not.toContain("フラッグ");
    expect(logged).not.toContain(TYPESAFE_KEY);
  });
});

describe("/api/llm/facts (fact-model.md §4.2)", () => {
  const FACTS = ["im.clock-pressed", "im.opponent-moved"];

  function factsHandler(
    env: Record<string, string> = JEV_ENV,
    over: Partial<FactsHandlerDeps> & { fetch?: typeof fetch } = {}
  ) {
    const fetchMock =
      over.fetch ??
      jevFetch({
        "im.clock-pressed": { type: "noul", noul: 0.93 },
        "im.opponent-moved": { type: "noul", noul: 0.02 },
      });
    const deps = { ...baseDeps(env), fetch: fetchMock, ...over };
    return {
      handler: createFactsRouteHandler(deps),
      fetch: fetchMock as ReturnType<typeof vi.fn<typeof fetch>>,
    };
  }

  it("returns the raw presence probabilities and the resolved model", async () => {
    const { handler, fetch } = factsHandler();
    const res = await handler(
      request({ narrative: NARRATIVE, factIds: FACTS })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      result: {
        presence: { "im.clock-pressed": 0.93, "im.opponent-moved": 0.02 },
        provider: "jev",
      },
      model: "jev-1.13.0",
    });
    const sent = sentBody(fetch);
    expect(sent.state).toEqual({ deidentified_incident: NARRATIVE });
    // 質問はカタログから作る（id と文言）
    expect(Object.keys(sent.questions)).toEqual(FACTS);
    expect(sent.questions["im.clock-pressed"].instructions).toContain(
      getFactDefinition("im.clock-pressed")?.question
    );
  });

  it.each([
    ["gemini provider (default)", { TYPESAFE_API_KEY: TYPESAFE_KEY }],
    ["jev without a key", { LLM_CLASSIFIER_PROVIDER: "jev" }],
  ])("%s → 503 not-configured", async (_n, env) => {
    const { handler, fetch } = factsHandler(env);
    const res = await handler(
      request({ narrative: NARRATIVE, factIds: FACTS })
    );
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe("not-configured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown fact id", { factIds: ["no.such-fact"] }],
    ["a local-only fact", { factIds: ["game.history"] }],
    ["a derived fact", { factIds: ["im.count"] }],
    ["a duplicate", { factIds: ["im.player", "im.player"] }],
    ["an empty list", { factIds: [] }],
    ["not a list", { factIds: "im.player" }],
    ["a non-string id", { factIds: [1] }],
    [
      "too many ids",
      {
        factIds: Array.from(
          { length: LLM_LIMITS.maxFactIds + 1 },
          () => "im.player"
        ),
      },
    ],
    ["question text from the client", { factIds: FACTS, questions: { x: 1 } }],
    ["no narrative", { narrative: undefined, factIds: FACTS }],
  ])("400 invalid-request for %s", async (_n, body) => {
    const { handler, fetch } = factsHandler();
    const res = await handler(request({ narrative: NARRATIVE, ...body }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("invalid-request");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fair play is rejected; a narrative the pattern pass would change is not-sendable", async () => {
    const { handler, fetch } = factsHandler();
    const fp = await handler(
      request({
        narrative: "相手がエンジンを使っている疑いがある",
        factIds: FACTS,
      })
    );
    expect(fp.status).toBe(400);
    const pii = await handler(
      request({
        narrative: "山本さんの時計のフラッグが落ちたと黒が申し立てた",
        factIds: FACTS,
      })
    );
    expect(pii.status).toBe(400);
    expect((await errorOf(pii)).code).toBe("not-sendable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the shared daily cap", async () => {
    const { handler, fetch } = factsHandler(JEV_ENV, {
      dailyCounter: { take: () => false },
    });
    const res = await handler(
      request({ narrative: NARRATIVE, factIds: FACTS })
    );
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe("quota-exceeded");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("invalid upstream output → 502, not retried", async () => {
    const bad = vi.fn<typeof fetch>(async () => jsonResponse({ answers: {} }));
    const res = await factsHandler(JEV_ENV, { fetch: bad }).handler(
      request({ narrative: NARRATIVE, factIds: FACTS })
    );
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe("invalid-model-output");
    expect(bad).toHaveBeenCalledTimes(1);
  });
});

describe("routeKeyConfigured (ADR-011 §3)", () => {
  const cfg = (env: Record<string, string>) => readLlmConfig(env);
  it.each([
    ["gemini only", { GEMINI_API_KEY: GEMINI_KEY }, [true, true, true, false]],
    ["jev only", JEV_ENV, [false, false, true, true]],
    [
      "both, provider gemini",
      { GEMINI_API_KEY: GEMINI_KEY, TYPESAFE_API_KEY: TYPESAFE_KEY },
      [true, true, true, false],
    ],
    ["nothing", {}, [false, false, false, false]],
  ] as const)("%s", (_n, env, expected) => {
    const c = cfg(env);
    expect(
      (["reason", "embed", "classify", "facts"] as const).map((k) =>
        routeKeyConfigured(k, c)
      )
    ).toEqual(expected);
  });
});
