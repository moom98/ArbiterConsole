import type { ClassifierProvider } from "@/lib/domain/llm/types";

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

/**
 * 分類のプロバイダー（ADR-011）。評価（jev-classifier-design §9）に合格するまで既定は gemini。
 * 本番の切り替えは LLM_CLASSIFIER_PROVIDER=jev（と TYPESAFE_API_KEY）の設定だけで行う
 */
export const DEFAULT_CLASSIFIER_PROVIDER: ClassifierProvider = "gemini";
/**
 * Jev の既定モデル。**バージョンを固定する**（jev-latest は使わない）。しきい値はモデルの較正に
 * 依存するため、変える場合は評価をやり直す（ADR-011, fact-model.md §5）
 */
export const DEFAULT_JEV_MODEL = "jev-1.13.0";

/** 既定のレート制限（1分あたり、ルートごと） */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 10;
/** 既定の1日あたりの上限（プロセス全体、UTC 日付で集計） */
export const DEFAULT_DAILY_REQUEST_LIMIT = 500;
/**
 * 埋め込みの既定値（ADR-010）。PDF 取り込みでは 16 件ずつ連続して送るため、推論・分類とは別の枠にする。
 * 1回あたりの費用は小さい（Gemini Embedding は入力トークン課金のみ）。
 */
export const DEFAULT_EMBED_RATE_LIMIT_PER_MINUTE = 60;
export const DEFAULT_DAILY_EMBED_REQUEST_LIMIT = 1_000;

/**
 * 思考（thinking）の量。"off" は設定を送らない（モデルの既定）。
 * 応答時間とトークン消費を抑えるため既定は "low"。
 */
export type LlmThinkingLevel = "off" | "minimal" | "low" | "medium";
export const DEFAULT_THINKING_LEVEL: LlmThinkingLevel = "low";

export interface LlmServerConfig {
  /** Gemini の API キー（推論・埋め込み、分類が gemini の場合の分類） */
  apiKey?: string;
  /** 分類（/api/llm/classify）のプロバイダー。/api/llm/facts は jev の場合のみ使える */
  classifierProvider: ClassifierProvider;
  /** TypeSafe（Jev）の API キー。サーバー専用（wrangler secret put TYPESAFE_API_KEY） */
  typesafeApiKey?: string;
  /** Jev のモデル（固定したバージョン） */
  jevModel: string;
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
  rateLimitPerMinute: {
    reason: number;
    classify: number;
    embed: number;
    facts: number;
    /** 送り先の確認（分類と同じ上限） */
    providers: number;
  };
  /** プロセス全体の1日あたりの上限（推論・分類。0 は無制限） */
  dailyRequestLimit: number;
  /** プロセス全体の1日あたりの埋め込みリクエストの上限（0 は無制限。ADR-010） */
  dailyEmbedRequestLimit: number;
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

export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,99}$/;

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

let warnedUnknownProvider = false;

/** 未知の値は gemini に戻す（1回だけログに残す。値そのものは残さない） */
function classifierProvider(value: string | undefined): ClassifierProvider {
  const v = value?.trim().toLowerCase();
  if (!v) return DEFAULT_CLASSIFIER_PROVIDER;
  if (v === "gemini" || v === "jev") return v;
  if (!warnedUnknownProvider) {
    warnedUnknownProvider = true;
    console.warn(
      "[llm]",
      JSON.stringify({
        code: "unknown-classifier-provider",
        fallback: "gemini",
      })
    );
  }
  return DEFAULT_CLASSIFIER_PROVIDER;
}

export function readLlmConfig(
  env: Record<string, string | undefined> = process.env
): LlmServerConfig {
  const apiKey = env.GEMINI_API_KEY?.trim();
  const accessToken = env.LLM_ACCESS_TOKEN?.trim();
  const typesafeApiKey = env.TYPESAFE_API_KEY?.trim();
  return {
    apiKey: apiKey ? apiKey : undefined,
    classifierProvider: classifierProvider(env.LLM_CLASSIFIER_PROVIDER),
    typesafeApiKey: typesafeApiKey ? typesafeApiKey : undefined,
    jevModel: model(env.JEV_MODEL, DEFAULT_JEV_MODEL),
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
      embed: Math.max(
        1,
        nonNegativeInt(
          env.LLM_RATE_LIMIT_EMBED_PER_MINUTE,
          DEFAULT_EMBED_RATE_LIMIT_PER_MINUTE
        )
      ),
      facts: Math.max(
        1,
        nonNegativeInt(
          env.LLM_RATE_LIMIT_FACTS_PER_MINUTE,
          DEFAULT_RATE_LIMIT_PER_MINUTE
        )
      ),
      // 送り先の確認は分類の前に1回ずつ行うため、分類と同じ上限にする
      providers: Math.max(
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
    dailyEmbedRequestLimit: nonNegativeInt(
      env.LLM_DAILY_EMBED_REQUEST_LIMIT,
      DEFAULT_DAILY_EMBED_REQUEST_LIMIT
    ),
    thinkingLevel: thinking(env.GEMINI_THINKING_LEVEL),
    // 未設定・不正な値は undefined（-1 は「不正」を表す番兵）
    thinkingBudget:
      nonNegativeInt(env.GEMINI_THINKING_BUDGET, -1) >= 0
        ? nonNegativeInt(env.GEMINI_THINKING_BUDGET, -1)
        : undefined,
  };
}
