import { describe, it, expect, vi } from "vitest";
import {
  createLlmRouteHandler,
  createProvidersRouteHandler,
} from "@/lib/infrastructure/llm/server/handler";
import { readLlmConfig } from "@/lib/infrastructure/llm/server/config";
import { DailyRequestCounter } from "@/lib/infrastructure/llm/server/rate-limiter";
import type { GenerateJsonFn } from "@/lib/infrastructure/llm/server/generate";
import type { LlmApiResponse } from "@/lib/infrastructure/llm/contract";
import {
  CLASSIFIER_PROVIDER_LABELS,
  PROVIDERS_TIMEOUT_MS,
  fetchExternalAiProviders,
  prepareClassification,
} from "@/lib/application/external-ai-guard";
import {
  PROVIDER_CHANGED_NOTICE,
  classificationView,
  prepareIncidentClassification,
} from "@/lib/application/llm-classification";
import { NO_IDENTIFIERS } from "@/lib/domain/privacy";
import type { IncidentClassification } from "@/lib/domain/llm/types";
import { answeringProviders } from "../helpers";

/**
 * J2-1: プレビューに実際の送り先を示す（jev-classifier-design §14.3, D13）。
 * - /api/llm/providers が送り先をコードで返す（上流は呼ばない）
 * - 分類はプレビューで示した送り先を添えて送り、サーバーの設定と違えば上流を呼ばずに拒否する
 */

const NARRATIVE = "白の時計のフラッグが落ちたと黒が申し立てた";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/llm/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function providersHandler(env: Record<string, string>) {
  const log = vi.fn();
  return {
    log,
    handler: createProvidersRouteHandler({
      config: () => readLlmConfig(env),
      dailyCounter: new DailyRequestCounter(),
      log,
    }),
  };
}

describe("/api/llm/providers", () => {
  it.each([
    [{}, { classify: "gemini", facts: false }],
    [{ GEMINI_API_KEY: "g" }, { classify: "gemini", facts: false }],
    [
      { LLM_CLASSIFIER_PROVIDER: "jev", TYPESAFE_API_KEY: "t" },
      { classify: "jev", facts: true },
    ],
    // jev を選んでもキーがなければ facts は使えない
    [{ LLM_CLASSIFIER_PROVIDER: "jev" }, { classify: "jev", facts: false }],
  ])("env %j → %j (codes only)", async (env, expected) => {
    const res = await providersHandler(env).handler(request({}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as LlmApiResponse;
    expect(body).toEqual({ ok: true, result: expected, model: "" });
    expect(JSON.stringify(body)).not.toMatch(/key|ts-|jev-1/i);
  });

  it("accepts only an empty object", async () => {
    const res = await providersHandler({}).handler(request({ x: 1 }));
    expect(res.status).toBe(400);
  });

  it("an unauthenticated request does not use the rate limit", async () => {
    const rateLimiter = { take: vi.fn(() => ({ allowed: true as const })) };
    const handler = createProvidersRouteHandler({
      config: () => readLlmConfig({ LLM_ACCESS_TOKEN: "tok" }),
      dailyCounter: new DailyRequestCounter(),
      rateLimiter: rateLimiter as never,
      log: vi.fn(),
    });
    expect((await handler(request({}))).status).toBe(401);
    expect(rateLimiter.take).not.toHaveBeenCalled();
  });

  it("uses its own bucket: using up providers leaves classify available", async () => {
    // このファイル内だけで使う上限（既定のリミッターはプロセス内で共有される）
    const env = {
      GEMINI_API_KEY: "g",
      LLM_RATE_LIMIT_CLASSIFY_PER_MINUTE: "2",
    };
    const providers = providersHandler(env).handler;
    expect((await providers(request({}))).status).toBe(200);
    expect((await providers(request({}))).status).toBe(200);
    expect((await providers(request({}))).status).toBe(429);
    const classify = createLlmRouteHandler("classify", {
      config: () => readLlmConfig(env),
      generate: vi.fn<GenerateJsonFn>(async () => ({
        text: JSON.stringify({ category: "clock-time" }),
      })),
      dailyCounter: new DailyRequestCounter(),
      log: vi.fn(),
    });
    expect(
      (await classify(request({ narrative: NARRATIVE, provider: "gemini" })))
        .status
    ).toBe(200);
  });

  it("requires the access token when one is configured", async () => {
    const { handler } = providersHandler({ LLM_ACCESS_TOKEN: "tok" });
    expect((await handler(request({}))).status).toBe(401);
    expect(
      (await handler(request({}, { "x-arbiter-access-token": "tok" }))).status
    ).toBe(200);
  });
});

describe("classify: the provider shown in the preview must be the one used", () => {
  function classify(env: Record<string, string>) {
    const generate = vi.fn<GenerateJsonFn>(async () => ({
      text: JSON.stringify({ category: "clock-time" }),
    }));
    const daily = { take: vi.fn(() => true) };
    const log = vi.fn();
    const handler = createLlmRouteHandler("classify", {
      config: () => readLlmConfig(env),
      generate,
      dailyCounter: daily,
      log,
    });
    return { handler, generate, daily, log };
  }

  it("a different provider → 409 provider-changed, no upstream call, no daily count", async () => {
    const { handler, generate, daily, log } = classify({
      GEMINI_API_KEY: "g",
    });
    const res = await handler(
      request({ narrative: NARRATIVE, provider: "jev" })
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "provider-changed"
    );
    expect(generate).not.toHaveBeenCalled();
    expect(daily.take).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({
      route: "classify",
      code: "provider-changed",
    });
  });

  it("the reverse (server on jev, request says gemini) is also 409", async () => {
    const { handler, generate, daily } = classify({
      LLM_CLASSIFIER_PROVIDER: "jev",
      TYPESAFE_API_KEY: "t",
    });
    const res = await handler(
      request({ narrative: NARRATIVE, provider: "gemini" })
    );
    expect(res.status).toBe(409);
    expect(generate).not.toHaveBeenCalled();
    expect(daily.take).not.toHaveBeenCalled();
  });

  it("provider jev on a jev server reaches the classifier", async () => {
    const classifier = vi.fn(async () => ({
      ok: true as const,
      result: { provider: "jev" },
      model: "jev-1.13.0",
    }));
    const handler = createLlmRouteHandler("classify", {
      config: () =>
        readLlmConfig({
          LLM_CLASSIFIER_PROVIDER: "jev",
          TYPESAFE_API_KEY: "t",
        }),
      generate: vi.fn<GenerateJsonFn>(),
      classifierFor: () => classifier,
      dailyCounter: { take: () => true },
      log: vi.fn(),
    });
    const res = await handler(
      request({ narrative: NARRATIVE, provider: "jev" })
    );
    expect(res.status).toBe(200);
    expect(classifier).toHaveBeenCalledTimes(1);
  });

  it("race: the server setting changes between the preview and send → nothing reaches the upstream", async () => {
    const env: Record<string, string> = { GEMINI_API_KEY: "g" };
    const generate = vi.fn<GenerateJsonFn>(async () => ({
      text: JSON.stringify({ category: "clock-time" }),
    }));
    const config = () => readLlmConfig(env);
    const providers = createProvidersRouteHandler({
      config,
      dailyCounter: new DailyRequestCounter(),
      log: vi.fn(),
    });
    const classifyRoute = createLlmRouteHandler("classify", {
      config,
      generate,
      dailyCounter: new DailyRequestCounter(),
      log: vi.fn(),
    });
    const call = async (kind: string, body: unknown) => {
      const handler = kind === "providers" ? providers : classifyRoute;
      return (await handler(request(body))).json();
    };
    const step = await prepareIncidentClassification(
      NARRATIVE,
      {},
      {
        identifiers: async () => NO_IDENTIFIERS,
        isOnline: () => true,
        call: call as never,
      }
    );
    if (step.status !== "needs-confirmation") throw new Error("expected");
    expect(step.preview.destination).toBe("カテゴリの提案（Gemini（Google））");
    // プレビュー表示後に設定が jev に変わる
    env.LLM_CLASSIFIER_PROVIDER = "jev";
    env.TYPESAFE_API_KEY = "t";
    const r = await step.send();
    expect(generate).not.toHaveBeenCalled();
    expect(r.notice).toBe(PROVIDER_CHANGED_NOTICE);
    expect(r.classification?.method).toBe("keyword");
  });

  it("the same provider is sent", async () => {
    const { handler, generate } = classify({ GEMINI_API_KEY: "g" });
    const res = await handler(
      request({ narrative: NARRATIVE, provider: "gemini" })
    );
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("a missing or unknown provider is 400 (old clients)", async () => {
    const { handler } = classify({ GEMINI_API_KEY: "g" });
    expect((await handler(request({ narrative: NARRATIVE }))).status).toBe(400);
    expect(
      (await handler(request({ narrative: NARRATIVE, provider: "x" }))).status
    ).toBe(400);
  });
});

describe("client: the preview names the provider the server reports", () => {
  const deps = { identifiers: async () => NO_IDENTIFIERS };

  it.each([
    ["gemini", "カテゴリの提案（Gemini（Google））"],
    ["jev", "カテゴリの提案（Jev（TypeSafe））"],
  ] as const)("%s", async (provider, destination) => {
    const call = vi.fn(async () => ({ ok: true, result: {}, model: "m" }));
    const r = await prepareClassification(
      NARRATIVE,
      {},
      {
        ...deps,
        call: answeringProviders(call, {
          classify: provider,
          facts: false,
        }) as never,
      }
    );
    if (r.status !== "needs-confirmation") throw new Error("expected");
    expect(r.preview.destination).toBe(destination);
    expect(r.provider).toBe(provider);
    await r.send();
    expect((call.mock.calls[0] as unknown[])[1]).toEqual({
      narrative: NARRATIVE,
      provider,
    });
    expect(CLASSIFIER_PROVIDER_LABELS[provider]).toBeTruthy();
  });

  it("when the provider cannot be confirmed, nothing is sent and keywords are shown", async () => {
    const call = vi.fn(async (kind: string) =>
      kind === "providers"
        ? {
            ok: false as const,
            error: { code: "upstream-error" as const, message: "失敗" },
          }
        : { ok: true as const, result: {}, model: "m" }
    );
    const step = await prepareIncidentClassification(
      NARRATIVE,
      {},
      {
        ...deps,
        call: call as never,
        isOnline: () => true,
      }
    );
    expect(step.status).toBe("done");
    if (step.status !== "done") return;
    expect(step.result.classification?.method).toBe("keyword");
    expect(step.result.notice).toMatch(
      /送り先を確認できないため送信していません/
    );
    expect(call.mock.calls.map((c) => c[0])).toEqual(["providers"]);
  });

  it("the providers call uses a short timeout", async () => {
    const call = vi.fn(async () => ({
      ok: true,
      result: { classify: "gemini", facts: false },
      model: "",
    }));
    await fetchExternalAiProviders({ call: call as never });
    await fetchExternalAiProviders({ call: call as never, timeoutMs: 60_000 });
    for (const c of call.mock.calls as unknown as [
      string,
      unknown,
      { timeoutMs: number },
    ][])
      expect(c[2].timeoutMs).toBe(PROVIDERS_TIMEOUT_MS);
  });

  it("a malformed providers answer is not trusted", async () => {
    const r = await fetchExternalAiProviders({
      call: (async () => ({
        ok: true,
        result: { classify: "other", facts: "yes" },
        model: "",
      })) as never,
    });
    expect(r).toMatchObject({ status: "provider-unknown" });
  });

  it("provider-changed from the server falls back to keywords and asks to confirm again", async () => {
    const step = await prepareIncidentClassification(
      NARRATIVE,
      {},
      {
        ...deps,
        isOnline: () => true,
        call: answeringProviders(async () => ({
          ok: false,
          error: {
            code: "provider-changed",
            message:
              "AIの送り先が確認時から変わったため送信しませんでした。もう一度確認してください",
          },
        })) as never,
      }
    );
    if (step.status !== "needs-confirmation") throw new Error("expected");
    const r = await step.send();
    expect(r.classification?.method).toBe("keyword");
    expect(r.notice).toBe(PROVIDER_CHANGED_NOTICE);
  });
});

describe("classificationView (§7, display only)", () => {
  const base: IncidentClassification = {
    category: "player-behavior",
    missingInformation: [],
    followUpQuestions: [],
    needsTournamentRules: false,
    confidence: "medium",
    method: "llm",
  };

  it("Gemini: no percentage, continue shown, no candidates", () => {
    expect(classificationView(base)).toEqual({
      percent: undefined,
      showContinue: true,
      candidates: [],
      candidatesLabel: undefined,
      showProbabilityHint: false,
    });
  });

  it("Jev with prefill: percentage, other candidates", () => {
    expect(
      classificationView({
        ...base,
        probability: 0.915,
        alternatives: ["fair-play", "team"],
        prefill: true,
      })
    ).toMatchObject({
      percent: 92,
      showContinue: true,
      candidates: ["fair-play", "team"],
      candidatesLabel: "他の候補",
    });
  });

  it("prefill false: no continue; the category leads the candidates", () => {
    expect(
      classificationView({
        ...base,
        confidence: "low",
        probability: 0.4,
        alternatives: ["fair-play", "team"],
        prefill: false,
      })
    ).toMatchObject({
      showContinue: false,
      candidates: ["player-behavior", "fair-play", "team"],
      candidatesLabel: "候補（タップで選択）",
    });
  });

  it("keyword classification: no hint, no percentage", () => {
    expect(
      classificationView({ ...base, method: "keyword", probability: 0.9 })
    ).toMatchObject({ percent: undefined, showProbabilityHint: false });
  });
});
