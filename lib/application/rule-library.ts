import type { RuleSource, RuleSourceType } from "@/lib/domain/entities";
import { db, type ArbiterDatabase } from "@/lib/infrastructure/db";
import { clearFulltextIndex } from "@/lib/infrastructure/ai/fulltext-search";
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
  /** 検索対象の条文のうち、現行モデルの意味検索用データがない件数（ADR-010） */
  missingEmbeddingCount: number;
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

  const activeSourceIds = new Set(
    sources.filter((s) => s.status === "active").map((s) => s.id)
  );
  const embeddedRuleIds = new Set(embeddings.map((e) => e.ruleId));
  const missingEmbeddingCount = rules.filter(
    (r) =>
      (!r.sourceId || activeSourceIds.has(r.sourceId)) &&
      !embeddedRuleIds.has(r.id)
  ).length;

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
    missingEmbeddingCount,
    bySource,
    sources: sources.map((source) => ({
      source,
      ruleCount: rulesBySourceId.get(source.id) ?? 0,
      embeddingCount: embeddingsBySourceId.get(source.id) ?? 0,
    })),
  };
}

/**
 * 資料の範囲判定: 大会固有規定は同じ大会のもののみ同一範囲とみなす
 */
export function inScope(
  item: { tournamentId?: string },
  sourceType: RuleSourceType,
  tournamentId: string | undefined
): boolean {
  return sourceType !== "tournament" || item.tournamentId === tournamentId;
}

/**
 * 同じ種別（大会固有規定は同じ大会）の有効な資料を取得する
 */
export async function findActiveSourcesInScope(
  database: ArbiterDatabase,
  sourceType: RuleSourceType,
  tournamentId: string | undefined
): Promise<RuleSource[]> {
  const sources = await database.ruleSources
    .where("sourceType")
    .equals(sourceType)
    .toArray();
  return sources.filter(
    (s) => s.status === "active" && inScope(s, sourceType, tournamentId)
  );
}

/**
 * 出典情報のない旧データ（スキーマv3以前に取り込まれ sourceId を持たない条文）の件数。
 * 同じ種別・範囲の次回インポート時に削除される。
 */
export async function countLegacyRulesInScope(
  database: ArbiterDatabase,
  sourceType: RuleSourceType,
  tournamentId: string | undefined
): Promise<number> {
  const rules = await database.rules
    .where("source")
    .equals(sourceType)
    .toArray();
  return rules.filter(
    (r) => !r.sourceId && inScope(r, sourceType, tournamentId)
  ).length;
}

export interface ImportScopeInfo {
  /** 同じ種別（大会固有規定は同じ大会）の有効な資料 */
  activeSources: RuleSource[];
  /** インポート時に削除される出典情報のない旧データの件数 */
  legacyRuleCount: number;
}

export async function getImportScopeInfo(
  sourceType: RuleSourceType,
  tournamentId: string | undefined,
  database: ArbiterDatabase = db
): Promise<ImportScopeInfo> {
  const [activeSources, legacyRuleCount] = await Promise.all([
    findActiveSourcesInScope(database, sourceType, tournamentId),
    countLegacyRulesInScope(database, sourceType, tournamentId),
  ]);
  return { activeSources, legacyRuleCount };
}

/**
 * 資料とその条文・Embeddingを削除する（1トランザクション）
 */
export async function deleteRuleSource(
  sourceId: string,
  database: ArbiterDatabase = db
): Promise<void> {
  await database.transaction(
    "rw",
    [database.ruleSources, database.rules, database.embeddings],
    async () => {
      const ruleIds = (await database.rules
        .where("sourceId")
        .equals(sourceId)
        .primaryKeys()) as string[];
      if (ruleIds.length > 0) {
        await database.embeddings.where("ruleId").anyOf(ruleIds).delete();
        await database.rules.bulkDelete(ruleIds);
      }
      await database.ruleSources.delete(sourceId);
    }
  );
  clearFulltextIndex();
}

/**
 * ルール検索の全文インデックスを破棄する（大会削除などで条文が削除された後）
 */
export function invalidateRuleSearchIndex(): void {
  clearFulltextIndex();
}
