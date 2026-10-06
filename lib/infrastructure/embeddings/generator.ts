/**
 * ブラウザ内 Embedding 生成（Transformers.js v2）
 *
 * オフライン要件（§31）のため、モデル・WASMは同一オリジンの /public 配下から
 * 読み込む（scripts/fetch-model-assets.mjs, scripts/copy-runtime-assets.mjs）。
 * HF Hub / jsDelivr には実行時にアクセスしない。詳細は ADR-003。
 */

/** 日本語・英語の両方に対応した多言語モデル（384次元） */
export const EMBEDDING_MODEL_ID =
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

/** モデルファイルの配置先（public/models/<model id>/...） */
export const LOCAL_MODEL_PATH = "/models/";
/** onnxruntime-web の .wasm 配置先（public/ort/） */
export const ORT_WASM_PATH = "/ort/";

interface FeatureExtractionOutput {
  data: Float32Array;
  dims: number[];
  tolist(): number[][] | number[];
}

type FeatureExtractor = (
  texts: string | string[],
  options: { pooling: "mean"; normalize: boolean }
) => Promise<FeatureExtractionOutput>;

let modelPromise: Promise<FeatureExtractor> | null = null;

/**
 * Embedding modelの初期化（読み込み中のPromiseを共有し二重ロードを防ぐ）
 */
export function initEmbeddingModel(): Promise<FeatureExtractor> {
  if (!modelPromise) {
    modelPromise = loadModel().catch((error) => {
      // 失敗時は次回再試行できるようにする
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}

async function loadModel(): Promise<FeatureExtractor> {
  if (typeof window === "undefined") {
    throw new Error("Embedding generation is only available in the browser");
  }

  // SSR時に評価されないよう動的import
  const { pipeline, env } = await import("@xenova/transformers");

  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = LOCAL_MODEL_PATH;
  // Service Worker (next-pwa) の CacheFirst でキャッシュするため、二重保存を避ける
  env.useBrowserCache = false;
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = ORT_WASM_PATH;
  }

  const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
    quantized: true,
  });
  return extractor as unknown as FeatureExtractor;
}

/**
 * テキストからembedding vectorを生成
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text]);
  return embedding;
}

export interface GenerateEmbeddingsOptions {
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
}

const yieldToEventLoop = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * 複数テキストのembeddingsをバッチ単位で生成
 * バッチ間でイベントループに制御を返し、UIのフリーズを避ける。
 */
export async function generateEmbeddings(
  texts: readonly string[],
  options: GenerateEmbeddingsOptions = {}
): Promise<number[][]> {
  const { batchSize = 8, onProgress } = options;
  const extractor = await initEmbeddingModel();
  const embeddings: number[][] = [];

  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    const [rows, dim] = output.dims;
    for (let i = 0; i < rows; i++) {
      embeddings.push(Array.from(output.data.subarray(i * dim, (i + 1) * dim)));
    }
    onProgress?.(embeddings.length, texts.length);
    await yieldToEventLoop();
  }

  return embeddings;
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

/**
 * Embedding modelのクリーンアップ
 */
export function cleanupEmbeddingModel(): void {
  modelPromise = null;
}
