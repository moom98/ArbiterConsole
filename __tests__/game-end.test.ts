import { describe, it, expect } from "vitest";
import {
  DecisionEngine,
  type RulesetContext,
} from "@/lib/domain/decision-engine";
import type { Incident } from "@/lib/domain/entities";
import { IllegalMoveStandardTree } from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";
import { IllegalMoveFastCompetitionTree } from "@/lib/domain/decision-trees/dt-002-illegal-move-fast-competition";
import { IllegalMoveFastBasicTree } from "@/lib/domain/decision-trees/dt-003-illegal-move-fast-basic";
import { FlagFallTree } from "@/lib/domain/decision-trees/dt-004-flag-fall";
import {
  QUESTIONS,
  applyIncidentAnswers,
  isQuestionVisible,
  type IncidentQuestionId,
} from "@/lib/domain/follow-up";
import {
  ENDED_BEFORE_FLAG_VALUES,
  GAME_END_EVENTS,
  endedBeforeFlagFromEvent,
  gameEndedFromEvent,
  recordStateAction,
} from "@/lib/domain/services/game-end";
import { FACT_USAGES, getFactDefinition } from "@/lib/domain/facts/catalog";
import { fixedProviders, FIXED_NOW } from "./helpers";

/**
 * ADR-014 §3: 対局の終了は観察した出来事（game.end-event / ct.ended-before-flag）から
 * 求める。握手だけでは終了としない。結果の記入・署名の状態は記録用。
 */

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

const STANDARD: RulesetContext = {
  competitionType: "standard",
  rulesVersion: "FIDE-2023",
};
const BLITZ_COMPETITION: RulesetContext = {
  competitionType: "blitz",
  supervisionRegime: "competition-rules",
  rulesVersion: "FIDE-2023",
};

function engine() {
  return new DecisionEngine(fixedProviders());
}

function evaluate(
  base: Partial<Incident>,
  answers: Partial<Record<IncidentQuestionId, string>>,
  ruleset: RulesetContext = STANDARD
) {
  return engine().processIncident({
    incident: applyIncidentAnswers(incident(base), answers),
    ruleset,
    illegalMoveHistory: { white: [], black: [] },
  });
}

const ILLEGAL = {
  playerColor: "white",
  subtype: "illegal-move",
  clockPressed: "true",
} as const;

describe("game-end service", () => {
  it("only in-progress / none mean the game is still going", () => {
    for (const e of GAME_END_EVENTS)
      expect(gameEndedFromEvent(e)).toBe(e !== "in-progress");
    for (const e of ENDED_BEFORE_FLAG_VALUES)
      expect(endedBeforeFlagFromEvent(e)).toBe(e !== "none");
    expect(gameEndedFromEvent(undefined)).toBeUndefined();
    expect(endedBeforeFlagFromEvent(undefined)).toBeUndefined();
  });

  it("asks to check signatures unless both players signed", () => {
    expect(recordStateAction(undefined)).toBeUndefined();
    expect(recordStateAction("both-signed")).toBeUndefined();
    expect(recordStateAction("none")).toContain("結果の記入");
    expect(recordStateAction("written")).toContain("署名");
    expect(recordStateAction("one-signed")).toContain("署名");
  });
});

describe("questions: a handshake alone never ends the game", () => {
  it("offers no handshake option and says so in the help", () => {
    for (const q of [QUESTIONS.gameEndEvent, QUESTIONS.endedBeforeFlag]) {
      expect(q.options.map((o) => o.label).join()).not.toContain("握手");
      expect(q.help).toContain("握手だけでは対局の終了として扱いません");
      expect(q.onUnknown).toBe("enumerate");
    }
  });

  it("says that an illegal mating or stalemating move does not end the game", () => {
    for (const q of [QUESTIONS.gameEndEvent, QUESTIONS.endedBeforeFlag])
      expect(q.help).toContain("5.1.1 / 5.2.1");
  });

  it("the record state is optional and shown only once the game has ended", () => {
    const q = QUESTIONS.gameRecordState;
    expect(q.optional).toBe(true);
    expect(isQuestionVisible(q, { gameEndEvent: "in-progress" })).toBe(false);
    expect(isQuestionVisible(q, { gameEndEvent: "unknown" })).toBe(false);
    for (const e of GAME_END_EVENTS.filter((v) => v !== "in-progress"))
      expect(isQuestionVisible(q, { gameEndEvent: e })).toBe(true);
  });

  it("maps the catalogue facts one to one onto the DT questions", () => {
    const end = FACT_USAGES.find(
      (u) => u.factId === "game.end-event" && u.category === "illegal-move"
    );
    expect(end?.dtQuestionIds).toEqual(["gameEndEvent"]);
    expect(end?.dtValues).toBeUndefined();
    const flag = FACT_USAGES.find((u) => u.factId === "ct.ended-before-flag");
    expect(flag?.dtQuestionIds).toEqual(["endedBeforeFlag"]);
    expect(flag?.dtValues).toBeUndefined();
    // 記録用の fact は DT の質問に対応付けない（必要かは appliesWhen で決まる）
    const record = FACT_USAGES.find(
      (u) => u.factId === "game.record-state" && u.category === "illegal-move"
    );
    expect(record?.dtQuestionIds).toBeUndefined();

    const values = (id: string) => {
      const answer = getFactDefinition(id)?.answer;
      return answer?.kind === "choice"
        ? answer.options.map((o) => o.value).sort()
        : [];
    };
    expect(values("game.end-event")).toEqual([...GAME_END_EVENTS].sort());
    expect(values("ct.ended-before-flag")).toEqual(
      [...ENDED_BEFORE_FLAG_VALUES].sort()
    );
  });
});

describe("answers", () => {
  it("stores the end event and the record state", () => {
    const inc = applyIncidentAnswers(incident(), {
      gameEndEvent: "resignation",
      gameRecordState: "one-signed",
    });
    expect(inc.illegalMoveFacts).toMatchObject({
      endEvent: "resignation",
      recordState: "one-signed",
    });
  });

  it("drops the record state when the game is still in progress", () => {
    const ended = applyIncidentAnswers(incident(), {
      gameEndEvent: "resignation",
      gameRecordState: "both-signed",
    });
    const back = applyIncidentAnswers(ended, { gameEndEvent: "in-progress" });
    expect(back.illegalMoveFacts?.endEvent).toBe("in-progress");
    expect(back.illegalMoveFacts?.recordState).toBeUndefined();
  });

  it("does not record an unknown record state, and keeps no unknown for it", () => {
    const signed = applyIncidentAnswers(incident(), {
      gameEndEvent: "resignation",
      gameRecordState: "both-signed",
    });
    const inc = applyIncidentAnswers(signed, { gameRecordState: "unknown" });
    expect(inc.illegalMoveFacts?.recordState).toBeUndefined();
    expect(inc.unknownAnswers).toBeUndefined();
  });

  it("replaces the legacy yes/no answers and their unknowns", () => {
    const legacy = incident({
      illegalMoveFacts: { gameEnded: true },
      unknownAnswers: ["gameEnded"],
    });
    const next = applyIncidentAnswers(legacy, { gameEndEvent: "in-progress" });
    expect(next.illegalMoveFacts?.gameEnded).toBeUndefined();
    expect(next.unknownAnswers).toBeUndefined();

    const flagLegacy = incident({
      category: "clock-time",
      subtype: "flag-fall",
      flagFallFacts: { flagFallen: "white", gameEndedBeforeFlag: true },
      unknownAnswers: ["gameEndedBeforeFlag"],
    });
    const flagNext = applyIncidentAnswers(flagLegacy, {
      endedBeforeFlag: "unknown",
    });
    expect(flagNext.flagFallFacts?.gameEndedBeforeFlag).toBeUndefined();
    expect(flagNext.flagFallFacts?.endedBeforeFlag).toBeUndefined();
    expect(flagNext.unknownAnswers).toEqual(["endedBeforeFlag"]);
  });
});

describe("DT-001: game ended from the observed event", () => {
  const tree = () => new IllegalMoveStandardTree(fixedProviders());
  const base = {
    playerColor: "white",
    subtype: "illegal-move",
    clockPressed: true,
    playerIncidentCount: 0,
  } as const;

  it("asks the end event with the optional record state, not the legacy yes/no", () => {
    const r = tree().evaluate({ ...base });
    expect(r.status).toBe("needs-input");
    if (r.status !== "needs-input") return;
    expect(r.questions.map((q) => q.id)).toEqual([
      "gameEndEvent",
      "gameRecordState",
    ]);
    // 任意の質問は不足項目に含めない
    expect(r.decision.missingFields).toEqual([QUESTIONS.gameEndEvent.label]);
  });

  it.each(GAME_END_EVENTS.filter((e) => e !== "in-progress"))(
    "%s: the result stands, no penalty",
    (endEvent) => {
      const r = tree().evaluate({ ...base, endEvent });
      expect(r.status).toBe("decided");
      expect(r.decision.intervention).toBe("no-intervention");
      expect(r.decision.penalties).toEqual([]);
      expect(r.decision.conclusion).toContain("対局終了後");
      // その他・チェックメイト・ステイルメイトは終了の根拠（手の合法性）を確認する
      expect(r.decision.confidence).toBe(
        ["other", "checkmate", "stalemate"].includes(endEvent)
          ? "medium"
          : "high"
      );
    }
  );

  it("names the event and asks for the signatures", () => {
    const r = tree().evaluate({
      ...base,
      endEvent: "checkmate",
      recordState: "written",
    });
    expect(r.decision.conclusion).toContain("チェックメイト");
    expect(r.decision.actions).toContain("両プレーヤーの署名を確認する");
  });

  it("checkmate / stalemate: asks whether the final move was legal (5.1.1 / 5.2.1)", () => {
    const mate = tree().evaluate({ ...base, endEvent: "checkmate" });
    expect(mate.decision.actions.join()).toContain("合法だったか確認する");
    expect(mate.decision.sources.map((s) => s.article)).toContain("FIDE 5.1.1");
    const stale = tree().evaluate({ ...base, endEvent: "stalemate" });
    expect(stale.decision.sources.map((s) => s.article)).toContain(
      "FIDE 5.2.1"
    );
    const resign = tree().evaluate({ ...base, endEvent: "resignation" });
    expect(resign.decision.actions.join()).not.toContain("合法だったか");
  });

  it("'other' asks the arbiter to confirm what ended the game", () => {
    const r = tree().evaluate({ ...base, endEvent: "other" });
    expect(r.decision.actions.join()).toContain("終了の根拠");
  });

  it("in-progress continues to the 7.5 penalty", () => {
    const r = tree().evaluate({ ...base, endEvent: "in-progress" });
    expect(r.status).toBe("decided");
    expect(r.decision.penalties.length).toBeGreaterThan(0);
  });
});

describe("DT-002 / DT-003: game ended from the observed event", () => {
  const base = {
    playerColor: "black",
    subtype: "illegal-move",
    clockPressed: true,
    playerIncidentCount: 0,
    opponentMadeNextMove: false,
    detectedBy: "arbiter",
  } as const;

  it("a confirmed time-out before the illegal move was noticed: result stands", () => {
    for (const tree of [
      new IllegalMoveFastCompetitionTree(fixedProviders(), "blitz"),
      new IllegalMoveFastBasicTree(fixedProviders(), "rapid"),
    ]) {
      const r = tree.evaluate({ ...base, endEvent: "time-out" });
      expect(r.status).toBe("decided");
      expect(r.decision.intervention).toBe("no-intervention");
      expect(r.decision.conclusion).toContain("時間切れの確定");
    }
  });

  it("asks the end event with the record state in the first round", () => {
    const r = new IllegalMoveFastCompetitionTree(
      fixedProviders(),
      "blitz"
    ).evaluate({ ...base });
    expect(r.status === "needs-input" && r.questions.map((q) => q.id)).toEqual([
      "gameEndEvent",
      "gameRecordState",
    ]);
  });
});

describe("DT-004: ended before the flag was established", () => {
  const tree = () => new FlagFallTree(fixedProviders());
  const base = {
    competitionType: "standard",
    flagFallen: "white",
    movesNotCompleted: true,
  } as const;

  it("asks endedBeforeFlag (not the legacy yes/no)", () => {
    const r = tree().evaluate({ ...base });
    expect(r.status === "needs-input" && r.questions.map((q) => q.id)).toEqual([
      "endedBeforeFlag",
    ]);
  });

  it("a checkmate before the flag was established stands (6.8), if the mating move was legal (5.1.1)", () => {
    const r = tree().evaluate({ ...base, endedBeforeFlag: "checkmate" });
    expect(r.status).toBe("decided");
    expect(r.decision.intervention).toBe("no-intervention");
    expect(r.decision.conclusion).toContain("チェックメイト");
    expect(r.decision.confidence).toBe("medium");
    expect(r.decision.actions.join()).toContain("合法だったか確認する");
    expect(r.decision.sources.map((s) => s.article)).toContain("FIDE 5.1.1");
  });

  it("a resignation before the flag stands with high confidence", () => {
    const r = tree().evaluate({ ...base, endedBeforeFlag: "resignation" });
    expect(r.decision.confidence).toBe("high");
  });

  it("'other' lowers the confidence and asks for the reason", () => {
    const r = tree().evaluate({ ...base, endedBeforeFlag: "other" });
    expect(r.decision.confidence).toBe("medium");
    expect(r.decision.actions.join()).toContain("終了の根拠");
  });

  it("none continues to the flag-fall ruling", () => {
    const r = tree().evaluate({ ...base, endedBeforeFlag: "none" });
    expect(r.decision.conclusion).not.toContain("フラッグが確定する前に対局は");
  });
});

describe("engine: legacy yes/no answers are not used (ADR-014 §3)", () => {
  it("a stored legacy gameEnded=true is re-asked, never decided as game over", () => {
    const r = engine().processIncident({
      incident: incident({
        playerColor: "white",
        subtype: "illegal-move",
        illegalMoveFacts: {
          subtype: "illegal-move",
          clockPressed: true,
          gameEnded: true,
        },
      }),
      ruleset: STANDARD,
      illegalMoveHistory: { white: [], black: [] },
    });
    expect(r.requiresFollowUp).toBe(true);
    expect(r.followUpQuestions.map((q) => q.id)).toContain("gameEndEvent");
  });

  it("a stored legacy gameEndedBeforeFlag=true is re-asked", () => {
    const r = engine().processIncident({
      incident: incident({
        category: "clock-time",
        subtype: "flag-fall",
        playerColor: "white",
        flagFallFacts: {
          flagFallen: "white",
          gameEndedBeforeFlag: true,
          movesNotCompleted: true,
        },
      }),
      ruleset: STANDARD,
    });
    expect(r.requiresFollowUp).toBe(true);
    expect(r.followUpQuestions.map((q) => q.id)).toEqual(["endedBeforeFlag"]);
  });
});

describe("engine: unknown end event", () => {
  it("with the clock pressed: ended or not gives different rulings → manual review", () => {
    const r = evaluate({}, { ...ILLEGAL, gameEndEvent: "unknown" });
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.penalties).toEqual([]);
    expect(r.decision.unconfirmedFacts).toEqual([QUESTIONS.gameEndEvent.label]);
  });

  it("does not ask the record state when the end event is unknown", () => {
    const r = evaluate(
      {},
      { playerColor: "white", gameEndEvent: "unknown" },
      BLITZ_COMPETITION
    );
    expect(r.requiresFollowUp).toBe(true);
    const ids = r.followUpQuestions.map((q) => q.id);
    expect(ids).toContain("subtype");
    expect(ids).not.toContain("gameEndEvent");
    expect(ids).not.toContain("gameRecordState");
  });

  it("a flag fall with an unknown earlier end: result stands or loss → manual review", () => {
    const r = evaluate(
      { category: "clock-time", subtype: "flag-fall" },
      {
        flagFallen: "white",
        endedBeforeFlag: "unknown",
        movesNotCompleted: "true",
        matePosition: "unknown",
      }
    );
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.unconfirmedFacts).toEqual([
      QUESTIONS.endedBeforeFlag.label,
    ]);
  });
});
