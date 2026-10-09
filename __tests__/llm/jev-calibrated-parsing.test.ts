import { describe, it, expect } from "vitest";
import {
  INCIDENT_CATEGORIES,
  parseLlmClassification,
} from "@/lib/domain/llm/classification";
import {
  findJevCalibration,
  isValidJevCalibration,
  JEV_CALIBRATIONS,
  type JevCalibration,
} from "@/lib/domain/llm/calibration";
import { parseFactPresence } from "@/lib/domain/llm/presence";
import type { IncidentCategory } from "@/lib/domain/entities";

/**
 * Jev の確率の形の解釈（jev-classifier-design §5.4, fact-model.md §4.3, §5）。
 * しきい値はテスト用の較正から取る（本物の較正は評価 J3 の後）
 */

const MODEL = "jev-test-1.0.0";

const CALIBRATION: JevCalibration = {
  model: MODEL,
  dataset: { id: "test", version: "1", tuningSize: 10, heldOutSize: 10 },
  createdAt: "2026-10-09",
  category: { medium: 0.8, prefill: 0.6 },
  subtype: 0.7,
  needsTournamentRules: 0.9,
  presence: { "im.clock-pressed": 0.95, "im.count": 0.5 },
  metrics: {},
};
const CALS = [CALIBRATION];

/** top のカテゴリに p、残りを 2 番目以降に順に配る（合計 1） */
function probs(
  top: IncidentCategory,
  p: number,
  order: IncidentCategory[] = []
): Record<string, number> {
  const rest = [
    ...order,
    ...INCIDENT_CATEGORIES.filter((c) => c !== top && !order.includes(c)),
  ];
  const out: Record<string, number> = Object.fromEntries(
    INCIDENT_CATEGORIES.map((c) => [c, 0])
  );
  out[top] = p;
  // 残りを減少列で配る（2 番目以降の順位を固定する）
  let remaining = 1 - p;
  rest.forEach((c, i) => {
    const share = i === rest.length - 1 ? remaining : remaining / 2;
    out[c] = Number(share.toFixed(6));
    remaining -= out[c];
  });
  return out;
}

function raw(overrides: Record<string, unknown> = {}) {
  return {
    category: "player-behavior",
    categoryProbabilities: probs("player-behavior", 0.85, [
      "fair-play",
      "tournament-admin",
    ]),
    subtype: null,
    subtypeProbability: null,
    needsTournamentRulesProbability: 0.1,
    provider: "jev",
    ...overrides,
  };
}

const parse = (r: unknown, model: string | undefined = MODEL) =>
  parseLlmClassification(r, { model, calibrations: CALS });

describe("parseLlmClassification – Jev probabilistic shape", () => {
  it("medium and prefill at or above the calibrated thresholds", () => {
    const c = parse(raw());
    expect(c).toMatchObject({
      category: "player-behavior",
      confidence: "medium",
      prefill: true,
      probability: 0.85,
      provider: "jev",
      method: "llm",
      missingInformation: [],
      followUpQuestions: [],
    });
    expect(c?.alternatives).toBeUndefined();
  });

  it.each([
    [0.8, "medium", true],
    [0.79, "low", true],
    [0.6, "low", true],
    [0.59, "low", false],
  ] as const)("p = %s → %s, prefill %s", (p, confidence, prefill) => {
    const c = parse(
      raw({
        categoryProbabilities: probs("player-behavior", p, [
          "fair-play",
          "tournament-admin",
        ]),
      })
    );
    expect(c?.confidence).toBe(confidence);
    expect(c?.prefill).toBe(prefill);
    // 低い・プレフィルしない場合は次の 2 件（category と合わせて上位 3 件）
    expect(c?.alternatives).toEqual(
      confidence === "medium" && prefill
        ? undefined
        : ["fair-play", "tournament-admin"]
    );
  });

  it("prefill false with medium confidence still lists the alternatives", () => {
    const c = parseLlmClassification(
      raw({
        categoryProbabilities: probs("player-behavior", 0.85, ["team", "draw"]),
      }),
      {
        model: MODEL,
        calibrations: [
          { ...CALIBRATION, category: { medium: 0.8, prefill: 0.9 } },
        ],
      }
    );
    expect(c?.confidence).toBe("medium");
    expect(c?.prefill).toBe(false);
    expect(c?.alternatives).toEqual(["team", "draw"]);
  });

  it("uncalibrated model: low, no prefill, top 3 as candidates, subtype hidden", () => {
    for (const model of [undefined, "jev-1.13.0", "jev-latest"]) {
      const c = parseLlmClassification(
        raw({
          category: "clock-time",
          categoryProbabilities: probs("clock-time", 0.99, ["draw", "team"]),
          subtype: "flag-fall",
          subtypeProbability: 0.99,
          needsTournamentRulesProbability: 0.99,
        }),
        { model, calibrations: CALS }
      );
      expect(c).toMatchObject({
        category: "clock-time",
        confidence: "low",
        prefill: false,
        alternatives: ["draw", "team"],
        subtype: undefined,
        // 未較正ではドメインの規則だけ（clock-time は不要）
        needsTournamentRules: false,
      });
    }
  });

  it("never returns high", () => {
    const c = parse(
      raw({
        categoryProbabilities: probs("player-behavior", 1),
        confidence: "high",
      })
    );
    expect(c?.confidence).toBe("medium");
  });

  it("recomputes the argmax and rejects a mismatching category", () => {
    expect(parse(raw({ category: "fair-play" }))).toBeNull();
    // 同率の最大値は category のとおりでよい
    const tie = Object.fromEntries(INCIDENT_CATEGORIES.map((c) => [c, 0]));
    tie["draw"] = 0.5;
    tie["clock-time"] = 0.5;
    expect(
      parse(raw({ category: "clock-time", categoryProbabilities: tie }))
        ?.category
    ).toBe("clock-time");
    expect(
      parse(raw({ category: "draw", categoryProbabilities: tie }))?.category
    ).toBe("draw");
  });

  it.each([
    ["an unknown key", { ...probs("draw", 0.9), cheating: 0 }],
    [
      "a missing category",
      Object.fromEntries(
        Object.entries(probs("draw", 0.9)).filter(([k]) => k !== "team")
      ),
    ],
    ["a sum above 1.02", { ...probs("draw", 0.9), team: 0.05 }],
    ["NaN", { ...probs("draw", 0.9), team: Number.NaN }],
    ["a negative value", { ...probs("draw", 0.9), team: -0.01 }],
    ["a value above 1", { ...probs("draw", 0.9), draw: 1.01 }],
    ["a string value", { ...probs("draw", 0.9), team: "0" }],
    ["an array", [0.9]],
  ])("rejects %s", (_name, categoryProbabilities) => {
    expect(parse(raw({ category: "draw", categoryProbabilities }))).toBeNull();
  });

  it("accepts a sum within ±0.02 (Jev rounds to 2 decimals)", () => {
    const p = probs("draw", 0.9);
    p.team = (p.team as number) + 0.015;
    expect(
      parse(raw({ category: "draw", categoryProbabilities: p }))
    ).not.toBeNull();
  });

  it("rejects a missing category answer, a wrong provider, bad optional probabilities", () => {
    expect(parse(raw({ category: undefined }))).toBeNull();
    expect(parse(raw({ provider: "gemini" }))).toBeNull();
    expect(parse(raw({ subtypeProbability: 1.5 }))).toBeNull();
    expect(
      parse(raw({ needsTournamentRulesProbability: Number.POSITIVE_INFINITY }))
    ).toBeNull();
  });

  it("keeps a known subtype only at or above the subtype threshold", () => {
    const clock = (subtype: string, p: number) =>
      parse(
        raw({
          category: "clock-time",
          categoryProbabilities: probs("clock-time", 0.9),
          subtype,
          subtypeProbability: p,
        })
      )?.subtype;
    expect(clock("flag-fall", 0.7)).toBe("flag-fall");
    expect(clock("flag-fall", 0.69)).toBeUndefined();
    expect(clock("threefold-repetition-claim", 0.99)).toBeUndefined();
  });

  it("needsTournamentRules: the model can add the flag, never remove the domain rule", () => {
    // player-behavior はドメインの規則で常に true
    expect(
      parse(raw({ needsTournamentRulesProbability: 0 }))?.needsTournamentRules
    ).toBe(true);
    const draw = (p: number | null) =>
      parse(
        raw({
          category: "draw",
          categoryProbabilities: probs("draw", 0.9),
          needsTournamentRulesProbability: p,
        })
      )?.needsTournamentRules;
    expect(draw(0.9)).toBe(true);
    expect(draw(0.89)).toBe(false);
    expect(draw(null)).toBe(false);
  });

  it("the legacy Gemini shape still parses (regression)", () => {
    const c = parseLlmClassification(
      { category: "draw", confidence: "low", subtype: "fifty-move-claim" },
      { model: MODEL, calibrations: CALS }
    );
    expect(c).toMatchObject({
      category: "draw",
      confidence: "low",
      subtype: "fifty-move-claim",
      provider: "gemini",
    });
    expect(c?.probability).toBeUndefined();
    expect(c?.prefill).toBeUndefined();
  });
});

describe("Jev calibration registry", () => {
  it("is empty until the evaluation (J3) produces a calibration", () => {
    expect(JEV_CALIBRATIONS).toEqual([]);
    expect(findJevCalibration("jev-1.13.0")).toBeUndefined();
  });

  it("every registered calibration is valid", () => {
    for (const c of JEV_CALIBRATIONS)
      expect(isValidJevCalibration(c)).toBe(true);
  });

  it("ignores invalid calibrations (fails to uncalibrated mode)", () => {
    for (const bad of [
      { ...CALIBRATION, category: { medium: 0, prefill: 0.5 } },
      { ...CALIBRATION, category: { medium: 0.8, prefill: 1.5 } },
      { ...CALIBRATION, subtype: Number.NaN },
      { ...CALIBRATION, presence: { "im.clock-pressed": -1 } },
    ])
      expect(findJevCalibration(MODEL, [bad])).toBeUndefined();
    expect(findJevCalibration(MODEL, CALS)).toBe(CALIBRATION);
    expect(findJevCalibration(undefined, CALS)).toBeUndefined();
  });
});

describe("parseFactPresence", () => {
  const ids = ["im.clock-pressed", "im.opponent-moved"];
  const parsePresence = (r: unknown, model = MODEL) =>
    parseFactPresence(r, {
      model,
      requestedFactIds: ids,
      calibrations: CALS,
    });

  it("present only at or above the fact's threshold", () => {
    expect(
      parsePresence({
        presence: { "im.clock-pressed": 0.95, "im.opponent-moved": 0.99 },
        provider: "jev",
      })
    ).toEqual({
      // im.opponent-moved はしきい値がないため常に missing
      byFact: { "im.clock-pressed": "present", "im.opponent-moved": "missing" },
      calibrated: true,
      valid: true,
    });
    expect(
      parsePresence({ presence: { "im.clock-pressed": 0.94 }, provider: "jev" })
        .byFact["im.clock-pressed"]
    ).toBe("missing");
  });

  it("uncalibrated model → every fact missing", () => {
    const r = parsePresence(
      {
        presence: { "im.clock-pressed": 1, "im.opponent-moved": 1 },
        provider: "jev",
      },
      "jev-1.13.0"
    );
    expect(r.calibrated).toBe(false);
    expect(Object.values(r.byFact)).toEqual(["missing", "missing"]);
  });

  it("a fact that is not presence-checkable is never present, even with a threshold", () => {
    const r = parseFactPresence(
      { presence: { "im.count": 1 }, provider: "jev" },
      { model: MODEL, requestedFactIds: ["im.count"], calibrations: CALS }
    );
    expect(r.byFact["im.count"]).toBe("missing");
  });

  it.each([
    ["an unrequested key", { "im.clock-pressed": 1, "dr.claim-timing": 1 }],
    ["NaN", { "im.clock-pressed": Number.NaN }],
    ["a value above 1", { "im.clock-pressed": 1.2 }],
    ["a string", { "im.clock-pressed": "1" }],
  ])("invalid output (%s) → all missing", (_n, presence) => {
    const r = parsePresence({ presence, provider: "jev" });
    expect(r.valid).toBe(false);
    expect(Object.values(r.byFact)).toEqual(["missing", "missing"]);
  });

  it("not an object or wrong provider → all missing", () => {
    for (const r of [
      null,
      [],
      "x",
      { presence: {}, provider: "gemini" },
      { provider: "jev" },
    ])
      expect(parsePresence(r).valid).toBe(false);
  });

  it("presence never supplies a value: the result is present/missing only", () => {
    const r = parsePresence({
      presence: { "im.clock-pressed": 1 },
      provider: "jev",
    });
    expect(new Set(Object.values(r.byFact))).toEqual(
      new Set(["present", "missing"])
    );
    expect(Object.keys(r.byFact)).toEqual(ids);
  });
});
