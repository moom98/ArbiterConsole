/**
 * /api/llm/* の通信契約（サーバー・クライアント共通。SDK には依存しない）。ADR-006。
 */

export const LLM_API_PATHS = {
  reason: "/api/llm/reason",
  classify: "/api/llm/classify",
} as const;

export type LlmApiKind = keyof typeof LLM_API_PATHS;

/** 入力サイズの上限（サーバーで検証し、クライアントはこれに収まるように送る） */
export const LLM_LIMITS = {
  maxBodyBytes: 160_000,
  maxDescriptionChars: 2_000,
  maxClassifyTextChars: 2_000,
  maxArticles: 8,
  maxArticleContentChars: 4_000,
  maxArticleTitleChars: 300,
  maxArticleNumberChars: 100,
  maxIdChars: 200,
  maxSourceNameChars: 200,
  maxShortChars: 50,
} as const;

export type LlmApiErrorCode =
  /** 入力が不正 */
  | "invalid-request"
  /** Content-Type が application/json でない */
  | "unsupported-media-type"
  /** 本文が大きすぎる */
  | "payload-too-large"
  /** このサーバーのレート制限に達した */
  | "rate-limited"
  /** サーバーに API キーが設定されていない */
  | "not-configured"
  /** 上流（Gemini）のタイムアウト */
  | "upstream-timeout"
  /** 上流が混雑・一時的に利用不可 */
  | "upstream-unavailable"
  /** 上流のその他のエラー */
  | "upstream-error"
  /** 出力が JSON として解釈できない */
  | "invalid-model-output"
  /** 安全性フィルタ等により応答がない */
  | "blocked"
  /** クライアント側: 通信失敗 */
  | "network-error"
  /** クライアント側: オフライン */
  | "offline";

export interface LlmApiError {
  code: LlmApiErrorCode;
  message: string;
}

export type LlmApiResponse =
  | { ok: true; result: unknown; model: string }
  | { ok: false; error: LlmApiError };
