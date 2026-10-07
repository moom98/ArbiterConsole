import type { Embedding, Rule } from "@/lib/domain/entities";
import { cosineSimilarity } from "@/lib/infrastructure/embeddings/generator";

export interface VectorHit {
  ruleId: string;
  /** コサイン類似度を [0, 1] にクランプした値 */
  score: number;
}

/**
 * 候補ルールに対してベクトル類似度を計算する（純粋関数）
 *
 * - modelId と異なるモデルで生成された embedding は無視する
 *   （次元・ベクトル空間が異なるため比較不能）
 * - 候補全件のスコアを返す（ハイブリッド検索で正規化・閾値判定する）
 */
export function scoreByVector(
  queryVector: number[],
  candidates: readonly Rule[],
  embeddings: readonly Embedding[],
  modelId: string
): VectorHit[] {
  const vectorByRule = new Map<string, number[]>();
  for (const e of embeddings) {
    if (e.model === modelId && e.vector.length === queryVector.length) {
      vectorByRule.set(e.ruleId, e.vector);
    }
  }

  const hits: VectorHit[] = [];
  for (const rule of candidates) {
    const vector = vectorByRule.get(rule.id);
    if (!vector) continue;
    const similarity = cosineSimilarity(queryVector, vector);
    hits.push({ ruleId: rule.id, score: Math.max(0, Math.min(1, similarity)) });
  }

  return hits.sort((a, b) => b.score - a.score);
}
