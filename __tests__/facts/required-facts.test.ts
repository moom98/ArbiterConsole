import { describe, expect, it } from "vitest";
import {
  evaluateCondition,
  presenceCheckableFacts,
  requiredFacts,
  unansweredFacts,
  type FactAnswers,
  type RequiredFactsInput,
} from "@/lib/domain/facts";

const v = (value: string | number | string[]) => ({ value });
const UNKNOWN = { unknown: true } as const;

const ids = (input: RequiredFactsInput) =>
  requiredFacts(input).map((r) => r.definition.id);

describe("evaluateCondition", () => {
  it("never satisfies a fact condition with an unknown or missing answer", () => {
    const c = { fact: "pb.behavior", in: ["device"] } as const;
    expect(evaluateCondition(c, { "pb.behavior": UNKNOWN }, {})).toBe(false);
    expect(evaluateCondition(c, {}, {})).toBe(false);
  });

  it("matches any value of a multiple choice", () => {
    const c = { fact: "pb.behavior", in: ["device"] } as const;
    expect(
      evaluateCondition(c, { "pb.behavior": v(["talking", "device"]) }, {})
    ).toBe(true);
  });

  it("checks numeric ranges (gte inclusive, lt exclusive)", () => {
    const c = { fact: "ss.remaining-time", range: { gte: 300 } } as const;
    expect(evaluateCondition(c, { "ss.remaining-time": v(299) }, {})).toBe(
      false
    );
    expect(evaluateCondition(c, { "ss.remaining-time": v(300) }, {})).toBe(
      true
    );
    expect(evaluateCondition(c, { "ss.remaining-time": UNKNOWN }, {})).toBe(
      false
    );
    const lt = { fact: "ss.increment", range: { lt: 30 } } as const;
    expect(evaluateCondition(lt, { "ss.increment": v(29) }, {})).toBe(true);
    expect(evaluateCondition(lt, { "ss.increment": v(30) }, {})).toBe(false);
  });

  it("treats arbiterObserved is:false as 'false or not recorded'", () => {
    const c = { incident: "arbiterObserved", is: false } as const;
    expect(evaluateCondition(c, {}, {})).toBe(true);
    expect(evaluateCondition(c, {}, { arbiterObserved: false })).toBe(true);
    expect(evaluateCondition(c, {}, { arbiterObserved: true })).toBe(false);
  });

  it("evaluates competition type from the context", () => {
    const c = { context: "competitionType", in: ["standard"] } as const;
    expect(evaluateCondition(c, {}, { competitionType: "standard" })).toBe(
      true
    );
    expect(evaluateCondition(c, {}, { competitionType: "rapid" })).toBe(false);
    expect(evaluateCondition(c, {}, {})).toBe(false);
  });
});

describe("requiredFacts: fact plan categories", () => {
  it("asks only the blocking facts first, in catalogue order", () => {
    expect(
      ids({
        category: "player-behavior",
        answers: {},
        context: { arbiterObserved: true },
      })
    ).toEqual(["pb.behavior", "pb.actor", "pb.disputed"]);
  });

  it("adds conditional facts when their condition holds", () => {
    const answers: FactAnswers = {
      "pb.behavior": v(["device"]),
      "pb.disputed": v("false"),
    };
    expect(
      ids({
        category: "player-behavior",
        answers,
        context: { arbiterObserved: true },
      })
    ).toEqual([
      "pb.behavior",
      "pb.actor",
      "pb.disputed",
      "pb.device-type",
      "pb.device-where",
      "pb.device-observed",
      "pb.bag-access",
    ]);
  });

  it("asks bag access whatever the device location, and permission only after access (FIDE 11.3.2.2)", () => {
    const base = {
      category: "player-behavior",
      context: { arbiterObserved: true },
    } as const;
    expect(ids({ ...base, answers: { "pb.behavior": v(["bag"]) } })).toContain(
      "pb.bag-access"
    );
    expect(
      ids({
        ...base,
        answers: { "pb.behavior": v(["bag"]), "pb.bag-access": v("true") },
      })
    ).toContain("pb.bag-access-permission");
    expect(
      ids({
        ...base,
        answers: { "pb.behavior": v(["bag"]), "pb.bag-access": UNKNOWN },
      })
    ).not.toContain("pb.bag-access-permission");
  });

  it("requires pb.observed-by when the arbiter did not observe it, or when the facts are disputed", () => {
    const answers = { "pb.behavior": v(["noise"]) };
    expect(
      ids({ category: "player-behavior", answers, context: {} })
    ).toContain("pb.observed-by");
    expect(
      ids({
        category: "player-behavior",
        answers,
        context: { arbiterObserved: true },
      })
    ).not.toContain("pb.observed-by");
    expect(
      ids({
        category: "player-behavior",
        answers: { ...answers, "pb.disputed": v("true") },
        context: { arbiterObserved: true },
      })
    ).toContain("pb.observed-by");
  });

  it("FIDE 8.4: asks 'below five in this period' only for Standard, 5:00 or more, increment under 30 s", () => {
    const answers = (remaining: number, increment: number): FactAnswers => ({
      "ss.issue": v("not-writing"),
      "ss.remaining-time": v(remaining),
      "ss.increment": v(increment),
    });
    const std = { competitionType: "standard" } as const;
    expect(
      ids({ category: "scoresheet", answers: answers(300, 0), context: std })
    ).toContain("ss.below-five-in-period");
    expect(
      ids({ category: "scoresheet", answers: answers(299, 0), context: std })
    ).not.toContain("ss.below-five-in-period");
    expect(
      ids({ category: "scoresheet", answers: answers(300, 30), context: std })
    ).not.toContain("ss.below-five-in-period");
    expect(
      ids({
        category: "scoresheet",
        answers: answers(300, 0),
        context: { competitionType: "rapid" },
      })
    ).not.toContain("ss.remaining-time");
  });

  it("does not ask facts the app derived from settings, and uses their values in conditions", () => {
    const answers = {
      "ss.issue": v("not-writing"),
      "ss.remaining-time": v(300),
    };
    const context = {
      competitionType: "standard" as const,
      derivedValues: { "ss.increment": v(0), "ss.current-period": v(1) },
    };
    const result = ids({ category: "scoresheet", answers, context });
    expect(result).not.toContain("ss.increment");
    expect(result).not.toContain("ss.current-period");
    expect(result).not.toContain("ss.move-number");
    // 設定から求めた加算 0 秒で、8.4 の追加質問が必要になる
    expect(result).toContain("ss.below-five-in-period");
  });

  it("asks the increment and the move number when the period cannot be derived", () => {
    const result = ids({
      category: "scoresheet",
      answers: { "ss.issue": v("behind") },
      context: { competitionType: "standard" },
    });
    expect(result).toContain("ss.increment");
    expect(result).toContain("ss.move-number");
    expect(result).not.toContain("ss.current-period");
  });

  it("does not ask the increment outside Standard", () => {
    const result = ids({
      category: "scoresheet",
      answers: { "ss.issue": v("behind") },
      context: { competitionType: "blitz" },
    });
    expect(result).not.toContain("ss.increment");
    expect(result).not.toContain("ss.move-number");
  });

  it("treats an empty multiple choice like no match", () => {
    expect(
      ids({
        category: "player-behavior",
        answers: { "pb.behavior": v([]) },
        context: { arbiterObserved: true },
      })
    ).toEqual(["pb.behavior", "pb.actor", "pb.disputed"]);
  });

  it("FIDE 7.3: asks the move count only for reversed colours", () => {
    expect(
      ids({
        category: "board-piece",
        answers: { "bp.issue": v("colours-reversed") },
        context: {},
      })
    ).toContain("bp.moves-played");
    expect(
      ids({
        category: "board-piece",
        answers: { "bp.issue": v("wrong-initial") },
        context: {},
      })
    ).toEqual(["bp.issue", "bp.when"]);
  });
});

describe("requiredFacts: Decision Tree categories (the tree is the authority)", () => {
  it("asks only im.action until the illegal-move subtype is known", () => {
    expect(ids({ category: "illegal-move", answers: {}, context: {} })).toEqual(
      ["im.action"]
    );
  });

  it("keeps 7.5 facts and touch-move facts apart", () => {
    const im = ids({
      category: "illegal-move",
      subtype: "two-hands",
      answers: {},
      context: {},
    });
    expect(im).toEqual([
      "im.action",
      "im.player",
      "im.clock-pressed",
      "game.end-event",
    ]);
    const tch = ids({
      category: "illegal-move",
      subtype: "touch-move",
      answers: {},
      context: {},
    });
    expect(tch.every((id) => id === "im.action" || id.startsWith("tch."))).toBe(
      true
    );
    expect(tch).toContain("tch.touched");
  });

  it("adds a DT-mapped conditional fact only when the tree asks its question", () => {
    const base = {
      category: "illegal-move",
      subtype: "illegal-move",
      answers: {},
      context: { competitionType: "rapid" },
    } as const;
    expect(ids(base)).not.toContain("im.opponent-moved");
    expect(
      ids({ ...base, dtRequestedQuestionIds: ["opponentMadeNextMove"] })
    ).toContain("im.opponent-moved");
  });

  it("R7: next-move-written follows the tree's moveWritten request", () => {
    const base = {
      category: "draw",
      answers: { "dr.kind": v("threefold-repetition-claim") },
      context: {},
    } as const;
    expect(ids(base)).not.toContain("dr.next-move-written");
    expect(ids({ ...base, dtRequestedQuestionIds: ["moveWritten"] })).toContain(
      "dr.next-move-written"
    );
  });

  it("facts with no condition and no DT mapping need an explicit request", () => {
    const base = {
      category: "illegal-move",
      subtype: "touch-move",
      answers: {},
      context: {},
    } as const;
    expect(ids(base)).not.toContain("tch.special");
    expect(ids({ ...base, requestedFactIds: ["tch.special"] })).toContain(
      "tch.special"
    );
  });
});

describe("unansweredFacts / presenceCheckableFacts", () => {
  it("treats unknown as answered", () => {
    const required = requiredFacts({
      category: "team",
      answers: {},
      context: {},
    });
    expect(unansweredFacts(required, { "tm.issue": UNKNOWN })).toEqual([]);
    expect(unansweredFacts(required, {}).map((r) => r.definition.id)).toEqual([
      "tm.issue",
    ]);
  });

  it("never offers local-only facts to Jev", () => {
    const required = requiredFacts({
      category: "illegal-move",
      subtype: "touch-move",
      answers: {},
      context: {},
    });
    const ids = presenceCheckableFacts(required).map((r) => r.definition.id);
    expect(ids).not.toContain("tch.touched");
    expect(ids).toContain("tch.how");
  });
});

describe("requiredFacts: subtype, records and explicit requests", () => {
  it("takes the illegal-move subtype from the im.action answer", () => {
    expect(
      ids({
        category: "illegal-move",
        answers: { "im.action": v("touch-move") },
        context: {},
      })
    ).toContain("tch.touched");
    expect(
      ids({
        category: "illegal-move",
        answers: { "im.action": v("two-hands") },
        context: {},
      })
    ).toContain("im.clock-pressed");
    expect(
      ids({
        category: "illegal-move",
        answers: { "im.action": UNKNOWN },
        context: {},
      })
    ).toEqual(["im.action"]);
  });

  it("asks the record state only after an observed end of the game", () => {
    const base = {
      category: "illegal-move",
      subtype: "illegal-move",
      context: {},
    } as const;
    expect(
      ids({ ...base, answers: { "game.end-event": v("in-progress") } })
    ).not.toContain("game.record-state");
    expect(
      ids({ ...base, answers: { "game.end-event": v("resignation") } })
    ).toContain("game.record-state");
  });

  it("lets an explicit request override a false condition, but never an optional level", () => {
    const base = {
      category: "illegal-move",
      subtype: "touch-move",
      answers: { "tch.what-next": v("moved-touched") },
      context: {},
    } as const;
    expect(ids(base)).not.toContain("game.position");
    expect(ids({ ...base, requestedFactIds: ["game.position"] })).toContain(
      "game.position"
    );
    expect(
      ids({ ...base, requestedFactIds: ["tch.claimed-by-opponent"] })
    ).not.toContain("tch.claimed-by-opponent");
  });

  it("maps the flag-fall questions of DT-004 to facts", () => {
    const result = ids({
      category: "clock-time",
      answers: { "ct.event": v("flag-fall") },
      context: {},
      dtRequestedQuestionIds: ["flagFallen", "positionFen", "lastPeriod"],
    });
    expect(result).toEqual([
      "ct.event",
      "ct.zero-side",
      "game.history",
      "ct.last-period",
    ]);
  });

  it("returns each fact once even when several questions map to it", () => {
    const result = ids({
      category: "clock-time",
      answers: {},
      context: {},
      dtRequestedQuestionIds: ["positionFen", "materialConfirmed"],
    });
    expect(result.filter((id) => id === "game.history")).toHaveLength(1);
  });

  it("treats an 'unknown' derived value as not derived", () => {
    const result = ids({
      category: "scoresheet",
      answers: { "ss.issue": v("behind") },
      context: {
        competitionType: "standard",
        derivedValues: { "ss.current-period": UNKNOWN },
      },
    });
    expect(result).toContain("ss.move-number");
  });

  it("does not ask a derived DT fact that the app could derive", () => {
    const result = ids({
      category: "clock-time",
      answers: {},
      context: { derivedValues: { "ct.last-period": v("true") } },
      dtRequestedQuestionIds: ["lastPeriod"],
    });
    expect(result).not.toContain("ct.last-period");
  });
});
