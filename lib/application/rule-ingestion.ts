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
import {
  findActiveSourcesInScope,
  getImportScopeInfo,
  inScope,
} from "./rule-library";

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
  /**
   * 同じ種別（大会固有規定は同じ大会）の有効な資料が既にある場合の扱い。
   * 既存資料がある場合は明示的な指定が必須（未指定ならエラー）。
   * - "supersede": 既存資料を旧版（superseded）にし、検索対象から外す
   * - "keep-both": 既存資料も有効のまま併存させる（JCF規則とNAセミナー資料など）
   */
  onExisting?: ExistingSourceAction;
}

export type ExistingSourceAction = "supersede" | "keep-both";

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

/** 既存の有効な資料があり、扱い（onExisting）の指定が必要な場合のエラー */
export class ExistingSourceDecisionRequired extends RuleIngestionError {
  constructor(
    readonly existing: RuleSource[],
    readonly legacyRuleCount: number = 0
  ) {
    const parts: string[] = [];
    if (existing.length > 0) {
      parts.push(
        `有効な資料が既に登録されています（${existing
          .map((s) => `${s.name} ${s.version}`)
          .join("、")}）`
      );
    }
    if (legacyRuleCount > 0) {
      parts.push(`出典情報のない旧データ${legacyRuleCount}件が削除されます`);
    }
    super(`${parts.join("。")}。扱いを選択してください`);
  }
}

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
 * 同じ種別（大会固有規定の場合は同じ大会）の有効な資料が既にある場合は、
 * meta.onExisting で「旧版にする」か「併存させる」かを明示的に指定する必要がある。
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

  // 時間のかかる抽出の前に、既存資料の扱いが指定されているか確認する
  const { activeSources, legacyRuleCount } = await getImportScopeInfo(
    meta.sourceType,
    meta.tournamentId,
    deps.database
  );
  if ((activeSources.length > 0 || legacyRuleCount > 0) && !meta.onExisting) {
    throw new ExistingSourceDecisionRequired(activeSources, legacyRuleCount);
  }

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

  await saveRuleSource(
    deps.database,
    source,
    rules,
    embeddings,
    meta.onExisting
  );
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
 * 新しい資料・条文・Embeddingを1トランザクションで保存する。
 *
 * - 同じ種別（大会固有規定は同じ大会）の有効な資料、または出典情報のない旧データが
 *   ある場合、onExisting が必須。
 *   "supersede" なら既存資料を旧版（superseded）にする（条文は保持、検索対象外）。
 * - sourceId を持たない旧データ（スキーマv3以前、出典情報なし）は同じ種別・範囲なら削除する。
 */
export async function saveRuleSource(
  database: ArbiterDatabase,
  source: RuleSource,
  rules: Rule[],
  embeddings: Embedding[],
  onExisting?: ExistingSourceAction
): Promise<void> {
  if (source.sourceType === "tournament" && !source.tournamentId) {
    throw new RuleIngestionError("大会固有規定には tournamentId が必要です");
  }

  await database.transaction(
    "rw",
    [database.ruleSources, database.rules, database.embeddings],
    async () => {
      const existing = await findActiveSourcesInScope(
        database,
        source.sourceType,
        source.tournamentId
      );
      const legacyRuleIds = (
        await database.rules.where("source").equals(source.sourceType).toArray()
      )
        .filter(
          (r) =>
            !r.sourceId && inScope(r, source.sourceType, source.tournamentId)
        )
        .map((r) => r.id);

      if ((existing.length > 0 || legacyRuleIds.length > 0) && !onExisting) {
        throw new ExistingSourceDecisionRequired(
          existing,
          legacyRuleIds.length
        );
      }
      if (onExisting === "supersede") {
        for (const old of existing) {
          await database.ruleSources.update(old.id, { status: "superseded" });
        }
      }
      if (legacyRuleIds.length > 0) {
        await database.embeddings.where("ruleId").anyOf(legacyRuleIds).delete();
        await database.rules.bulkDelete(legacyRuleIds);
      }

      await database.ruleSources.add(source);
      await database.rules.bulkAdd(rules);
      if (embeddings.length > 0) {
        await database.embeddings.bulkAdd(embeddings);
      }
    }
  );
}
