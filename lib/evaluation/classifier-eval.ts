import type { IncidentCategory } from "@/lib/domain/entities";
import type { JevCalibration } from "@/lib/domain/llm/calibration";
import { INCIDENT_CATEGORIES } from "@/lib/domain/llm/classification";

/**
 * 分類器の評価（J3, jev-classifier-design §9, fact-model.md §5）。純粋関数だけ。
 *
 * - 評価の実行（実キーでの API 呼び出し）は scripts/eval/classifier.eval.ts。ここは集計としきい値の選択
 * - 合成データだけを使う。実際の大会の報告は送らない
 * - 失敗（通信・形の不正・ドメインの検証で却下）は不正解として数える（本番ではキーワード分類に戻るため）
 */

export type EvalSplit = "tuning" | "heldout";
/** keyword は端末内のキーワード分類（参考の基準。受け入れ判定には使わない） */
export type EvalProvider = "jev" | "gemini" | "keyword";

export interface EvalItem {
  id: string;
  category: IncidentCategory;
  subtype?: string;
  split: EvalSplit;
  text: string;
}

/** 1件の評価結果（本文は含めない） */
export interface EvalRecord {
  id: string;
  split: EvalSplit;
  provider: EvalProvider;
  label: IncidentCategory;
  labelSubtype?: string;
  /**
   * - ok: 応答があり、ドメインの検証（parseLlmClassification）を通った
   * - rejected: 応答はあったが、ドメインの検証で却下された（例: 確率の合計が許容誤差の外）
   * - not-sent: 外部AIガードで止まった（評価データの不備。本番でもローカル処理になる）
   * - error: 通信の失敗・形の不正
   */
  status: "ok" | "rejected" | "not-sent" | "error";
  /** 却下・失敗の理由（コードだけ） */
  reason?: string;
  /** ドメインが受け付けた（または Gemini が返した）カテゴリ */
  predicted?: IncidentCategory;
  /** Jev の生の確率（却下された場合も記録する。合計のずれの確認に使う） */
  probabilities?: Partial<Record<IncidentCategory, number>>;
  subtype?: string | null;
  subtypeProbability?: number | null;
  /** 解決済みのモデル（Jev）または設定のモデル（Gemini） */
  model?: string;
  latencyMs?: number;
}

const round = (v: number, digits = 4) =>
  Math.round(v * 10 ** digits) / 10 ** digits;

const isCorrect = (r: EvalRecord) =>
  r.status === "ok" && r.predicted === r.label;

/** 正解率（失敗は不正解）。件数 0 なら NaN */
export function accuracy(records: readonly EvalRecord[]): number {
  if (records.length === 0) return NaN;
  return records.filter(isCorrect).length / records.length;
}

/** 確率の上位 k 件に正解が含まれる割合（確率がない応答・失敗は不正解） */
export function topKAccuracy(
  records: readonly EvalRecord[],
  k: number
): number {
  if (records.length === 0) return NaN;
  const hits = records.filter((r) => {
    if (r.status !== "ok" || !r.probabilities) return false;
    const ranked = rankCategories(r.probabilities);
    return ranked.slice(0, k).includes(r.label);
  }).length;
  return hits / records.length;
}

/** 確率の高い順（同率はカテゴリの定義順。parseLlmClassification と同じ） */
export function rankCategories(
  probabilities: Partial<Record<IncidentCategory, number>>
): IncidentCategory[] {
  return INCIDENT_CATEGORIES.map((c, i) => ({ c, i, p: probabilities[c] ?? 0 }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((x) => x.c);
}

export function perCategoryAccuracy(
  records: readonly EvalRecord[]
): Partial<Record<IncidentCategory, { n: number; accuracy: number }>> {
  const out: Partial<
    Record<IncidentCategory, { n: number; accuracy: number }>
  > = {};
  for (const c of INCIDENT_CATEGORIES) {
    const rs = records.filter((r) => r.label === c);
    if (rs.length > 0) out[c] = { n: rs.length, accuracy: accuracy(rs) };
  }
  return out;
}

/** しきい値の判定に使う点（p は選ばれたカテゴリの確率） */
export interface ScoredPoint {
  p: number;
  correct: boolean;
}

/** 受け付けられた Jev の応答から、選ばれたカテゴリの確率と正否を取り出す */
export function categoryPoints(records: readonly EvalRecord[]): ScoredPoint[] {
  return records.flatMap((r) => {
    if (r.status !== "ok" || !r.predicted || !r.probabilities) return [];
    const p = r.probabilities[r.predicted];
    return typeof p === "number"
      ? [{ p, correct: r.predicted === r.label }]
      : [];
  });
}

/**
 * subtype の点。正しいカテゴリが選ばれ、subtype のラベルがある項目だけ
 * （カテゴリが違えば subtype は表示されないため）
 */
export function subtypePoints(records: readonly EvalRecord[]): ScoredPoint[] {
  return records.flatMap((r) => {
    if (!isCorrect(r) || !r.labelSubtype) return [];
    if (!r.subtype || typeof r.subtypeProbability !== "number") return [];
    return [{ p: r.subtypeProbability, correct: r.subtype === r.labelSubtype }];
  });
}

export interface ThresholdStats {
  threshold: number;
  /** p ≥ threshold の件数 */
  support: number;
  accuracy: number;
}

export function statsAt(
  points: readonly ScoredPoint[],
  threshold: number
): ThresholdStats {
  const above = points.filter((x) => x.p >= threshold);
  return {
    threshold,
    support: above.length,
    accuracy:
      above.length === 0
        ? NaN
        : above.filter((x) => x.correct).length / above.length,
  };
}

/**
 * tuning の点から、p ≥ t の正解率が target 以上になる最も低い t を選ぶ（候補は観測された p）。
 * p ≥ t の件数が minSupport 未満なら選ばない。見つからなければ null（しきい値なし）
 */
export function chooseAccuracyThreshold(
  points: readonly ScoredPoint[],
  target: number,
  minSupport: number
): ThresholdStats | null {
  const candidates = Array.from(new Set(points.map((x) => x.p)))
    .filter((p) => p > 0)
    .sort((a, b) => a - b);
  for (const t of candidates) {
    const s = statsAt(points, t);
    if (s.support >= minSupport && s.accuracy >= target) return s;
  }
  return null;
}

/** Wilson スコア区間の下限（95%、z = 1.96）。n = 0 なら 0 */
export function wilsonLowerBound(successes: number, n: number, z = 1.96) {
  if (n === 0) return 0;
  const phat = successes / n;
  const z2 = z * z;
  const center = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return (center - margin) / (1 + z2 / n);
}

/** 百分位（最近傍順位法）。空なら NaN */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export interface ReliabilityRow {
  from: number;
  to: number;
  n: number;
  meanP: number;
  accuracy: number;
}

/** 確率の区間ごとの平均確率と正解率（較正の確認。jev-classifier-design §9） */
export function reliabilityTable(
  points: readonly ScoredPoint[],
  edges: readonly number[] = [0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1]
): ReliabilityRow[] {
  const rows: ReliabilityRow[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i];
    const to = edges[i + 1];
    const last = i === edges.length - 2;
    const inBucket = points.filter(
      (x) => x.p >= from && (last ? x.p <= to : x.p < to)
    );
    rows.push({
      from,
      to,
      n: inBucket.length,
      meanP:
        inBucket.length === 0
          ? NaN
          : inBucket.reduce((a, x) => a + x.p, 0) / inBucket.length,
      accuracy:
        inBucket.length === 0
          ? NaN
          : inBucket.filter((x) => x.correct).length / inBucket.length,
    });
  }
  return rows;
}

/** 確率の合計と 1 のずれ（Jev の生の確率。±0.02 の許容誤差の確認。§14.3） */
export function probabilitySumDrift(records: readonly EvalRecord[]): {
  n: number;
  maxAbs: number;
  min: number;
  max: number;
} {
  const drifts = records.flatMap((r) => {
    if (!r.probabilities) return [];
    const values = Object.values(r.probabilities).filter(
      (v): v is number => typeof v === "number"
    );
    return values.length === 0 ? [] : [values.reduce((a, b) => a + b, 0) - 1];
  });
  if (drifts.length === 0) return { n: 0, maxAbs: NaN, min: NaN, max: NaN };
  return {
    n: drifts.length,
    maxAbs: round(Math.max(...drifts.map(Math.abs)), 6),
    min: round(Math.min(...drifts), 6),
    max: round(Math.max(...drifts), 6),
  };
}

// ---------------------------------------------------------------------------
// 受け入れ判定としきい値（jev-classifier-design §9.3）
// ---------------------------------------------------------------------------

export const ACCEPTANCE = {
  /** held-out の正解率: Jev ≥ Gemini − 0.02 */
  maxAccuracyGapToGemini: 0.02,
  /** held-out のカテゴリごとの正解率の下限（件数が少ないため目安） */
  minPerCategoryAccuracy: 0.8,
  /** T_medium: p ≥ T の正解率 */
  mediumTarget: 0.9,
  /** T_prefill: p ≥ T の正解率 */
  prefillTarget: 0.8,
  /** subtype: p ≥ T の正解率（表示だけのため medium と同じ水準） */
  subtypeTarget: 0.9,
  /** tuning でしきい値を選ぶ最小の件数（カテゴリ。少ない件数の偶然で決めない） */
  minCategorySupport: 30,
  /** 同じく subtype */
  minSubtypeSupport: 10,
  /** p95 の応答時間（ミリ秒） */
  maxP95LatencyMs: 1_000,
} as const;

export interface GateCheck {
  id: string;
  pass: boolean;
  detail: string;
}

export interface ThresholdResult {
  tuning: ThresholdStats | null;
  heldout: ThresholdStats | null;
  /** tuning で選べ、held-out でも目標を満たした */
  confirmed: boolean;
}

function threshold(
  tuning: readonly ScoredPoint[],
  heldout: readonly ScoredPoint[],
  target: number,
  minSupport: number
): ThresholdResult {
  const chosen = chooseAccuracyThreshold(tuning, target, minSupport);
  if (!chosen) return { tuning: null, heldout: null, confirmed: false };
  const h = statsAt(heldout, chosen.threshold);
  return {
    tuning: chosen,
    heldout: h,
    confirmed: h.support > 0 && h.accuracy >= target,
  };
}

export interface ProviderSummary {
  provider: EvalProvider;
  model?: string;
  n: number;
  statusCounts: Record<EvalRecord["status"], number>;
  accuracy: { all: number; tuning: number; heldout: number };
  top2Heldout?: number;
  perCategoryHeldout: ReturnType<typeof perCategoryAccuracy>;
  latency: { p50: number; p95: number };
}

export function summarizeProvider(
  provider: EvalProvider,
  records: readonly EvalRecord[]
): ProviderSummary {
  const rs = records.filter((r) => r.provider === provider);
  const tuning = rs.filter((r) => r.split === "tuning");
  const heldout = rs.filter((r) => r.split === "heldout");
  const latencies = rs.flatMap((r) =>
    r.status === "ok" || r.status === "rejected"
      ? typeof r.latencyMs === "number"
        ? [r.latencyMs]
        : []
      : []
  );
  const statusCounts = { ok: 0, rejected: 0, "not-sent": 0, error: 0 };
  for (const r of rs) statusCounts[r.status]++;
  return {
    provider,
    model: rs.find((r) => r.model)?.model,
    n: rs.length,
    statusCounts,
    accuracy: {
      all: accuracy(rs),
      tuning: accuracy(tuning),
      heldout: accuracy(heldout),
    },
    ...(provider === "jev" ? { top2Heldout: topKAccuracy(heldout, 2) } : {}),
    perCategoryHeldout: perCategoryAccuracy(heldout),
    latency: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
    },
  };
}

export interface JevEvaluation {
  jev: ProviderSummary;
  gemini?: ProviderSummary;
  keyword?: ProviderSummary;
  medium: ThresholdResult;
  prefill: ThresholdResult;
  subtype: ThresholdResult;
  sumDrift: ReturnType<typeof probabilitySumDrift>;
  reliabilityHeldout: ReliabilityRow[];
  checks: GateCheck[];
  /** すべての受け入れ条件を満たした（本番の切り替えの前提） */
  accepted: boolean;
  /** 較正を作れる（T_medium・T_prefill が確認できた） */
  calibratable: boolean;
}

const pct = (v: number) => (Number.isNaN(v) ? "n/a" : `${round(v * 100, 1)}%`);

/** Jev の結果（と比較用の Gemini の結果）から受け入れ判定としきい値を求める */
export function evaluateJev(records: readonly EvalRecord[]): JevEvaluation {
  const jevRecords = records.filter((r) => r.provider === "jev");
  const jev = summarizeProvider("jev", records);
  const hasGemini = records.some((r) => r.provider === "gemini");
  const gemini = hasGemini ? summarizeProvider("gemini", records) : undefined;
  const keyword = records.some((r) => r.provider === "keyword")
    ? summarizeProvider("keyword", records)
    : undefined;
  const tuning = jevRecords.filter((r) => r.split === "tuning");
  const heldout = jevRecords.filter((r) => r.split === "heldout");

  const medium = threshold(
    categoryPoints(tuning),
    categoryPoints(heldout),
    ACCEPTANCE.mediumTarget,
    ACCEPTANCE.minCategorySupport
  );
  const prefill = threshold(
    categoryPoints(tuning),
    categoryPoints(heldout),
    ACCEPTANCE.prefillTarget,
    ACCEPTANCE.minCategorySupport
  );
  const subtype = threshold(
    subtypePoints(tuning),
    subtypePoints(heldout),
    ACCEPTANCE.subtypeTarget,
    ACCEPTANCE.minSubtypeSupport
  );

  const checks: GateCheck[] = [];
  if (gemini) {
    const gap = gemini.accuracy.heldout - jev.accuracy.heldout;
    checks.push({
      id: "accuracy-vs-gemini",
      pass: gap <= ACCEPTANCE.maxAccuracyGapToGemini,
      detail: `held-out: Jev ${pct(jev.accuracy.heldout)} / Gemini ${pct(gemini.accuracy.heldout)}`,
    });
  } else {
    checks.push({
      id: "accuracy-vs-gemini",
      pass: false,
      detail: "Gemini の結果がない（比較できない）",
    });
  }
  const weak = Object.entries(jev.perCategoryHeldout).filter(
    ([, v]) => v.accuracy < ACCEPTANCE.minPerCategoryAccuracy
  );
  checks.push({
    id: "per-category",
    pass: weak.length === 0,
    detail:
      weak.length === 0
        ? `すべてのカテゴリが ${pct(ACCEPTANCE.minPerCategoryAccuracy)} 以上`
        : weak.map(([c, v]) => `${c} ${pct(v.accuracy)}`).join(", "),
  });
  checks.push({
    id: "t-medium",
    pass: medium.confirmed,
    detail: describeThreshold(medium),
  });
  checks.push({
    id: "t-prefill",
    pass: prefill.confirmed,
    detail: describeThreshold(prefill),
  });
  checks.push({
    id: "latency-p95",
    pass: jev.latency.p95 < ACCEPTANCE.maxP95LatencyMs,
    detail: `p50 ${jev.latency.p50} ms / p95 ${jev.latency.p95} ms`,
  });
  checks.push({
    id: "no-failures",
    pass: jev.statusCounts.error === 0 && jev.statusCounts["not-sent"] === 0,
    detail: `ok ${jev.statusCounts.ok}, rejected ${jev.statusCounts.rejected}, not-sent ${jev.statusCounts["not-sent"]}, error ${jev.statusCounts.error}`,
  });

  return {
    jev,
    gemini,
    keyword,
    medium,
    prefill,
    subtype,
    sumDrift: probabilitySumDrift(jevRecords),
    reliabilityHeldout: reliabilityTable(categoryPoints(heldout)),
    checks,
    accepted: checks.every((c) => c.pass),
    calibratable: medium.confirmed && prefill.confirmed,
  };
}

function describeThreshold(t: ThresholdResult): string {
  if (!t.tuning) return "tuning で目標を満たすしきい値がない";
  const h = t.heldout;
  return `T=${t.tuning.threshold} (tuning ${pct(t.tuning.accuracy)}, n=${t.tuning.support}; held-out ${h ? pct(h.accuracy) : "n/a"}, n=${h?.support ?? 0})`;
}

/**
 * 較正データを作る（fact-model.md §5.1）。T_medium・T_prefill が確認できない場合は null
 * （未較正モードのまま）。presence は別の評価データ（§5.2）が必要なため、ここでは空（すべて「記載なし」）。
 * needsTournamentRules はラベルがないため設定しない（ドメインの規則だけ）
 */
export function buildJevCalibration(
  evaluation: JevEvaluation,
  dataset: {
    id: string;
    version: string;
    tuningSize: number;
    heldOutSize: number;
  },
  createdAt: string
): JevCalibration | null {
  const { medium, prefill, subtype, jev } = evaluation;
  if (
    !evaluation.calibratable ||
    !medium.tuning ||
    !prefill.tuning ||
    !jev.model
  )
    return null;
  const metrics: Record<string, number> = {
    heldoutAccuracy: round(jev.accuracy.heldout),
    heldoutMediumAccuracy: round(medium.heldout?.accuracy ?? NaN),
    heldoutMediumSupport: medium.heldout?.support ?? 0,
    heldoutPrefillAccuracy: round(prefill.heldout?.accuracy ?? NaN),
    heldoutPrefillSupport: prefill.heldout?.support ?? 0,
    latencyP95Ms: jev.latency.p95,
    probabilitySumMaxAbsDrift: evaluation.sumDrift.maxAbs,
  };
  if (jev.top2Heldout !== undefined)
    metrics.heldoutTop2Accuracy = round(jev.top2Heldout);
  const calibration: JevCalibration = {
    model: jev.model,
    dataset,
    createdAt,
    category: {
      medium: medium.tuning.threshold,
      prefill: prefill.tuning.threshold,
    },
    presence: {},
    metrics,
  };
  if (subtype.confirmed && subtype.tuning) {
    calibration.subtype = subtype.tuning.threshold;
    metrics.heldoutSubtypeAccuracy = round(subtype.heldout?.accuracy ?? NaN);
    metrics.heldoutSubtypeSupport = subtype.heldout?.support ?? 0;
  }
  return calibration;
}
