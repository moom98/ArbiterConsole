import { describe, expect, it } from "vitest";
import type { IncidentCategory } from "@/lib/domain/entities";
import {
  INCIDENT_CATEGORIES,
  parseLlmClassification,
} from "@/lib/domain/llm/classification";
import { parseFactPresence } from "@/lib/domain/llm/presence";
import { isValidJevCalibration } from "@/lib/domain/llm/calibration";
import {
  buildJevCalibration,
  chooseThreshold,
  evaluateAcceptance,
  fitCategory,
  fitPresence,
  fitThreshold,
  percentile,
  presenceLevel,
  statsAt,
  summarizeClassification,
  toClassificationObservation,
  wilsonLowerBound,
  type ClassificationObservation,
  type ClassificationRecord,
  type EvalSplit,
  type PresenceRecord,
  type ScoredPoint,
} from "@/lib/domain/llm/calibration/fit";

const MODEL = "jev-1.13.0";

/** カテゴリ c に確率 p、残りを均等に配った Jev の raw */
function jevRaw(
  c: IncidentCategory,
  p: number,
  extra: Record<string, unknown> = {},
  second?: IncidentCategory
): Record<string, unknown> {
  const others = INCIDENT_CATEGORIES.filter((x) => x !== c);
  const probs: Record<string, number> = {};
  const rest = 1 - p;
  for (const o of others) probs[o] = second ? 0 : rest / others.length;
  if (second) probs[second] = rest;
  probs[c] = p;
  return {
    category: c,
    categoryProbabilities: probs,
    subtype: null,
    subtypeProbability: null,
    needsTournamentRulesProbability: null,
    provider: "jev",
    ...extra,
  };
}

function record(
  i: number,
  split: EvalSplit,
  label: IncidentCategory,
  predicted: IncidentCategory,
  p: number,
  extra: Partial<ClassificationRecord> = {}
): ClassificationRecord {
  return {
    caseId: `c${i}`,
    split,
    label,
    model: MODEL,
    raw: jevRaw(predicted, p),
    latencyMs: 300,
    ...extra,
  };
}

const observe = (records: ClassificationRecord[]) =>
  records
    .map((r) => toClassificationObservation(r, "jev"))
    .filter((o): o is ClassificationObservation => o !== undefined);

describe("statistics", () => {
  it("wilsonLowerBound matches known values", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    // 190/190 → 約 0.980（fact-model §5.2: blocking に必要な件数）
    expect(wilsonLowerBound(190, 190)).toBeGreaterThanOrEqual(0.98);
    expect(wilsonLowerBound(180, 180)).toBeLessThan(0.98);
    // 125/125 → 約 0.970（その他）
    expect(wilsonLowerBound(125, 125)).toBeGreaterThanOrEqual(0.97);
    expect(wilsonLowerBound(115, 115)).toBeLessThan(0.97);
    expect(wilsonLowerBound(8, 10)).toBeCloseTo(0.49, 2);
  });

  it("percentile uses the nearest rank", () => {
    expect(percentile([], 0.5)).toBeUndefined();
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(
      percentile(
        Array.from({ length: 100 }, (_, i) => i + 1),
        0.95
      )
    ).toBe(95);
  });
});

describe("chooseThreshold", () => {
  const pts = (pairs: [number, boolean][]): ScoredPoint[] =>
    pairs.map(([p, correct]) => ({ p, correct }));

  it("picks the lowest observed p that reaches the target", () => {
    const points = pts([
      [0.3, false],
      [0.5, true],
      [0.6, true],
      [0.7, true],
      [0.9, true],
    ]);
    expect(chooseThreshold(points, { target: 0.85 })?.threshold).toBe(0.5);
    expect(chooseThreshold(points, { target: 0.8 })?.threshold).toBe(0.3);
  });

  it("checks every candidate (precision is not monotone in t)", () => {
    const points = pts([
      [0.4, true],
      [0.5, true],
      [0.6, false],
      [0.7, true],
    ]);
    // t=0.4: 3/4、t=0.5: 2/3、t=0.6: 1/2、t=0.7: 1/1
    expect(chooseThreshold(points, { target: 0.75 })?.threshold).toBe(0.4);
    expect(chooseThreshold(points, { target: 0.9 })?.threshold).toBe(0.7);
  });

  it("respects minSupport and minWilson", () => {
    const points = pts([
      [0.9, true],
      [0.95, true],
    ]);
    expect(chooseThreshold(points, { target: 0.9, minSupport: 3 })).toBe(
      undefined
    );
    expect(
      chooseThreshold(points, { target: 0.9, minWilson: 0.9 })
    ).toBeUndefined();
  });

  it("never chooses 0 as a threshold", () => {
    expect(chooseThreshold(pts([[0, true]]), { target: 0.5 })).toBeUndefined();
  });

  it("fitThreshold rejects a threshold the held-out set does not confirm", () => {
    const tuning = pts([
      [0.8, true],
      [0.9, true],
    ]);
    const heldOut = pts([
      [0.85, false],
      [0.95, true],
    ]);
    const fit = fitThreshold(tuning, heldOut, {
      tuning: { target: 0.9 },
      heldOut: { target: 0.9 },
    });
    expect(fit.tuning?.threshold).toBe(0.8);
    expect(fit.heldOut?.precision).toBe(0.5);
    expect(fit.accepted).toBe(false);
    expect(statsAt(heldOut, 0.9).precision).toBe(1);
  });
});

describe("toClassificationObservation", () => {
  it("skips reports the guard held back", () => {
    expect(
      toClassificationObservation(
        { caseId: "a", split: "tuning", label: "draw", notSent: "gate-raw" },
        "jev"
      )
    ).toBeUndefined();
  });

  it("counts transport errors and invalid output as invalid (keyword fallback)", () => {
    const err = toClassificationObservation(
      { caseId: "a", split: "tuning", label: "draw", error: "UpstreamError" },
      "jev"
    );
    expect(err?.valid).toBe(false);
    const bad = jevRaw("draw", 0.9);
    (bad.categoryProbabilities as Record<string, number>).draw = 0.95; // sum 1.05
    const o = toClassificationObservation(
      { caseId: "b", split: "tuning", label: "draw", model: MODEL, raw: bad },
      "jev"
    );
    expect(o?.valid).toBe(false);
    expect(o?.probabilitySum).toBeCloseTo(1.05);
  });

  it("recomputes the category the same way as the domain and records the runner-up", () => {
    const o = toClassificationObservation(
      {
        caseId: "a",
        split: "held-out",
        label: "clock-time",
        labelSubtype: "flag-fall",
        model: MODEL,
        raw: jevRaw(
          "clock-time",
          0.7,
          { subtype: "flag-fall", subtypeProbability: 0.8 },
          "draw"
        ),
      },
      "jev"
    );
    expect(o).toMatchObject({
      valid: true,
      predicted: "clock-time",
      probability: 0.7,
      second: "draw",
      subtype: "flag-fall",
      subtypeProbability: 0.8,
    });
  });

  it("rejects output from the other provider", () => {
    const o = toClassificationObservation(
      {
        caseId: "a",
        split: "tuning",
        label: "draw",
        model: "gemini-flash-lite-latest",
        raw: { category: "draw", confidence: "medium" },
      },
      "jev"
    );
    expect(o?.valid).toBe(false);
    const g = toClassificationObservation(
      {
        caseId: "a",
        split: "tuning",
        label: "draw",
        model: "gemini-flash-lite-latest",
        raw: { category: "draw", confidence: "medium" },
      },
      "gemini"
    );
    expect(g).toMatchObject({ valid: true, predicted: "draw" });
    expect(g?.probability).toBeUndefined();
  });
});

describe("summarizeClassification", () => {
  it("reports accuracy, top-2, per category, latency and probability sums", () => {
    const records = [
      record(1, "held-out", "draw", "draw", 0.9),
      record(2, "held-out", "draw", "scoresheet", 0.5),
      record(3, "held-out", "team", "team", 0.95, { latencyMs: 900 }),
      {
        caseId: "x",
        split: "held-out" as const,
        label: "team" as const,
        error: "UpstreamError",
      },
    ];
    records[1].raw = jevRaw("scoresheet", 0.5, {}, "draw");
    const s = summarizeClassification(observe(records), "jev");
    expect(s.n).toBe(4);
    expect(s.invalid).toBe(1);
    expect(s.accuracy).toBe(0.5);
    expect(s.top2Accuracy).toBe(0.75);
    expect(s.perCategory.draw).toEqual({ n: 2, correct: 1, accuracy: 0.5 });
    expect(s.perCategory.team).toEqual({ n: 2, correct: 1, accuracy: 0.5 });
    expect(s.latency.p95).toBe(900);
    expect(s.probabilitySum?.outsideTolerance).toBe(0);
    const bucket9 = s.reliability!.find((b) => b.from === 0.9)!;
    expect(bucket9).toMatchObject({ n: 2, accuracy: 1 });
  });
});

/** tuning・held-out に n 件ずつ、p ≥ 0.7 は正解、p < 0.7 は4件に1件が誤り */
function syntheticRun(n: number): ClassificationRecord[] {
  const out: ClassificationRecord[] = [];
  let i = 0;
  for (const split of ["tuning", "held-out"] as const) {
    for (let k = 0; k < n; k++) {
      const p = 0.4 + (0.59 * k) / (n - 1);
      const correct = p >= 0.7 || k % 4 !== 0;
      out.push(
        record(
          i++,
          split,
          "draw",
          correct ? "draw" : "team",
          Number(p.toFixed(3))
        )
      );
    }
  }
  return out;
}

describe("fitCategory and buildJevCalibration", () => {
  const obs = observe(syntheticRun(60));
  const category = fitCategory(obs);

  it("chooses medium and prefill on tuning and confirms them on held-out", () => {
    expect(category.medium.accepted).toBe(true);
    expect(category.prefill.accepted).toBe(true);
    expect(category.medium.tuning!.threshold).toBeGreaterThanOrEqual(
      category.prefill.tuning!.threshold
    );
    expect(category.medium.heldOut!.precision).toBeGreaterThanOrEqual(0.9);
    // subtype のデータがない → しきい値なし
    expect(category.subtype.accepted).toBe(false);
  });

  it("builds a calibration that the domain parser accepts", () => {
    const calibration = buildJevCalibration({
      model: MODEL,
      dataset: { id: "classification-eval.ja", version: "1" },
      createdAt: "2026-10-09T00:00:00.000Z",
      observations: obs,
      category,
      presence: [],
    })!;
    expect(isValidJevCalibration(calibration)).toBe(true);
    expect(calibration.subtype).toBeUndefined();
    expect(calibration.needsTournamentRules).toBeUndefined();
    expect(calibration.dataset).toMatchObject({
      tuningSize: 60,
      heldOutSize: 60,
    });
    const parsed = parseLlmClassification(jevRaw("draw", 0.99), {
      model: MODEL,
      calibrations: [calibration],
    });
    expect(parsed).toMatchObject({ confidence: "medium", prefill: true });
    const below =
      Math.min(calibration.category.prefill, calibration.category.medium) -
      0.01;
    const low = parseLlmClassification(jevRaw("draw", below), {
      model: MODEL,
      calibrations: [calibration],
    });
    expect(low).toMatchObject({ confidence: "low", prefill: false });
  });

  it("builds no calibration when held-out does not confirm medium", () => {
    // held-out はすべて誤り
    const records = syntheticRun(60).map((r) =>
      r.split === "held-out" ? { ...r, raw: jevRaw("team", 0.95) } : r
    );
    const o = observe(records);
    const fit = fitCategory(o);
    expect(fit.medium.accepted).toBe(false);
    expect(
      buildJevCalibration({
        model: MODEL,
        dataset: { id: "d", version: "1" },
        createdAt: "x",
        observations: o,
        category: fit,
        presence: [],
      })
    ).toBeUndefined();
  });

  it("fits a subtype threshold only from cases whose category was right", () => {
    const records: ClassificationRecord[] = [];
    let i = 0;
    for (const split of ["tuning", "held-out"] as const)
      for (let k = 0; k < 20; k++)
        records.push({
          caseId: `s${i++}`,
          split,
          label: "draw",
          labelSubtype: "agreement",
          model: MODEL,
          raw: jevRaw("draw", 0.9, {
            subtype: k < 3 ? "stalemate" : "agreement",
            subtypeProbability: k < 3 ? 0.5 : 0.8,
          }),
        });
    const fit = fitCategory(observe(records));
    expect(fit.subtype.accepted).toBe(true);
    expect(fit.subtype.tuning!.threshold).toBe(0.8);
  });
});

describe("fitPresence", () => {
  const presenceRecords = (
    factId: string,
    split: EvalSplit,
    present: number,
    absent: number,
    pPresent = 0.97,
    pAbsent = 0.05
  ): PresenceRecord[] => [
    ...Array.from({ length: present }, (_, i) => ({
      caseId: `${factId}-${split}-p${i}`,
      split,
      factId,
      present: true,
      kind: "explicit",
      model: MODEL,
      p: pPresent,
    })),
    ...Array.from({ length: absent }, (_, i) => ({
      caseId: `${factId}-${split}-a${i}`,
      split,
      factId,
      present: false,
      kind: "absent",
      model: MODEL,
      p: pAbsent,
    })),
  ];

  it("uses the blocking target when any usage is blocking", () => {
    expect(presenceLevel("im.action")).toBe("blocking");
    expect(presenceLevel("game.record-state")).toBe("other");
  });

  it("needs about 190 clean present predictions for a blocking fact", () => {
    const enough = fitPresence([
      ...presenceRecords("im.action", "tuning", 200, 200),
      ...presenceRecords("im.action", "held-out", 50, 50),
    ])[0];
    expect(enough.accepted).toBe(true);
    expect(enough.tuning!.threshold).toBe(0.97);
    expect(enough.heldOutRecall).toBe(1);

    const tooFew = fitPresence([
      ...presenceRecords("im.action", "tuning", 150, 150),
      ...presenceRecords("im.action", "held-out", 50, 50),
    ])[0];
    expect(tooFew.accepted).toBe(false);
    expect(tooFew.tuning).toBeUndefined();
  });

  it("rejects a fact with a false 'present' on held-out", () => {
    const records = [
      ...presenceRecords("im.action", "tuning", 200, 200),
      ...presenceRecords("im.action", "held-out", 50, 50),
    ];
    // held-out の「記載なし」の1件が高い確率
    const absent = records.find((r) => r.split === "held-out" && !r.present)!;
    absent.p = 0.99;
    const fit = fitPresence(records)[0];
    expect(fit.tuning?.threshold).toBe(0.97);
    expect(fit.accepted).toBe(false);
  });

  it("treats a missing answer as missing and skips reports that were not sent", () => {
    const records = [
      ...presenceRecords("game.record-state", "tuning", 130, 10),
      ...presenceRecords("game.record-state", "held-out", 20, 5),
      {
        caseId: "x1",
        split: "tuning" as const,
        factId: "game.record-state",
        present: false,
        kind: "near-miss",
        error: "UpstreamError",
      },
      {
        caseId: "x2",
        split: "tuning" as const,
        factId: "game.record-state",
        present: true,
        kind: "explicit",
        notSent: "gate-raw",
      },
    ];
    const fit = fitPresence(records)[0];
    expect(fit.level).toBe("other");
    expect(fit.accepted).toBe(true);
    expect(fit.notSent).toBe(1);
    expect(fit.counts.tuning).toEqual({ n: 141, present: 130 });
  });

  it("puts only accepted facts into the calibration, and parseFactPresence uses them", () => {
    const presence = fitPresence([
      ...presenceRecords("im.action", "tuning", 200, 200),
      ...presenceRecords("im.action", "held-out", 50, 50),
      ...presenceRecords("im.noticed-by", "tuning", 20, 20),
      ...presenceRecords("im.noticed-by", "held-out", 5, 5),
    ]);
    const obs = observe(syntheticRun(60));
    const calibration = buildJevCalibration({
      model: MODEL,
      dataset: { id: "c", version: "1" },
      presenceDataset: { id: "p", version: "2" },
      createdAt: "x",
      observations: obs,
      category: fitCategory(obs),
      presence,
    })!;
    expect(calibration.presence).toEqual({ "im.action": 0.97 });
    expect(calibration.dataset).toMatchObject({ id: "c+p", version: "1+2" });
    expect(calibration.metrics["presence.im.action.heldOutPrecision"]).toBe(1);
    const parsed = parseFactPresence(
      {
        presence: { "im.action": 0.98, "im.noticed-by": 0.99 },
        provider: "jev",
      },
      {
        model: MODEL,
        requestedFactIds: ["im.action", "im.noticed-by"],
        calibrations: [calibration],
      }
    );
    expect(parsed.byFact).toEqual({
      "im.action": "present",
      "im.noticed-by": "missing",
    });
  });
});

describe("evaluateAcceptance", () => {
  const obs = observe(syntheticRun(60));
  const heldOut = obs.filter((o) => o.split === "held-out");
  const jev = summarizeClassification(heldOut, "jev");
  const category = fitCategory(obs);

  it("fails without a Gemini comparison", () => {
    const r = evaluateAcceptance({
      jevHeldOut: jev,
      category,
      jevModels: [MODEL],
    });
    expect(r.accepted).toBe(false);
    expect(r.items.find((i) => i.id === "accuracy-vs-gemini")).toMatchObject({
      pass: false,
      notEvaluated: true,
    });
  });

  it("passes when every item holds and fails on a 2-point drop, latency or several models", () => {
    const gemini = { ...jev, accuracy: jev.accuracy + 0.02 };
    const ok = evaluateAcceptance({
      jevHeldOut: jev,
      geminiHeldOut: gemini,
      category,
      jevModels: [MODEL],
    });
    expect(ok.items.filter((i) => !i.pass)).toEqual([]);
    expect(ok.accepted).toBe(true);

    expect(
      evaluateAcceptance({
        jevHeldOut: jev,
        geminiHeldOut: { ...jev, accuracy: jev.accuracy + 0.03 },
        category,
        jevModels: [MODEL],
      }).accepted
    ).toBe(false);
    expect(
      evaluateAcceptance({
        jevHeldOut: { ...jev, latency: { p95: 1000 } },
        geminiHeldOut: gemini,
        category,
        jevModels: [MODEL],
      }).items.find((i) => i.id === "latency")?.pass
    ).toBe(false);
    expect(
      evaluateAcceptance({
        jevHeldOut: jev,
        geminiHeldOut: gemini,
        category,
        jevModels: [MODEL, "jev-1.14.0"],
      }).accepted
    ).toBe(false);
  });

  it("fails when a category is below 80% on held-out", () => {
    const r = evaluateAcceptance({
      jevHeldOut: {
        ...jev,
        perCategory: {
          ...jev.perCategory,
          team: { n: 10, correct: 7, accuracy: 0.7 },
        },
      },
      geminiHeldOut: jev,
      category,
      jevModels: [MODEL],
    });
    expect(r.items.find((i) => i.id === "per-category")).toMatchObject({
      pass: false,
    });
    expect(r.items.find((i) => i.id === "per-category")?.detail).toContain(
      "team 70.0%"
    );
  });
});
