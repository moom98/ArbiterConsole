import { createHash, timingSafeEqual } from "node:crypto";
import {
  EMBEDDING_MODEL,
  LLM_ACCESS_TOKEN_HEADER,
  LLM_LIMITS,
  type LlmApiErrorCode,
  type LlmApiKind,
  type LlmApiResponse,
  type LlmGenerateKind,
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
  buildClassificationUserContent,
  buildReasoningUserContent,
  CLASSIFICATION_RESPONSE_SCHEMA,
  CLASSIFIER_SYSTEM_PROMPT,
  REASONING_SYSTEM_PROMPT,
  reasoningResponseSchema,
} from "./prompts";
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
  validateReasoningRequest,
  type Validated,
} from "./request-validation";

/**
 * /api/llm/{reason,classify} の処理本体（Route Handler から呼ぶ）。ADR-007。
 *
 * - Content-Type: application/json 必須（クロスオリジンのブラウザからはプリフライトが必要になる）
 * - レート制限（ルートごと、インメモリ）→ アクセストークン（LLM_ACCESS_TOKEN 設定時）
 *   → API キー確認 → 本文サイズ（ストリーム読み込み中に打ち切り）・入力検証
 *   → 1日あたりの上限 → Gemini 呼び出し
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
}

/** /api/llm/embed の依存（ADR-010）。1日の上限は推論・分類とは別に数える */
export interface EmbedHandlerDeps extends BaseHandlerDeps {
  embed: EmbedTextsFn;
  /** 1回の試行のタイムアウト（ミリ秒） */
  timeoutMs: number;
}

const MAX_OUTPUT_TOKENS: Record<LlmGenerateKind, number> = {
  reason: 6_000,
  classify: 1_024,
};

const STATUS: Record<LlmApiErrorCode, number> = {
  "invalid-request": 400,
  "not-sendable": 400,
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

const defaultDeps: LlmHandlerDeps = {
  ...baseDefaults,
  generate: async () => {
    throw new Error("generate is not configured");
  },
  dailyCounter: new DailyRequestCounter(),
  timeoutMs: { reason: 20_000, classify: 8_000 },
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
  | { ok: true; config: LlmServerConfig & { apiKey: string }; body: unknown }
  | { ok: false; response: Response };

/**
 * 全ルート共通の前処理: Content-Type → アクセストークン（本番では必須）→ レート制限
 * → API キー → 本文（サイズ上限・JSON）
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

  if (!config.apiKey) {
    deps.log({ route: kind, code: "not-configured" });
    return { ok: false, response: fail("not-configured") };
  }

  const read = await readBody(req);
  if (!read.ok) return read;
  return {
    ok: true,
    config: { ...config, apiKey: config.apiKey },
    body: read.body,
  };
}

export function createLlmRouteHandler(
  kind: LlmGenerateKind,
  overrides: Partial<LlmHandlerDeps> = {}
): (req: Request) => Promise<Response> {
  const deps: LlmHandlerDeps = { ...defaultDeps, ...overrides };

  return async (req) => {
    const guarded = await guard(kind, req, deps);
    if (!guarded.ok) return guarded.response;
    const { config } = guarded;

    let model: string;
    let systemInstruction: string;
    let userContent: string;
    let schema: unknown;
    if (kind === "reason") {
      const v = validateReasoningRequest(guarded.body);
      if (!v.ok) return rejected(kind, v, deps);
      model = config.reasoningModel;
      systemInstruction = REASONING_SYSTEM_PROMPT;
      userContent = buildReasoningUserContent(v.value);
      schema = reasoningResponseSchema(v.value.articles.map((a) => a.id));
    } else {
      const v = validateClassificationRequest(guarded.body);
      if (!v.ok) return rejected(kind, v, deps);
      model = config.classifierModel;
      systemInstruction = CLASSIFIER_SYSTEM_PROMPT;
      userContent = buildClassificationUserContent(v.value);
      schema = CLASSIFICATION_RESPONSE_SCHEMA;
    }

    // 費用の上限（検証を通過し、実際に上流を呼ぶリクエストのみ数える）
    if (!deps.dailyCounter.take(config.dailyRequestLimit)) {
      deps.log({ route: kind, code: "quota-exceeded" });
      return fail("quota-exceeded");
    }

    const { apiKey } = config;
    let result: Awaited<ReturnType<GenerateJsonFn>>;
    try {
      const out = await withRetry((_attempt, remainingMs) => {
        // 1回の試行は全体の締め切りを超えない
        const timeoutMs = Math.max(
          1,
          Math.min(deps.timeoutMs[kind], remainingMs)
        );
        return withTimeout(timeoutMs, (signal) =>
          deps.generate({
            apiKey,
            model,
            systemInstruction,
            userContent,
            responseJsonSchema: schema,
            maxOutputTokens: MAX_OUTPUT_TOKENS[kind],
            thinking: resolveThinking(model, config),
            timeoutMs,
            signal,
          })
        );
      }, deps.retry);
      result = out.value;
    } catch (error) {
      const upstream =
        error instanceof UpstreamError ? error : new UpstreamError("network");
      const code = upstreamCode(upstream);
      deps.log({
        route: kind,
        code,
        kind: upstream.kind,
        status: upstream.status,
      });
      return fail(code);
    }

    if (result.blocked || !result.text?.trim()) {
      deps.log({ route: kind, code: "blocked" });
      return fail("blocked");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      deps.log({
        route: kind,
        code: "invalid-model-output",
        truncated: result.truncated ? 1 : 0,
      });
      return fail("invalid-model-output");
    }
    return json({ ok: true, result: parsed, model }, 200);
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
              apiKey: config.apiKey,
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
      const upstream =
        error instanceof UpstreamError ? error : new UpstreamError("network");
      const code = upstreamCode(upstream);
      deps.log({
        route: "embed",
        code,
        kind: upstream.kind,
        status: upstream.status,
      });
      return fail(code);
    }
    return json(
      { ok: true, result: { vectors }, model: EMBEDDING_MODEL.key },
      200
    );
  };
}
