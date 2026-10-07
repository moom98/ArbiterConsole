/**
 * サーバー専用の LLM 設定（環境変数）。ADR-006。
 * API キーはサーバーの環境変数のみに置き、クライアントへは返さない。
 */

/** 推論（決定木の対象外の事象）の既定モデル。応答速度を優先（§33） */
export const DEFAULT_REASONING_MODEL = "gemini-flash-latest";
/** 分類の既定モデル（低コスト） */
export const DEFAULT_CLASSIFIER_MODEL = "gemini-flash-lite-latest";

export interface LlmServerConfig {
  apiKey?: string;
  reasoningModel: string;
  classifierModel: string;
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,99}$/;

function model(value: string | undefined, fallback: string): string {
  const v = value?.trim();
  return v && MODEL_ID.test(v) ? v : fallback;
}

export function readLlmConfig(
  env: Record<string, string | undefined> = process.env
): LlmServerConfig {
  const apiKey = env.GEMINI_API_KEY?.trim();
  return {
    apiKey: apiKey ? apiKey : undefined,
    reasoningModel: model(env.GEMINI_MODEL_REASONING, DEFAULT_REASONING_MODEL),
    classifierModel: model(
      env.GEMINI_MODEL_CLASSIFIER,
      DEFAULT_CLASSIFIER_MODEL
    ),
  };
}
