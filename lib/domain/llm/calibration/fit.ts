import type { IncidentCategory } from "@/lib/domain/entities";
import { FACT_USAGES } from "@/lib/domain/facts/catalog";
import type { FactId, FactLevel } from "@/lib/domain/facts/types";
import {
  INCIDENT_CATEGORIES,
  PROBABILITY_SUM_TOLERANCE,
  parseLlmClassification,
} from "../classification";
import { isValidJevCalibration, type JevCalibration } from "./index";

/**
 * 評価結果から較正（しきい値）を求め、受け入れ条件を判定する（純粋関数。J3）。
 * jev-classifier-design §5.4, §9 / fact-model.md §5.2。
 *
 * - 評価スクリプト（scripts/eval-classifier.mjs）だけが使う。アプリの実行時には使わない
 * - しきい値は tuning で選び、held-out で確認する。held-out で満たさなければしきい値なし
 * - しきい値がない = 安全側（分類は low・プレフィルなし、fact は常に「記載なし」）
 */

export type EvalSplit = "tuning" | "held-out";

/** 評価するカテゴリ（fair-play は外部AIに送らないため除く） */
export const EVALUATED_CATEGORIES: readonly IncidentCategory[] =
  INCIDENT_CATEGORIES.filter((c) => c !== "fair-play");
export type EvalProvider = "jev" | "gemini";

// ---------------------------------------------------------------------------
// 目標値（設計書の値。変える場合は設計書を先に直す）
// ---------------------------------------------------------------------------

/** 分類のしきい値の目標（§9.3）。p ≥ T の予測の正解率 */
export const CATEGORY_TARGETS = { medium: 0.9, prefill: 0.8 } as const;
/** subtype を表示するしきい値の目標（p ≥ T の subtype の正解率） */
export const SUBTYPE_TARGET = 0.9;
/** しきい値を選ぶ・確認するのに必要な件数（少なすぎる件数で決めない） */
export const CATEGORY_MIN_SUPPORT = { tuning: 20, heldOut: 10 } as const;
export const SUBTYPE_MIN_SUPPORT = { tuning: 10, heldOut: 5 } as const;

/** 記載ありの precision の目標と Wilson 95% 下限（fact-model.md §5.2, Q-F2） */
export const PRESENCE_TARGETS: Readonly<
  Record<"blocking" | "other", { precision: number; wilson: number }>
> = {
  blocking: { precision: 0.995, wilson: 0.98 },
  other: { precision: 0.99, wilson: 0.97 },
};

/** 受け入れ条件（§9.3） */
export const ACCEPTANCE = {
  /** held-out の正解率が Gemini − 2 ポイント以上 */
  maxAccuracyDropVsGemini: 0.02,
  /** held-out のカテゴリごとの正解率（件数が少ないため目安） */
  minPerCategoryAccuracy: 0.8,
  /** held-out で評価できたカテゴリごとの最小件数（ガードで止まって減った場合は不合格） */
  minHeldOutPerCategory: 5,
  /** p95 の応答時間（ミリ秒） */
  maxP95LatencyMs: 1_000,
} as const;

// ---------------------------------------------------------------------------
// 統計
// ---------------------------------------------------------------------------

/** Wilson スコア区間の下限（z = 1.96 で 95%）。n = 0 は 0 */
export function wilsonLowerBound(
  successes: number,
  n: number,
  z = 1.96
): number {
  if (n <= 0) return 0;
  const phat = successes / n;
  const z2 = z * z;
  const centre = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

/** 分位点（最近傍法。入力は並べ替えなくてよい）。空なら undefined */
export function percentile(
  values: readonly number[],
  q: number
): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(q * sorted.length) - 1)
  );
  return sorted[index];
}

export interface ScoredPoint {
  /** 予測の確率 */
  p: number;
  /** 予測が正しかったか（分類: カテゴリが正解 / presence: 実際に記載がある） */
  correct: boolean;
}

export interface ThresholdStats {
  threshold: number;
  /** p ≥ threshold の件数 */
  support: number;
  /** そのうち正しかった件数 */
  correct: number;
  precision: number;
  wilson: number;
}

export interface ThresholdCriteria {
  /** p ≥ T の正解率（precision）の下限 */
  target: number;
  /** p ≥ T の件数の下限 */
  minSupport?: number;
  /** Wilson 95% 下限の下限 */
  minWilson?: number;
}

/** しきい値 t での成績（p ≥ t の予測） */
export function statsAt(
  points: readonly ScoredPoint[],
  threshold: number
): ThresholdStats {
  const selected = points.filter((x) => x.p >= threshold);
  const correct = selected.filter((x) => x.correct).length;
  const support = selected.length;
  return {
    threshold,
    support,
    correct,
    precision: support === 0 ? 0 : correct / support,
    wilson: wilsonLowerBound(correct, support),
  };
}

function meets(stats: ThresholdStats, criteria: ThresholdCriteria): boolean {
  return (
    stats.support > 0 &&
    stats.support >= (criteria.minSupport ?? 1) &&
    stats.precision >= criteria.target &&
    stats.wilson >= (criteria.minWilson ?? 0)
  );
}

/**
 * 条件を満たす最小のしきい値（候補は観測された p。0 は使わない）。なければ undefined。
 * 正解率は t に対して単調でないため、すべての候補を調べる
 */
export function chooseThreshold(
  points: readonly ScoredPoint[],
  criteria: ThresholdCriteria
): ThresholdStats | undefined {
  const candidates = Array.from(new Set(points.map((x) => x.p)))
    .filter((p) => p > 0 && p <= 1)
    .sort((a, b) => a - b);
  for (const t of candidates) {
    const stats = statsAt(points, t);
    if (meets(stats, criteria)) return stats;
  }
  return undefined;
}

export interface FittedThreshold {
  criteria: ThresholdCriteria;
  /** tuning で選んだしきい値（なければ undefined） */
  tuning?: ThresholdStats;
  /** 同じしきい値の held-out での成績 */
  heldOut?: ThresholdStats;
  /** held-out でも条件を満たした（このときだけ較正に入れる） */
  accepted: boolean;
}

/** tuning で選び、held-out で確認する */
export function fitThreshold(
  tuning: readonly ScoredPoint[],
  heldOut: readonly ScoredPoint[],
  criteria: { tuning: ThresholdCriteria; heldOut: ThresholdCriteria }
): FittedThreshold {
  const chosen = chooseThreshold(tuning, criteria.tuning);
  if (!chosen) return { criteria: criteria.tuning, accepted: false };
  const confirmed = statsAt(heldOut, chosen.threshold);
  return {
    criteria: criteria.tuning,
    tuning: chosen,
    heldOut: confirmed,
    accepted: meets(confirmed, criteria.heldOut),
  };
}

// ---------------------------------------------------------------------------
// 分類の観測
// ---------------------------------------------------------------------------

/** 評価の1件の生の記録（スクリプトが保存する。application 層の runner が作る） */
export interface ClassificationRecord {
  caseId: string;
  split: EvalSplit;
  label: IncidentCategory;
  labelSubtype?: string;
  /** 外部AIガードで止まった（送らなかった）場合の段階 */
  notSent?: string;
  /** 送った場合の応答。通信の失敗・不正な応答は error */
  model?: string;
  raw?: unknown;
  error?: string;
  /** transport: 再試行しても通信が失敗した / model: 応答はあったが使えない */
  errorKind?: "transport" | "model";
  /** 試行回数（本番と同じ再試行） */
  attempts?: number;
  latencyMs?: number;
}

export interface ClassificationObservation {
  caseId: string;
  split: EvalSplit;
  label: IncidentCategory;
  labelSubtype?: string;
  /** ドメインの検証（parseLlmClassification）を通った */
  valid: boolean;
  /** 通信の失敗（不正解に数えるが、レポートでは別に示す） */
  transportError?: boolean;
  predicted?: IncidentCategory;
  /** 予測したカテゴリの確率（Jev のみ） */
  probability?: number;
  /** 2番目のカテゴリ（Jev のみ） */
  second?: IncidentCategory;
  probabilitySum?: number;
  subtype?: string;
  subtypeProbability?: number;
  latencyMs?: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 生の記録を観測に変換する。送らなかった記録は undefined（評価の対象外。件数は別に数える）。
 * 正誤はドメインと同じ検証で決める: 検証を通らない応答は本番ではキーワード分類になるため不正解に数える。
 * 確率の合計だけは検証の前に記録する（±0.02 の許容誤差を確かめる。§14.3）
 */
export function toClassificationObservation(
  record: ClassificationRecord,
  provider: EvalProvider
): ClassificationObservation | undefined {
  if (record.notSent) return undefined;
  const base = {
    caseId: record.caseId,
    split: record.split,
    label: record.label,
    labelSubtype: record.labelSubtype,
    latencyMs: record.latencyMs,
  };
  if (record.error || record.raw === undefined)
    return {
      ...base,
      valid: false,
      ...(record.errorKind === "transport" ? { transportError: true } : {}),
    };

  let probabilitySum: number | undefined;
  if (provider === "jev" && isObject(record.raw)) {
    const probs = record.raw.categoryProbabilities;
    if (isObject(probs)) {
      const values = Object.values(probs);
      if (values.every((v) => typeof v === "number" && Number.isFinite(v)))
        probabilitySum = (values as number[]).reduce((a, b) => a + b, 0);
    }
  }

  // 較正なし（未較正モード）で検証する。しきい値は観測に影響しない
  const parsed = parseLlmClassification(record.raw, {
    model: record.model,
    calibrations: [],
  });
  if (!parsed || parsed.provider !== provider)
    return { ...base, valid: false, probabilitySum };

  const observation: ClassificationObservation = {
    ...base,
    valid: true,
    predicted: parsed.category,
    probabilitySum,
  };
  if (provider === "jev" && isObject(record.raw)) {
    const probs = record.raw.categoryProbabilities as Record<string, number>;
    observation.probability = parsed.probability;
    observation.second = INCIDENT_CATEGORIES.filter(
      (c) => c !== parsed.category
    )
      .map((c, i) => ({ c, i, p: probs[c] }))
      .sort((a, b) => b.p - a.p || a.i - b.i)[0]?.c;
    // subtype は較正なしでは捨てられるため、生の値を使う（予測カテゴリの質問の回答だけ）
    if (
      typeof record.raw.subtype === "string" &&
      typeof record.raw.subtypeProbability === "number"
    ) {
      observation.subtype = record.raw.subtype;
      observation.subtypeProbability = record.raw.subtypeProbability;
    }
  }
  return observation;
}

export interface ReliabilityBucket {
  /** [from, to)。最後のバケットは 1 を含む */
  from: number;
  to: number;
  n: number;
  meanProbability: number;
  accuracy: number;
}

export interface ClassificationSummary {
  /** 送った件数（ガードで止まったものを除く） */
  n: number;
  /** ドメインの検証を通らなかった件数（本番ではキーワード分類になる） */
  invalid: number;
  /** そのうち通信の失敗（再試行後も）。0 でなければ評価をやり直す */
  transportErrors: number;
  accuracy: number;
  /** Jev のみ（確率の上位2件に正解がある） */
  top2Accuracy?: number;
  perCategory: Partial<
    Record<IncidentCategory, { n: number; correct: number; accuracy: number }>
  >;
  /** Jev のみ */
  reliability?: ReliabilityBucket[];
  latency: { p50?: number; p95?: number; max?: number };
  /** Jev のみ。確率の合計（§14.3: ±0.02 の確認） */
  probabilitySum?: {
    min: number;
    max: number;
    maxAbsDeviation: number;
    outsideTolerance: number;
    tolerance: number;
  };
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function summarizeClassification(
  observations: readonly ClassificationObservation[],
  provider: EvalProvider
): ClassificationSummary {
  const n = observations.length;
  const correct = observations.filter(
    (o) => o.valid && o.predicted === o.label
  ).length;
  const perCategory: ClassificationSummary["perCategory"] = {};
  for (const o of observations) {
    const entry = perCategory[o.label] ?? { n: 0, correct: 0, accuracy: 0 };
    entry.n += 1;
    if (o.valid && o.predicted === o.label) entry.correct += 1;
    entry.accuracy = ratio(entry.correct, entry.n);
    perCategory[o.label] = entry;
  }
  const latencies = observations
    .map((o) => o.latencyMs)
    .filter((v): v is number => typeof v === "number");
  const summary: ClassificationSummary = {
    n,
    invalid: observations.filter((o) => !o.valid).length,
    transportErrors: observations.filter((o) => o.transportError).length,
    accuracy: ratio(correct, n),
    perCategory,
    latency: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length ? Math.max(...latencies) : undefined,
    },
  };
  if (provider !== "jev") return summary;

  summary.top2Accuracy = ratio(
    observations.filter(
      (o) => o.valid && (o.predicted === o.label || o.second === o.label)
    ).length,
    n
  );
  const scored = observations.filter(
    (o): o is ClassificationObservation & { probability: number } =>
      o.valid && typeof o.probability === "number"
  );
  summary.reliability = Array.from({ length: 10 }, (_, i) => {
    const from = i / 10;
    const to = (i + 1) / 10;
    const inBucket = scored.filter((o) =>
      i === 9
        ? o.probability >= from
        : o.probability >= from && o.probability < to
    );
    return {
      from,
      to,
      n: inBucket.length,
      meanProbability: ratio(
        inBucket.reduce((s, o) => s + o.probability, 0),
        inBucket.length
      ),
      accuracy: ratio(
        inBucket.filter((o) => o.predicted === o.label).length,
        inBucket.length
      ),
    };
  });
  const sums = observations
    .map((o) => o.probabilitySum)
    .filter((v): v is number => typeof v === "number");
  if (sums.length) {
    const deviations = sums.map((s) => Math.abs(s - 1));
    summary.probabilitySum = {
      min: Math.min(...sums),
      max: Math.max(...sums),
      maxAbsDeviation: Math.max(...deviations),
      outsideTolerance: deviations.filter((d) => d > PROBABILITY_SUM_TOLERANCE)
        .length,
      tolerance: PROBABILITY_SUM_TOLERANCE,
    };
  }
  return summary;
}

/** 分類のしきい値の点（p は予測カテゴリの確率、correct は予測が正解） */
export function categoryPoints(
  observations: readonly ClassificationObservation[],
  split: EvalSplit
): ScoredPoint[] {
  return observations
    .filter(
      (o): o is ClassificationObservation & { probability: number } =>
        o.split === split && o.valid && typeof o.probability === "number"
    )
    .map((o) => ({ p: o.probability, correct: o.predicted === o.label }));
}

/**
 * subtype のしきい値の点。カテゴリが正解で、正解の subtype があり、subtype の回答がある件だけ
 * （カテゴリを誤った件の subtype は表示されても意味がないため、カテゴリの評価で数える）
 */
export function subtypePoints(
  observations: readonly ClassificationObservation[],
  split: EvalSplit
): ScoredPoint[] {
  return observations
    .filter(
      (o): o is ClassificationObservation & { subtypeProbability: number } =>
        o.split === split &&
        o.valid &&
        o.predicted === o.label &&
        o.labelSubtype !== undefined &&
        typeof o.subtypeProbability === "number"
    )
    .map((o) => ({
      p: o.subtypeProbability,
      correct: o.subtype === o.labelSubtype,
    }));
}

// ---------------------------------------------------------------------------
// fact の記載の有無（presence）
// ---------------------------------------------------------------------------

export interface PresenceRecord {
  caseId: string;
  split: EvalSplit;
  factId: FactId;
  /** 正解: 報告文に明示されている */
  present: boolean;
  /** 明示 / 推測が必要 / 似た別の事実 / 記載なし（集計用） */
  kind: string;
  notSent?: string;
  model?: string;
  /** その fact の確率。応答に欠けた・不正な場合は undefined（missing として扱う） */
  p?: number;
  error?: string;
  latencyMs?: number;
}

/** fact の最も厳しい水準（いずれかの usage で blocking なら blocking） */
export function presenceLevel(factId: FactId): "blocking" | "other" {
  const levels = FACT_USAGES.filter((u) => u.factId === factId).map(
    (u) => u.level as FactLevel
  );
  return levels.includes("blocking") ? "blocking" : "other";
}

export interface PresenceFit extends FittedThreshold {
  factId: FactId;
  level: "blocking" | "other";
  /** 評価した件数（送ったもの）と、正解が「記載あり」の件数 */
  counts: Record<EvalSplit, { n: number; present: number }>;
  /** held-out の recall（しきい値がある場合。目標ではなく記録） */
  heldOutRecall?: number;
  /** 送らなかった件数 */
  notSent: number;
}

/**
 * fact ごとに「記載あり」のしきい値を選ぶ。tuning と held-out の両方で、precision の目標と
 * Wilson 下限を満たすこと（fact-model §5.2 の手順 2「同じ目標」。ADR-013 Q-F2）
 */
export function fitPresence(records: readonly PresenceRecord[]): PresenceFit[] {
  const factIds = Array.from(new Set(records.map((r) => r.factId))).sort();
  return factIds.map((factId) => {
    const level = presenceLevel(factId);
    const target = PRESENCE_TARGETS[level];
    const ofFact = records.filter((r) => r.factId === factId);
    const sent = ofFact.filter((r) => !r.notSent);
    // 応答のない件は p = 0（missing）。「記載あり」と判定されないため precision は下がらない
    const points = (split: EvalSplit): ScoredPoint[] =>
      sent
        .filter((r) => r.split === split)
        .map((r) => ({
          p: typeof r.p === "number" && !r.error ? r.p : 0,
          correct: r.present,
        }));
    const fit = fitThreshold(points("tuning"), points("held-out"), {
      tuning: { target: target.precision, minWilson: target.wilson },
      heldOut: { target: target.precision, minWilson: target.wilson },
    });
    const count = (split: EvalSplit) => {
      const s = sent.filter((r) => r.split === split);
      return { n: s.length, present: s.filter((r) => r.present).length };
    };
    const heldOutPresent = points("held-out").filter((x) => x.correct);
    return {
      ...fit,
      factId,
      level,
      counts: { tuning: count("tuning"), "held-out": count("held-out") },
      heldOutRecall:
        fit.tuning && heldOutPresent.length
          ? heldOutPresent.filter((x) => x.p >= fit.tuning!.threshold).length /
            heldOutPresent.length
          : undefined,
      notSent: ofFact.length - sent.length,
    };
  });
}

// ---------------------------------------------------------------------------
// 較正と受け入れ判定
// ---------------------------------------------------------------------------

export interface DatasetInfo {
  id: string;
  version: string;
}

export interface CategoryFit {
  medium: FittedThreshold;
  prefill: FittedThreshold;
  subtype: FittedThreshold;
}

export function fitCategory(
  observations: readonly ClassificationObservation[]
): CategoryFit {
  const tuning = categoryPoints(observations, "tuning");
  const heldOut = categoryPoints(observations, "held-out");
  const category = (target: number) =>
    fitThreshold(tuning, heldOut, {
      tuning: { target, minSupport: CATEGORY_MIN_SUPPORT.tuning },
      heldOut: { target, minSupport: CATEGORY_MIN_SUPPORT.heldOut },
    });
  return {
    medium: category(CATEGORY_TARGETS.medium),
    prefill: category(CATEGORY_TARGETS.prefill),
    subtype: fitThreshold(
      subtypePoints(observations, "tuning"),
      subtypePoints(observations, "held-out"),
      {
        tuning: {
          target: SUBTYPE_TARGET,
          minSupport: SUBTYPE_MIN_SUPPORT.tuning,
        },
        heldOut: {
          target: SUBTYPE_TARGET,
          minSupport: SUBTYPE_MIN_SUPPORT.heldOut,
        },
      }
    ),
  };
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/**
 * 較正を作る。分類の medium・prefill の両方が held-out で確認できない場合は undefined
 * （較正を作れない = 受け入れ条件を満たさない）。subtype・fact は確認できたものだけ入れる。
 * needsTournamentRules は正解ラベルがないため較正しない（ドメインの規則だけ）
 */
export function buildJevCalibration(input: {
  model: string;
  dataset: DatasetInfo;
  presenceDataset?: DatasetInfo;
  createdAt: string;
  observations: readonly ClassificationObservation[];
  category: CategoryFit;
  presence: readonly PresenceFit[];
}): JevCalibration | undefined {
  const { medium, prefill, subtype } = input.category;
  if (!medium.accepted || !prefill.accepted) return undefined;
  const count = (split: EvalSplit) =>
    input.observations.filter((o) => o.split === split).length;
  const metrics: Record<string, number> = {
    "category.medium.heldOutPrecision": round4(medium.heldOut!.precision),
    "category.medium.heldOutSupport": medium.heldOut!.support,
    "category.prefill.heldOutPrecision": round4(prefill.heldOut!.precision),
    "category.prefill.heldOutSupport": prefill.heldOut!.support,
  };
  const presence: Partial<Record<FactId, number>> = {};
  for (const fit of input.presence) {
    if (!fit.accepted || !fit.tuning) continue;
    presence[fit.factId] = fit.tuning.threshold;
    metrics[`presence.${fit.factId}.tuningPrecision`] = round4(
      fit.tuning.precision
    );
    metrics[`presence.${fit.factId}.tuningWilson`] = round4(fit.tuning.wilson);
    metrics[`presence.${fit.factId}.tuningSupport`] = fit.tuning.support;
    metrics[`presence.${fit.factId}.heldOutPrecision`] = round4(
      fit.heldOut!.precision
    );
    metrics[`presence.${fit.factId}.heldOutSupport`] = fit.heldOut!.support;
    if (fit.heldOutRecall !== undefined)
      metrics[`presence.${fit.factId}.heldOutRecall`] = round4(
        fit.heldOutRecall
      );
  }
  const calibration: JevCalibration = {
    model: input.model,
    dataset: {
      id: input.presenceDataset
        ? `${input.dataset.id}+${input.presenceDataset.id}`
        : input.dataset.id,
      version: input.presenceDataset
        ? `${input.dataset.version}+${input.presenceDataset.version}`
        : input.dataset.version,
      tuningSize: count("tuning"),
      heldOutSize: count("held-out"),
    },
    createdAt: input.createdAt,
    category: {
      medium: medium.tuning!.threshold,
      prefill: prefill.tuning!.threshold,
    },
    ...(subtype.accepted ? { subtype: subtype.tuning!.threshold } : {}),
    presence,
    metrics,
  };
  return isValidJevCalibration(calibration) ? calibration : undefined;
}

export interface GateItem {
  id:
    | "accuracy-vs-gemini"
    | "per-category"
    | "calibration"
    | "latency"
    | "transport"
    | "single-model";
  pass: boolean;
  /** 判定できなかった（Gemini の結果がない等）。pass は false */
  notEvaluated?: boolean;
  detail: string;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * 受け入れ条件（§9.3）。presence は条件ではない（しきい値のない fact は常に「記載なし」で安全）。
 * プライバシーの確認（§9.4）はスクリプトが送信の前に行い、ここでは扱わない
 */
export function evaluateAcceptance(input: {
  jevHeldOut: ClassificationSummary;
  geminiHeldOut?: ClassificationSummary;
  category: CategoryFit;
  /** Jev の応答の model（解決済み）。複数あれば較正を1つに決められない */
  jevModels: readonly string[];
}): { accepted: boolean; items: GateItem[] } {
  const items: GateItem[] = [];
  const jev = input.jevHeldOut;

  if (!input.geminiHeldOut) {
    items.push({
      id: "accuracy-vs-gemini",
      pass: false,
      notEvaluated: true,
      detail: "Gemini の held-out の結果がない",
    });
  } else {
    const gemini = input.geminiHeldOut.accuracy;
    items.push({
      id: "accuracy-vs-gemini",
      pass: jev.accuracy >= gemini - ACCEPTANCE.maxAccuracyDropVsGemini - 1e-9,
      detail: `Jev ${pct(jev.accuracy)} / Gemini ${pct(gemini)}（許容 −${pct(ACCEPTANCE.maxAccuracyDropVsGemini)}）`,
    });
  }

  // 評価するカテゴリはすべて（fair-play を除く）。件数が足りないカテゴリも不合格
  const problems: string[] = [];
  for (const c of EVALUATED_CATEGORIES) {
    const v = jev.perCategory[c];
    if (!v || v.n < ACCEPTANCE.minHeldOutPerCategory)
      problems.push(
        `${c} n=${v?.n ?? 0}（${ACCEPTANCE.minHeldOutPerCategory} 件未満）`
      );
    else if (v.accuracy < ACCEPTANCE.minPerCategoryAccuracy)
      problems.push(`${c} ${pct(v.accuracy)}`);
  }
  items.push({
    id: "per-category",
    pass: problems.length === 0,
    detail:
      problems.length === 0
        ? `すべてのカテゴリが ${pct(ACCEPTANCE.minPerCategoryAccuracy)} 以上`
        : `${pct(ACCEPTANCE.minPerCategoryAccuracy)} 未満または件数不足: ${problems.join(", ")}`,
  });

  const transport = [
    ["Jev", jev.transportErrors],
    ["Gemini", input.geminiHeldOut?.transportErrors ?? 0],
  ] as const;
  const failed = transport.filter(([, n]) => n > 0);
  items.push({
    id: "transport",
    pass: failed.length === 0,
    detail:
      failed.length === 0
        ? "通信の失敗なし"
        : `通信の失敗（再試行後）: ${failed.map(([p, n]) => `${p} ${n}`).join(", ")}。評価をやり直す`,
  });

  const { medium, prefill } = input.category;
  const describe = (name: string, f: FittedThreshold) =>
    f.tuning
      ? `${name} T=${f.tuning.threshold}（held-out ${pct(f.heldOut!.precision)}, n=${f.heldOut!.support}）`
      : `${name}: tuning で目標に届くしきい値がない`;
  items.push({
    id: "calibration",
    pass: medium.accepted && prefill.accepted,
    detail: `${describe("medium", medium)} / ${describe("prefill", prefill)}`,
  });

  const p95 = jev.latency.p95;
  items.push({
    id: "latency",
    pass: p95 !== undefined && p95 < ACCEPTANCE.maxP95LatencyMs,
    notEvaluated: p95 === undefined ? true : undefined,
    detail:
      p95 === undefined
        ? "応答時間の記録がない"
        : `p95 ${Math.round(p95)} ms（上限 ${ACCEPTANCE.maxP95LatencyMs} ms）`,
  });

  items.push({
    id: "single-model",
    pass: input.jevModels.length === 1,
    detail:
      input.jevModels.length === 1
        ? `model ${input.jevModels[0]}`
        : `応答の model が1つでない: ${input.jevModels.join(", ") || "なし"}`,
  });

  return { accepted: items.every((i) => i.pass), items };
}
