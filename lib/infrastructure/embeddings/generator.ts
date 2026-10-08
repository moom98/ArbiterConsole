/**
 * 意味検索の埋め込み（ブラウザ側）。ADR-010。
 *
 * Gemini Embedding をサーバールート /api/llm/embed 経由で呼び出す（API キーはサーバーのみ）。
 * 端末内のモデル（Transformers.js）は使わない（ADR-003 の自前配信モデルを置き換え）。
 * - 条文（document）: PDF 取り込み時・「意味検索用データを作成」時に 16 件ずつ送る
 * - 検索語（query）: 検索のたびに1件送る。フェアプレーに触れる検索語は送らない（§23）
 * オフライン・トークン未設定・失敗時は呼び出し側がキーワード検索のみで継続する。
 */
import { mentionsFairPlay } from "@/lib/domain/llm/keyword-classifier";
import {
  EMBEDDING_MODEL,
  LLM_LIMITS,
  type EmbeddingTaskType,
  type LlmApiErrorCode,
} from "@/lib/infrastructure/llm/contract";
import {
  callLlmApi,
  type LlmApiClientDeps,
} from "@/lib/infrastructure/llm/llm-api-client";

/** Embedding.model に保存する識別子（モデルと次元の組）。これと一致するベクトルのみ比較する */
export const EMBEDDING_MODEL_ID: string = EMBEDDING_MODEL.key;

/** 埋め込みを取得できなかった（オフライン・未認証・上限・上流のエラー等） */
export class EmbeddingUnavailableError extends Error {
  /** 条文の取り込みで、失敗する前に作成できた分（先頭から順に）。呼び出し側はこれを保存できる */
  partialVectors: number[][] = [];

  constructor(
    readonly code: LlmApiErrorCode | "fair-play" | "invalid-response",
    message: string
  ) {
    super(message);
    this.name = "EmbeddingUnavailableError";
  }
}

export interface EmbeddingClientDeps extends LlmApiClientDeps {
  call?: typeof callLlmApi;
  sleep?: (ms: number) => Promise<void>;
}

export interface GenerateEmbeddingsOptions {
  onProgress?: (done: number, total: number) => void;
  /** 一時的な失敗で待機する前に呼ぶ（画面に「再試行中」を表示するため） */
  onRetry?: (waitMs: number) => void;
  deps?: EmbeddingClientDeps;
}

/** 一時的な失敗（レート制限・混雑・タイムアウト・通信断）。条文の取り込みでは待って再試行する */
const RETRYABLE: ReadonlySet<LlmApiErrorCode> = new Set<LlmApiErrorCode>([
  "rate-limited",
  "upstream-unavailable",
  "upstream-timeout",
  "network-error",
]);
/** 条文の取り込みでの再試行の待ち時間（無料枠の1分あたりの上限に備えて長めに待つ） */
const DOCUMENT_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
/** 検索語の埋め込みのクライアント側のタイムアウト。超えたらキーワード検索の結果のみ表示する（§33） */
export const QUERY_CLIENT_TIMEOUT_MS = 5_000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 送信用に整える（前後の空白を除き、モデルの入力上限に収まるよう切り詰める） */
export function prepareEmbeddingText(text: string): string {
  return text.trim().slice(0, LLM_LIMITS.maxEmbedTextChars);
}

function isVectorList(v: unknown, count: number): v is number[][] {
  return (
    Array.isArray(v) &&
    v.length === count &&
    v.every(
      (row) =>
        Array.isArray(row) &&
        row.length === EMBEDDING_MODEL.dimensions &&
        row.every((x) => typeof x === "number" && Number.isFinite(x))
    )
  );
}

async function embedBatch(
  taskType: EmbeddingTaskType,
  texts: string[],
  retryDelaysMs: readonly number[],
  deps: EmbeddingClientDeps,
  onRetry?: (waitMs: number) => void
): Promise<number[][]> {
  const call = deps.call ?? callLlmApi;
  const sleep = deps.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    const res = await call("embed", { taskType, texts }, deps);
    if (res.ok) {
      const vectors = (res.result as { vectors?: unknown } | null)?.vectors;
      if (
        res.model !== EMBEDDING_MODEL.key ||
        !isVectorList(vectors, texts.length)
      )
        throw new EmbeddingUnavailableError(
          "invalid-response",
          "意味検索用データの応答が不正です"
        );
      return vectors;
    }
    if (RETRYABLE.has(res.error.code) && attempt < retryDelaysMs.length) {
      onRetry?.(retryDelaysMs[attempt]);
      await sleep(retryDelaysMs[attempt]);
      continue;
    }
    throw new EmbeddingUnavailableError(res.error.code, res.error.message);
  }
}

/**
 * 条文（document）の埋め込みを 16 件ずつ生成する。一時的な失敗は待って再試行する。
 * いずれかのバッチが失敗した場合は例外。それまでに作成できた分は error.partialVectors に入れる
 * （呼び出し側はそれを保存し、残りは後で「意味検索用データを作成」で作成できる）。
 */
export async function generateEmbeddings(
  texts: readonly string[],
  options: GenerateEmbeddingsOptions = {}
): Promise<number[][]> {
  const { onProgress, onRetry, deps = {} } = options;
  const embeddings: number[][] = [];
  for (let start = 0; start < texts.length; start += LLM_LIMITS.maxEmbedTexts) {
    const batch = texts
      .slice(start, start + LLM_LIMITS.maxEmbedTexts)
      .map(prepareEmbeddingText)
      // 空の条文も件数を合わせるために送る（サーバーは空文字を受け付けないため記号を入れる）
      .map((t) => (t === "" ? "-" : t));
    try {
      embeddings.push(
        ...(await embedBatch(
          "document",
          batch,
          DOCUMENT_RETRY_DELAYS_MS,
          deps,
          onRetry
        ))
      );
    } catch (error) {
      const failure =
        error instanceof EmbeddingUnavailableError
          ? error
          : new EmbeddingUnavailableError(
              "network-error",
              error instanceof Error ? error.message : String(error)
            );
      failure.partialVectors = embeddings;
      throw failure;
    }
    onProgress?.(embeddings.length, texts.length);
  }
  return embeddings;
}

/**
 * 検索語（query）の埋め込み。検索の応答を待たせないよう再試行しない。
 * フェアプレーに触れる検索語は送らない（キーワード検索のみになる）。
 */
export async function generateQueryEmbedding(
  query: string,
  deps: EmbeddingClientDeps = {}
): Promise<number[]> {
  // フェアプレーの確認は切り詰める前の全文で行う
  if (mentionsFairPlay(query))
    throw new EmbeddingUnavailableError(
      "fair-play",
      "フェアプレー関連の検索語はAIへ送信しません（キーワード検索のみ）"
    );
  const text = prepareEmbeddingText(query);
  if (!text)
    throw new EmbeddingUnavailableError("invalid-request", "検索語が空です");
  const [vector] = await embedBatch("query", [text], [], {
    timeoutMs: QUERY_CLIENT_TIMEOUT_MS,
    ...deps,
  });
  return vector;
}

/**
 * コサイン類似度の計算
 * ゼロベクトルを含む場合は 0 を返す（NaNを返さない）
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
