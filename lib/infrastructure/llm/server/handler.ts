import { createHash, timingSafeEqual } from "node:crypto";
import {
  EMBEDDING_MODEL,
  LLM_ACCESS_TOKEN_HEADER,
  LLM_LIMITS,
  type LlmApiErrorCode,
  type LlmApiKind,
  type LlmApiResponse,
  type LlmGenerateKind,
  type LlmProvidersInfo,
} from "../contract";
import { readLlmConfig, resolveThinking, type LlmServerConfig } from "./config";
import {
  DEFAULT_RETRY,
  UpstreamError,
  withRetry,
  withTimeout,
  InvalidEmbeddingOutput,
  type EmbedTextsFn,
  type GenerateJsonFn,
  type RetryOptions,
} from "./generate";
import {
  buildReasoningUserContent,
  REASONING_SYSTEM_PROMPT,
  reasoningResponseSchema,
} from "./prompts";
import {
  selectClassifier,
  type ClassifyIncidentFn,
  type ClassifyOutcome,
} from "./classify-port";
import {
  createJevEvaluate,
  InvalidProviderOutput,
  type JevEvaluateFn,
} from "./jev-client";
import { buildJevState } from "./jev-questions";
import {
  buildJevPresenceQuestions,
  jevAnswersToRawPresence,
} from "./jev-presence";
import {
  clientKey,
  DailyRequestCounter,
  TokenBucketRateLimiter,
  type RateLimitDecision,
} from "./rate-limiter";
import {
  NOT_SENDABLE_MESSAGE,
  validateClassificationRequest,
  validateEmbedRequest,
  validateFactPresenceRequest,
  validateProvidersRequest,
  validateReasoningRequest,
  type Validated,
} from "./request-validation";

/**
 * /api/llm/{reason,classify,embed,facts} の処理本体（Route Handler から呼ぶ）。ADR-007, ADR-011。
 *
 * - Content-Type: application/json 必須（クロスオリジンのブラウザからはプリフライトが必要になる）
 * - アクセストークン（LLM_ACCESS_TOKEN 設定時）→ レート制限（ルートごと、インメモリ）
 *   → ルートごとの API キー確認（分類は選んだプロバイダーのキー）→ 本文サイズ（ストリーム読み込み中に
 *   打ち切り）・入力検証 → 1日あたりの上限 → 上流（Gemini / Jev）の呼び出し
 * - タイムアウト・一時的エラーの再試行（指数バックオフ）。全体の締め切り（30 秒）を超えない
 * - 応答・エラーは型付き。API キーや入力本文はログ・応答に含めない
 */

interface BaseHandlerDeps {
  config: () => LlmServerConfig;
  /** 未指定ならルートごとに config の上限で作成する（プロセス内で共有） */
  rateLimiter?: { take(key: string): RateLimitDecision };
  dailyCounter: { take(limit: number): boolean };
  retry: RetryOptions;
  /** 最小限のログ（エラーコード・上流ステータス・試行回数のみ） */
  log: (event: Record<string, string | number | undefined>) => void;
}

export interface LlmHandlerDeps extends BaseHandlerDeps {
  generate: GenerateJsonFn;
  /** 1回の試行のタイムアウト（ミリ秒） */
  timeoutMs: Record<LlmGenerateKind, number>;
  /**
   * 分類の実装を設定から選ぶ（ADR-011）。未指定なら generate（gemini）と fetch（jev）から作る。
   * ルートでは provider.ts の classifierProvider を渡す
   */
  classifierFor?: (config: LlmServerConfig) => ClassifyIncidentFn;
  /** Jev の呼び出しに使う fetch（テスト用。未指定なら globalThis.fetch） */
  fetch?: typeof fetch;
}

/** /api/llm/facts の依存（fact-model.md §4）。1日の上限は推論・分類と共有する */
export interface FactsHandlerDeps extends BaseHandlerDeps {
  evaluate: JevEvaluateFn;
}

/** /api/llm/embed の依存（ADR-010）。1日の上限は推論・分類とは別に数える */
export interface EmbedHandlerDeps extends BaseHandlerDeps {
  embed: EmbedTextsFn;
  /** 1回の試行のタイムアウト（ミリ秒） */
  timeoutMs: number;
}

const REASON_MAX_OUTPUT_TOKENS = 6_000;

/**
 * Jev の締め切り（jev-classifier-design §4.2, §6）。通常は約 100 ms のため、遅い場合は
 * 早めにキーワード分類へ戻す。1回 3 秒・全体 10 秒・残り 1 秒未満なら再試行しない（最大 3 回）
 */
export const JEV_ATTEMPT_TIMEOUT_MS = 3_000;
export const JEV_TOTAL_DEADLINE_MS = 10_000;
const JEV_MIN_REMAINING_FOR_RETRY_MS = 1_000;

function jevRetry(retry: RetryOptions): RetryOptions {
  return {
    ...retry,
    totalDeadlineMs: Math.min(retry.totalDeadlineMs, JEV_TOTAL_DEADLINE_MS),
    minRemainingForRetryMs: Math.min(
      retry.minRemainingForRetryMs,
      JEV_MIN_REMAINING_FOR_RETRY_MS
    ),
  };
}

const STATUS: Record<LlmApiErrorCode, number> = {
  "invalid-request": 400,
  "not-sendable": 400,
  "provider-changed": 409,
  "unsupported-media-type": 415,
  "payload-too-large": 413,
  "rate-limited": 429,
  "quota-exceeded": 429,
  unauthorized: 401,
  "not-configured": 503,
  "upstream-timeout": 504,
  "upstream-unavailable": 503,
  "upstream-error": 502,
  "invalid-model-output": 502,
  blocked: 422,
  "network-error": 502,
  offline: 503,
};

const MESSAGES: Partial<Record<LlmApiErrorCode, string>> = {
  "unsupported-media-type": "Content-Type は application/json にしてください",
  "payload-too-large": "リクエストが大きすぎます",
  "rate-limited":
    "AIへのリクエストが多すぎます。しばらく待ってから再試行してください",
  "not-configured": "AI機能はこのサーバーで設定されていません",
  "quota-exceeded":
    "本日のAIの利用上限に達しました。CAへ確認してください（上限はサーバーで設定）",
  unauthorized: "AI機能のアクセストークンが必要です（設定画面で入力）",
  "upstream-timeout": "AIの応答がタイムアウトしました",
  "upstream-unavailable": "AIサービスが一時的に利用できません",
  "upstream-error": "AIサービスの呼び出しに失敗しました",
  "invalid-model-output": "AIの応答を解釈できませんでした",
  blocked: "AIが応答を返しませんでした（安全性フィルタ等）",
  "provider-changed":
    "AIの送り先が確認時から変わったため送信しませんでした。もう一度確認してください",
};

function json(
  body: LlmApiResponse,
  status: number,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function fail(
  code: LlmApiErrorCode,
  message = MESSAGES[code] ?? code,
  headers?: Record<string, string>
): Response {
  return json({ ok: false, error: { code, message } }, STATUS[code], headers);
}

function upstreamCode(error: UpstreamError): LlmApiErrorCode {
  if (error.kind === "timeout") return "upstream-timeout";
  if (error.kind === "network" || error.kind === "unknown")
    return "upstream-error";
  const s = error.status ?? 0;
  if (s === 429 || s >= 500) return "upstream-unavailable";
  return "upstream-error";
}

const baseDefaults: Omit<BaseHandlerDeps, "dailyCounter"> = {
  config: () => readLlmConfig(),
  retry: {
    ...DEFAULT_RETRY,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
  },
  log: (event) => console.warn("[llm]", JSON.stringify(event)),
};

/** 推論・分類・fact の判定で共有する1日の上限（dailyRequestLimit） */
const sharedDailyCounter = new DailyRequestCounter();

const defaultDeps: LlmHandlerDeps = {
  ...baseDefaults,
  generate: async () => {
    throw new Error("generate is not configured");
  },
  dailyCounter: sharedDailyCounter,
  timeoutMs: { reason: 20_000, classify: 8_000 },
};

const defaultFactsDeps: FactsHandlerDeps = {
  ...baseDefaults,
  evaluate: async () => {
    throw new Error("evaluate is not configured");
  },
  dailyCounter: sharedDailyCounter,
};

/** 検索語の埋め込みのサーバー側の締め切り（クライアントは QUERY_CLIENT_TIMEOUT_MS で打ち切る） */
const QUERY_DEADLINE_MS = 4_000;

const defaultEmbedDeps: EmbedHandlerDeps = {
  ...baseDefaults,
  embed: async () => {
    throw new Error("embed is not configured");
  },
  dailyCounter: new DailyRequestCounter(),
  timeoutMs: 15_000,
};

/** プロセス内で共有する既定のレート制限（ルートごと） */
const defaultLimiters = new Map<string, TokenBucketRateLimiter>();

function defaultLimiter(kind: LlmApiKind, perMinute: number) {
  const key = `${kind}:${perMinute}`;
  let limiter = defaultLimiters.get(key);
  if (!limiter) {
    limiter = new TokenBucketRateLimiter({
      capacity: perMinute,
      refillIntervalMs: 60_000,
    });
    defaultLimiters.set(key, limiter);
  }
  return limiter;
}

const digest = (v: string) => createHash("sha256").update(v).digest();

/** 定数時間の比較（長さの違いも漏らさないようハッシュで比較する） */
export function tokenMatches(
  provided: string | null,
  expected: string
): boolean {
  if (provided === null) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

/** 本文を読み込みながらサイズを確認し、上限を超えた時点で打ち切る */
async function readBody(
  req: Request
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > LLM_LIMITS.maxBodyBytes) {
    return { ok: false, response: fail("payload-too-large") };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (req.body) {
      const reader = req.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > LLM_LIMITS.maxBodyBytes) {
          await reader.cancel().catch(() => {});
          return { ok: false, response: fail("payload-too-large") };
        }
        chunks.push(value);
      }
    }
  } catch {
    return {
      ok: false,
      response: fail("invalid-request", "本文を読み取れません"),
    };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return {
      ok: true,
      body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    };
  } catch {
    return {
      ok: false,
      response: fail("invalid-request", "本文がJSONではありません"),
    };
  }
}

/**
 * 検証で拒否した応答。L5 の再確認で止めた場合はコードだけを記録する（本文・欄の内容は残さない）
 */
function rejected(
  kind: LlmApiKind,
  v: Extract<Validated<unknown>, { ok: false }>,
  deps: BaseHandlerDeps
): Response {
  if (v.code === "not-sendable") {
    deps.log({ route: kind, code: "not-sendable" });
    return fail("not-sendable", NOT_SENDABLE_MESSAGE);
  }
  return fail("invalid-request", v.errors.join(" / "));
}

type Guarded =
  | { ok: true; config: LlmServerConfig; body: unknown }
  | { ok: false; response: Response };

/**
 * ルートが必要とする上流の API キーがあるか（ADR-011 §3。ルートごと）。
 * - 推論・埋め込み: Gemini のキー
 * - 分類: 選んだプロバイダーのキー
 * - fact の判定: 分類のプロバイダーが jev で、TypeSafe のキーがある場合のみ
 */
export function routeKeyConfigured(
  kind: LlmApiKind,
  config: LlmServerConfig
): boolean {
  switch (kind) {
    case "reason":
    case "embed":
      return Boolean(config.apiKey);
    case "classify":
      return Boolean(
        config.classifierProvider === "jev"
          ? config.typesafeApiKey
          : config.apiKey
      );
    case "facts":
      return (
        config.classifierProvider === "jev" && Boolean(config.typesafeApiKey)
      );
    // 送り先の確認は上流を呼ばない。facts の可否は TypeSafe のキーの有無を含む（トークンの内側。§15.1）
    case "providers":
      return true;
  }
}

/**
 * 全ルート共通の前処理: Content-Type → アクセストークン（本番では必須）→ レート制限
 * → ルートの API キー → 本文（サイズ上限・JSON）
 */
async function guard(
  kind: LlmApiKind,
  req: Request,
  deps: BaseHandlerDeps
): Promise<Guarded> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    return { ok: false, response: fail("unsupported-media-type") };
  }

  const config = deps.config();
  // 本番ではアクセストークン未設定の公開を拒否する（明示的にプラットフォーム側で保護している場合を除く）
  if (!config.accessToken && config.requireAccessToken) {
    deps.log({ route: kind, code: "not-configured" });
    return { ok: false, response: fail("not-configured") };
  }

  // トークンの確認はレート制限より先に行う（未認証の要求で正規利用者の枠を消費させない）
  if (
    config.accessToken &&
    !tokenMatches(req.headers.get(LLM_ACCESS_TOKEN_HEADER), config.accessToken)
  ) {
    return { ok: false, response: fail("unauthorized") };
  }

  const limiter =
    deps.rateLimiter ?? defaultLimiter(kind, config.rateLimitPerMinute[kind]);
  const limit = limiter.take(clientKey(req.headers, config.trustProxy));
  if (!limit.allowed) {
    return {
      ok: false,
      response: fail("rate-limited", undefined, {
        "Retry-After": String(limit.retryAfterSeconds),
      }),
    };
  }

  if (!routeKeyConfigured(kind, config)) {
    deps.log({ route: kind, code: "not-configured" });
    return { ok: false, response: fail("not-configured") };
  }

  const read = await readBody(req);
  if (!read.ok) return read;
  return { ok: true, config, body: read.body };
}

/** 上流の失敗を応答にする（ログはコード・種類・ステータスだけ） */
function upstreamFailure(
  kind: LlmApiKind,
  error: unknown,
  deps: BaseHandlerDeps
): Response {
  const upstream =
    error instanceof UpstreamError ? error : new UpstreamError("network");
  const code = upstreamCode(upstream);
  deps.log({ route: kind, code, kind: upstream.kind, status: upstream.status });
  return fail(code);
}

export function createLlmRouteHandler(
  kind: LlmGenerateKind,
  overrides: Partial<LlmHandlerDeps> = {}
): (req: Request) => Promise<Response> {
  const deps: LlmHandlerDeps = { ...defaultDeps, ...overrides };
  return kind === "reason" ? reasonHandler(deps) : classifyHandler(deps);
}

function reasonHandler(deps: LlmHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const guarded = await guard("reason", req, deps);
    if (!guarded.ok) return guarded.response;
    const { config } = guarded;

    const v = validateReasoningRequest(guarded.body);
    if (!v.ok) return rejected("reason", v, deps);
    const model = config.reasoningModel;
    const userContent = buildReasoningUserContent(v.value);
    const schema = reasoningResponseSchema(v.value.articles.map((a) => a.id));

    // 費用の上限（検証を通過し、実際に上流を呼ぶリクエストのみ数える）
    if (!deps.dailyCounter.take(config.dailyRequestLimit)) {
      deps.log({ route: "reason", code: "quota-exceeded" });
      return fail("quota-exceeded");
    }

    const apiKey = config.apiKey ?? "";
    let result: Awaited<ReturnType<GenerateJsonFn>>;
    try {
      const out = await withRetry((_attempt, remainingMs) => {
        // 1回の試行は全体の締め切りを超えない
        const timeoutMs = Math.max(
          1,
          Math.min(deps.timeoutMs.reason, remainingMs)
        );
        return withTimeout(timeoutMs, (signal) =>
          deps.generate({
            apiKey,
            model,
            systemInstruction: REASONING_SYSTEM_PROMPT,
            userContent,
            responseJsonSchema: schema,
            maxOutputTokens: REASON_MAX_OUTPUT_TOKENS,
            thinking: resolveThinking(model, config),
            timeoutMs,
            signal,
          })
        );
      }, deps.retry);
      result = out.value;
    } catch (error) {
      return upstreamFailure("reason", error, deps);
    }

    if (result.blocked || !result.text?.trim()) {
      deps.log({ route: "reason", code: "blocked" });
      return fail("blocked");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      deps.log({
        route: "reason",
        code: "invalid-model-output",
        truncated: result.truncated ? 1 : 0,
      });
      return fail("invalid-model-output");
    }
    return json({ ok: true, result: parsed, model }, 200);
  };
}

/** fetch はテストで差し替えられるよう、呼び出し時に解決する */
function jevEvaluateFor(deps: { fetch?: typeof fetch }): JevEvaluateFn {
  return createJevEvaluate((input, init) =>
    (deps.fetch ?? globalThis.fetch)(input, init)
  );
}

/**
 * 分類（ADR-011）。プロバイダーは設定（LLM_CLASSIFIER_PROVIDER）で選ぶ。
 * 応答の形（{ ok, result, model }）はプロバイダーによらず同じ。result はプロバイダーの生の出力
 */
function classifyHandler(deps: LlmHandlerDeps) {
  const classifierFor =
    deps.classifierFor ??
    ((config: LlmServerConfig) =>
      selectClassifier(config, {
        generate: deps.generate,
        evaluate: jevEvaluateFor(deps),
      }));

  return async (req: Request): Promise<Response> => {
    const guarded = await guard("classify", req, deps);
    if (!guarded.ok) return guarded.response;
    const { config } = guarded;

    const v = validateClassificationRequest(guarded.body);
    if (!v.ok) return rejected("classify", v, deps);
    // プレビューで示した送り先と違えば送らない（D13）。日次上限も消費しない
    if (v.value.provider !== config.classifierProvider) {
      deps.log({ route: "classify", code: "provider-changed" });
      return fail("provider-changed");
    }

    if (!deps.dailyCounter.take(config.dailyRequestLimit)) {
      deps.log({ route: "classify", code: "quota-exceeded" });
      return fail("quota-exceeded");
    }

    const isJev = config.classifierProvider === "jev";
    const retry = isJev ? jevRetry(deps.retry) : deps.retry;
    const perAttemptMs = isJev
      ? Math.min(deps.timeoutMs.classify, JEV_ATTEMPT_TIMEOUT_MS)
      : deps.timeoutMs.classify;
    const classify = classifierFor(config);

    let outcome: ClassifyOutcome;
    let attempts: number;
    try {
      const out = await withRetry((_attempt, remainingMs) => {
        const timeoutMs = Math.max(1, Math.min(perAttemptMs, remainingMs));
        return withTimeout(timeoutMs, (signal) =>
          classify({ narrative: v.value.narrative, config, timeoutMs, signal })
        );
      }, retry);
      outcome = out.value;
      attempts = out.attempts;
    } catch (error) {
      return upstreamFailure("classify", error, deps);
    }

    if (!outcome.ok) {
      deps.log({
        route: "classify",
        code: outcome.code,
        provider: config.classifierProvider,
        truncated: outcome.truncated ? 1 : undefined,
      });
      return fail(outcome.code);
    }
    if (isJev)
      deps.log({
        route: "classify",
        code: "ok",
        provider: "jev",
        model: outcome.model,
        attempts,
        inputTokens: outcome.inputTokens,
      });
    return json(
      { ok: true, result: outcome.result, model: outcome.model },
      200
    );
  };
}

/**
 * /api/llm/providers: 外部AIの送り先（分類のプロバイダー・fact の判定の可否）を返す。
 * 送信前のプレビューに実際の送り先を示すため（D13）。上流は呼ばず、日次上限も消費しない。
 * 返すのはコードだけ（キー・モデル名・設定値は返さない）
 */
export function createProvidersRouteHandler(
  overrides: Partial<BaseHandlerDeps> = {}
): (req: Request) => Promise<Response> {
  const deps: BaseHandlerDeps = {
    ...baseDefaults,
    dailyCounter: sharedDailyCounter,
    ...overrides,
  };
  return async (req: Request): Promise<Response> => {
    const guarded = await guard("providers", req, deps);
    if (!guarded.ok) return guarded.response;
    const v = validateProvidersRequest(guarded.body);
    if (!v.ok) return rejected("providers", v, deps);
    const { config } = guarded;
    const info: LlmProvidersInfo = {
      classify: config.classifierProvider,
      facts: routeKeyConfigured("facts", config),
    };
    return json({ ok: true, result: info, model: "" }, 200);
  };
}

/**
 * /api/llm/facts（fact-model.md §4）。報告文に fact が明示されているかを Jev に尋ねる。
 * 分類のプロバイダーが jev で TypeSafe のキーがある場合のみ使える（それ以外は 503 not-configured）。
 * 質問はカタログからサーバーが作る。応答の result は { presence: { [factId]: p }, provider }
 */
export function createFactsRouteHandler(
  overrides: Partial<FactsHandlerDeps> & { fetch?: typeof fetch } = {}
): (req: Request) => Promise<Response> {
  const deps: FactsHandlerDeps = {
    ...defaultFactsDeps,
    evaluate: jevEvaluateFor(overrides),
    ...overrides,
  };

  return async (req) => {
    const guarded = await guard("facts", req, deps);
    if (!guarded.ok) return guarded.response;
    const { config } = guarded;

    const v = validateFactPresenceRequest(guarded.body);
    if (!v.ok) return rejected("facts", v, deps);

    if (!deps.dailyCounter.take(config.dailyRequestLimit)) {
      deps.log({ route: "facts", code: "quota-exceeded" });
      return fail("quota-exceeded");
    }

    const { narrative, factIds } = v.value;
    const questions = buildJevPresenceQuestions(factIds);
    let invalidOutput = false;
    let response: Awaited<ReturnType<JevEvaluateFn>>;
    let attempts: number;
    try {
      const out = await withRetry((_attempt, remainingMs) => {
        const timeoutMs = Math.max(
          1,
          Math.min(JEV_ATTEMPT_TIMEOUT_MS, remainingMs)
        );
        return withTimeout(timeoutMs, async (signal) => {
          try {
            return await deps.evaluate({
              apiKey: config.typesafeApiKey ?? "",
              model: config.jevModel,
              state: buildJevState(narrative),
              questions,
              signal,
            });
          } catch (error) {
            if (error instanceof InvalidProviderOutput) invalidOutput = true;
            throw error;
          }
        });
      }, jevRetry(deps.retry));
      response = out.value;
      attempts = out.attempts;
    } catch (error) {
      if (invalidOutput) {
        deps.log({ route: "facts", code: "invalid-model-output" });
        return fail("invalid-model-output");
      }
      return upstreamFailure("facts", error, deps);
    }

    deps.log({
      route: "facts",
      code: "ok",
      model: response.model,
      attempts,
      facts: factIds.length,
      inputTokens: response.usage?.inputTokens,
    });
    return json(
      {
        ok: true,
        result: jevAnswersToRawPresence(response.answers, factIds),
        model: response.model,
      },
      200
    );
  };
}

/**
 * /api/llm/embed（ADR-010）。条文（document）または検索語（query）のベクトルを返す。
 * モデル・次元は EMBEDDING_MODEL で固定し、応答の model には保存用の key を返す。
 */
export function createEmbedRouteHandler(
  overrides: Partial<EmbedHandlerDeps> = {}
): (req: Request) => Promise<Response> {
  const deps: EmbedHandlerDeps = { ...defaultEmbedDeps, ...overrides };

  return async (req) => {
    const guarded = await guard("embed", req, deps);
    if (!guarded.ok) return guarded.response;
    const { config } = guarded;

    const v = validateEmbedRequest(guarded.body);
    if (!v.ok) return rejected("embed", v, deps);

    if (!deps.dailyCounter.take(config.dailyEmbedRequestLimit)) {
      deps.log({ route: "embed", code: "quota-exceeded" });
      return fail("quota-exceeded");
    }

    // 検索語は検索の応答を待たせないよう、短い締め切りで1回だけ試す（§33 数秒以内）。
    // 条文（取り込み）は通常の再試行を行う
    const isQuery = v.value.taskType === "query";
    const retry = isQuery
      ? {
          ...deps.retry,
          attempts: 1,
          totalDeadlineMs: Math.min(
            deps.retry.totalDeadlineMs,
            QUERY_DEADLINE_MS
          ),
        }
      : deps.retry;
    const perAttemptMs = isQuery
      ? Math.min(deps.timeoutMs, QUERY_DEADLINE_MS)
      : deps.timeoutMs;

    let invalidOutput = false;
    let vectors: number[][];
    try {
      const out = await withRetry((_attempt, remainingMs) => {
        const timeoutMs = Math.max(1, Math.min(perAttemptMs, remainingMs));
        return withTimeout(timeoutMs, async (signal) => {
          try {
            return await deps.embed({
              apiKey: config.apiKey ?? "",
              model: EMBEDDING_MODEL.id,
              texts: v.value.texts,
              taskType: v.value.taskType,
              dimensions: EMBEDDING_MODEL.dimensions,
              timeoutMs,
              signal,
            });
          } catch (error) {
            if (error instanceof InvalidEmbeddingOutput) invalidOutput = true;
            throw error;
          }
        });
      }, retry);
      vectors = out.value;
    } catch (error) {
      if (invalidOutput) {
        deps.log({ route: "embed", code: "invalid-model-output" });
        return fail("invalid-model-output");
      }
      return upstreamFailure("embed", error, deps);
    }
    return json(
      { ok: true, result: { vectors }, model: EMBEDDING_MODEL.key },
      200
    );
  };
}
