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
  /**
   * accessToken が未設定の場合にルートを無効にする。本番（NODE_ENV=production）では既定で true。
   * プラットフォーム側で保護している場合のみ LLM_ALLOW_UNAUTHENTICATED=1 で解除する。
   */
  requireAccessToken: boolean;
  /** X-Forwarded-For / X-Real-IP を信頼する（信頼できるリバースプロキシの背後のみ） */
  trustProxy: boolean;
  rateLimitPerMinute: { reason: number; classify: number };
  /** プロセス全体の1日あたりの上限（0 は無制限） */
  dailyRequestLimit: number;
  thinkingLevel: LlmThinkingLevel;
  /** 明示的な思考トークン数（GEMINI_THINKING_BUDGET。設定時は thinkingLevel より優先） */
  thinkingBudget?: number;
}

/** 実際に送る思考の設定（プロバイダー非依存） */
export type ThinkingSetting =
  | { mode: "level"; level: Exclude<LlmThinkingLevel, "off"> }
  | { mode: "budget"; tokens: number };

/** Gemini 2.5 系（thinkingBudget で制御）で使う、レベルに対応するトークン数 */
const BUDGET_FOR_LEVEL: Record<Exclude<LlmThinkingLevel, "off">, number> = {
  minimal: 512,
  low: 1_024,
  medium: 4_096,
};

/**
 * モデル系列ごとに思考の設定を決める（純粋関数）。null は設定を送らない。
 * - GEMINI_THINKING_BUDGET が設定されていればそれを thinkingBudget として送る
 * - Gemini 1.x / 2.0: 思考なし（送らない）
 * - Gemini 2.5: thinkingBudget（low → 1024 等。off は Flash 系のみ 0、Pro は無効化できないため送らない）
 * - それ以外（Gemini 3 以降・*-latest の別名）: thinkingLevel
 * 別名（*-latest）の実体は変わりうるため、モデル変更時は実キーでの動作確認が必要（ADR-007）。
 */
export function resolveThinking(
  model: string,
  config: Pick<LlmServerConfig, "thinkingLevel" | "thinkingBudget">
): ThinkingSetting | null {
  if (config.thinkingBudget !== undefined)
    return { mode: "budget", tokens: config.thinkingBudget };
  const id = model.toLowerCase();
  if (/gemini-(1\.|2\.0)/.test(id)) return null;
  if (/gemini-2\.5/.test(id)) {
    if (config.thinkingLevel === "off")
      return /pro/.test(id) ? null : { mode: "budget", tokens: 0 };
    return { mode: "budget", tokens: BUDGET_FOR_LEVEL[config.thinkingLevel] };
  }
  if (config.thinkingLevel === "off") return null;
  return { mode: "level", level: config.thinkingLevel };
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
    requireAccessToken:
      env.NODE_ENV === "production" &&
      env.LLM_ALLOW_UNAUTHENTICATED?.trim() !== "1",
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
    // 未設定・不正な値は undefined（-1 は「不正」を表す番兵）
    thinkingBudget:
      nonNegativeInt(env.GEMINI_THINKING_BUDGET, -1) >= 0
        ? nonNegativeInt(env.GEMINI_THINKING_BUDGET, -1)
        : undefined,
  };
}
