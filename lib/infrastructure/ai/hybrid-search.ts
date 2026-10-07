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
  /** 主結果（優先順位 大会 > JCF > FIDE > 解説 でグループ化） */
  results: RuleSearchResult[];
  /**
   * 関連する可能性のある条文（一般的な語のみの一致など確度の低いもの）。
   * 主結果とは混ぜず、優先順位の並べ替えもしない（関連度順）。
   */
  related: RuleSearchResult[];
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
  /**
   * ベクトル類似度の下限。これ未満の類似度は統合スコアに寄与しない
   * （同一ドメインの無関係な条文でも0.3〜0.5程度の類似度になるため）
   */
  vectorMinSimilarity?: number;
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
  /**
   * main: 主結果（優先順位でグループ化して表示）
   * related: 弱い一致（一般的な語のみ一致など）。主結果に混ぜず
   *          「関連する可能性のある条文」として別表示する
   */
  confidence: "main" | "related";
}

export interface FuseOptions {
  vectorWeight: number;
  fulltextWeight: number;
  minScore: number;
  /** これ未満のベクトル類似度は 0 として扱う（既定 0） */
  vectorMinSimilarity?: number;
  /**
   * 全文検索ヒットを「実質的な一致」とみなす coverage（IDF重み付き内容語の一致率）の下限
   * （既定 0.3）。これ未満の一致（"場合", "対局者" など一般的な語のみ）は
   * 主結果に入れない。
   */
  substantiveCoverage?: number;
  /**
   * 実質的な一致である全文検索の上位この件数は、minScore に関わらず主結果に残す
   * （既定 3）。また、実質的でない上位ヒットはこの件数まで related として返す。
   */
  guaranteedFulltextHits?: number;
  /**
   * 全文検索のみ成功した場合の足切り（最上位スコアに対する比率, 既定 0.1）。
   * この場合 minScore は適用せず、順位（limit）で件数を絞る。
   */
  fulltextRelativeFloor?: number;
}

/**
 * 2つの検索結果を正規化して統合する（純粋関数）
 *
 * - Vector: コサイン類似度（[0,1] にクランプ）。vectorMinSimilarity 未満は 0
 * - Full-text: Lunrスコアは上限がないため最大値で割り [0,1] に正規化し、
 *   クエリトークンの一致割合（coverage）を掛ける
 * - 片方が利用不可（null）の場合は、利用可能な側の重みを1に再配分
 * - minScore は統合後のスコアに一度だけ適用。ただし全文検索の上位ヒットは
 *   常に残し、全文検索のみ成功した場合は minScore を適用せず順位で絞る
 */
export function fuseHits(
  vectorHits: readonly VectorHit[] | null,
  fulltextHits: readonly FulltextHit[] | null,
  options: FuseOptions
): FusedHit[] {
  type Draft = Omit<FusedHit, "confidence">;
  const wv = vectorHits ? Math.max(0, options.vectorWeight) : 0;
  const wf = fulltextHits ? Math.max(0, options.fulltextWeight) : 0;
  const totalWeight = wv + wf;
  if (totalWeight === 0) {
    return [];
  }

  const fused = new Map<string, Draft>();
  const entry = (ruleId: string) => {
    let hit = fused.get(ruleId);
    if (!hit) {
      hit = { ruleId, score: 0 };
      fused.set(ruleId, hit);
    }
    return hit;
  };

  for (const hit of vectorHits ?? []) {
    const similarity = Math.max(0, Math.min(1, hit.score));
    entry(hit.ruleId).vectorScore =
      similarity >= (options.vectorMinSimilarity ?? 0) ? similarity : 0;
  }

  const maxFulltext = Math.max(0, ...(fulltextHits ?? []).map((h) => h.score));
  const relativeById = new Map<string, number>();
  for (const hit of fulltextHits ?? []) {
    const relative = maxFulltext > 0 ? Math.max(0, hit.score) / maxFulltext : 0;
    relativeById.set(hit.ruleId, relative);
    // 最大値で割るだけだと弱い最上位ヒットも1.0になるため coverage で減衰させる。
    // ただし長い質問文では coverage が極端に低くなるため半分までに留める
    const coverage = Math.max(0, Math.min(1, hit.coverage ?? 1));
    entry(hit.ruleId).fulltextScore = relative * (0.5 + 0.5 * coverage);
  }

  const substantiveCoverage = options.substantiveCoverage ?? 0.3;
  const substantive = new Set(
    (fulltextHits ?? [])
      .filter((h) => (h.coverage ?? 1) >= substantiveCoverage)
      .map((h) => h.ruleId)
  );
  const topK = options.guaranteedFulltextHits ?? 3;
  const topFulltext = new Set(
    [...(fulltextHits ?? [])]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((h) => h.ruleId)
  );
  const fulltextOnly = vectorHits === null;
  const relativeFloor = options.fulltextRelativeFloor ?? 0.1;

  const results: FusedHit[] = [];
  for (const draft of Array.from(fused.values())) {
    const score =
      (wv * (draft.vectorScore ?? 0) + wf * (draft.fulltextScore ?? 0)) /
      totalWeight;
    const relative = relativeById.get(draft.ruleId) ?? 0;
    const isSubstantive = substantive.has(draft.ruleId);
    const hasVectorSupport = (draft.vectorScore ?? 0) > 0;

    let confidence: FusedHit["confidence"] | null = null;
    if (fulltextOnly) {
      // 意味検索が使えない（オフライン等）場合: minScore は適用せず、
      // 実質的な一致を主結果、それ以外の上位を related とする
      if (relative >= relativeFloor) {
        confidence = isSubstantive
          ? "main"
          : topFulltext.has(draft.ruleId)
            ? "related"
            : null;
      }
    } else if (
      (score >= options.minScore && (hasVectorSupport || isSubstantive)) ||
      (isSubstantive && topFulltext.has(draft.ruleId))
    ) {
      confidence = "main";
    } else if (topFulltext.has(draft.ruleId) && relative >= relativeFloor) {
      confidence = "related";
    }

    if (confidence) {
      results.push({ ...draft, score, confidence });
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
    vectorMinSimilarity = 0.5,
  } = options;

  if (!query.trim()) {
    return { results: [], related: [], failures: {} };
  }

  const corpus = await deps.loadCorpus();
  const candidates = selectCandidates(corpus, tournamentId);
  if (candidates.length === 0) {
    return { results: [], related: [], failures: {} };
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
    { vectorWeight, fulltextWeight, minScore, vectorMinSimilarity }
  );

  const ruleById = new Map(candidates.map((r) => [r.id, r]));
  const sourceById = new Map(corpus.sources.map((s) => [s.id, s]));

  const toResult = (hit: FusedHit): RuleSearchResult | null => {
    const rule = ruleById.get(hit.ruleId);
    if (!rule) return null;
    const methods: SearchMethod[] = [];
    if (hit.vectorScore !== undefined && hit.vectorScore > 0) {
      methods.push("vector");
    }
    if (hit.fulltextScore !== undefined && hit.fulltextScore > 0) {
      methods.push("fulltext");
    }
    return {
      rule,
      source: rule.sourceId ? sourceById.get(rule.sourceId) : undefined,
      score: hit.score,
      vectorScore: hit.vectorScore,
      fulltextScore: hit.fulltextScore,
      methods,
    };
  };
  const collect = (confidence: FusedHit["confidence"], max: number) =>
    fused
      .filter((hit) => hit.confidence === confidence)
      .map(toResult)
      .filter((r): r is RuleSearchResult => r !== null)
      .slice(0, max);

  return {
    results: orderByRulePriority(collect("main", limit)),
    related: collect("related", RELATED_LIMIT),
    failures,
  };
}

const RELATED_LIMIT = 3;

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

/**
 * ルールデータの版。インポートのたびに RuleSource.id と Rule.id が新規発行されるため、
 * 別タブで再インポートされた場合も変化を検出できる。
 */
async function getRuleDataStamp(): Promise<string> {
  const [ruleCount, sourceIds] = await Promise.all([
    db.rules.count(),
    db.ruleSources.toCollection().primaryKeys(),
  ]);
  return `${ruleCount}:${sourceIds.map(String).sort().join(",")}`;
}

const defaultDeps: HybridSearchDeps = {
  loadCorpus: loadCorpusFromDb,

  async fulltext(query, candidates) {
    const index = await getFulltextIndex(
      loadSearchableRules,
      await getRuleDataStamp()
    );
    const allowed = new Set(candidates.map((r) => r.id));
    return index.search(query).filter((hit) => allowed.has(hit.ruleId));
  },

  async vector(query, candidates) {
    // 埋め込みが無い場合（モデル未配信の環境等）はモデルを読み込まない（毎回の読み込み失敗を避ける）
    const embeddings = await db.embeddings
      .where("model")
      .equals(EMBEDDING_MODEL_ID)
      .toArray();
    if (embeddings.length === 0) {
      throw new Error("No embeddings available for the current model");
    }
    const queryVector = await generateEmbedding(query);
    return scoreByVector(
      queryVector,
      candidates,
      embeddings,
      EMBEDDING_MODEL_ID
    );
  },
};
