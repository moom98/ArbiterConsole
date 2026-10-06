import { pipeline, env } from "@xenova/transformers";

// Transformers.jsの設定（ブラウザ環境）
if (typeof window !== "undefined") {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
}

// モデルのシングルトンインスタンス
let embeddingModel: any = null;

/**
 * Embedding modelの初期化
 */
export async function initEmbeddingModel(): Promise<void> {
  if (embeddingModel) {
    return;
  }

  console.log("Loading embedding model: Xenova/all-MiniLM-L6-v2");

  embeddingModel = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
  );

  console.log("Embedding model loaded successfully");
}

/**
 * テキストからembedding vectorを生成
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!embeddingModel) {
    await initEmbeddingModel();
  }

  const output = await embeddingModel(text, {
    pooling: "mean",
    normalize: true,
  });

  // Float32Arrayを通常の配列に変換
  return Array.from(output.data);
}

/**
 * 複数テキストのembeddingsを一括生成
 */
export async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  if (!embeddingModel) {
    await initEmbeddingModel();
  }

  const embeddings: number[][] = [];

  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    embeddings.push(embedding);
  }

  return embeddings;
}

/**
 * コサイン類似度の計算
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

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Embedding modelのクリーンアップ
 */
export function cleanupEmbeddingModel(): void {
  embeddingModel = null;
}
