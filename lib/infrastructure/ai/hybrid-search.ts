import type { Rule, RuleSource } from "@/lib/domain/entities";
import {
  isRuleApplicableToTournament,
  orderByRulePriority,
} from "@/lib/domain/services/rule-priority";
import { db } from "@/lib/infrastructure/db";
import {
  EMBEDDING_MODEL_ID,
  generateEmbedding,
} from "@/lib/infrastructure/embeddings/generator";
import { getFulltextIndex, type FulltextHit } from "./fulltext-search";
import { scoreByVector, type VectorHit } from "./vector-search";

export type SearchMethod = "vector" | "fulltext";

export interface RuleSearchResult {
  rule: Rule;
  /** 出典資料（資料名・版・言語など）。旧データでは未設定 */
  source?: RuleSource;
  /** 正規化後の統合スコア [0, 1] */
  score: number;
  vectorScore?: number;
  fulltextScore?: number;
  methods: SearchMethod[];
}

export interface HybridSearchResponse {
  results: RuleSearchResult[];
  /** 失敗した検索方式とエラー内容（片方失敗時はもう片方の結果のみ返す） */
  failures: Partial<Record<SearchMethod, string>>;
}

export interface HybridSearchOptions {
  /**
   * 対象大会ID。大会固有規定はこのIDに一致するもののみ検索対象となる。
   * 大会未選択の場合は明示的に undefined を渡す（大会固有規定は対象外）。
   */
  tournamentId: string | undefined;
  limit?: number;
  vectorWeight?: number;
  fulltextWeight?: number;
  /** 正規化後の統合スコアに対する閾値 */
  minScore?: number;
}

export interface SearchCorpus {
  rules: Rule[];
  sources: RuleSource[];
}

export interface HybridSearchDeps {
  loadCorpus(): Promise<SearchCorpus>;
  fulltext(query: string, candidates: readonly Rule[]): Promise<FulltextHit[]>;
  vector(query: string, candidates: readonly Rule[]): Promise<VectorHit[]>;
}

export interface FusedHit {
  ruleId: string;
  score: number;
  vectorScore?: number;
  fulltextScore?: number;
}

export interface FuseOptions {
  vectorWeight: number;
  fulltextWeight: number;
  minScore: number;
}

/**
 * 2つの検索結果を正規化して統合する（純粋関数）
 *
 * - Vector: コサイン類似度（[0,1] にクランプ済み）をそのまま使用
 * - Full-text: Lunrスコアは上限がないため最大値で割り [0,1] に正規化
 * - 片方が利用不可（null）の場合は、利用可能な側の重みを1に再配分
 * - minScore は統合後のスコアに一度だけ適用
 */
export function fuseHits(
  vectorHits: readonly VectorHit[] | null,
  fulltextHits: readonly FulltextHit[] | null,
  options: FuseOptions
): FusedHit[] {
  const wv = vectorHits ? Math.max(0, options.vectorWeight) : 0;
  const wf = fulltextHits ? Math.max(0, options.fulltextWeight) : 0;
  const totalWeight = wv + wf;
  if (totalWeight === 0) {
    return [];
  }

  const fused = new Map<string, FusedHit>();
  const entry = (ruleId: string) => {
    let hit = fused.get(ruleId);
    if (!hit) {
      hit = { ruleId, score: 0 };
      fused.set(ruleId, hit);
    }
    return hit;
  };

  for (const hit of vectorHits ?? []) {
    entry(hit.ruleId).vectorScore = Math.max(0, Math.min(1, hit.score));
  }

  const maxFulltext = Math.max(0, ...(fulltextHits ?? []).map((h) => h.score));
  for (const hit of fulltextHits ?? []) {
    entry(hit.ruleId).fulltextScore =
      maxFulltext > 0 ? Math.max(0, hit.score) / maxFulltext : 0;
  }

  const results: FusedHit[] = [];
  for (const hit of Array.from(fused.values())) {
    hit.score =
      (wv * (hit.vectorScore ?? 0) + wf * (hit.fulltextScore ?? 0)) /
      totalWeight;
    if (hit.score >= options.minScore) {
      results.push(hit);
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * 検索対象ルールを絞り込む
 * - 有効（active）でない資料のルールを除外（§30 旧版の混在防止）
 * - 大会固有規定は指定大会のもののみ
 */
export function selectCandidates(
  corpus: SearchCorpus,
  tournamentId: string | undefined
): Rule[] {
  const sourceById = new Map(corpus.sources.map((s) => [s.id, s]));
  return corpus.rules.filter((rule) => {
    if (rule.sourceId) {
      const source = sourceById.get(rule.sourceId);
      if (!source || source.status !== "active") return false;
    }
    return isRuleApplicableToTournament(rule, tournamentId);
  });
}

/**
 * Hybrid search（Vector + Full-text）
 *
 * 両方式を並列実行し、片方が失敗した場合はもう片方の結果で継続する。
 * 両方失敗した場合のみ例外を投げる。
 * 結果は関連度上位 limit 件を、優先順位（大会 > JCF > FIDE > 解説）で
 * グループ化して返す。
 */
export async function hybridSearch(
  query: string,
  options: HybridSearchOptions,
  deps: HybridSearchDeps = defaultDeps
): Promise<HybridSearchResponse> {
  const {
    tournamentId,
    limit = 10,
    vectorWeight = 0.6,
    fulltextWeight = 0.4,
    minScore = 0.25,
  } = options;

  if (!query.trim()) {
    return { results: [], failures: {} };
  }

  const corpus = await deps.loadCorpus();
  const candidates = selectCandidates(corpus, tournamentId);
  if (candidates.length === 0) {
    return { results: [], failures: {} };
  }

  const [vectorOutcome, fulltextOutcome] = await Promise.allSettled([
    deps.vector(query, candidates),
    deps.fulltext(query, candidates),
  ]);

  const failures: HybridSearchResponse["failures"] = {};
  if (vectorOutcome.status === "rejected") {
    failures.vector = errorMessage(vectorOutcome.reason);
  }
  if (fulltextOutcome.status === "rejected") {
    failures.fulltext = errorMessage(fulltextOutcome.reason);
  }
  if (failures.vector && failures.fulltext) {
    throw new Error(
      `Rule search failed (vector: ${failures.vector}; fulltext: ${failures.fulltext})`
    );
  }

  const fused = fuseHits(
    vectorOutcome.status === "fulfilled" ? vectorOutcome.value : null,
    fulltextOutcome.status === "fulfilled" ? fulltextOutcome.value : null,
    { vectorWeight, fulltextWeight, minScore }
  );

  const ruleById = new Map(candidates.map((r) => [r.id, r]));
  const sourceById = new Map(corpus.sources.map((s) => [s.id, s]));

  const top: RuleSearchResult[] = [];
  for (const hit of fused) {
    const rule = ruleById.get(hit.ruleId);
    if (!rule) continue;
    const methods: SearchMethod[] = [];
    if (hit.vectorScore !== undefined) methods.push("vector");
    if (hit.fulltextScore !== undefined && hit.fulltextScore > 0) {
      methods.push("fulltext");
    }
    top.push({
      rule,
      source: rule.sourceId ? sourceById.get(rule.sourceId) : undefined,
      score: hit.score,
      vectorScore: hit.vectorScore,
      fulltextScore: hit.fulltextScore,
      methods,
    });
    if (top.length >= limit) break;
  }

  return { results: orderByRulePriority(top), failures };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

async function loadSearchableRules(): Promise<Rule[]> {
  const corpus = await loadCorpusFromDb();
  // インデックスは大会に依存しない（大会での絞り込みは検索時に行う）
  const sourceById = new Map(corpus.sources.map((s) => [s.id, s]));
  return corpus.rules.filter(
    (r) => !r.sourceId || sourceById.get(r.sourceId)?.status === "active"
  );
}

async function loadCorpusFromDb(): Promise<SearchCorpus> {
  const [rules, sources] = await Promise.all([
    db.rules.toArray(),
    db.ruleSources.toArray(),
  ]);
  return { rules, sources };
}

const defaultDeps: HybridSearchDeps = {
  loadCorpus: loadCorpusFromDb,

  async fulltext(query, candidates) {
    const index = await getFulltextIndex(loadSearchableRules);
    const allowed = new Set(candidates.map((r) => r.id));
    return index.search(query).filter((hit) => allowed.has(hit.ruleId));
  },

  async vector(query, candidates) {
    const [queryVector, embeddings] = await Promise.all([
      generateEmbedding(query),
      db.embeddings.where("model").equals(EMBEDDING_MODEL_ID).toArray(),
    ]);
    if (embeddings.length === 0) {
      throw new Error("No embeddings available for the current model");
    }
    return scoreByVector(
      queryVector,
      candidates,
      embeddings,
      EMBEDDING_MODEL_ID
    );
  },
};
