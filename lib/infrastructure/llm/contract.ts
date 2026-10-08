/**
 * /api/llm/* の通信契約（サーバー・クライアント共通。SDK には依存しない）。ADR-007。
 */

export const LLM_API_PATHS = {
  reason: "/api/llm/reason",
  classify: "/api/llm/classify",
  embed: "/api/llm/embed",
} as const;

export type LlmApiKind = keyof typeof LLM_API_PATHS;
/** JSON を生成するルート（埋め込み以外） */
export type LlmGenerateKind = Exclude<LlmApiKind, "embed">;

/**
 * 意味検索の埋め込みモデル（ADR-010）。サーバーとクライアントで共有する固定値。
 * 変更すると保存済みのベクトルと比較できなくなるため、環境変数では切り替えない。
 * 変更した場合は「意味検索用データを作成」で全条文のベクトルが作り直される（key が変わるため）。
 */
export const EMBEDDING_MODEL = {
  id: "gemini-embedding-001",
  dimensions: 768,
  /** Embedding.model に保存する識別子（モデルと次元の組） */
  key: "gemini-embedding-001@768",
} as const;

/** 埋め込みの用途。文書（条文）と検索語でベクトルの作り方が異なる */
export type EmbeddingTaskType = "document" | "query";

export interface EmbedRequest {
  taskType: EmbeddingTaskType;
  texts: string[];
}

export interface EmbedResult {
  vectors: number[][];
}

/**
 * サーバーで LLM_ACCESS_TOKEN が設定されている場合に必要なヘッダー（ADR-007）。
 * Gemini の API キーではなく、このアプリの /api/llm/* 専用のアクセストークン。
 */
export const LLM_ACCESS_TOKEN_HEADER = "x-arbiter-access-token";

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
  /** 1回の埋め込みリクエストで送る文の数（16 × 3,000 文字 × 3 バイトでも本文上限に収まる） */
  maxEmbedTexts: 16,
  /** 埋め込み1件あたりの文字数（モデルの入力上限 2,048 トークン以内に収める） */
  maxEmbedTextChars: 3_000,
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
  /** このサーバーの1日あたりの上限に達した */
  | "quota-exceeded"
  /** アクセストークンが必要・不一致 */
  | "unauthorized"
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
