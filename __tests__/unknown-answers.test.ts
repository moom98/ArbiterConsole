import { describe, it, expect } from "vitest";
import {
  DecisionEngine,
  type DecisionEngineContext,
  type RulesetContext,
} from "@/lib/domain/decision-engine";
import type { Decision, Incident } from "@/lib/domain/entities";
import type { PriorIllegalMove } from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";
import {
  MAX_ENUMERATED_UNKNOWN_FACTS,
  resolveUnknown,
  unknownResolutionFields,
  type BranchResult,
} from "@/lib/domain/decision-trees/tree-support";
import {
  QUESTIONS,
  UNKNOWN_VALUE,
  applyIncidentAnswers,
  type FollowUpQuestion,
  type IncidentQuestionId,
} from "@/lib/domain/follow-up";
import { IncidentCounter } from "@/lib/domain/services/incident-counter";
import { fixedProviders, FIXED_NOW } from "./helpers";
import { chessJsPositionPort } from "@/lib/infrastructure/chess/chess-js-position-port";
import { runHelpmateSearch } from "@/lib/infrastructure/chess/helpmate/run";
import { mateSearchNeeded } from "@/lib/domain/services/mate-possibility";

/** ストアと同じく、局面があればヘルプメイトを探して Incident に付ける（ADR-015） */
function withSearch(inc: Incident): Incident {
  const request = mateSearchNeeded(chessJsPositionPort, inc);
  return request ? { ...inc, mateSearch: runHelpmateSearch(request) } : inc;
}

/** 黒が K+Q（白の手番）。黒のメイトの手順が見つかる局面 */
const BLACK_QUEEN_WHITE_TO_MOVE = "6k1/8/8/8/8/8/5q2/6K1 w - - 0 40";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    gameId: "g1",
    category: "illegal-move",
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

function priors(n: number): PriorIllegalMove[] {
  return Array.from({ length: n }, (_, i) => ({
    incidentId: `prior-${i}`,
    reportedAt: FIXED_NOW,
    subtype: "illegal-move" as const,
  }));
}

const STANDARD: RulesetContext = {
  competitionType: "standard",
  rulesVersion: "FIDE-2023",
};
const RAPID_BASIC: RulesetContext = {
  competitionType: "rapid",
  supervisionRegime: "basic-rules",
  rulesVersion: "FIDE-2023",
};
const RAPID_COMPETITION: RulesetContext = {
  competitionType: "rapid",
  supervisionRegime: "competition-rules",
  rulesVersion: "FIDE-2023",
};

/** 回答（"unknown" を含む）を UI と同じ経路で Incident に反映して評価する */
function evaluate(
  base: Partial<Incident>,
  answers: Partial<Record<IncidentQuestionId, string>>,
  ctx: Partial<DecisionEngineContext> = {}
) {
  const inc = withSearch(applyIncidentAnswers(incident(base), answers));
  return new DecisionEngine(fixedProviders(), {
    positions: chessJsPositionPort,
  }).processIncident({
    incident: inc,
    ruleset: STANDARD,
    illegalMoveHistory: { white: [], black: [] },
    ...ctx,
  });
}

function expectManualReview(d: Decision, facts: IncidentQuestionId[]) {
  expect(d.kind).toBe("manual-review");
  expect(d.intervention).toBe("consult-ca");
  expect(d.escalationRecommended).toBe(true);
  // §3.3 4: 分岐が一致しなければペナルティは適用しない
  expect(d.penalties).toEqual([]);
  expect(d.unconfirmedFacts).toEqual(facts.map((id) => QUESTIONS[id].label));
  expect(d.conclusion).toContain("確認できないため裁定を確定できません");
  expect(d.actions).toContain("CAへ確認する");
}

const ILLEGAL_BASE = {
  subtype: "illegal-move",
  gameEndEvent: "in-progress",
  clockPressed: "true",
  playerColor: "white",
} as const;

// ---------------------------------------------------------------------------
// questions and answers
// ---------------------------------------------------------------------------

describe("unknown answers: questions", () => {
  it("every incident-scope choice question offers an unknown answer (R5)", () => {
    const choice = Object.values(QUESTIONS).filter(
      (q) => q.scope === "incident" && (q.input ?? "choice") === "choice"
    );
    expect(choice.length).toBeGreaterThan(10);
    for (const q of choice)
      expect(
        q.options.map((o) => o.value),
        q.id
      ).toContain(UNKNOWN_VALUE);
  });

  it("the generic unknown is the last option and is never an enumerated value", () => {
    for (const q of Object.values(QUESTIONS).filter((q) => q.onUnknown)) {
      expect(q.options[q.options.length - 1].value).toBe(UNKNOWN_VALUE);
      expect(
        q.options.filter((o) => o.value === UNKNOWN_VALUE),
        q.id
      ).toHaveLength(1);
    }
  });

  it("questions with their own unknown value keep it (handled by their tree)", () => {
    for (const id of [
      "matePosition",
      "bothFlagsOrder",
      "movesNotCompleted",
      "repetitionCheck",
    ] as const)
      expect(QUESTIONS[id].onUnknown).toBeUndefined();
  });
});

describe("unknown answers: applyIncidentAnswers (§3.3 e)", () => {
  it("records unknown in unknownAnswers and leaves the value unset (not needs-input)", () => {
    const inc = applyIncidentAnswers(incident(), {
      gameEndEvent: "unknown",
      clockPressed: "true",
    });
    expect(inc.unknownAnswers).toEqual(["gameEndEvent"]);
    expect(inc.illegalMoveFacts?.endEvent).toBeUndefined();
    expect(inc.illegalMoveFacts?.clockPressed).toBe(true);
  });

  it("an unknown answer clears an earlier value", () => {
    const first = applyIncidentAnswers(incident(), {
      playerColor: "white",
      clockPressed: "true",
    });
    const next = applyIncidentAnswers(first, {
      playerColor: "unknown",
      clockPressed: "unknown",
    });
    expect(next.playerColor).toBeUndefined();
    expect(next.illegalMoveFacts?.clockPressed).toBeUndefined();
    expect(next.unknownAnswers).toEqual(["playerColor", "clockPressed"]);
  });

  it("a later concrete answer removes the unknown", () => {
    const first = applyIncidentAnswers(incident(), { gameEndEvent: "unknown" });
    const next = applyIncidentAnswers(first, { gameEndEvent: "in-progress" });
    expect(next.unknownAnswers).toBeUndefined();
    expect(next.illegalMoveFacts?.endEvent).toBe("in-progress");
  });

  it("an unknown illegal-move subtype also clears Incident.subtype (log, CSV, counts)", () => {
    const reported = applyIncidentAnswers(incident(), {
      subtype: "two-hands",
    });
    expect(reported.subtype).toBe("two-hands");
    const next = applyIncidentAnswers(reported, { subtype: "unknown" });
    expect(next.subtype).toBeUndefined();
    expect(next.illegalMoveFacts?.subtype).toBeUndefined();
    // 別の質問への回答で以前の subtype が復活しない
    const later = applyIncidentAnswers(next, { gameEndEvent: "in-progress" });
    expect(later.subtype).toBeUndefined();
  });

  it("clears draw and flag values, including the player derived from them", () => {
    const draw = applyIncidentAnswers(
      applyIncidentAnswers(incident({ category: "draw" }), {
        drawSubtype: "threefold-repetition-claim",
        claimant: "black",
      }),
      { claimant: "unknown" }
    );
    expect(draw.drawClaimFacts?.claimant).toBeUndefined();
    expect(draw.playerColor).toBeUndefined();

    const flag = applyIncidentAnswers(
      applyIncidentAnswers(incident({ category: "clock-time" }), {
        flagFallen: "white",
      }),
      { flagFallen: "unknown" }
    );
    expect(flag.flagFallFacts?.flagFallen).toBeUndefined();
    expect(flag.playerColor).toBeUndefined();
  });

  it("keeps the own unknown value of tree-specific questions", () => {
    const inc = applyIncidentAnswers(incident({ category: "clock-time" }), {
      movesNotCompleted: "unknown",
      bothFlagsOrder: "unknown",
    });
    expect(inc.unknownAnswers).toBeUndefined();
    expect(inc.flagFallFacts?.movesNotCompleted).toBe("unknown");
    expect(inc.flagFallFacts?.bothFlagsOrder).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// resolveUnknown (pure)
// ---------------------------------------------------------------------------

function q(
  id: string,
  values: string[],
  extra: Partial<FollowUpQuestion> = {}
): FollowUpQuestion {
  return {
    id: id as FollowUpQuestion["id"],
    scope: "incident",
    label: id,
    options: [...values, "unknown"].map((value) => ({ value, label: value })),
    onUnknown: "enumerate",
    ...extra,
  };
}

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "d",
    incidentId: "",
    kind: "recommendation",
    conclusion: "c",
    actions: [],
    intervention: "immediate",
    penalties: [],
    sources: [],
    confidence: "high",
    escalationRecommended: false,
    generatedBy: "decision-tree",
    validationPassed: true,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

const decided = (d: Partial<Decision> = {}): BranchResult => ({
  status: "decided",
  decision: decision(d),
});
const needs = (...questions: FollowUpQuestion[]): BranchResult => ({
  status: "needs-input",
  decision: decision({ kind: "follow-up-required" }),
  questions,
});

describe("resolveUnknown", () => {
  const A = q("a", ["true", "false"]);
  const B = q("b", ["x", "y", "z"]);
  const C = q("c", ["true", "false"]);

  it("is not needed when the current branch does not ask an unknown fact", () => {
    expect(
      resolveUnknown({ unknownIds: ["a"], evaluate: () => decided() }).kind
    ).toBe("not-needed");
    expect(
      resolveUnknown({
        unknownIds: ["a"],
        evaluate: () => needs(q("other", ["1"])),
      }).kind
    ).toBe("not-needed");
  });

  it("asks other unanswered questions first, without the unknown ones", () => {
    const r = resolveUnknown({
      unknownIds: ["a"],
      evaluate: () => needs(A, q("other", ["1"])),
    });
    expect(r.kind).toBe("ask-others");
    if (r.kind === "ask-others")
      expect(r.questions.map((x) => x.id)).toEqual(["other"]);
  });

  it("agrees when every value gives the same kind, intervention and penalties", () => {
    const r = resolveUnknown({
      unknownIds: ["b"],
      evaluate: (a) =>
        a.b === undefined ? needs(B) : decided({ conclusion: `text ${a.b}` }), // conclusion is ignored
    });
    expect(r.kind).toBe("agreed");
    if (r.kind === "agreed") expect(r.branches).toHaveLength(3);
  });

  it("disagrees when penalties differ (type, side or time)", () => {
    for (const other of [
      { type: "draw" as const },
      {
        type: "time-addition-opponent" as const,
        playerColor: "white" as const,
        timeAdjustmentSeconds: 120,
      },
      {
        type: "time-addition-opponent" as const,
        playerColor: "black" as const,
        timeAdjustmentSeconds: 60,
      },
    ]) {
      const r = resolveUnknown({
        unknownIds: ["a"],
        evaluate: (a) =>
          a.a === undefined
            ? needs(A)
            : decided({
                penalties: [
                  a.a === "true"
                    ? {
                        type: "time-addition-opponent",
                        playerColor: "black",
                        timeAdjustmentSeconds: 120,
                        description: "x",
                      }
                    : { ...other, description: "x" },
                ],
              }),
      });
      expect(r.kind).toBe("disagreed");
    }
  });

  it("a branch that needs an unanswered input counts as disagreeing (§3.3 a)", () => {
    const r = resolveUnknown({
      unknownIds: ["a"],
      evaluate: (a) =>
        a.a === undefined
          ? needs(A)
          : a.a === "true"
            ? needs(q("more", ["1"]))
            : decided(),
    });
    expect(r).toMatchObject({ kind: "disagreed", reason: "branches-differ" });
  });

  it("a branch outside the trees counts as disagreeing", () => {
    const r = resolveUnknown({
      unknownIds: ["a"],
      evaluate: (a) =>
        a.a === undefined
          ? needs(A)
          : a.a === "true"
            ? { status: "other" }
            : decided(),
    });
    expect(r.kind).toBe("disagreed");
  });

  it("adds another unknown fact that a branch asks for, and enumerates both", () => {
    const seen: string[] = [];
    const r = resolveUnknown({
      unknownIds: ["a", "c"],
      evaluate: (a) => {
        seen.push(JSON.stringify(a));
        if (a.a === undefined) return needs(A);
        if (a.a === "true" && a.c === undefined) return needs(C);
        return decided();
      },
    });
    expect(r.kind).toBe("agreed");
    if (r.kind === "agreed") {
      expect(r.facts.map((x) => x.id)).toEqual(["a", "c"]);
      expect(r.branches).toHaveLength(4);
    }
  });

  it(`goes to manual-review with more than ${MAX_ENUMERATED_UNKNOWN_FACTS} unknown facts (§3.3 d)`, () => {
    const r = resolveUnknown({
      unknownIds: ["a", "b", "c"],
      evaluate: (a) =>
        Object.keys(a).length === 0 ? needs(A, B, C) : decided(),
    });
    expect(r).toMatchObject({ kind: "disagreed", reason: "too-many" });
  });

  it("goes to manual-review for a fact that cannot be enumerated (§3.3 c), before other questions", () => {
    const M = q("m", ["true"], { onUnknown: "manual-review" });
    const r = resolveUnknown({
      unknownIds: ["m"],
      evaluate: () => needs(q("count", ["0"]), M),
    });
    expect(r).toMatchObject({ kind: "disagreed", reason: "not-enumerable" });
  });

  it("ignores questions hidden by an unknown answer", () => {
    const hidden = q("hidden", ["1"], {
      showWhen: { questionId: "a" as FollowUpQuestion["id"], values: ["true"] },
    });
    const r = resolveUnknown({
      unknownIds: ["a"],
      evaluate: (a) => (a.a === undefined ? needs(A, hidden) : decided()),
    });
    expect(r.kind).toBe("agreed");
  });
});

describe("unknownResolutionFields", () => {
  const A = q("a", ["true", "false"]);

  it("disagreed: manual-review, no penalty, keeps the actions all branches share", () => {
    const fields = unknownResolutionFields({
      kind: "disagreed",
      reason: "branches-differ",
      facts: [A],
      branches: [
        {
          assignment: { a: "true" },
          result: decided({
            actions: ["時計を止める", "Xの負けを宣言する"],
            penalties: [
              { type: "game-loss", playerColor: "white", description: "x" },
            ],
          }),
        },
        {
          assignment: { a: "false" },
          result: decided({ actions: ["時計を止める", "ドローを宣言する"] }),
        },
      ],
    });
    expect(fields.kind).toBe("manual-review");
    expect(fields.penalties).toEqual([]);
    expect(fields.actions[0]).toBe("時計を止める");
    expect(fields.actions).not.toContain("Xの負けを宣言する");
    expect(fields.unconfirmedFacts).toEqual(["a"]);
  });

  it("agreed: keeps the shared penalty, lowers confidence, keeps branch-specific actions with their condition", () => {
    const penalty = {
      type: "time-addition-opponent" as const,
      playerColor: "black" as const,
      timeAdjustmentSeconds: 120,
      description: "黒に2分追加",
    };
    const fields = unknownResolutionFields({
      kind: "agreed",
      facts: [A],
      branches: [
        {
          assignment: { a: "true" },
          result: decided({
            actions: ["共通", "Aの場合の手順"],
            penalties: [penalty],
          }),
        },
        {
          assignment: { a: "false" },
          result: decided({ actions: ["共通"], penalties: [penalty] }),
        },
      ],
    });
    expect(fields.penalties).toEqual([penalty]);
    expect(fields.confidence).toBe("medium");
    expect(fields.actions).toEqual([
      "共通",
      "［a →「true」 の場合］Aの場合の手順",
    ]);
    expect(fields.conclusion).toContain("どの場合でも同じ判断になります");
  });
});

// ---------------------------------------------------------------------------
// DT-001 (Standard illegal move)
// ---------------------------------------------------------------------------

describe("DT-001 with unknown answers", () => {
  it("playerColor unknown: the penalty side differs → manual-review", () => {
    const r = evaluate({}, { ...ILLEGAL_BASE, playerColor: "unknown" });
    expect(r.requiresFollowUp).toBe(false);
    expectManualReview(r.decision, ["playerColor"]);
  });

  it("subtype unknown on a first offence: every subtype adds 2 minutes → decided", () => {
    const r = evaluate({}, { ...ILLEGAL_BASE, subtype: "unknown" });
    expect(r.decision.kind).toBe("recommendation");
    expect(r.decision.penalties).toEqual([
      expect.objectContaining({
        type: "time-addition-opponent",
        playerColor: "black",
        timeAdjustmentSeconds: 120,
      }),
    ]);
    expect(r.decision.unconfirmedFacts).toEqual([QUESTIONS.subtype.label]);
    expect(r.decision.confidence).not.toBe("high");
    // 種類ごとに異なる手順（局面の戻し方）は条件付きで残す
    expect(
      r.decision.actions.some(
        (a) => a.includes("クイーンに置き換える") && a.startsWith("［")
      )
    ).toBe(true);
    expect(r.decision.actions).toContain("時計を止める");
  });

  it("subtype unknown on a second offence: mate possibility still asked, then decided", () => {
    const ctx = { illegalMoveHistory: { white: priors(1), black: [] } };
    const r1 = evaluate({}, { ...ILLEGAL_BASE, subtype: "unknown" }, ctx);
    // どの種類でも同じ質問（局面）が必要 → その質問を尋ねる
    expect(r1.requiresFollowUp).toBe(true);
    expect(r1.followUpQuestions.map((x) => x.id)).toEqual([
      "matePosition",
      "reinstatedFen",
    ]);
    const r2 = evaluate(
      {},
      {
        ...ILLEGAL_BASE,
        subtype: "unknown",
        matePosition: "fen",
        reinstatedFen: BLACK_QUEEN_WHITE_TO_MOVE,
      },
      ctx
    );
    expect(r2.decision.penalties).toEqual([
      expect.objectContaining({ type: "game-loss", playerColor: "white" }),
    ]);
    expect(r2.decision.unconfirmedFacts).toEqual([QUESTIONS.subtype.label]);
  });

  it("gameEndEvent unknown with the clock not pressed: no intervention either way → decided", () => {
    const r = evaluate(
      {},
      { ...ILLEGAL_BASE, gameEndEvent: "unknown", clockPressed: "false" }
    );
    expect(r.decision.kind).toBe("recommendation");
    expect(r.decision.intervention).toBe("no-intervention");
    expect(r.decision.penalties).toEqual([]);
    expect(r.decision.unconfirmedFacts).toEqual([QUESTIONS.gameEndEvent.label]);
  });

  it("gameEndEvent unknown with the clock pressed: penalty only if not ended → manual-review", () => {
    const r = evaluate({}, { ...ILLEGAL_BASE, gameEndEvent: "unknown" });
    expectManualReview(r.decision, ["gameEndEvent"]);
  });

  it("clockPressed unknown → manual-review (no penalty)", () => {
    const r = evaluate({}, { ...ILLEGAL_BASE, clockPressed: "unknown" });
    expectManualReview(r.decision, ["clockPressed"]);
  });

  it("clockPressed unknown is not needed for 7.5.3 (pressing the clock is the offence)", () => {
    const r = evaluate(
      {},
      {
        ...ILLEGAL_BASE,
        subtype: "clock-without-move",
        clockPressed: "unknown",
      }
    );
    expect(r.decision.kind).toBe("recommendation");
    expect(r.decision.unconfirmedFacts).toBeUndefined();
    expect(r.decision.penalties[0]?.timeAdjustmentSeconds).toBe(120);
  });

  it("two unknown facts are enumerated together", () => {
    const r = evaluate(
      {},
      { ...ILLEGAL_BASE, gameEndEvent: "unknown", clockPressed: "unknown" }
    );
    expectManualReview(r.decision, ["gameEndEvent", "clockPressed"]);
  });

  it("more than two unknown facts → manual-review without enumeration", () => {
    const r = evaluate(
      {},
      {
        subtype: "illegal-move",
        playerColor: "unknown",
        gameEndEvent: "unknown",
        clockPressed: "unknown",
      }
    );
    expectManualReview(r.decision, [
      "playerColor",
      "gameEndEvent",
      "clockPressed",
    ]);
    expect(r.decision.escalationReason).toContain("3件");
  });

  it("asks the unanswered questions first, without repeating the unknown one", () => {
    const r = evaluate({}, { gameEndEvent: "unknown" });
    expect(r.requiresFollowUp).toBe(true);
    const ids = r.followUpQuestions.map((x) => x.id);
    expect(ids).toEqual(["playerColor", "subtype", "clockPressed"]);
    expect(r.decision.missingFields).not.toContain(
      QUESTIONS.gameEndEvent.label
    );
  });
});

// ---------------------------------------------------------------------------
// DT-002 / DT-003 (Rapid / Blitz illegal move)
// ---------------------------------------------------------------------------

describe("DT-002 / DT-003 with unknown answers", () => {
  it("DT-002 subtype unknown on a first offence: 1 minute for every subtype → decided", () => {
    const r = evaluate(
      {},
      { ...ILLEGAL_BASE, subtype: "unknown" },
      { ruleset: RAPID_COMPETITION }
    );
    expect(r.decision.treeId).toBe("DT-002-illegal-move-fast-competition");
    expect(r.decision.penalties).toEqual([
      expect.objectContaining({
        type: "time-addition-opponent",
        playerColor: "black",
        timeAdjustmentSeconds: 60,
      }),
    ]);
    expect(r.decision.unconfirmedFacts).toEqual([QUESTIONS.subtype.label]);
  });

  it("DT-002 gameEndEvent / clockPressed / playerColor unknown → manual-review", () => {
    for (const id of ["gameEndEvent", "clockPressed", "playerColor"] as const) {
      const r = evaluate(
        {},
        { ...ILLEGAL_BASE, [id]: "unknown" },
        { ruleset: RAPID_COMPETITION }
      );
      expectManualReview(r.decision, [id]);
    }
  });

  const BASIC = {
    ...ILLEGAL_BASE,
    opponentMadeNextMove: "false",
    detectedBy: "arbiter",
  } as const;

  it("DT-003 opponentMadeNextMove unknown: correction possible only before the next move → manual-review", () => {
    const r = evaluate(
      {},
      { ...BASIC, opponentMadeNextMove: "unknown" },
      { ruleset: RAPID_BASIC }
    );
    expectManualReview(r.decision, ["opponentMadeNextMove"]);
  });

  it("DT-003 detectedBy unknown: a spectator report is not covered by A.5.2 → manual-review", () => {
    const r = evaluate(
      {},
      { ...BASIC, detectedBy: "unknown" },
      { ruleset: RAPID_BASIC }
    );
    expectManualReview(r.decision, ["detectedBy"]);
  });

  it("Blitz B.2 subtype unknown: the unverified 2 minutes for every subtype → decided, escalated", () => {
    const r = evaluate(
      {},
      { ...ILLEGAL_BASE, subtype: "unknown" },
      {
        ruleset: {
          competitionType: "blitz",
          supervisionRegime: "competition-rules",
          rulesVersion: "FIDE-2023",
        },
      }
    );
    expect(r.decision.kind).toBe("recommendation");
    expect(r.decision.penalties).toEqual([
      expect.objectContaining({
        type: "time-addition-opponent",
        playerColor: "black",
      }),
    ]);
    expect(r.decision.escalationRecommended).toBe(true);
    expect(r.decision.unconfirmedFacts).toEqual([QUESTIONS.subtype.label]);
  });

  it("Blitz B.2 with a tournament override: the override applies on the unknown path too", () => {
    const r = evaluate(
      {},
      { ...ILLEGAL_BASE, subtype: "unknown" },
      {
        ruleset: {
          competitionType: "blitz",
          supervisionRegime: "competition-rules",
          rulesVersion: "FIDE-2023",
          tournamentOverrides: {
            blitzCompetitionTimePenaltySeconds: {
              value: 60,
              source: { document: "要項", article: "第7条", quote: undefined },
            },
          },
        },
      }
    );
    expect(r.decision.penalties[0]?.timeAdjustmentSeconds).toBe(60);
  });

  it("DT-003 playerColor unknown: the penalty side differs → manual-review", () => {
    const r = evaluate(
      {},
      { ...BASIC, playerColor: "unknown" },
      { ruleset: RAPID_BASIC }
    );
    expectManualReview(r.decision, ["playerColor"]);
  });

  it("DT-003 subtype unknown before the next move: 1 minute for every subtype → decided", () => {
    const r = evaluate(
      {},
      { ...BASIC, subtype: "unknown" },
      { ruleset: RAPID_BASIC }
    );
    expect(r.decision.treeId).toBe("DT-003-illegal-move-fast-basic");
    expect(r.decision.penalties).toEqual([
      expect.objectContaining({
        type: "time-addition-opponent",
        playerColor: "black",
        timeAdjustmentSeconds: 60,
      }),
    ]);
  });

  it("DT-003 subtype unknown after the next move: a pawn on the last rank waits (A.5.4) → manual-review", () => {
    const r = evaluate(
      {},
      { ...BASIC, subtype: "unknown", opponentMadeNextMove: "true" },
      { ruleset: RAPID_BASIC }
    );
    expectManualReview(r.decision, ["subtype"]);
  });

  it("DT-003 detectedBy unknown is not needed after the opponent's next move", () => {
    const r = evaluate(
      {},
      { ...BASIC, opponentMadeNextMove: "true", detectedBy: "unknown" },
      { ruleset: RAPID_BASIC }
    );
    expect(r.decision.kind).toBe("recommendation");
    expect(r.decision.penalties).toEqual([]);
    // 回答ラウンドで一緒に質問されるため列挙はされるが、どの値でも同じ判断
    expect(r.decision.unconfirmedFacts).toEqual([QUESTIONS.detectedBy.label]);
  });

  it("DT-003 gameEndEvent / clockPressed unknown → manual-review", () => {
    for (const id of ["gameEndEvent", "clockPressed"] as const) {
      const r = evaluate(
        {},
        { ...BASIC, [id]: "unknown" },
        { ruleset: RAPID_BASIC }
      );
      expectManualReview(r.decision, [id]);
    }
  });
});

// ---------------------------------------------------------------------------
// DT-004 (flag fall)
// ---------------------------------------------------------------------------

const FLAG = { category: "clock-time" as const, subtype: "flag-fall" };
/** 白のフラッグ。黒は K+Q（局面からメイトの手順が見つかる）、白は K のみ */
const FLAG_BASE = {
  flagFallen: "white",
  endedBeforeFlag: "none",
  movesNotCompleted: "true",
  matePosition: "fen",
  positionFen: BLACK_QUEEN_WHITE_TO_MOVE,
} as const;

describe("DT-004 with unknown answers", () => {
  it("baseline: the answers give a loss for white", () => {
    const r = evaluate(FLAG, FLAG_BASE);
    expect(r.decision.penalties).toEqual([
      expect.objectContaining({ type: "game-loss", playerColor: "white" }),
    ]);
  });

  it("flagFallen unknown → manual-review", () => {
    const r = evaluate(FLAG, { ...FLAG_BASE, flagFallen: "unknown" });
    expectManualReview(r.decision, ["flagFallen"]);
  });

  it("endedBeforeFlag unknown: the earlier result or a loss → manual-review", () => {
    const r = evaluate(FLAG, { ...FLAG_BASE, endedBeforeFlag: "unknown" });
    expectManualReview(r.decision, ["endedBeforeFlag"]);
  });

  it("position unavailable is the tree's own unknown (specific consult-CA, not enumerated)", () => {
    const r = evaluate(FLAG, { ...FLAG_BASE, matePosition: "unknown" });
    expect(r.requiresFollowUp).toBe(false);
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.penalties).toEqual([]);
    expect(r.decision.unconfirmedFacts ?? []).toEqual([]);
  });

  const BOTH = {
    flagFallen: "both",
    bothFlagsOrder: "unknown",
    endedBeforeFlag: "none",
    quickplayGuidelinesApply: "true",
    lastPeriod: "true",
  } as const;

  it("lastPeriod unknown (both flags, order unknown): draw or continue → manual-review", () => {
    const r = evaluate(FLAG, { ...BOTH, lastPeriod: "unknown" });
    expectManualReview(r.decision, ["lastPeriod"]);
  });

  it("quickplayGuidelinesApply unknown: CA or draw → manual-review", () => {
    const r = evaluate(FLAG, { ...BOTH, quickplayGuidelinesApply: "unknown" });
    expectManualReview(r.decision, ["quickplayGuidelinesApply"]);
  });

  it("quickplayGuidelinesApply unknown and the guidelines do not matter in Blitz", () => {
    const r = evaluate(
      FLAG,
      { ...BOTH, quickplayGuidelinesApply: "unknown" },
      {
        ruleset: {
          competitionType: "blitz",
          supervisionRegime: "competition-rules",
          rulesVersion: "FIDE-2023",
        },
      }
    );
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.unconfirmedFacts).toBeUndefined();
  });

  it("clockTimeSubtype unknown → manual-review", () => {
    const r = evaluate(
      { category: "clock-time" },
      { clockTimeSubtype: "unknown" }
    );
    expectManualReview(r.decision, ["clockTimeSubtype"]);
  });
});

// ---------------------------------------------------------------------------
// DT-005 Draw Claim / DT-006 Automatic Draw
// ---------------------------------------------------------------------------

const DRAW = {
  category: "draw" as const,
  subtype: "threefold-repetition-claim",
};
const CLAIM = {
  drawSubtype: "threefold-repetition-claim",
  claimant: "white",
  lastMover: "black",
  claimMode: "just-appeared",
  touchedPiece: "false",
  repetitionCheck: "met",
} as const;

describe("DT-005 with unknown answers", () => {
  it("claimant unknown: whether the claimant had the move depends on who claimed → manual-review", () => {
    // 黒が最後に指した: 白のクレームなら正しいクレーム（ドロー）、黒なら手番ではない
    const r = evaluate(DRAW, { ...CLAIM, claimant: "unknown" });
    expectManualReview(r.decision, ["claimant"]);
  });

  it("claimant unknown with an incorrect claim: time goes to different players → manual-review", () => {
    const r = evaluate(DRAW, {
      ...CLAIM,
      claimant: "unknown",
      repetitionCheck: "not-met",
    });
    expectManualReview(r.decision, ["claimant"]);
  });

  it("lastMover unknown → manual-review (the side to move is never taken from the clock)", () => {
    const r = evaluate(DRAW, { ...CLAIM, lastMover: "unknown" });
    expectManualReview(r.decision, ["lastMover"]);
  });

  it("lastMover unknown with a correct 50-move claim: not-on-move vs draw → manual-review", () => {
    const r = evaluate(
      { category: "draw", subtype: "fifty-move-claim" },
      {
        ...CLAIM,
        drawSubtype: "fifty-move-claim",
        repetitionCheck: undefined,
        fiftyMoveCheck: "met",
        lastMover: "unknown",
      }
    );
    expectManualReview(r.decision, ["lastMover"]);
  });

  it("touchedPiece unknown → manual-review", () => {
    const r = evaluate(DRAW, { ...CLAIM, touchedPiece: "unknown" });
    expectManualReview(r.decision, ["touchedPiece"]);
  });

  it("claimMode unknown: the 9.2.1 branch needs moveWritten (unanswered) → manual-review", () => {
    const r = evaluate(DRAW, { ...CLAIM, claimMode: "unknown" });
    expectManualReview(r.decision, ["claimMode"]);
  });

  it("claimMode unknown with the move written: a correct claim either way → decided", () => {
    const r = evaluate(DRAW, {
      ...CLAIM,
      claimMode: "unknown",
      moveWritten: "true",
    });
    expect(r.decision.penalties).toEqual([
      expect.objectContaining({ type: "draw" }),
    ]);
    expect(r.decision.unconfirmedFacts).toEqual([QUESTIONS.claimMode.label]);
  });

  it("moveWritten unknown (9.2.1) → manual-review", () => {
    const r = evaluate(DRAW, {
      ...CLAIM,
      claimMode: "about-to-appear",
      moveWritten: "unknown",
    });
    expectManualReview(r.decision, ["moveWritten"]);
  });

  it("75 moves: the last-move checkmate is part of the reconstruction result, not a separate question", () => {
    expect(
      (QUESTIONS as Record<string, unknown>).lastMoveCheckmate
    ).toBeUndefined();
    expect(QUESTIONS.seventyFiveCheck.options.map((o) => o.value)).toContain(
      "met-checkmate"
    );
    const r = evaluate(
      { category: "draw", subtype: "75-move-rule" },
      { drawSubtype: "75-move-rule", seventyFiveCheck: "met-checkmate" }
    );
    expect(r.decision.treeId).toBe("DT-006-automatic-draw");
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.conclusion).toContain("チェックメイトが優先");
  });

  it("drawSubtype unknown → manual-review", () => {
    const r = evaluate({ category: "draw" }, { drawSubtype: "unknown" });
    expectManualReview(r.decision, ["drawSubtype"]);
  });
});

// ---------------------------------------------------------------------------
// IncidentCounter (§3.3 4: no penalty on an unknown path unless all branches agree)
// ---------------------------------------------------------------------------

describe("IncidentCounter with decisions on unknown paths", () => {
  function counted(answers: Partial<Record<IncidentQuestionId, string>>) {
    const inc = applyIncidentAnswers(incident(), answers);
    const { decision } = new DecisionEngine(fixedProviders()).processIncident({
      incident: inc,
      ruleset: STANDARD,
      illegalMoveHistory: { white: [], black: [] },
    });
    return {
      decision,
      penalised: IncidentCounter.isPenalisedIllegalMove({
        incident: inc,
        decision: { ...decision, incidentId: inc.id },
      }),
    };
  }

  it("counts an agreed decision with a 7.5.5 penalty (subtype unknown)", () => {
    const r = counted({ ...ILLEGAL_BASE, subtype: "unknown" });
    expect(r.decision.treeId).toBe("DT-001-illegal-move-standard");
    expect(r.penalised).toBe(true);
  });

  it("does not count a manual-review decision on an unknown path", () => {
    for (const id of ["clockPressed", "gameEndEvent", "playerColor"] as const) {
      const r = counted({ ...ILLEGAL_BASE, [id]: "unknown" });
      expect(r.decision.kind).toBe("manual-review");
      expect(r.penalised).toBe(false);
    }
  });
});

describe("merged decision text", () => {
  it("keeps branch-specific steps as one line per branch (subtype unknown)", () => {
    const r = evaluate({}, { ...ILLEGAL_BASE, subtype: "unknown" });
    const conditional = r.decision.actions.filter((a) => a.startsWith("［"));
    // 4 種類それぞれの手順（局面の戻し方など）が1行ずつ
    expect(conditional).toHaveLength(4);
    expect(conditional.some((a) => a.includes("クイーンに置き換える"))).toBe(
      true
    );
  });

  it("puts branches with the same steps on one line", () => {
    const B = q("b", ["x", "y", "z"]);
    const fields = unknownResolutionFields({
      kind: "agreed",
      facts: [B],
      branches: [
        {
          assignment: { b: "x" },
          result: decided({ actions: ["共通", "手順1"] }),
        },
        {
          assignment: { b: "y" },
          result: decided({ actions: ["共通", "手順1"] }),
        },
        {
          assignment: { b: "z" },
          result: decided({ actions: ["共通", "手順2"] }),
        },
      ],
    });
    expect(fields.actions).toEqual([
      "共通",
      "［b →「x」 または b →「y」 の場合］手順1",
      "［b →「z」 の場合］手順2",
    ]);
  });

  it("labels escalation reasons with their branch when only some branches have one", () => {
    const fields = unknownResolutionFields({
      kind: "agreed",
      facts: [QUESTIONS.gameEndEvent],
      branches: [
        {
          assignment: { gameEndEvent: "resignation" },
          result: decided({
            escalationRecommended: true,
            escalationReason: "理由A",
          }),
        },
        { assignment: { gameEndEvent: "in-progress" }, result: decided() },
      ],
    });
    expect(fields.escalationRecommended).toBe(true);
    expect(fields.escalationReason).toContain("理由A");
    expect(fields.escalationReason).toContain("「投了の発言や動作」");
  });
});
