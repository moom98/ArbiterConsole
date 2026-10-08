import type { FactId } from "@/lib/domain/facts/types";

/**
 * Jev の較正データ（しきい値）。モデルごと（fact-model.md §5, jev-classifier-design §5.4）。
 *
 * - しきい値は評価データ（合成・匿名化済み）から scripts/eval-classifier.mjs が決める（J3）。
 *   固定値（0.5 等）は使わない
 * - 応答の model（解決済みのバージョン）に一致する較正がない場合は「未較正モード」:
 *   分類は confidence "low"・プレフィルなし、fact はすべて「記載なし」として質問する
 * - JEV_MODEL・評価データ・匿名化を変えた場合は評価をやり直して作り直す
 */
export interface JevCalibration {
  /** 応答の model と一致すること（例: "jev-1.13.0"） */
  model: string;
  dataset: {
    id: string;
    version: string;
    tuningSize: number;
    heldOutSize: number;
  };
  createdAt: string;
  /** p(category) ≥ medium → "medium"、≥ prefill → プレフィルする */
  category: { medium: number; prefill: number };
  /** subtype を表示するしきい値（未指定なら subtype は表示しない） */
  subtype?: number;
  /** needsTournamentRules を立てるしきい値（未指定ならドメインの規則のみ） */
  needsTournamentRules?: number;
  /** fact ごとの「記載あり」のしきい値。ない fact は常に「記載なし」 */
  presence: Partial<Record<FactId, number>>;
  /** 評価の記録（held-out の precision 等）。判断には使わない */
  metrics: Record<string, number>;
}

/**
 * 登録済みの較正。**評価（J3）前のため空**。空の間はすべて未較正モードで動く。
 * 追加するときは評価スクリプトの出力（calibration/<model>.json）から作り、テストで一致を確認する
 */
export const JEV_CALIBRATIONS: readonly JevCalibration[] = [];

const isThreshold = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1;

/** しきい値がすべて (0, 1] にあるか（不正な較正は使わない） */
export function isValidJevCalibration(c: JevCalibration): boolean {
  if (typeof c.model !== "string" || !c.model) return false;
  if (!isThreshold(c.category?.medium) || !isThreshold(c.category?.prefill))
    return false;
  if (c.subtype !== undefined && !isThreshold(c.subtype)) return false;
  if (
    c.needsTournamentRules !== undefined &&
    !isThreshold(c.needsTournamentRules)
  )
    return false;
  return Object.values(c.presence ?? {}).every(
    (t) => t === undefined || isThreshold(t)
  );
}

/**
 * 応答の model（解決済みのバージョン）に対応する較正を返す。ない・不正な場合は undefined
 * （未較正モード）。別名（jev-latest 等）には一致させない
 */
export function findJevCalibration(
  model: string | undefined,
  calibrations: readonly JevCalibration[] = JEV_CALIBRATIONS
): JevCalibration | undefined {
  if (!model) return undefined;
  const found = calibrations.find((c) => c.model === model);
  return found && isValidJevCalibration(found) ? found : undefined;
}
