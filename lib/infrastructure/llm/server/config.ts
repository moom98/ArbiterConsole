/**
 * サーバー専用の LLM 設定（環境変数）。ADR-007。
 * API キー・アクセストークンはサーバーの環境変数のみに置き、クライアントへは返さない。
 *
 * モデル ID はこのファイルでのみ定義する（他のファイルに書かないこと）。
 */

/** 推論（決定木の対象外の事象）の既定モデル。応答速度を優先（§33） */
export const DEFAULT_REASONING_MODEL = "gemini-flash-latest";
/** 分類の既定モデル（低コスト） */
export const DEFAULT_CLASSIFIER_MODEL = "gemini-flash-lite-latest";

/** 既定のレート制限（1分あたり、ルートごと） */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 10;
/** 既定の1日あたりの上限（プロセス全体、UTC 日付で集計） */
export const DEFAULT_DAILY_REQUEST_LIMIT = 500;

/**
 * 思考（thinking）の量。"off" は設定を送らない（モデルの既定）。
 * 応答時間とトークン消費を抑えるため既定は "low"。
 */
export type LlmThinkingLevel = "off" | "minimal" | "low" | "medium";
export const DEFAULT_THINKING_LEVEL: LlmThinkingLevel = "low";

export interface LlmServerConfig {
  apiKey?: string;
  reasoningModel: string;
  classifierModel: string;
  /**
   * 設定されている場合、/api/llm/* は X-Arbiter-Access-Token ヘッダーの一致を要求する。
   * Gemini の API キーとは別の、このアプリのルート専用のトークン。
   */
  accessToken?: string;
  /** X-Forwarded-For / X-Real-IP を信頼する（信頼できるリバースプロキシの背後のみ） */
  trustProxy: boolean;
  rateLimitPerMinute: { reason: number; classify: number };
  /** プロセス全体の1日あたりの上限（0 は無制限） */
  dailyRequestLimit: number;
  thinkingLevel: LlmThinkingLevel;
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,99}$/;

function model(value: string | undefined, fallback: string): string {
  const v = value?.trim();
  return v && MODEL_ID.test(v) ? v : fallback;
}

function nonNegativeInt(value: string | undefined, fallback: number): number {
  const n = Number(value?.trim());
  return value !== undefined &&
    value.trim() !== "" &&
    Number.isInteger(n) &&
    n >= 0
    ? n
    : fallback;
}

function thinking(value: string | undefined): LlmThinkingLevel {
  const v = value?.trim().toLowerCase();
  return v === "off" || v === "minimal" || v === "low" || v === "medium"
    ? v
    : DEFAULT_THINKING_LEVEL;
}

export function readLlmConfig(
  env: Record<string, string | undefined> = process.env
): LlmServerConfig {
  const apiKey = env.GEMINI_API_KEY?.trim();
  const accessToken = env.LLM_ACCESS_TOKEN?.trim();
  return {
    apiKey: apiKey ? apiKey : undefined,
    reasoningModel: model(env.GEMINI_MODEL_REASONING, DEFAULT_REASONING_MODEL),
    classifierModel: model(
      env.GEMINI_MODEL_CLASSIFIER,
      DEFAULT_CLASSIFIER_MODEL
    ),
    accessToken: accessToken ? accessToken : undefined,
    trustProxy: env.TRUST_PROXY?.trim() === "1",
    rateLimitPerMinute: {
      reason: Math.max(
        1,
        nonNegativeInt(
          env.LLM_RATE_LIMIT_REASON_PER_MINUTE,
          DEFAULT_RATE_LIMIT_PER_MINUTE
        )
      ),
      classify: Math.max(
        1,
        nonNegativeInt(
          env.LLM_RATE_LIMIT_CLASSIFY_PER_MINUTE,
          DEFAULT_RATE_LIMIT_PER_MINUTE
        )
      ),
    },
    dailyRequestLimit: nonNegativeInt(
      env.LLM_DAILY_REQUEST_LIMIT,
      DEFAULT_DAILY_REQUEST_LIMIT
    ),
    thinkingLevel: thinking(env.GEMINI_THINKING_LEVEL),
  };
}
