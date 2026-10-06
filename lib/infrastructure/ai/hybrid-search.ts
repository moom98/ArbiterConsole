import { vectorSearch, applyRulePriority, type ScoredRule } from "./vector-search";
import { fulltextSearch } from "./fulltext-search";

export interface HybridSearchOptions {
  limit?: number;
  vectorWeight?: number;
  fulltextWeight?: number;
  minScore?: number;
  tournamentId?: string;
}

/**
 * Hybrid search（Vector + Full-text）
 */
export async function hybridSearch(
  query: string,
  options: HybridSearchOptions = {}
): Promise<ScoredRule[]> {
  const {
    limit = 10,
    vectorWeight = 0.6,
    fulltextWeight = 0.4,
    minScore = 0.3,
    tournamentId,
  } = options;

  // Vector searchとFull-text searchを並列実行
  const [vectorResults, fulltextResults] = await Promise.all([
    vectorSearch(query, limit * 2, minScore),
    fulltextSearch(query, limit * 2),
  ]);

  // 結果をマージ
  const scoreMap = new Map<string, ScoredRule>();

  // Vector searchの結果を追加
  vectorResults.forEach((item) => {
    scoreMap.set(item.rule.id, {
      ...item,
      score: item.score * vectorWeight,
      method: "hybrid",
    });
  });

  // Full-text searchの結果をマージ
  fulltextResults.forEach((item) => {
    const existing = scoreMap.get(item.rule.id);
    if (existing) {
      // 両方に存在する場合はスコアを合算
      existing.score += item.score * fulltextWeight;
    } else {
      // Full-text searchのみに存在する場合
      scoreMap.set(item.rule.id, {
        ...item,
        score: item.score * fulltextWeight,
        method: "hybrid",
      });
    }
  });

  // スコア順にソート
  let results = Array.from(scoreMap.values()).sort(
    (a, b) => b.score - a.score
  );

  // Rule priorityを適用
  if (tournamentId) {
    results = applyRulePriority(results, tournamentId);
    results.sort((a, b) => b.score - a.score);
  }

  // limitまで絞り込み
  return results.slice(0, limit);
}

export * from "./vector-search";
export * from "./fulltext-search";
