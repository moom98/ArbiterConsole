import { createHash, timingSafeEqual } from "node:crypto";
import {
  LLM_ACCESS_TOKEN_HEADER,
  LLM_LIMITS,
  type LlmApiErrorCode,
  type LlmApiKind,
  type LlmApiResponse,
} from "../contract";
import { readLlmConfig, resolveThinking, type LlmServerConfig } from "./config";
import {
  DEFAULT_RETRY,
  UpstreamError,
  withRetry,
  withTimeout,
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
  validateClassificationRequest,
  validateReasoningRequest,
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

export interface LlmHandlerDeps {
  config: () => LlmServerConfig;
  generate: GenerateJsonFn;
  /** 未指定ならルートごとに config の上限で作成する（プロセス内で共有） */
  rateLimiter?: { take(key: string): RateLimitDecision };
  dailyCounter: { take(limit: number): boolean };
  retry: RetryOptions;
  /** 1回の試行のタイムアウト（ミリ秒） */
  timeoutMs: Record<LlmApiKind, number>;
  /** 最小限のログ（エラーコード・上流ステータス・試行回数のみ） */
  log: (event: Record<string, string | number | undefined>) => void;
}

const MAX_OUTPUT_TOKENS: Record<LlmApiKind, number> = {
  reason: 6_000,
  classify: 1_024,
};

const STATUS: Record<LlmApiErrorCode, number> = {
  "invalid-request": 400,
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

const defaultDeps: LlmHandlerDeps = {
  config: () => readLlmConfig(),
  generate: async () => {
    throw new Error("generate is not configured");
  },
  dailyCounter: new DailyRequestCounter(),
  retry: {
    ...DEFAULT_RETRY,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
  },
  timeoutMs: { reason: 20_000, classify: 8_000 },
  log: (event) => console.warn("[llm]", JSON.stringify(event)),
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

export function createLlmRouteHandler(
  kind: LlmApiKind,
  overrides: Partial<LlmHandlerDeps> = {}
): (req: Request) => Promise<Response> {
  const deps: LlmHandlerDeps = { ...defaultDeps, ...overrides };

  return async (req) => {
    const contentType = req.headers.get("content-type") ?? "";
    if (!/^application\/json\b/i.test(contentType)) {
      return fail("unsupported-media-type");
    }

    const config = deps.config();
    // 本番ではアクセストークン未設定の公開を拒否する（明示的にプラットフォーム側で保護している場合を除く）
    if (!config.accessToken && config.requireAccessToken) {
      deps.log({ route: kind, code: "not-configured" });
      return fail("not-configured");
    }

    // トークンの確認はレート制限より先に行う（未認証の要求で正規利用者の枠を消費させない）
    if (
      config.accessToken &&
      !tokenMatches(
        req.headers.get(LLM_ACCESS_TOKEN_HEADER),
        config.accessToken
      )
    ) {
      return fail("unauthorized");
    }

    const limiter =
      deps.rateLimiter ?? defaultLimiter(kind, config.rateLimitPerMinute[kind]);
    const limit = limiter.take(clientKey(req.headers, config.trustProxy));
    if (!limit.allowed) {
      return fail("rate-limited", undefined, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }

    if (!config.apiKey) {
      deps.log({ route: kind, code: "not-configured" });
      return fail("not-configured");
    }

    const read = await readBody(req);
    if (!read.ok) return read.response;

    let model: string;
    let systemInstruction: string;
    let userContent: string;
    let schema: unknown;
    if (kind === "reason") {
      const v = validateReasoningRequest(read.body);
      if (!v.ok) return fail("invalid-request", v.errors.join(" / "));
      model = config.reasoningModel;
      systemInstruction = REASONING_SYSTEM_PROMPT;
      userContent = buildReasoningUserContent(v.value);
      schema = reasoningResponseSchema(v.value.articles.map((a) => a.id));
    } else {
      const v = validateClassificationRequest(read.body);
      if (!v.ok) return fail("invalid-request", v.errors.join(" / "));
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

    const apiKey = config.apiKey;
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
