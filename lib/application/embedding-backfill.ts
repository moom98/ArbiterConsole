import type { Embedding, Rule } from "@/lib/domain/entities";
import { db, type ArbiterDatabase } from "@/lib/infrastructure/db";
import {
  EMBEDDING_MODEL_ID,
  generateEmbeddings,
  type GenerateEmbeddingsOptions,
} from "@/lib/infrastructure/embeddings/generator";
import { LLM_LIMITS } from "@/lib/infrastructure/llm/contract";

/**
 * 意味検索用データ（埋め込み）の後からの作成（ADR-010）。
 *
 * オフライン・アクセストークン未入力・上限到達などで取り込み時に作成できなかった条文や、
 * 埋め込みモデルの変更（EMBEDDING_MODEL.key の変更）後の条文について、
 * 現行モデルのベクトルを 16 件ずつ作成し、そのたびに保存する（途中で失敗しても続きから再開できる）。
 */

export interface BackfillDeps {
  database: ArbiterDatabase;
  embed(
    texts: readonly string[],
    options: GenerateEmbeddingsOptions
  ): Promise<number[][]>;
  modelId: string;
  now: () => Date;
  newId: () => string;
}

const defaultDeps: BackfillDeps = {
  database: db,
  embed: generateEmbeddings,
  modelId: EMBEDDING_MODEL_ID,
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
};

export interface BackfillResult {
  /** 今回作成した件数 */
  created: number;
  /** 開始時点で未作成だった件数 */
  total: number;
  /** 途中で失敗した場合の理由（作成済みの分は保存されている） */
  error?: string;
}

/** 埋め込みに使う本文（取り込み時と同じ形式） */
export function embeddingTextForRule(
  rule: Pick<Rule, "article" | "title" | "content">
): string {
  return `${rule.article} ${rule.title}\n${rule.content}`;
}

/** 検索対象（有効な資料・出典情報のない旧データ）のうち、現行モデルの埋め込みがない条文 */
export async function findRulesMissingEmbeddings(
  database: ArbiterDatabase = db,
  modelId: string = EMBEDDING_MODEL_ID
): Promise<Rule[]> {
  const [rules, sources, embedded] = await Promise.all([
    database.rules.toArray(),
    database.ruleSources.toArray(),
    database.embeddings.where("model").equals(modelId).toArray(),
  ]);
  const activeSourceIds = new Set(
    sources.filter((s) => s.status === "active").map((s) => s.id)
  );
  const hasEmbedding = new Set(embedded.map((e) => e.ruleId));
  return rules.filter(
    (r) =>
      (!r.sourceId || activeSourceIds.has(r.sourceId)) &&
      !hasEmbedding.has(r.id)
  );
}

let running: Promise<BackfillResult> | null = null;

/**
 * 未作成の意味検索用データを作成する。同時に複数回呼ばれた場合は実行中の処理を共有する。
 * 別モデルの古い埋め込みは使われないため、開始時に削除する。
 */
export function generateMissingEmbeddings(
  onProgress?: (done: number, total: number) => void,
  deps: BackfillDeps = defaultDeps
): Promise<BackfillResult> {
  if (!running) {
    running = run(onProgress, deps).finally(() => {
      running = null;
    });
  }
  return running;
}

async function run(
  onProgress: ((done: number, total: number) => void) | undefined,
  deps: BackfillDeps
): Promise<BackfillResult> {
  const { database, modelId } = deps;
  await database.embeddings.where("model").notEqual(modelId).delete();

  const missing = await findRulesMissingEmbeddings(database, modelId);
  const total = missing.length;
  let created = 0;
  onProgress?.(0, total);

  for (let start = 0; start < total; start += LLM_LIMITS.maxEmbedTexts) {
    const batch = missing.slice(start, start + LLM_LIMITS.maxEmbedTexts);
    let vectors: number[][];
    try {
      vectors = await deps.embed(batch.map(embeddingTextForRule), {});
    } catch (error) {
      return {
        created,
        total,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const now = deps.now();
    await database.transaction(
      "rw",
      [database.rules, database.embeddings],
      async () => {
        // 作成中に資料が削除された条文・別の処理で作成済みの条文には保存しない
        const [stillThere, existing] = await Promise.all([
          database.rules.bulkGet(batch.map((r) => r.id)),
          database.embeddings
            .where("ruleId")
            .anyOf(batch.map((r) => r.id))
            .filter((e) => e.model === modelId)
            .toArray(),
        ]);
        const done = new Set(existing.map((e) => e.ruleId));
        const rows: Embedding[] = batch.flatMap((rule, i) =>
          stillThere[i] && !done.has(rule.id)
            ? [
                {
                  id: deps.newId(),
                  ruleId: rule.id,
                  vector: vectors[i],
                  model: modelId,
                  createdAt: now,
                },
              ]
            : []
        );
        if (rows.length > 0) await database.embeddings.bulkAdd(rows);
        created += rows.length;
      }
    );
    onProgress?.(Math.min(start + batch.length, total), total);
  }
  return { created, total };
}
