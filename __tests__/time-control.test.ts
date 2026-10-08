import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, it, expect } from "vitest";
import {
  assessRecordingObligation,
  buildTimeControl,
  currentPeriod,
  deriveTimeControlFacts,
  lastPeriodFromTimeControl,
  normalizeTimeControl,
  validateTimeControl,
} from "@/lib/domain/services/time-control";
import {
  buildTournament,
  formatTimeControl,
  toProfileInput,
  type TournamentProfileInput,
} from "@/lib/domain/services/tournament-profile";
import { deriveRulesetFromTournament } from "@/lib/domain/services/game-context";
import {
  DecisionEngine,
  type RulesetContext,
} from "@/lib/domain/decision-engine";
import type { Incident, TimeControl, Tournament } from "@/lib/domain/entities";
import {
  applyIncidentAnswers,
  QUESTIONS,
  type IncidentQuestionId,
} from "@/lib/domain/follow-up";
import { ArbiterDatabase } from "@/lib/infrastructure/db/schema";
import { chessJsPositionPort } from "@/lib/infrastructure/chess/chess-js-position-port";
import { fixedProviders, FIXED_NOW } from "./helpers";

/** 40手90分 → 残り30分、全ピリオド30秒加算 */
const CLASSICAL: TimeControl = {
  periods: [
    { moves: 40, minutes: 90, incrementSeconds: 30 },
    { minutes: 30, incrementSeconds: 30 },
  ],
};
/** 40手120分 → 20手60分 → 残り15分、加算なし */
const THREE_NO_INC: TimeControl = {
  periods: [
    { moves: 40, minutes: 120, incrementSeconds: 0 },
    { moves: 20, minutes: 60, incrementSeconds: 0 },
    { minutes: 15, incrementSeconds: 0 },
  ],
};
const SINGLE: TimeControl = { periods: [{ minutes: 60, incrementSeconds: 0 }] };

describe("validateTimeControl", () => {
  it("accepts a single period and multi-period controls", () => {
    expect(validateTimeControl(SINGLE)).toEqual([]);
    expect(validateTimeControl(CLASSICAL)).toEqual([]);
    expect(validateTimeControl(THREE_NO_INC)).toEqual([]);
  });

  it("requires at least one period", () => {
    expect(validateTimeControl(undefined)).toContain(
      "持ち時間（分）は1以上の整数で入力してください"
    );
    expect(validateTimeControl({ periods: [] }).length).toBeGreaterThan(0);
  });

  it("requires moves on every period except the last, and none on the last", () => {
    expect(
      validateTimeControl({
        periods: [
          { minutes: 90, incrementSeconds: 30 },
          { minutes: 30, incrementSeconds: 30 },
        ],
      })
    ).toContain("第1ピリオドの手数は1以上の整数で入力してください");
    expect(
      validateTimeControl({
        periods: [{ moves: 40, minutes: 90, incrementSeconds: 30 }],
      })
    ).toContain(
      "最後のピリオドは残りの全ての手を指すため、手数を入力しないでください"
    );
  });

  it("rejects bad minutes, increments, delays and too many periods", () => {
    const e = validateTimeControl({
      periods: [
        { moves: 40, minutes: 0, incrementSeconds: -1 },
        { minutes: 1.5, incrementSeconds: 0 },
      ],
      delaySeconds: -2,
    });
    expect(e).toContain(
      "第1ピリオドの持ち時間（分）は1以上の整数で入力してください"
    );
    expect(e).toContain(
      "第1ピリオドの加算（秒/手）は0以上の整数で入力してください"
    );
    expect(e).toContain(
      "第2ピリオドの持ち時間（分）は1以上の整数で入力してください"
    );
    expect(e).toContain("遅延（秒）は0以上の整数で入力してください");
    const six = Array.from({ length: 6 }, (_, i) =>
      i < 5
        ? { moves: 10, minutes: 10, incrementSeconds: 0 }
        : { minutes: 10, incrementSeconds: 0 }
    );
    expect(validateTimeControl({ periods: six })).toContain(
      "ピリオドは5つまでです"
    );
  });

  it("buildTimeControl drops the last period's moves and copies the input", () => {
    const input = {
      periods: [
        { moves: 40, minutes: 90, incrementSeconds: 30 },
        { minutes: 30, incrementSeconds: 30 },
      ],
    };
    const tc = buildTimeControl(input);
    expect(tc).toEqual(CLASSICAL);
    input.periods[0].minutes = 1;
    expect(tc.periods[0].minutes).toBe(90);
  });
});

describe("normalizeTimeControl (legacy migration)", () => {
  it("turns the legacy single control into one period, marked incomplete (review M1)", () => {
    // 旧フォームには2つ目以降のピリオドの欄がなかったため、"40手90分 → 30分" も "90分+30秒" で保存されている
    const legacy = normalizeTimeControl({
      initialMinutes: 3,
      incrementSeconds: 2,
    });
    expect(legacy).toEqual({
      periods: [{ minutes: 3, incrementSeconds: 2 }],
      periodsIncomplete: true,
    });
    expect(lastPeriodFromTimeControl(legacy)).toBeUndefined();
    expect(
      normalizeTimeControl({
        initialMinutes: 15,
        incrementSeconds: 0,
        delaySeconds: 5,
      })
    ).toEqual({
      periods: [{ minutes: 15, incrementSeconds: 0 }],
      delaySeconds: 5,
      periodsIncomplete: true,
    });
  });

  it("keeps the legacy additionalTimeAfterMove and marks the periods incomplete", () => {
    const tc = normalizeTimeControl({
      initialMinutes: 90,
      incrementSeconds: 30,
      additionalTimeAfterMove: 30,
    });
    expect(tc).toEqual({
      periods: [{ minutes: 90, incrementSeconds: 30 }],
      periodsIncomplete: true,
      additionalTimeAfterMove: 30,
    });
    // 何手目の後か分からないため、最終ピリオドも現在のピリオドも求めない
    expect(currentPeriod(tc, 10)).toBeUndefined();
    expect(lastPeriodFromTimeControl(tc)).toBeUndefined();
    expect(deriveTimeControlFacts(tc, 10)).toEqual({});
  });

  it("passes the current format through (as a copy) and rejects junk", () => {
    const tc = normalizeTimeControl(CLASSICAL);
    expect(tc).toEqual(CLASSICAL);
    expect(tc).not.toBe(CLASSICAL);
    expect(normalizeTimeControl(undefined)).toBeUndefined();
    expect(normalizeTimeControl("90+30")).toBeUndefined();
    expect(
      normalizeTimeControl({ initialMinutes: 0, incrementSeconds: 0 })
    ).toBeUndefined();
    expect(
      normalizeTimeControl({
        periods: [{ moves: 40, minutes: 90, incrementSeconds: 0 }],
      })
    ).toBeUndefined();
  });
});

describe("currentPeriod / derived facts", () => {
  it("a single period is always the last period, without a move number", () => {
    expect(currentPeriod(SINGLE)).toMatchObject({ number: 1, isLast: true });
    expect(lastPeriodFromTimeControl(SINGLE)).toBe(true);
    expect(deriveTimeControlFacts(SINGLE)).toEqual({
      "ss.current-period": { value: 1 },
      "ss.increment": { value: 0 },
      "ct.last-period": { value: "true" },
    });
  });

  it("multi-period controls need the move number", () => {
    expect(currentPeriod(CLASSICAL)).toBeUndefined();
    expect(lastPeriodFromTimeControl(CLASSICAL)).toBeUndefined();
    expect(deriveTimeControlFacts(CLASSICAL)).toEqual({});
    expect(currentPeriod(CLASSICAL, 0)).toBeUndefined();
    expect(currentPeriod(CLASSICAL, 2.5)).toBeUndefined();
  });

  it("move 40 is still in the first period; move 41 starts the next", () => {
    expect(currentPeriod(CLASSICAL, 1)).toMatchObject({
      number: 1,
      isLast: false,
    });
    expect(currentPeriod(CLASSICAL, 40)).toMatchObject({
      number: 1,
      isLast: false,
    });
    expect(currentPeriod(CLASSICAL, 41)).toMatchObject({
      number: 2,
      isLast: true,
    });
    expect(currentPeriod(CLASSICAL, 300)).toMatchObject({
      number: 2,
      isLast: true,
    });
  });

  it("three periods: boundaries at 40 and 60", () => {
    expect(currentPeriod(THREE_NO_INC, 40)?.number).toBe(1);
    expect(currentPeriod(THREE_NO_INC, 41)?.number).toBe(2);
    expect(currentPeriod(THREE_NO_INC, 60)?.number).toBe(2);
    expect(currentPeriod(THREE_NO_INC, 61)).toMatchObject({
      number: 3,
      isLast: true,
    });
    expect(deriveTimeControlFacts(THREE_NO_INC, 45)).toEqual({
      "ss.current-period": { value: 2 },
      "ss.increment": { value: 0 },
      "ct.last-period": { value: "false" },
    });
  });

  it("un-normalized data without moves on a non-final period derives nothing (review S6)", () => {
    const bad = {
      periods: [
        { minutes: 90, incrementSeconds: 30 },
        { minutes: 30, incrementSeconds: 30 },
      ],
    } as TimeControl;
    expect(currentPeriod(bad, 10)).toBeUndefined();
  });

  it("no time control derives nothing", () => {
    expect(currentPeriod(undefined, 10)).toBeUndefined();
    expect(deriveTimeControlFacts(undefined, 10)).toEqual({});
  });
});

describe("assessRecordingObligation (FIDE 8.4)", () => {
  const std = { competitionType: "standard" as const };

  it("exempt: less than five minutes and less than 30 s increment", () => {
    const r = assessRecordingObligation({
      ...std,
      remainingSeconds: 299,
      incrementSeconds: 0,
    });
    expect(r.status).toBe("exempt");
    expect(r.sources.map((s) => s.article)).toEqual(["FIDE 8.4", "FIDE 8.1.1"]);
  });

  it("exactly five minutes is not 'less than five minutes'", () => {
    const r = assessRecordingObligation({
      ...std,
      remainingSeconds: 300,
      belowFiveInPeriod: false,
      incrementSeconds: 10,
    });
    expect(r.status).toBe("required");
  });

  it("the exemption lasts for the rest of the period, even back above five minutes", () => {
    const r = assessRecordingObligation({
      ...std,
      remainingSeconds: 330,
      belowFiveInPeriod: true,
      incrementSeconds: 10,
    });
    expect(r.status).toBe("exempt");
    expect(r.explanation).toContain("5分以上に戻っていても");
  });

  it("an increment of 30 s or more never exempts", () => {
    for (const remainingSeconds of [10, 299, 600]) {
      expect(
        assessRecordingObligation({
          ...std,
          remainingSeconds,
          incrementSeconds: 30,
        }).status
      ).toBe("required");
    }
    // 加算が30秒以上なら、残り時間が分からなくても義務あり
    expect(
      assessRecordingObligation({ ...std, incrementSeconds: 30 }).status
    ).toBe("required");
  });

  it("not below five in the period: required, whatever the increment", () => {
    const r = assessRecordingObligation({
      ...std,
      remainingSeconds: 400,
      belowFiveInPeriod: false,
    });
    expect(r.status).toBe("required");
  });

  it("missing facts give unknown with the missing list", () => {
    const a = assessRecordingObligation({ ...std, remainingSeconds: 100 });
    expect(a).toMatchObject({ status: "unknown", missing: ["increment"] });
    const b = assessRecordingObligation({
      ...std,
      remainingSeconds: 400,
      incrementSeconds: 0,
    });
    expect(b).toMatchObject({
      status: "unknown",
      missing: ["belowFiveInPeriod"],
    });
    const c = assessRecordingObligation({ ...std });
    expect(c).toMatchObject({
      status: "unknown",
      missing: ["increment", "remainingTime"],
    });
    const d = assessRecordingObligation({
      ...std,
      remainingSeconds: -1,
      incrementSeconds: 0,
    });
    expect(d).toMatchObject({ status: "unknown", missing: ["remainingTime"] });
  });

  it("works with the increment derived from the current period", () => {
    const facts = deriveTimeControlFacts(THREE_NO_INC, 50);
    const inc = (facts["ss.increment"] as { value: number }).value;
    expect(
      assessRecordingObligation({
        ...std,
        remainingSeconds: 200,
        incrementSeconds: inc,
      }).status
    ).toBe("exempt");
    const facts2 = deriveTimeControlFacts(CLASSICAL, 50);
    const inc2 = (facts2["ss.increment"] as { value: number }).value;
    expect(
      assessRecordingObligation({
        ...std,
        remainingSeconds: 200,
        incrementSeconds: inc2,
      }).status
    ).toBe("required");
  });

  it("a delay never confirms the exemption (8.4 speaks only of added time; review S3)", () => {
    const r = assessRecordingObligation({
      ...std,
      remainingSeconds: 100,
      incrementSeconds: 0,
      delaySeconds: 30,
    });
    expect(r).toMatchObject({ status: "unknown", missing: ["delayTreatment"] });
    // 義務ありの判定は遅延に関係しない
    expect(
      assessRecordingObligation({
        ...std,
        remainingSeconds: 400,
        belowFiveInPeriod: false,
        delaySeconds: 30,
      }).status
    ).toBe("required");
  });

  it("Rapid and Blitz are not assessed", () => {
    for (const competitionType of ["rapid", "blitz"] as const) {
      expect(
        assessRecordingObligation({
          competitionType,
          remainingSeconds: 10,
          incrementSeconds: 0,
        }).status
      ).toBe("not-assessed");
    }
  });
});

describe("tournament profile with periods", () => {
  const providers = fixedProviders();
  const base: TournamentProfileInput = {
    name: "Classical Open",
    startDate: FIXED_NOW,
    competitionType: "standard",
    rulesVersion: "FIDE-2023",
    timeControl: CLASSICAL,
  };

  it("builds, formats and round-trips a multi-period control", () => {
    const t = buildTournament(base, providers);
    expect(t.timeControl).toEqual(CLASSICAL);
    expect(formatTimeControl(t.timeControl)).toBe("40手90分+30秒 → 30分+30秒");
    expect(toProfileInput(t).timeControl).toEqual(CLASSICAL);
  });

  it("formats legacy values, delay and incomplete periods", () => {
    const legacy = {
      initialMinutes: 90,
      incrementSeconds: 30,
      additionalTimeAfterMove: 30,
    } as unknown as TimeControl;
    expect(formatTimeControl(legacy)).toBe("90分+30秒（ピリオド未確認）");
    expect(
      formatTimeControl({
        periods: [{ minutes: 15, incrementSeconds: 0 }],
        delaySeconds: 5,
      })
    ).toBe("15分（遅延5秒）");
  });

  it("editing a legacy tournament keeps the unknown extra time until confirmed", () => {
    const legacy = {
      ...buildTournament(base, providers),
      timeControl: {
        initialMinutes: 90,
        incrementSeconds: 30,
        additionalTimeAfterMove: 30,
      } as unknown as TimeControl,
    };
    const input = toProfileInput(legacy);
    expect(input.timeControl).toMatchObject({
      periodsIncomplete: true,
      additionalTimeAfterMove: 30,
    });
    const rebuilt = buildTournament(input, providers, legacy);
    expect(rebuilt.timeControl?.periodsIncomplete).toBe(true);
    // 確認後（フォームのチェック）は旧形式の値を落とす
    const confirmed = buildTournament(
      { ...input, timeControl: { periods: CLASSICAL.periods } },
      providers,
      legacy
    );
    expect(confirmed.timeControl).toEqual(CLASSICAL);
  });

  it("the ruleset snapshot carries a normalized copy of the time control", () => {
    const t = {
      ...buildTournament(base, providers),
      timeControl: {
        initialMinutes: 3,
        incrementSeconds: 2,
      } as unknown as TimeControl,
    };
    const r = deriveRulesetFromTournament(t);
    expect(r.ok && r.ruleset.timeControl).toEqual({
      periods: [{ minutes: 3, incrementSeconds: 2 }],
      periodsIncomplete: true,
    });
    const t2 = buildTournament(base, providers);
    const r2 = deriveRulesetFromTournament(t2);
    expect(r2.ok && r2.ruleset.timeControl).toEqual(CLASSICAL);
    expect(r2.ok && r2.ruleset.timeControl).not.toBe(t2.timeControl);
  });
});

describe("DT-004 lastPeriod from the time control (ADR-014 §7)", () => {
  const BOTH = {
    flagFallen: "both",
    bothFlagsOrder: "unknown",
    endedBeforeFlag: "none",
    quickplayGuidelinesApply: "true",
  } as const;

  function evaluate(
    answers: Partial<Record<IncidentQuestionId, string>>,
    timeControl?: TimeControl
  ) {
    const base: Incident = {
      id: "inc-1",
      gameId: "g1",
      category: "clock-time",
      subtype: "flag-fall",
      description: "",
      arbiterObserved: true,
      reportedBy: "arbiter",
      reportedAt: FIXED_NOW,
      status: "pending",
      escalatedToCA: false,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    };
    const ruleset: RulesetContext = {
      competitionType: "standard",
      rulesVersion: "FIDE-2023",
      timeControl,
    };
    return new DecisionEngine(fixedProviders(), {
      positions: chessJsPositionPort,
    }).processIncident({
      incident: applyIncidentAnswers(base, answers),
      ruleset,
      illegalMoveHistory: { white: [], black: [] },
    });
  }

  it("a single period is the last period: draw without asking", () => {
    const r = evaluate(BOTH, SINGLE);
    expect(r.requiresFollowUp).toBe(false);
    expect(r.decision.penalties.map((p) => p.type)).toEqual(["draw"]);
    expect(r.decision.conclusion).toContain("最終ピリオド");
  });

  it("the setting wins over a stored unknown answer", () => {
    const r = evaluate({ ...BOTH, lastPeriod: "unknown" }, SINGLE);
    expect(r.decision.kind).not.toBe("manual-review");
    expect(r.decision.penalties.map((p) => p.type)).toEqual(["draw"]);
  });

  it("multi-period, incomplete or missing time controls still ask", () => {
    const incomplete: TimeControl = { ...SINGLE, periodsIncomplete: true };
    for (const tc of [CLASSICAL, incomplete, undefined]) {
      const r = evaluate(BOTH, tc);
      expect(r.requiresFollowUp).toBe(true);
      expect(r.followUpQuestions.map((q) => q.id)).toContain(
        QUESTIONS.lastPeriod.id
      );
    }
  });

  it("an explicit answer wins over the setting: no draw against 'not last period' (review M1/S1)", () => {
    const r = evaluate({ ...BOTH, lastPeriod: "false" }, SINGLE);
    expect(r.requiresFollowUp).toBe(false);
    expect(r.decision.penalties).toEqual([]);
    expect(r.decision.conclusion).not.toContain("ドローです");
  });

  it("a migrated legacy tournament (e.g. stored 90+30 for 40/90 → 30) asks lastPeriod", () => {
    const migrated = normalizeTimeControl({
      initialMinutes: 90,
      incrementSeconds: 30,
    });
    const r = evaluate(BOTH, migrated);
    expect(r.requiresFollowUp).toBe(true);
    expect(r.followUpQuestions.map((q) => q.id)).toContain(
      QUESTIONS.lastPeriod.id
    );
  });

  it("multi-period with an answer uses the answer", () => {
    const r = evaluate({ ...BOTH, lastPeriod: "false" }, CLASSICAL);
    expect(r.requiresFollowUp).toBe(false);
    expect(r.decision.penalties).toEqual([]);
    expect(r.decision.conclusion).not.toContain("ドローです");
  });
});

describe("Dexie v8 migration", () => {
  it("converts stored legacy time controls into periods", async () => {
    const name = `tc-migration-${Date.now()}`;
    const v7 = new Dexie(name);
    v7.version(7).stores({
      tournaments: "id, name, competitionType, startDate",
      games:
        "id, tournamentId, round, boardNumber, startTime, roundId, [tournamentId+round]",
      incidents:
        "id, gameId, category, status, reportedAt, [gameId+playerColor]",
      decisions: "id, incidentId, generatedBy, confidence, createdAt",
      rules: "id, source, sourceId, tournamentId, article, priority",
      embeddings: "id, ruleId, model",
      appState: "key",
      ruleSources: "id, sourceType, tournamentId, status",
      rounds: "id, tournamentId, [tournamentId+roundNumber], status",
      players: "id, tournamentId, name",
      roundChecklists: "id, tournamentId",
      checklistTemplates: "tournamentId",
    });
    await v7.open();
    await v7.table("tournaments").bulkAdd([
      {
        id: "a",
        name: "A",
        timeControl: { initialMinutes: 3, incrementSeconds: 2 },
      },
      {
        id: "b",
        name: "B",
        timeControl: {
          initialMinutes: 90,
          incrementSeconds: 30,
          additionalTimeAfterMove: 30,
        },
      },
      { id: "c", name: "C" },
      { id: "d", name: "D", timeControl: { weird: true } },
    ]);
    v7.close();

    const db = new ArbiterDatabase(name);
    try {
      const all = (await db.tournaments.toArray()) as Tournament[];
      const by = Object.fromEntries(all.map((t) => [t.id, t.timeControl]));
      expect(by.a).toEqual({
        periods: [{ minutes: 3, incrementSeconds: 2 }],
        periodsIncomplete: true,
      });
      expect(by.b).toEqual({
        periods: [{ minutes: 90, incrementSeconds: 30 }],
        periodsIncomplete: true,
        additionalTimeAfterMove: 30,
      });
      expect(by.c).toBeUndefined();
      // 解釈できない値は破壊しない
      expect(by.d).toEqual({ weird: true });
    } finally {
      await db.delete();
    }
  });
});
