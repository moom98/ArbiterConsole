import { db } from "@/lib/infrastructure/db";
import { extractRulesFromPDF } from "@/lib/infrastructure/pdf";
import { generateEmbedding } from "@/lib/infrastructure/embeddings";
import { buildFulltextIndex } from "@/lib/infrastructure/ai";
import type { Rule, RuleSource } from "@/lib/domain/entities";

export interface RuleIngestionProgress {
  stage:
    | "extracting"
    | "generating-embeddings"
    | "saving"
    | "building-index"
    | "complete";
  current: number;
  total: number;
  message: string;
}

/**
 * PDFファイルからルールをインポート
 */
export async function ingestRulesFromPDF(
  file: File,
  source: RuleSource,
  tournamentId?: string,
  onProgress?: (progress: RuleIngestionProgress) => void
): Promise<{ ruleCount: number; embeddingCount: number }> {
  // 1. PDFからルールを抽出
  onProgress?.({
    stage: "extracting",
    current: 0,
    total: 1,
    message: "PDFからテキストを抽出中...",
  });

  const result = await extractRulesFromPDF(file, source);
  const extractedRules = result.rules;

  // 2. Embeddingsを生成
  const rules: Rule[] = [];
  const embeddings: Array<{ ruleId: string; vector: number[] }> = [];

  for (let i = 0; i < extractedRules.length; i++) {
    const extracted = extractedRules[i];

    onProgress?.({
      stage: "generating-embeddings",
      current: i + 1,
      total: extractedRules.length,
      message: `Embedding生成中... (${i + 1}/${extractedRules.length})`,
    });

    // Ruleエンティティを作成
    const rule: Rule = {
      id: crypto.randomUUID(),
      source,
      tournamentId,
      article: extracted.article,
      title: extracted.title,
      content: extracted.content,
      priority: getPriorityBySource(source),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Embeddingを生成
    const embedding = await generateEmbedding(
      `${extracted.title} ${extracted.content}`
    );

    rules.push(rule);
    embeddings.push({
      ruleId: rule.id,
      vector: embedding,
    });
  }

  // 3. データベースに保存
  onProgress?.({
    stage: "saving",
    current: 0,
    total: rules.length,
    message: "データベースに保存中...",
  });

  await db.transaction("rw", [db.rules, db.embeddings], async () => {
    // 既存の同じソースのルールを削除
    await db.rules
      .where("source")
      .equals(source)
      .and((r) => (tournamentId ? r.tournamentId === tournamentId : true))
      .delete();

    // 新しいルールを追加
    await db.rules.bulkAdd(rules);

    // Embeddingsを追加
    await db.embeddings.bulkAdd(
      embeddings.map((e) => ({
        id: crypto.randomUUID(),
        ruleId: e.ruleId,
        vector: e.vector,
        model: "Xenova/all-MiniLM-L6-v2",
        createdAt: new Date(),
      }))
    );
  });

  // 4. Full-text indexを再構築
  onProgress?.({
    stage: "building-index",
    current: 0,
    total: 1,
    message: "検索インデックスを構築中...",
  });

  await buildFulltextIndex();

  // 5. 完了
  onProgress?.({
    stage: "complete",
    current: 1,
    total: 1,
    message: "インポート完了",
  });

  return {
    ruleCount: rules.length,
    embeddingCount: embeddings.length,
  };
}

/**
 * ソースごとの優先度を取得
 */
function getPriorityBySource(source: RuleSource): number {
  switch (source) {
    case "tournament":
      return 1000;
    case "JCF":
      return 100;
    case "FIDE":
      return 10;
    case "commentary":
      return 1;
    default:
      return 0;
  }
}

/**
 * 登録済みルールの統計を取得
 */
export async function getRuleStatistics() {
  const allRules = await db.rules.toArray();

  const stats = {
    total: allRules.length,
    bySource: {
      FIDE: 0,
      JCF: 0,
      tournament: 0,
      commentary: 0,
    },
  };

  allRules.forEach((rule) => {
    stats.bySource[rule.source]++;
  });

  return stats;
}
