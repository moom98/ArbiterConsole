import { db } from "@/lib/infrastructure/db";
import {
  generateEmbedding,
  cosineSimilarity,
} from "@/lib/infrastructure/embeddings";
import type { Rule } from "@/lib/domain/entities";

export interface ScoredRule {
  rule: Rule;
  score: number;
  method: "vector" | "fulltext" | "hybrid";
}

/**
 * Vector searchでルールを検索
 */
export async function vectorSearch(
  query: string,
  limit: number = 10,
  minScore: number = 0.5
): Promise<ScoredRule[]> {
  // クエリのembeddingを生成
  const queryEmbedding = await generateEmbedding(query);

  // 全てのruleのembeddingsを取得
  const allRules = await db.rules.toArray();
  const allEmbeddings = await db.embeddings.toArray();

  // embeddingsをruleIdでマッピング
  const embeddingMap = new Map(
    allEmbeddings.map((e) => [e.ruleId, e.vector])
  );

  // 類似度を計算
  const scoredRules: ScoredRule[] = allRules
    .map((rule) => {
      const embedding = embeddingMap.get(rule.id);
      if (!embedding) {
        return null;
      }

      const score = cosineSimilarity(queryEmbedding, embedding);

      const scoredRule: ScoredRule = {
        rule,
        score,
        method: "vector",
      };
      return scoredRule;
    })
    .filter((item) => item !== null && (item as ScoredRule).score >= minScore) as ScoredRule[];

  return scoredRules.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Rule priorityを適用（大会特別規定 > JCF > FIDE）
 */
export function applyRulePriority(
  scoredRules: ScoredRule[],
  tournamentId?: string
): ScoredRule[] {
  return scoredRules.map((item) => {
    let priorityBoost = 0;

    switch (item.rule.source) {
      case "tournament":
        if (item.rule.tournamentId === tournamentId) {
          priorityBoost = 1000;
        }
        break;
      case "JCF":
        priorityBoost = 100;
        break;
      case "FIDE":
        priorityBoost = 10;
        break;
      case "commentary":
        priorityBoost = 1;
        break;
    }

    return {
      ...item,
      score: item.score + priorityBoost / 10000, // 0.1以下のboost
    };
  });
}
