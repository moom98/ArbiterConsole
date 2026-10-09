import type { JevCalibration } from "./index";

/**
 * jev-1.13.0 の較正（J3。評価: docs/progress/evaluations/classifier-v2-run1-rescored/）。
 * 値は scripts/eval-classifier.mjs の出力 jev-1.13.0.json と同じ（テストで一致を確認する）。
 *
 * - カテゴリ: p ≥ 0.9 で medium（held-out 98.9%, n = 94）、p ≥ 0.8 でプレフィル（97.3%, n = 113）
 * - subtype: p ≥ 0.9 で表示（held-out 100%, n = 24）
 * - しきい値の下限（目標未満にしない）は v2 の held-out を見た後に加えたため、held-out での確認は
 *   独立ではない（jev-classifier-design §18.3）。tuning だけでも p ≥ 0.9 は 100%（n = 203）
 * - presence: 評価データがないため空（すべて「記載なし」。fact-model §5.2）
 * - needsTournamentRules: ラベルがないため未設定（ドメインの規則だけ）
 */
export const JEV_1_13_0_CALIBRATION: JevCalibration = {
  model: "jev-1.13.0",
  dataset: {
    id: "classification-eval-ja",
    version: "2",
    tuningSize: 270,
    heldOutSize: 135,
  },
  createdAt: "2026-10-09T22:17:08.803Z",
  category: { medium: 0.9, prefill: 0.8 },
  subtype: 0.9,
  presence: {},
  metrics: {
    heldoutAccuracy: 0.9037,
    heldoutMediumAccuracy: 0.9894,
    heldoutMediumSupport: 94,
    heldoutPrefillAccuracy: 0.9735,
    heldoutPrefillSupport: 113,
    latencyP95Ms: 259,
    probabilitySumMaxAbsDrift: 0.01,
    heldoutTop2Accuracy: 0.9926,
    heldoutSubtypeAccuracy: 1,
    heldoutSubtypeSupport: 24,
  },
};
