import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import classificationDataset from "../fixtures/classification-eval.ja.json";
import presenceDataset from "../fixtures/presence-eval.ja.json";
import {
  EVAL_CATEGORIES,
  deidentifyEvalText,
  runClassificationEval,
  runPresenceEval,
  summarizeDeidentification,
  validateClassificationDataset,
  validatePresenceDataset,
  type ClassificationEvalDataset,
  type PresenceEvalDataset,
} from "@/lib/application/classifier-evaluation";
import { INCIDENT_CATEGORIES } from "@/lib/domain/llm/classification";
import { isValidJevCalibration } from "@/lib/domain/llm/calibration";
import {
  CLASSIFICATION_DATASET,
  PRESENCE_DATASET,
  main,
  type EvalDeps,
} from "@/scripts/eval/eval-classifier";

const IDS = {
  players: [{ name: "山田太郎" }],
  tournaments: [],
  venues: [],
  officials: [],
};

const tiny: ClassificationEvalDataset = {
  id: "tiny",
  version: "1",
  identifiers: IDS,
  cases: [
    {
      id: "a",
      split: "tuning",
      category: "illegal-move",
      text: "山田太郎が両手でキャスリングして時計を押した",
    },
    {
      id: "b",
      split: "held-out",
      category: "clock-time",
      subtype: "flag-fall",
      text: "白のフラッグが落ちた",
    },
  ],
};

describe("dataset validation", () => {
  it("reports missing categories, splits, bad subtypes and duplicate ids", () => {
    const errors = validateClassificationDataset({
      ...tiny,
      cases: [
        ...tiny.cases,
        { ...tiny.cases[0] },
        {
          id: "c",
          split: "tuning",
          category: "draw",
          subtype: "flag-fall",
          text: "x",
        },
        { id: "d", split: "tuning", category: "fair-play", text: "x" },
      ],
    });
    expect(errors).toContain("case id の重複: a");
    expect(errors).toContain("c: subtype flag-fall は draw にない");
    expect(errors).toContain("d: 評価できないカテゴリ fair-play");
    expect(errors).toContain("team: tuning の報告がない");
    expect(errors.some((e) => e.startsWith("illegal-move:"))).toBe(true);
  });

  it("rejects presence cases for facts that may not be sent", () => {
    const errors = validatePresenceDataset({
      id: "p",
      version: "1",
      identifiers: IDS,
      cases: [
        {
          id: "1",
          split: "tuning",
          factId: "game.history",
          kind: "explicit",
          text: "x",
        },
        {
          id: "2",
          split: "tuning",
          factId: "im.action",
          kind: "maybe" as never,
          text: "x",
        },
      ],
    });
    expect(errors).toContain("1: 判定できない fact game.history");
    expect(errors).toContain("2: kind が不正");
  });
});

describe("the committed datasets", () => {
  const cls = classificationDataset as ClassificationEvalDataset;

  it("classification: at least 15 labelled reports per category in both splits (§9.1)", () => {
    expect(validateClassificationDataset(cls)).toEqual([]);
    expect(EVAL_CATEGORIES).not.toContain("fair-play");
    expect(EVAL_CATEGORIES).toHaveLength(INCIDENT_CATEGORIES.length - 1);
  });

  it("classification: every report passes the production guard (synthetic, de-identified)", () => {
    const summary = summarizeDeidentification(
      cls.cases,
      cls.identifiers,
      (c) => c.category
    );
    const held = Object.entries(summary).filter(([, v]) => v.notSent > 0);
    expect(held).toEqual([]);
  });

  it("classification: registered names are replaced before sending", () => {
    const named = cls.cases.filter((c) =>
      cls.identifiers.players.some((p) => c.text.includes(p.name))
    );
    expect(named.length).toBeGreaterThan(0);
    for (const c of named) {
      const d = deidentifyEvalText(c.text, cls.identifiers);
      expect(d.ok).toBe(true);
      if (d.ok)
        for (const p of cls.identifiers.players)
          expect(d.narrative).not.toContain(p.name);
    }
  });

  it("presence: valid (a seed set; facts without enough data stay always missing)", () => {
    expect(
      validatePresenceDataset(presenceDataset as PresenceEvalDataset)
    ).toEqual([]);
  });
});

describe("runClassificationEval", () => {
  it("sends only the de-identified narrative and records model, raw output and latency", async () => {
    let t = 0;
    const sent: string[] = [];
    const records = await runClassificationEval(
      tiny,
      async (narrative) => {
        sent.push(narrative);
        t += 120;
        return { ok: true, raw: { r: narrative.length }, model: "jev-1.13.0" };
      },
      { now: () => t }
    );
    expect(sent[0]).toContain("〈選手A〉");
    expect(sent.join()).not.toContain("山田");
    expect(records[0]).toMatchObject({
      caseId: "a",
      split: "tuning",
      label: "illegal-move",
      model: "jev-1.13.0",
      latencyMs: 120,
    });
    expect(records[1]).toMatchObject({ labelSubtype: "flag-fall" });
    expect(JSON.stringify(records)).not.toContain("キャスリング");
  });

  it("does not send reports the guard holds back, and records failures", async () => {
    const classify = vi.fn(async () => {
      throw new TypeError("network");
    });
    const records = await runClassificationEval(
      {
        ...tiny,
        cases: [
          ...tiny.cases,
          {
            id: "s",
            split: "tuning",
            category: "player-behavior",
            text: "黒が対局中にカンニングを疑われた",
          },
        ],
      },
      classify
    );
    expect(records[2].notSent).toBeDefined();
    expect(classify).toHaveBeenCalledTimes(2);
    expect(records[0].error).toBe("TypeError");
  });
});

describe("runPresenceEval", () => {
  it("asks all facts of one report in one request", async () => {
    const ds: PresenceEvalDataset = {
      id: "p",
      version: "1",
      identifiers: IDS,
      cases: [
        {
          id: "1",
          split: "tuning",
          factId: "im.action",
          kind: "explicit",
          text: "白が両手でキャスリングした",
        },
        {
          id: "2",
          split: "tuning",
          factId: "im.noticed-by",
          kind: "absent",
          text: "白が両手でキャスリングした",
        },
        {
          id: "3",
          split: "held-out",
          factId: "im.action",
          kind: "near-miss",
          text: "黒が違法手を指した",
        },
      ],
    };
    const calls: string[][] = [];
    const records = await runPresenceEval(ds, async (_n, factIds) => {
      calls.push([...factIds]);
      return { ok: true, presence: { "im.action": 0.9 }, model: "jev-1.13.0" };
    });
    expect(calls).toEqual([["im.action", "im.noticed-by"], ["im.action"]]);
    expect(records.map((r) => [r.caseId, r.present, r.p])).toEqual([
      ["1", true, 0.9],
      ["2", false, undefined],
      ["3", false, 0.9],
    ]);
  });
});

/** Jev の応答（カテゴリは報告のラベルどおり、確率 0.91） */
function fakeJevFetch(labels: Map<string, string>): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const narrative: string = body.state.deidentified_incident;
    const questions = Object.keys(body.questions);
    const answers: Record<string, unknown> = {};
    if (questions.includes("category")) {
      const label = labels.get(narrative) ?? "team";
      const probabilities = Object.fromEntries(
        INCIDENT_CATEGORIES.map((c) => [c, c === label ? 0.91 : 0.01])
      );
      answers.category = { type: "choice", choice: label, probabilities };
    } else {
      for (const q of questions) answers[q] = { type: "noul", noul: 0.1 };
    }
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

describe("scripts/eval/eval-classifier main", () => {
  function setup() {
    const root = mkdtempSync(join(tmpdir(), "arbiter-eval-"));
    mkdirSync(join(root, "__tests__/fixtures"), { recursive: true });
    writeFileSync(
      join(root, CLASSIFICATION_DATASET),
      JSON.stringify(classificationDataset)
    );
    writeFileSync(
      join(root, PRESENCE_DATASET),
      JSON.stringify(presenceDataset)
    );
    const cls = classificationDataset as ClassificationEvalDataset;
    const labels = new Map<string, string>();
    for (const c of cls.cases) {
      const d = deidentifyEvalText(c.text, cls.identifiers);
      if (d.ok) labels.set(d.narrative, c.category);
    }
    const log: string[] = [];
    let clock = Date.parse("2026-10-09T00:00:00Z");
    const deps: EvalDeps = {
      root,
      fetch: fakeJevFetch(labels),
      runPrivacyCheck: () => true,
      readKey: () => "test-key",
      env: {},
      now: () => new Date((clock += 1000)),
      log: (l) => log.push(l),
    };
    return { root, deps, log };
  }

  it("check validates the datasets without any network call", async () => {
    const { deps, log } = setup();
    const fetchSpy = vi.fn();
    expect(await main(["check"], { ...deps, fetch: fetchSpy })).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.some((l) => l.startsWith("ERROR"))).toBe(false);
  });

  it("run refuses to send when the privacy check fails", async () => {
    const { deps } = setup();
    const fetchSpy = vi.fn();
    expect(
      await main(["run", "--provider", "jev"], {
        ...deps,
        fetch: fetchSpy,
        runPrivacyCheck: () => false,
      })
    ).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("run → fit writes results without report text, a report and a valid calibration", async () => {
    const { root, deps } = setup();
    expect(await main(["run", "--provider", "jev"], deps)).toBe(0);
    expect(
      await main(["run", "--provider", "jev", "--set", "presence"], deps)
    ).toBe(0);
    const resultsDir = join(root, "docs/progress/eval/results");
    const files = readdirSync(resultsDir).sort();
    const cls = files.find((f) => f.startsWith("classification-jev"))!;
    const pres = files.find((f) => f.startsWith("presence-jev"))!;
    const raw = readFileSync(join(resultsDir, cls), "utf8");
    expect(raw).not.toContain("〈選手");
    expect(raw).not.toContain("時計");
    expect(JSON.parse(raw).models).toEqual(["jev-1.13.0"]);

    expect(
      await main(
        [
          "fit",
          "--jev",
          `docs/progress/eval/results/${cls}`,
          "--presence",
          `docs/progress/eval/results/${pres}`,
        ],
        deps
      )
    ).toBe(0);
    const report = readFileSync(
      join(root, "docs/progress/eval/classifier-eval-jev-1.13.0.md"),
      "utf8"
    );
    // Gemini の結果がないため不合格（比較できない）
    expect(report).toContain("**Acceptance (§9.3): FAIL**");
    expect(report).toContain("| accuracy-vs-gemini | not evaluated |");
    const calibration = JSON.parse(
      readFileSync(
        join(root, "lib/domain/llm/calibration/jev-1.13.0.json"),
        "utf8"
      )
    );
    expect(isValidJevCalibration(calibration)).toBe(true);
    expect(calibration.category).toEqual({ medium: 0.91, prefill: 0.91 });
    // presence は 0.1 しか返さない → しきい値なし
    expect(calibration.presence).toEqual({});
  });

  it("presence is evaluated for Jev only", async () => {
    const { deps } = setup();
    expect(
      await main(["run", "--provider", "gemini", "--set", "presence"], deps)
    ).toBe(2);
  });
});
