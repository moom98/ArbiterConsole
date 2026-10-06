import type { RuleSource, RuleSourceType } from "@/lib/domain/entities";
import { db } from "@/lib/infrastructure/db";
import { EMBEDDING_MODEL_ID } from "@/lib/infrastructure/embeddings/generator";

/**
 * 登録済みルール資料の参照（pdfjs等の重い依存を持たない）
 */

export interface RuleSourceSummary {
  source: RuleSource;
  ruleCount: number;
  /** 現行モデルで生成されたEmbeddingの件数 */
  embeddingCount: number;
}

export interface RuleStatistics {
  total: number;
  bySource: Record<RuleSourceType, number>;
  sources: RuleSourceSummary[];
}

export async function getRuleStatistics(): Promise<RuleStatistics> {
  const [rules, sources, embeddings] = await Promise.all([
    db.rules.toArray(),
    db.ruleSources.toArray(),
    db.embeddings.where("model").equals(EMBEDDING_MODEL_ID).toArray(),
  ]);

  const bySource: Record<RuleSourceType, number> = {
    FIDE: 0,
    JCF: 0,
    tournament: 0,
    commentary: 0,
  };
  const rulesBySourceId = new Map<string, number>();
  const sourceIdByRuleId = new Map<string, string>();

  for (const rule of rules) {
    bySource[rule.source]++;
    if (rule.sourceId) {
      rulesBySourceId.set(
        rule.sourceId,
        (rulesBySourceId.get(rule.sourceId) ?? 0) + 1
      );
      sourceIdByRuleId.set(rule.id, rule.sourceId);
    }
  }

  const embeddingsBySourceId = new Map<string, number>();
  for (const e of embeddings) {
    const sourceId = sourceIdByRuleId.get(e.ruleId);
    if (sourceId) {
      embeddingsBySourceId.set(
        sourceId,
        (embeddingsBySourceId.get(sourceId) ?? 0) + 1
      );
    }
  }

  return {
    total: rules.length,
    bySource,
    sources: sources.map((source) => ({
      source,
      ruleCount: rulesBySourceId.get(source.id) ?? 0,
      embeddingCount: embeddingsBySourceId.get(source.id) ?? 0,
    })),
  };
}
