import {
  LLM_LIMITS,
  type LlmApiErrorCode,
  type LlmApiKind,
  type LlmApiResponse,
} from "../contract";
import { readLlmConfig, type LlmServerConfig } from "./config";
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
  sharedLlmRateLimiter,
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
 * - レート制限（インメモリ、IP 単位）→ API キー確認 → 本文サイズ・入力検証 → Gemini 呼び出し
 * - タイムアウト・一時的エラーの再試行（指数バックオフ）
 * - 応答・エラーは型付き。API キーや入力本文はログ・応答に含めない
 */

export interface LlmHandlerDeps {
  config: () => LlmServerConfig;
  generate: GenerateJsonFn;
  rateLimiter: { take(key: string): RateLimitDecision };
  retry: RetryOptions;
  /** 1回の試行のタイムアウト（ミリ秒） */
  timeoutMs: Record<LlmApiKind, number>;
  /** 最小限のログ（エラーコード・上流ステータス・試行回数のみ） */
  log: (event: Record<string, string | number | undefined>) => void;
}

const MAX_OUTPUT_TOKENS: Record<LlmApiKind, number> = {
  reason: 2_048,
  classify: 512,
};

const STATUS: Record<LlmApiErrorCode, number> = {
  "invalid-request": 400,
  "unsupported-media-type": 415,
  "payload-too-large": 413,
  "rate-limited": 429,
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
  if (error.kind === "network") return "upstream-error";
  const s = error.status ?? 0;
  if (s === 429 || s >= 500) return "upstream-unavailable";
  return "upstream-error";
}

const defaultDeps: LlmHandlerDeps = {
  config: () => readLlmConfig(),
  generate: async () => {
    throw new Error("generate is not configured");
  },
  rateLimiter: sharedLlmRateLimiter,
  retry: {
    ...DEFAULT_RETRY,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
  },
  timeoutMs: { reason: 20_000, classify: 8_000 },
  log: (event) => console.warn("[llm]", JSON.stringify(event)),
};

async function readBody(
  req: Request
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > LLM_LIMITS.maxBodyBytes) {
    return { ok: false, response: fail("payload-too-large") };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return {
      ok: false,
      response: fail("invalid-request", "本文を読み取れません"),
    };
  }
  if (new TextEncoder().encode(text).length > LLM_LIMITS.maxBodyBytes) {
    return { ok: false, response: fail("payload-too-large") };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
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

    const limit = deps.rateLimiter.take(clientKey(req.headers));
    if (!limit.allowed) {
      return fail("rate-limited", undefined, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }

    const config = deps.config();
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

    const apiKey = config.apiKey;
    let result: Awaited<ReturnType<GenerateJsonFn>>;
    try {
      const out = await withRetry(
        () =>
          withTimeout(deps.timeoutMs[kind], (signal) =>
            deps.generate({
              apiKey,
              model,
              systemInstruction,
              userContent,
              responseJsonSchema: schema,
              maxOutputTokens: MAX_OUTPUT_TOKENS[kind],
              timeoutMs: deps.timeoutMs[kind],
              signal,
            })
          ),
        deps.retry
      );
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
