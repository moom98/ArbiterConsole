import type {
  Embedding,
  Rule,
  RuleLanguage,
  RuleSource,
  RuleSourceType,
} from "@/lib/domain/entities";
import { getPriorityBySource } from "@/lib/domain/services/rule-priority";
import { db, type ArbiterDatabase } from "@/lib/infrastructure/db";
import { clearFulltextIndex } from "@/lib/infrastructure/ai/fulltext-search";
import {
  EMBEDDING_MODEL_ID,
  generateEmbeddings,
  type GenerateEmbeddingsOptions,
} from "@/lib/infrastructure/embeddings/generator";
import type { PDFExtractionResult } from "@/lib/infrastructure/pdf/extractor";

/**
 * ルール資料の取り込み（アプリケーションサービス）
 *
 * PDF抽出・Embedding生成・DB保存というインフラ処理を組み合わせるため、
 * ドメイン層ではなくアプリケーション層に置く。
 * pdfjs はこのモジュールから動的importし、SSR時に評価されないようにする。
 */

export interface RuleIngestionProgress {
  stage:
    | "validating"
    | "extracting"
    | "generating-embeddings"
    | "saving"
    | "complete";
  current: number;
  total: number;
  message: string;
}

export interface RuleSourceMetadata {
  sourceType: RuleSourceType;
  name: string;
  version: string;
  language: RuleLanguage;
  effectiveDate?: Date;
  publishedDate?: Date;
  /** sourceType が 'tournament' の場合は必須 */
  tournamentId?: string;
}

export interface IngestionDeps {
  extract(
    file: File,
    source: RuleSourceType,
    onPage: (page: number, total: number) => void
  ): Promise<PDFExtractionResult>;
  embed(
    texts: readonly string[],
    options: GenerateEmbeddingsOptions
  ): Promise<number[][]>;
  modelId: string;
  database: ArbiterDatabase;
}

const defaultDeps: IngestionDeps = {
  async extract(file, source, onPage) {
    const { extractRulesFromPDF } =
      await import("@/lib/infrastructure/pdf/extractor");
    return extractRulesFromPDF(file, source, onPage);
  },
  embed: generateEmbeddings,
  modelId: EMBEDDING_MODEL_ID,
  database: db,
};

export class RuleIngestionError extends Error {}

export function validateMetadata(meta: RuleSourceMetadata): void {
  if (!meta.name.trim()) {
    throw new RuleIngestionError("資料名を入力してください");
  }
  if (!meta.version.trim()) {
    throw new RuleIngestionError("版（Version）を入力してください");
  }
  if (meta.sourceType === "tournament" && !meta.tournamentId) {
    // 大会IDなしで取り込むと、置き換え時に他大会の規定を削除してしまう
    throw new RuleIngestionError(
      "大会固有規定の取り込みには大会の指定が必要です"
    );
  }
}

/**
 * PDFファイルからルールをインポートする
 *
 * 同じ資料種別・資料名（大会固有規定の場合は同じ大会）の既存資料は置き換える。
 * Embedding生成に失敗した場合は、全文検索のみ利用可能な状態で保存する。
 */
export async function ingestRulesFromPDF(
  file: File,
  meta: RuleSourceMetadata,
  onProgress?: (progress: RuleIngestionProgress) => void,
  deps: IngestionDeps = defaultDeps
): Promise<{
  ruleCount: number;
  embeddingCount: number;
  embeddingError?: string;
}> {
  validateMetadata(meta);

  onProgress?.({
    stage: "extracting",
    current: 0,
    total: 1,
    message: "PDFからテキストを抽出中...",
  });

  const extraction = await deps.extract(file, meta.sourceType, (page, total) =>
    onProgress?.({
      stage: "extracting",
      current: page,
      total,
      message: `PDFからテキストを抽出中... (${page}/${total}ページ)`,
    })
  );

  if (extraction.rules.length === 0) {
    throw new RuleIngestionError(
      "条文を抽出できませんでした。PDFの形式を確認してください"
    );
  }

  const now = new Date();
  const source: RuleSource = {
    id: crypto.randomUUID(),
    name: meta.name.trim(),
    fileName: file.name,
    sourceType: meta.sourceType,
    version: meta.version.trim(),
    publishedDate: meta.publishedDate,
    effectiveDate: meta.effectiveDate,
    status: "active",
    language: meta.language,
    tournamentId:
      meta.sourceType === "tournament" ? meta.tournamentId : undefined,
    totalPages: extraction.totalPages,
    importedAt: now,
  };

  const rules: Rule[] = extraction.rules.map((extracted) => ({
    id: crypto.randomUUID(),
    source: meta.sourceType,
    sourceId: source.id,
    tournamentId: source.tournamentId,
    article: extracted.article,
    title: extracted.title,
    content: extracted.content,
    page: extracted.pageNumber,
    priority: getPriorityBySource(meta.sourceType),
    createdAt: now,
    updatedAt: now,
  }));

  let embeddings: Embedding[] = [];
  let embeddingError: string | undefined;
  try {
    const vectors = await deps.embed(
      rules.map((r) => `${r.article} ${r.title}\n${r.content}`),
      {
        onProgress: (done, total) =>
          onProgress?.({
            stage: "generating-embeddings",
            current: done,
            total,
            message: `Embedding生成中... (${done}/${total})`,
          }),
      }
    );
    embeddings = vectors.map((vector, i) => ({
      id: crypto.randomUUID(),
      ruleId: rules[i].id,
      vector,
      model: deps.modelId,
      createdAt: now,
    }));
  } catch (error) {
    // 意味検索用モデルが利用できなくても、全文検索用に条文は保存する
    embeddingError = error instanceof Error ? error.message : String(error);
  }

  onProgress?.({
    stage: "saving",
    current: 0,
    total: 1,
    message: "データベースに保存中...",
  });

  await replaceRuleSource(deps.database, source, rules, embeddings);
  clearFulltextIndex();

  onProgress?.({
    stage: "complete",
    current: 1,
    total: 1,
    message: "インポート完了",
  });

  return {
    ruleCount: rules.length,
    embeddingCount: embeddings.length,
    embeddingError,
  };
}

/**
 * 同じ資料種別・資料名（大会固有規定は同じ大会）の既存資料・条文・Embeddingを削除し、
 * 新しい資料に置き換える。1トランザクションで実行する。
 */
export async function replaceRuleSource(
  database: ArbiterDatabase,
  source: RuleSource,
  rules: Rule[],
  embeddings: Embedding[]
): Promise<void> {
  if (source.sourceType === "tournament" && !source.tournamentId) {
    throw new RuleIngestionError("大会固有規定には tournamentId が必要です");
  }

  const sameScope = (r: { tournamentId?: string }) =>
    source.sourceType !== "tournament" ||
    r.tournamentId === source.tournamentId;
  const normalizeName = (name: string) => name.trim().toLowerCase();
  // 同じ種別・同じ資料名（大会固有規定は同じ大会）の資料のみ置き換える。
  // 例: JCF規則 と NAセミナー資料 は別資料として共存する
  const sameDocument = (s: RuleSource) =>
    sameScope(s) && normalizeName(s.name) === normalizeName(source.name);

  await database.transaction(
    "rw",
    [database.ruleSources, database.rules, database.embeddings],
    async () => {
      const oldSourceIds = (
        await database.ruleSources
          .where("sourceType")
          .equals(source.sourceType)
          .toArray()
      )
        .filter(sameDocument)
        .map((s) => s.id);
      const oldSourceIdSet = new Set(oldSourceIds);

      // sourceId を持たない旧データ（v3以前）も同じ種別・範囲なら置き換え対象
      const oldRuleIds = (
        await database.rules.where("source").equals(source.sourceType).toArray()
      )
        .filter((r) =>
          r.sourceId ? oldSourceIdSet.has(r.sourceId) : sameScope(r)
        )
        .map((r) => r.id);

      if (oldRuleIds.length > 0) {
        await database.embeddings.where("ruleId").anyOf(oldRuleIds).delete();
        await database.rules.bulkDelete(oldRuleIds);
      }
      if (oldSourceIds.length > 0) {
        await database.ruleSources.bulkDelete(oldSourceIds);
      }

      await database.ruleSources.add(source);
      await database.rules.bulkAdd(rules);
      if (embeddings.length > 0) {
        await database.embeddings.bulkAdd(embeddings);
      }
    }
  );
}
