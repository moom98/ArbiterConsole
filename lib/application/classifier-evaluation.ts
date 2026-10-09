import type { IncidentCategory } from "@/lib/domain/entities";
import {
  CLOCK_TIME_SUBTYPE_LABELS,
  DRAW_SUBTYPE_LABELS,
} from "@/lib/domain/follow-up";
import { getFactDefinition } from "@/lib/domain/facts/catalog";
import type { FactId } from "@/lib/domain/facts/types";
import { INCIDENT_CATEGORIES } from "@/lib/domain/llm/classification";
import type {
  ClassificationRecord,
  EvalSplit,
  PresenceRecord,
} from "@/lib/domain/llm/calibration/fit";
import {
  PlaceholderMap,
  protectIncidentText,
  type KnownIdentifiers,
  type ProtectedTextRoute,
} from "@/lib/domain/privacy";

/**
 * 分類・fact の記載の評価（J3。jev-classifier-design §9, fact-model.md §5.2）。
 *
 * - データセットは合成した報告だけ（実際の大会の報告は送らない）
 * - すべての報告を本番と同じ前処理（protectIncidentText）に通し、送る形の本文だけを送る。
 *   ガードで止まった報告は送らず、件数を記録する（ゲートの誤検出の割合）
 * - 通信はポート（classify / presence）として受け取る。このファイルはネットワークに触れない
 */

export const MIN_CASES_PER_CATEGORY = 15;
/** 評価するカテゴリ（fair-play は送らないため除く） */
export const EVAL_CATEGORIES: readonly IncidentCategory[] =
  INCIDENT_CATEGORIES.filter((c) => c !== "fair-play");

/** Jev に subtype の質問があるカテゴリ（jev-questions.ts と同じ） */
const SUBTYPE_LABELS: Partial<
  Record<IncidentCategory, Record<string, string>>
> = {
  "clock-time": CLOCK_TIME_SUBTYPE_LABELS,
  draw: DRAW_SUBTYPE_LABELS,
};

export interface ClassificationEvalCase {
  id: string;
  split: EvalSplit;
  category: IncidentCategory;
  subtype?: string;
  text: string;
}

export interface ClassificationEvalDataset {
  id: string;
  version: string;
  description?: string;
  /** 合成の大会の登録済み識別子（名前の置き換えを本番と同じに通すため） */
  identifiers: KnownIdentifiers;
  cases: ClassificationEvalCase[];
}

export type PresenceCaseKind = "explicit" | "inferred" | "near-miss" | "absent";

export interface PresenceEvalCase {
  id: string;
  split: EvalSplit;
  factId: FactId;
  /** explicit だけが「記載あり」 */
  kind: PresenceCaseKind;
  text: string;
}

export interface PresenceEvalDataset {
  id: string;
  version: string;
  description?: string;
  identifiers: KnownIdentifiers;
  cases: PresenceEvalCase[];
}

const SPLITS: readonly EvalSplit[] = ["tuning", "held-out"];

function commonErrors(
  ds: { id?: unknown; version?: unknown; cases?: unknown },
  ids: string[]
): string[] {
  const errors: string[] = [];
  if (typeof ds.id !== "string" || !ds.id) errors.push("id がない");
  if (typeof ds.version !== "string" || !ds.version)
    errors.push("version がない");
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`case id の重複: ${id}`);
    seen.add(id);
  }
  return errors;
}

/** データセットの形と件数を確かめる（§9.1）。問題がなければ空配列 */
export function validateClassificationDataset(
  ds: ClassificationEvalDataset
): string[] {
  const errors = commonErrors(
    ds,
    ds.cases.map((c) => c.id)
  );
  for (const c of ds.cases) {
    if (!SPLITS.includes(c.split)) errors.push(`${c.id}: split が不正`);
    if (!EVAL_CATEGORIES.includes(c.category))
      errors.push(`${c.id}: 評価できないカテゴリ ${c.category}`);
    if (typeof c.text !== "string" || !c.text.trim())
      errors.push(`${c.id}: text がない`);
    if (c.subtype !== undefined) {
      const labels = SUBTYPE_LABELS[c.category];
      if (!labels || !Object.hasOwn(labels, c.subtype))
        errors.push(`${c.id}: subtype ${c.subtype} は ${c.category} にない`);
    }
  }
  for (const category of EVAL_CATEGORIES) {
    for (const split of SPLITS) {
      const n = ds.cases.filter(
        (c) => c.category === category && c.split === split
      ).length;
      if (n === 0) errors.push(`${category}: ${split} の報告がない`);
    }
    const total = ds.cases.filter((c) => c.category === category).length;
    if (total < MIN_CASES_PER_CATEGORY)
      errors.push(
        `${category}: ${total} 件（${MIN_CASES_PER_CATEGORY} 件以上必要）`
      );
  }
  return errors;
}

export function validatePresenceDataset(ds: PresenceEvalDataset): string[] {
  const errors = commonErrors(
    ds,
    ds.cases.map((c) => c.id)
  );
  const kinds: readonly PresenceCaseKind[] = [
    "explicit",
    "inferred",
    "near-miss",
    "absent",
  ];
  for (const c of ds.cases) {
    if (!SPLITS.includes(c.split)) errors.push(`${c.id}: split が不正`);
    if (!kinds.includes(c.kind)) errors.push(`${c.id}: kind が不正`);
    const d = getFactDefinition(c.factId);
    if (!d || !d.presenceCheckable || d.localOnly)
      errors.push(`${c.id}: 判定できない fact ${c.factId}`);
    if (typeof c.text !== "string" || !c.text.trim())
      errors.push(`${c.id}: text がない`);
  }
  return errors;
}

export type Deidentified =
  { ok: true; narrative: string } | { ok: false; stage: string };

/** 本番と同じ前処理（カテゴリは未選択として扱う。分類の前の状態） */
export function deidentifyEvalText(
  text: string,
  identifiers: KnownIdentifiers,
  route: Extract<ProtectedTextRoute, "classify" | "facts"> = "classify"
): Deidentified {
  const result = protectIncidentText({
    route,
    text,
    identifiers,
    map: new PlaceholderMap(),
  });
  return result.ok
    ? { ok: true, narrative: result.text }
    : { ok: false, stage: result.stage };
}

/** ガードの集計（送らなかった件数。カテゴリまたは fact ごと） */
export function summarizeDeidentification<T extends { text: string }>(
  cases: readonly T[],
  identifiers: KnownIdentifiers,
  keyOf: (c: T) => string,
  route: "classify" | "facts" = "classify"
): Record<string, { total: number; notSent: number; stages: string[] }> {
  const out: Record<
    string,
    { total: number; notSent: number; stages: string[] }
  > = {};
  for (const c of cases) {
    const key = keyOf(c);
    const entry = out[key] ?? { total: 0, notSent: 0, stages: [] };
    entry.total += 1;
    const d = deidentifyEvalText(c.text, identifiers, route);
    if (!d.ok) {
      entry.notSent += 1;
      entry.stages.push(d.stage);
    }
    out[key] = entry;
  }
  return out;
}

/** 分類のポート。raw はプロバイダーの生の出力（サーバーの ClassifyIncidentFn と同じ） */
export type EvalClassifyFn = (
  narrative: string
) => Promise<
  { ok: true; raw: unknown; model: string } | { ok: false; error: string }
>;

/** 記載の有無のポート。factIds の確率（応答にない fact は含めない） */
export type EvalPresenceFn = (
  narrative: string,
  factIds: readonly FactId[]
) => Promise<
  | { ok: true; presence: Record<FactId, number>; model: string }
  | { ok: false; error: string }
>;

export interface RunOptions {
  /** 同時に送る件数（既定 1。応答時間を正しく測るため） */
  concurrency?: number;
  now?: () => number;
  /** 進捗（件数だけ。本文は出さない） */
  onProgress?: (done: number, total: number) => void;
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  onDone?: (done: number) => void
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
      onDone?.(++done);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  );
  return results;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return "error";
}

/** 分類の評価を実行して生の記録を返す（送らなかった報告は notSent） */
export async function runClassificationEval(
  dataset: ClassificationEvalDataset,
  classify: EvalClassifyFn,
  options: RunOptions = {}
): Promise<ClassificationRecord[]> {
  const now = options.now ?? (() => Date.now());
  return mapLimited(
    dataset.cases,
    options.concurrency ?? 1,
    async (c): Promise<ClassificationRecord> => {
      const base: ClassificationRecord = {
        caseId: c.id,
        split: c.split,
        label: c.category,
        ...(c.subtype ? { labelSubtype: c.subtype } : {}),
      };
      const d = deidentifyEvalText(c.text, dataset.identifiers, "classify");
      if (!d.ok) return { ...base, notSent: d.stage };
      const started = now();
      try {
        const res = await classify(d.narrative);
        const latencyMs = now() - started;
        return res.ok
          ? { ...base, model: res.model, raw: res.raw, latencyMs }
          : { ...base, error: res.error, latencyMs };
      } catch (error) {
        return { ...base, error: errorCode(error), latencyMs: now() - started };
      }
    },
    (done) => options.onProgress?.(done, dataset.cases.length)
  );
}

/**
 * 記載の有無の評価。同じ本文の fact はまとめて1回で送る（本番と同じく1つの要求に複数の fact）
 */
export async function runPresenceEval(
  dataset: PresenceEvalDataset,
  presence: EvalPresenceFn,
  options: RunOptions = {}
): Promise<PresenceRecord[]> {
  const now = options.now ?? (() => Date.now());
  const groups = new Map<string, PresenceEvalCase[]>();
  for (const c of dataset.cases) {
    const list = groups.get(c.text) ?? [];
    list.push(c);
    groups.set(c.text, list);
  }
  const entries = Array.from(groups.entries());
  const nested = await mapLimited(
    entries,
    options.concurrency ?? 1,
    async ([text, cases]): Promise<PresenceRecord[]> => {
      const base = (c: PresenceEvalCase): PresenceRecord => ({
        caseId: c.id,
        split: c.split,
        factId: c.factId,
        present: c.kind === "explicit",
        kind: c.kind,
      });
      const d = deidentifyEvalText(text, dataset.identifiers, "facts");
      if (!d.ok) return cases.map((c) => ({ ...base(c), notSent: d.stage }));
      const factIds = Array.from(new Set(cases.map((c) => c.factId)));
      const started = now();
      try {
        const res = await presence(d.narrative, factIds);
        const latencyMs = now() - started;
        if (!res.ok)
          return cases.map((c) => ({
            ...base(c),
            error: res.error,
            latencyMs,
          }));
        return cases.map((c) => ({
          ...base(c),
          model: res.model,
          latencyMs,
          ...(typeof res.presence[c.factId] === "number"
            ? { p: res.presence[c.factId] }
            : {}),
        }));
      } catch (error) {
        const latencyMs = now() - started;
        return cases.map((c) => ({
          ...base(c),
          error: errorCode(error),
          latencyMs,
        }));
      }
    },
    (done) => options.onProgress?.(done, entries.length)
  );
  return nested.flat();
}
