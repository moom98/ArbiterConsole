import { describe, expect, it } from "vitest";
import type { IncidentCategory } from "@/lib/domain/entities";
import { INCIDENT_CATEGORIES } from "@/lib/domain/llm/classification";
import { isValidJevCalibration } from "@/lib/domain/llm/calibration";
import {
  accuracy,
  buildJevCalibration,
  categoryPoints,
  chooseAccuracyThreshold,
  evaluateJev,
  percentile,
  probabilitySumDrift,
  reliabilityTable,
  statsAt,
  subtypePoints,
  topKAccuracy,
  wilsonLowerBound,
  type EvalRecord,
  type EvalSplit,
  type ScoredPoint,
} from "@/lib/evaluation/classifier-eval";

/** 指定のカテゴリに p、残りを均等に配った確率 */
function probs(
  top: IncidentCategory,
  p: number,
  second?: IncidentCategory
): Partial<Record<IncidentCategory, number>> {
  const rest = INCIDENT_CATEGORIES.filter((c) => c !== top && c !== second);
  const secondP = second ? (1 - p) / 2 : 0;
  const each = (1 - p - secondP) / rest.length;
  return {
    ...Object.fromEntries(rest.map((c) => [c, each])),
    ...(second ? { [second]: secondP } : {}),
    [top]: p,
  };
}

let seq = 0;
function jev(
  label: IncidentCategory,
  predicted: IncidentCategory,
  p: number,
  split: EvalSplit = "heldout",
  extra: Partial<EvalRecord> = {}
): EvalRecord {
  return {
    id: `r${seq++}`,
    split,
    provider: "jev",
    label,
    status: "ok",
    predicted,
    probabilities: probs(predicted, p),
    model: "jev-1.13.0",
    latencyMs: 100,
    ...extra,
  };
}

describe("accuracy / topKAccuracy", () => {
  it("失敗・却下は不正解として数える", () => {
    const rs = [
      jev("draw", "draw", 0.9),
      jev("draw", "team", 0.9),
      { ...jev("draw", "draw", 0.9), status: "rejected" as const },
      { ...jev("draw", "draw", 0.9), status: "error" as const },
    ];
    expect(accuracy(rs)).toBe(0.25);
    expect(accuracy([])).toBeNaN();
  });

  it("top-2 は確率の2番目までに正解があれば正解", () => {
    const r = {
      ...jev("scoresheet", "draw", 0.6),
      probabilities: probs("draw", 0.6, "scoresheet"),
    };
    expect(topKAccuracy([r], 1)).toBe(0);
    expect(topKAccuracy([r], 2)).toBe(1);
  });
});

describe("chooseAccuracyThreshold", () => {
  const pts: ScoredPoint[] = [
    { p: 0.3, correct: false },
    { p: 0.5, correct: false },
    { p: 0.6, correct: true },
    { p: 0.7, correct: true },
    { p: 0.8, correct: true },
    { p: 0.9, correct: true },
  ];

  it("目標を満たす最も低いしきい値を選ぶ", () => {
    // p ≥ 0.5: 4/5 = 0.8、p ≥ 0.6: 4/4 = 1
    expect(chooseAccuracyThreshold(pts, 0.8, 1)?.threshold).toBe(0.5);
    expect(chooseAccuracyThreshold(pts, 0.9, 1)?.threshold).toBe(0.6);
  });

  it("件数が足りなければ選ばない", () => {
    expect(chooseAccuracyThreshold(pts, 0.9, 5)).toBeNull();
    expect(chooseAccuracyThreshold(pts, 0.9, 4)?.threshold).toBe(0.6);
  });

  it("境界: p がしきい値と等しい点を含む", () => {
    expect(statsAt(pts, 0.6)).toEqual({
      threshold: 0.6,
      support: 4,
      accuracy: 1,
    });
  });

  it("目標に届かなければ null", () => {
    expect(
      chooseAccuracyThreshold([{ p: 0.9, correct: false }], 0.5, 1)
    ).toBeNull();
  });
});

describe("points", () => {
  it("カテゴリの点は受け付けた応答だけ", () => {
    const rs = [
      jev("draw", "draw", 0.9),
      { ...jev("draw", "team", 0.7), status: "rejected" as const },
    ];
    expect(categoryPoints(rs)).toEqual([{ p: 0.9, correct: true }]);
  });

  it("subtype の点はカテゴリが正しく、ラベルがある項目だけ", () => {
    const rs = [
      jev("draw", "draw", 0.9, "heldout", {
        labelSubtype: "stalemate",
        subtype: "stalemate",
        subtypeProbability: 0.8,
      }),
      jev("draw", "team", 0.9, "heldout", {
        labelSubtype: "stalemate",
        subtype: "stalemate",
        subtypeProbability: 0.8,
      }),
      jev("clock-time", "clock-time", 0.9, "heldout", {
        labelSubtype: "flag-fall",
        subtype: "other",
        subtypeProbability: 0.6,
      }),
    ];
    expect(subtypePoints(rs)).toEqual([
      { p: 0.8, correct: true },
      { p: 0.6, correct: false },
    ]);
  });
});

describe("統計", () => {
  it("Wilson の下限: 誤りなし 190 件で 0.98 以上（fact-model §5.2）", () => {
    expect(wilsonLowerBound(190, 190)).toBeGreaterThanOrEqual(0.98);
    expect(wilsonLowerBound(150, 150)).toBeLessThan(0.98);
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("百分位", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 0.5)).toBe(50);
    expect(percentile(v, 0.95)).toBe(95);
    expect(percentile([], 0.5)).toBeNaN();
  });

  it("確率の区間（最後の区間は 1 を含む）", () => {
    const rows = reliabilityTable(
      [
        { p: 1, correct: true },
        { p: 0.5, correct: false },
      ],
      [0, 0.5, 1]
    );
    expect(rows.map((r) => r.n)).toEqual([0, 2]);
    expect(rows[1].accuracy).toBe(0.5);
  });

  it("確率の合計のずれ", () => {
    const r = jev("draw", "draw", 0.9);
    const off = {
      ...r,
      probabilities: { ...r.probabilities, draw: 0.93 },
    };
    const d = probabilitySumDrift([r, off]);
    expect(d.n).toBe(2);
    expect(d.maxAbs).toBeCloseTo(0.03, 6);
  });
});

describe("evaluateJev / buildJevCalibration", () => {
  /**
   * 9 カテゴリ × 各 split 20 件。p ≥ 0.8 は正解、p = 0.5 は不正解（各 3 件）。
   * p ≥ 0.5 の正解率 85% → T_prefill = 0.5、T_medium = 0.8
   */
  function dataset(): EvalRecord[] {
    const cats = INCIDENT_CATEGORIES.filter((c) => c !== "fair-play");
    const out: EvalRecord[] = [];
    for (const split of ["tuning", "heldout"] as const)
      for (const c of cats)
        for (let i = 0; i < 20; i++) {
          const wrong = i < 3;
          out.push(
            wrong
              ? jev(c, c === "team" ? "draw" : "team", 0.5, split)
              : jev(c, c, i % 2 ? 0.95 : 0.8, split)
          );
          // Gemini はすべて正解
          out.push({
            ...jev(c, c, 1, split),
            provider: "gemini",
            probabilities: undefined,
            model: "gemini-flash-lite-latest",
          });
        }
    return out;
  }

  it("条件を満たせば受け入れ、しきい値を選ぶ", () => {
    const records = dataset().filter((r) => r.provider === "jev");
    const e = evaluateJev(records);
    expect(e.medium.tuning?.threshold).toBe(0.8);
    expect(e.prefill.tuning?.threshold).toBe(0.5);
    expect(e.medium.confirmed).toBe(true);
    expect(e.prefill.confirmed).toBe(true);
    expect(e.calibratable).toBe(true);
    // Gemini がないと比較できず、受け入れない
    expect(e.checks.find((c) => c.id === "accuracy-vs-gemini")?.pass).toBe(
      false
    );
    expect(e.accepted).toBe(false);
  });

  it("Gemini より 2 ポイントを超えて低ければ不合格", () => {
    const e = evaluateJev(dataset());
    // Jev 85%、Gemini 100%
    expect(e.gemini?.accuracy.heldout).toBe(1);
    expect(e.checks.find((c) => c.id === "accuracy-vs-gemini")?.pass).toBe(
      false
    );
  });

  it("p95 が 1 秒以上なら不合格", () => {
    const records = dataset()
      .filter((r) => r.provider === "jev")
      .map((r) => ({ ...r, latencyMs: 1_500 }));
    expect(
      evaluateJev(records).checks.find((c) => c.id === "latency-p95")?.pass
    ).toBe(false);
  });

  it("較正は有効な形で、presence は空（すべて記載なし）", () => {
    const e = evaluateJev(dataset().filter((r) => r.provider === "jev"));
    const c = buildJevCalibration(
      e,
      { id: "d", version: "1", tuningSize: 180, heldOutSize: 180 },
      "2026-10-10T00:00:00.000Z"
    );
    expect(c).not.toBeNull();
    expect(c?.model).toBe("jev-1.13.0");
    expect(c?.category).toEqual({ medium: 0.8, prefill: 0.5 });
    expect(c?.presence).toEqual({});
    expect(c?.needsTournamentRules).toBeUndefined();
    expect(isValidJevCalibration(c!)).toBe(true);
  });

  it("held-out で確認できなければ較正を作らない", () => {
    const records = dataset()
      .filter((r) => r.provider === "jev")
      .map((r) =>
        r.split === "heldout" && r.predicted === r.label
          ? { ...r, predicted: "team" as const, label: "draw" as const }
          : r
      );
    const e = evaluateJev(records);
    expect(e.medium.confirmed).toBe(false);
    expect(
      buildJevCalibration(
        e,
        { id: "d", version: "1", tuningSize: 1, heldOutSize: 1 },
        "x"
      )
    ).toBeNull();
  });
});
