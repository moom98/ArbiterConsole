import { describe, it, expect } from "vitest";
import {
  DT_011_ID,
  RecordingObligationTree,
  type RecordingObligationTreeInput,
} from "@/lib/domain/decision-trees/dt-011-recording-obligation";
import { DecisionEngine } from "@/lib/domain/decision-engine";
import { applyIncidentAnswers } from "@/lib/domain/follow-up";
import {
  assessRecordingObligation,
  recordingIncrement,
  timeControlPeriodOptions,
} from "@/lib/domain/services/time-control";
import { requiredFacts } from "@/lib/domain/facts";
import type { Incident, TimeControl } from "@/lib/domain/entities";
import { FIXED_NOW, fixedProviders } from "./helpers";

/** DT-011: 棋譜の記録義務（FIDE 8.1.1 / 8.4。ADR-014 §7） */

const SINGLE_30: TimeControl = {
  periods: [{ minutes: 90, incrementSeconds: 30 }],
};
const SINGLE_0: TimeControl = {
  periods: [{ minutes: 90, incrementSeconds: 0 }],
};
const SINGLE_DELAY: TimeControl = {
  periods: [{ minutes: 90, incrementSeconds: 0 }],
  delaySeconds: 5,
};
/** 40手 / 90分（加算0）→ 残り / 30分（加算30秒）: ピリオドで「30秒以上か」が変わる */
const MIXED: TimeControl = {
  periods: [
    { moves: 40, minutes: 90, incrementSeconds: 0 },
    { minutes: 30, incrementSeconds: 30 },
  ],
};
const INCOMPLETE: TimeControl = { ...SINGLE_0, periodsIncomplete: true };

function run(
  input: Omit<RecordingObligationTreeInput, "issue"> &
    Partial<Pick<RecordingObligationTreeInput, "issue">>
) {
  return new RecordingObligationTree(fixedProviders()).evaluate({
    issue: "not-writing",
    ...input,
  });
}
function ids(r: ReturnType<typeof run>) {
  return r.status === "needs-input" ? r.questions.map((q) => q.id) : [];
}
function articles(r: ReturnType<typeof run>) {
  return r.decision.sources.map((s) => s.article);
}

describe("DT-011 questions", () => {
  it("increment of 30 s or more: no exemption without asking the clock", () => {
    const r = run({ facts: {}, timeControl: SINGLE_30 });
    expect(r.status).toBe("decided");
    expect(r.decision.treeId).toBe(DT_011_ID);
    expect(r.decision.intervention).toBe("immediate");
    expect(r.decision.conclusion).toMatch(/30秒（30秒以上）/);
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE 8.4", "FIDE 8.1.1"])
    );
    expect(r.decision.penalties).toEqual([]);
  });

  it("increment under 30 s: asks the clock and the period history in one round", () => {
    const r = run({ facts: {}, timeControl: SINGLE_0 });
    expect(ids(r)).toEqual([
      "recordingBelowFiveNow",
      "recordingBelowFiveInPeriod",
    ]);
  });

  it("mixed periods: asks the period with options built from the time control", () => {
    const r = run({ facts: {}, timeControl: MIXED });
    expect(ids(r)).toEqual([
      "recordingBelowFiveNow",
      "recordingBelowFiveInPeriod",
      "recordingPeriod",
    ]);
    if (r.status !== "needs-input") throw new Error("expected");
    expect(r.questions[2].options.map((o) => o.label)).toEqual([
      "第1ピリオド（1〜40手目・加算0秒）",
      "第2ピリオド（41手目以降・加算30秒）",
      "わからない・確認できない",
    ]);
  });

  it("no or incomplete time control: asks the increment", () => {
    expect(ids(run({ facts: {} }))).toContain("recordingIncrement");
    expect(ids(run({ facts: {}, timeControl: INCOMPLETE }))).toContain(
      "recordingIncrement"
    );
  });
});

describe("DT-011 decisions", () => {
  it("under 5:00 now with no increment: exempt for the rest of the period", () => {
    const r = run({ facts: { belowFiveNow: true }, timeControl: SINGLE_0 });
    expect(r.status).toBe("decided");
    expect(r.decision.kind).toBe("recommendation");
    expect(r.decision.intervention).toBe("no-intervention");
    expect(r.decision.confidence).toBe("high");
  });

  it("5:00 or more now but below five earlier in the period: still exempt (8.4)", () => {
    const r = run({
      facts: { belowFiveNow: false, belowFiveInPeriod: true },
      timeControl: SINGLE_0,
    });
    expect(r.decision.intervention).toBe("no-intervention");
    expect(r.decision.conclusion).toMatch(/5分以上に戻っていても/);
  });

  it("never below five in the period: recording required", () => {
    const r = run({
      facts: { belowFiveNow: false, belowFiveInPeriod: false },
      timeControl: SINGLE_0,
    });
    expect(r.decision.intervention).toBe("immediate");
    expect(articles(r)).toContain("FIDE 12.9");
  });

  it("a delay never confirms the exemption (consult the CA)", () => {
    const r = run({ facts: { belowFiveNow: true }, timeControl: SINGLE_DELAY });
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.intervention).toBe("consult-ca");
    const answeredDelay = run({
      facts: { belowFiveNow: true, increment: "delay" },
    });
    expect(answeredDelay.decision.kind).toBe("manual-review");
  });

  it("unknown answers lead to the CA, naming what is missing", () => {
    const r = run({
      facts: { belowFiveNow: "unknown", belowFiveInPeriod: "unknown" },
      timeControl: SINGLE_0,
    });
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.missingFields?.join()).toMatch(/5分/);
    const period = run({
      facts: { belowFiveNow: true, period: "unknown" },
      timeControl: MIXED,
    });
    expect(period.decision.kind).toBe("manual-review");
  });

  it("the chosen period decides the increment", () => {
    expect(
      run({ facts: { belowFiveNow: true, period: 1 }, timeControl: MIXED })
        .decision.intervention
    ).toBe("no-intervention");
    expect(
      run({ facts: { belowFiveNow: true, period: 2 }, timeControl: MIXED })
        .decision.intervention
    ).toBe("immediate");
  });

  it("an answered increment (no settings) gives medium confidence", () => {
    const r = run({ facts: { belowFiveNow: true, increment: "below-30" } });
    expect(r.decision.intervention).toBe("no-intervention");
    expect(r.decision.confidence).toBe("medium");
    const req = run({ facts: { increment: "at-least-30" } });
    expect(req.decision.intervention).toBe("immediate");
    expect(req.decision.conclusion).toMatch(/30秒以上のため/);
  });
});

describe("DT-011: behind (8.1.3)", () => {
  it("asks 'only the last moves?' first; the time questions show only for other answers", () => {
    const r = run({ issue: "behind", facts: {}, timeControl: SINGLE_0 });
    expect(ids(r)).toEqual([
      "recordingOnlyLastMoves",
      "recordingBelowFiveNow",
      "recordingBelowFiveInPeriod",
    ]);
    if (r.status !== "needs-input") throw new Error("expected");
    expect(r.questions[1].showWhen).toEqual({
      questionId: "recordingOnlyLastMoves",
      values: ["false", "unknown"],
    });
    // 5分を下回ったかは、残り時間の質問に続く（元の表示条件のまま）
    expect(r.questions[2].showWhen?.questionId).toBe("recordingBelowFiveNow");
    expect(articles(r)).toContain("FIDE 8.1.3");
  });

  it("only the last moves: no violation, even with a 30 s increment", () => {
    const r = run({
      issue: "behind",
      facts: { onlyLastMoves: true },
      timeControl: SINGLE_30,
    });
    expect(r.decision.intervention).toBe("no-intervention");
    expect(articles(r)).toContain("FIDE 8.1.3");
  });

  it("one move behind in 90+30 is never 'intervene immediately'", () => {
    const r = run({ issue: "behind", facts: {}, timeControl: SINGLE_30 });
    expect(ids(r)).toEqual(["recordingOnlyLastMoves"]);
  });

  it("older moves missing and no exemption: recording required", () => {
    const r = run({
      issue: "behind",
      facts: { onlyLastMoves: false },
      timeControl: SINGLE_30,
    });
    expect(r.decision.intervention).toBe("immediate");
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE 8.1.3", "FIDE 12.9"])
    );
  });

  it("unknown which moves are missing and no exemption: consult the CA", () => {
    const r = run({
      issue: "behind",
      facts: { onlyLastMoves: "unknown" },
      timeControl: SINGLE_30,
    });
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.conclusion).toMatch(/8\.1\.3/);
  });

  it("unknown which moves are missing but exempt (8.4): exempt", () => {
    const r = run({
      issue: "behind",
      facts: { onlyLastMoves: "unknown", belowFiveNow: true },
      timeControl: SINGLE_0,
    });
    expect(r.decision.intervention).toBe("no-intervention");
  });
});

describe("DT-011: more cases", () => {
  it("the exempt result names the 8.5 steps", () => {
    const r = run({ facts: { belowFiveNow: true }, timeControl: SINGLE_0 });
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE 8.5.1", "FIDE 8.5.2"])
    );
    expect(r.decision.actions.join()).toMatch(/8\.5\.2/);
  });

  it("never below five in the period: no period or increment question", () => {
    for (const timeControl of [MIXED, undefined]) {
      const r = run({
        facts: { belowFiveNow: false, belowFiveInPeriod: false },
        timeControl,
      });
      expect(r.status).toBe("decided");
      expect(r.decision.intervention).toBe("immediate");
    }
    const unknownNow = run({
      facts: { belowFiveNow: "unknown", belowFiveInPeriod: false },
      timeControl: SINGLE_0,
    });
    expect(unknownNow.decision.intervention).toBe("immediate");
  });

  it("increment boundary from settings: 29 s can be exempt, 30 s cannot", () => {
    const tc = (incrementSeconds: number): TimeControl => ({
      periods: [{ minutes: 90, incrementSeconds }],
    });
    expect(
      run({ facts: { belowFiveNow: true }, timeControl: tc(29) }).decision
        .intervention
    ).toBe("no-intervention");
    expect(
      run({ facts: { belowFiveNow: true }, timeControl: tc(30) }).decision
        .intervention
    ).toBe("immediate");
  });

  it("several periods all under 30 s: the period is not asked", () => {
    const r = run({
      facts: { belowFiveNow: true },
      timeControl: {
        periods: [
          { moves: 40, minutes: 90, incrementSeconds: 10 },
          { minutes: 30, incrementSeconds: 10 },
        ],
      },
    });
    expect(r.decision.intervention).toBe("no-intervention");
  });

  it("a delay with an increment of 30 s or more: recording required", () => {
    const r = run({
      facts: {},
      timeControl: { ...SINGLE_30, delaySeconds: 5 },
    });
    expect(r.decision.intervention).toBe("immediate");
  });

  it("a stored period out of range is asked again", () => {
    const r = run({
      facts: { belowFiveNow: true, period: 7 },
      timeControl: MIXED,
    });
    expect(ids(r)).toContain("recordingPeriod");
  });
});

describe("DT-011 in the engine", () => {
  function incident(overrides: Partial<Incident> = {}): Incident {
    return {
      id: "inc-ss",
      gameId: "g1",
      category: "scoresheet",
      description: "",
      arbiterObserved: true,
      reportedBy: "arbiter",
      reportedAt: FIXED_NOW,
      status: "pending",
      escalatedToCA: false,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      ...overrides,
    };
  }
  const engine = () => new DecisionEngine(fixedProviders());

  it("asks the issue first, then routes not-writing (Standard) to DT-011", () => {
    const ruleset = {
      competitionType: "standard" as const,
      rulesVersion: "FIDE-2023",
      timeControl: SINGLE_0,
    };
    const first = engine().processIncident({ incident: incident(), ruleset });
    expect(first.followUpQuestions.map((q) => q.id)).toEqual([
      "scoresheetIssue",
    ]);

    let inc = applyIncidentAnswers(incident(), {
      scoresheetIssue: "not-writing",
    });
    expect(inc.subtype).toBe("not-writing");
    const second = engine().processIncident({ incident: inc, ruleset });
    expect(second.followUpQuestions.map((q) => q.id)).toContain(
      "recordingBelowFiveNow"
    );

    inc = applyIncidentAnswers(inc, { recordingBelowFiveNow: "true" });
    expect(inc.scoresheetFacts).toEqual({ belowFiveNow: true });
    const third = engine().processIncident({ incident: inc, ruleset });
    expect(third.decision.treeId).toBe(DT_011_ID);
    expect(third.decision.intervention).toBe("no-intervention");
  });

  it("other issues, Rapid and an unknown issue stay outside the tree", () => {
    const standard = {
      competitionType: "standard" as const,
      rulesVersion: "FIDE-2023",
    };
    for (const subtype of ["illegible", "unknown"]) {
      const r = engine().processIncident({
        incident: incident({ subtype }),
        ruleset: standard,
      });
      expect(r.decision.treeId).toBeUndefined();
    }
    const rapid = engine().processIncident({
      incident: incident({ subtype: "behind", description: "遅れている" }),
      ruleset: {
        competitionType: "rapid",
        supervisionRegime: "competition-rules",
        rulesVersion: "FIDE-2023",
      },
    });
    expect(rapid.decision.treeId).toBeUndefined();
  });

  it("Blitz stays outside the tree", () => {
    const r = engine().processIncident({
      incident: incident({
        subtype: "not-writing",
        description: "書いていない",
      }),
      ruleset: {
        competitionType: "blitz",
        supervisionRegime: "competition-rules",
        rulesVersion: "FIDE-2023",
      },
    });
    expect(r.decision.treeId).toBeUndefined();
  });

  it("a stored scoresheet incident with a description but no issue is asked the issue", () => {
    const r = engine().processIncident({
      incident: incident({ description: "棋譜をつけていない" }),
      ruleset: { competitionType: "standard", rulesVersion: "FIDE-2023" },
    });
    expect(r.followUpQuestions.map((q) => q.id)).toEqual(["scoresheetIssue"]);
  });

  it("the period answer is limited to the profile maximum", () => {
    expect(
      applyIncidentAnswers(incident(), { recordingPeriod: "6" }).scoresheetFacts
    ).toBeUndefined();
    expect(
      applyIncidentAnswers(incident(), { recordingPeriod: "5" }).scoresheetFacts
    ).toEqual({ period: 5 });
  });

  it("ignores invalid answers", () => {
    const inc = applyIncidentAnswers(incident(), {
      scoresheetIssue: "lost",
      recordingPeriod: "0",
      recordingIncrement: "lots",
      recordingBelowFiveNow: "maybe",
    });
    expect(inc.subtype).toBeUndefined();
    expect(inc.scoresheetFacts).toBeUndefined();
  });
});

describe("8.4 service helpers", () => {
  it("answer-based inputs work like the measured values", () => {
    expect(
      assessRecordingObligation({
        competitionType: "standard",
        belowFiveNow: true,
        incrementAtLeast30: false,
      }).status
    ).toBe("exempt");
    expect(
      assessRecordingObligation({
        competitionType: "standard",
        incrementAtLeast30: true,
      }).status
    ).toBe("required");
    // 測った値があればそちらを使う
    expect(
      assessRecordingObligation({
        competitionType: "standard",
        remainingSeconds: 300,
        belowFiveNow: true,
        belowFiveInPeriod: false,
        incrementSeconds: 0,
      }).status
    ).toBe("required");
  });

  it("recordingIncrement", () => {
    expect(recordingIncrement(undefined)).toEqual({ status: "ask-increment" });
    expect(recordingIncrement(SINGLE_30)).toEqual({
      status: "known",
      incrementSeconds: 30,
    });
    expect(
      recordingIncrement({
        periods: [
          { moves: 40, minutes: 90, incrementSeconds: 30 },
          { minutes: 30, incrementSeconds: 30 },
        ],
      })
    ).toEqual({ status: "class-known", atLeast30: true });
    expect(recordingIncrement(MIXED)).toEqual({ status: "ask-period" });
    expect(recordingIncrement(MIXED, 9)).toEqual({ status: "ask-period" });
    expect(recordingIncrement(MIXED, "unknown")).toEqual({ status: "unknown" });
  });

  it("period labels for three periods", () => {
    expect(
      timeControlPeriodOptions({
        periods: [
          { moves: 40, minutes: 90, incrementSeconds: 30 },
          { moves: 20, minutes: 60, incrementSeconds: 30 },
          { minutes: 15, incrementSeconds: 30 },
        ],
      }).map((o) => o.label)
    ).toEqual([
      "第1ピリオド（1〜40手目・加算30秒）",
      "第2ピリオド（41〜60手目・加算30秒）",
      "第3ピリオド（61手目以降・加算30秒）",
    ]);
  });
});

describe("game.record-state is a record-only fact", () => {
  it("is marked recordOnly; others are not", () => {
    const facts = requiredFacts({
      category: "illegal-move",
      subtype: "illegal-move",
      answers: { "game.end-event": { value: "resignation" } },
      context: {},
    } as never);
    const rs = facts.find((f) => f.definition.id === "game.record-state");
    expect(rs?.recordOnly).toBe(true);
    expect(
      facts.filter((f) => f.recordOnly).map((f) => f.definition.id)
    ).toEqual(["game.record-state"]);
  });
});
