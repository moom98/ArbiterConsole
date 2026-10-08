import { describe, it, expect } from "vitest";
import {
  DT_007_ID,
  TouchMoveTree,
  type TouchMoveInput,
} from "@/lib/domain/decision-trees/dt-007-touch-move";
import {
  DecisionEngine,
  type DecisionEngineContext,
  type RulesetContext,
} from "@/lib/domain/decision-engine";
import {
  QUESTIONS,
  QUICK_REPORTS,
  applyIncidentAnswers,
  enumerableValues,
  isKnownSubtype,
} from "@/lib/domain/follow-up";
import { touchObligation } from "@/lib/domain/services/touch-move";
import { IncidentCounter } from "@/lib/domain/services/incident-counter";
import { classifyByKeywords } from "@/lib/domain/llm/keyword-classifier";
import type { Decision, Incident } from "@/lib/domain/entities";
import { chessJsPositionPort as port } from "@/lib/infrastructure/chess/chess-js-position-port";
import { FIXED_NOW, fixedProviders } from "./helpers";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function run(input: Partial<TouchMoveInput>) {
  return new TouchMoveTree(fixedProviders()).evaluate({
    arbiterObserved: true,
    ...input,
  });
}
function ids(r: ReturnType<typeof run>) {
  return r.status === "needs-input" ? r.questions.map((q) => q.id) : [];
}
function articles(r: { decision: Decision }) {
  return r.decision.sources.map((s) => s.article);
}

/** 意図して触れた・手番・調整の表明なし・アービターが観察 */
const ON_MOVE: Partial<TouchMoveInput> = {
  player: "white",
  how: "grasped",
  adjustDeclared: false,
  onMove: true,
  arbiterObserved: true,
};

describe("DT-007 Touch Move: questions", () => {
  it("asks the observation round first, with the conditional questions attached", () => {
    const r = run({ arbiterObserved: false });
    expect(ids(r)).toEqual([
      "touchPlayer",
      "touchHow",
      "touchAdjustDeclared",
      "touchOnMove",
      "touchClaimedByOpponent",
      "touchClaimTiming",
      "touchWhatNext",
      "touchPromotion",
      "touchReleased",
      "touchChangedAfter",
      "touchedPieces",
      "touchFen",
    ]);
    expect(r.decision.treeId).toBe(DT_007_ID);
    expect(DT_007_ID).toBe("DT-007-touch-move");
  });

  it("does not ask about the opponent's claim when the arbiter observed it (4.8 does not apply)", () => {
    expect(ids(run({}))).not.toContain("touchClaimedByOpponent");
  });

  it("re-asks a conditional question without its parent condition", () => {
    const r = run({ ...ON_MOVE, whatNext: "not-moved" });
    expect(ids(r)).toEqual(["touchedPieces", "touchFen"]);
    if (r.status === "needs-input")
      expect(r.questions.every((q) => q.showWhen === undefined)).toBe(true);
    const claim = run({
      ...ON_MOVE,
      arbiterObserved: false,
      claimedByOpponent: true,
      whatNext: "moved-touched",
      released: true,
      promotion: "none",
      changedAfter: true,
    });
    expect(ids(claim)).toEqual(["touchClaimTiming"]);
  });

  it("asks promotion, release and a later change for a moved touched piece", () => {
    const r = run({ ...ON_MOVE, whatNext: "moved-touched" });
    expect(ids(r)).toEqual([
      "touchPromotion",
      "touchReleased",
      "touchChangedAfter",
    ]);
    // 動かし直したかは「手を離した」ときだけ表示する
    if (r.status === "needs-input")
      expect(
        r.questions.find((q) => q.id === "touchChangedAfter")?.showWhen
      ).toEqual({ questionId: "touchReleased", values: ["true"] });
    // 昇格の駒が確定した（手は離していない）場合は、単独で質問する
    const promo = run({
      ...ON_MOVE,
      whatNext: "moved-touched",
      released: false,
      promotion: "promotion-placed",
    });
    expect(ids(promo)).toEqual(["touchChangedAfter"]);
    if (promo.status === "needs-input")
      expect(promo.questions[0].showWhen).toBeUndefined();
  });

  it("the adjust question has no display condition (asked even when 'how' is unknown)", () => {
    expect(QUESTIONS.touchAdjustDeclared.showWhen).toBeUndefined();
  });
});

describe("DT-007 Touch Move: no obligation (4.2 / 4.3)", () => {
  it("clearly accidental contact → no obligation (4.2.2)", () => {
    const r = run({ how: "brushed" });
    expect(r.status).toBe("decided");
    expect(r.decision.intervention).toBe("no-intervention");
    expect(r.decision.penalties).toEqual([]);
    expect(articles(r)).toContain("FIDE 4.2.2");
  });

  it("not on move → 4.3 does not apply", () => {
    const r = run({ player: "black", how: "lifted", onMove: false });
    expect(r.status).toBe("decided");
    expect(r.decision.conclusion).toContain("4.3");
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE 4.3", "FIDE 4.2.1", "FIDE 12.9"])
    );
  });

  it("adjusting with a prior declaration on move → no obligation (4.2.1), medium confidence", () => {
    const r = run({ ...ON_MOVE, adjustDeclared: true });
    expect(r.status).toBe("decided");
    expect(r.decision.confidence).toBe("medium");
    expect(articles(r)).toContain("FIDE 4.2.1");
  });

  it("declaring 'adjust' when not on move does not help: 4.3 still does not apply", () => {
    const r = run({ ...ON_MOVE, adjustDeclared: true, onMove: false });
    expect(r.decision.conclusion).toContain("手番でない");
  });
});

describe("DT-007 Touch Move: the opponent's claim (4.8)", () => {
  const claimed: Partial<TouchMoveInput> = {
    ...ON_MOVE,
    arbiterObserved: false,
    claimedByOpponent: true,
    claimBeforeOwnTouch: false,
  };
  const changed: Partial<TouchMoveInput> = {
    whatNext: "moved-touched",
    released: true,
    promotion: "none",
    changedAfter: true,
  };
  it("claim after touching a piece, not observed by the arbiter → claim forfeited", () => {
    const r = run(claimed);
    expect(r.status).toBe("decided");
    expect(r.decision.intervention).toBe("no-intervention");
    expect(articles(r)).toContain("FIDE 4.8");
  });

  it("a late claim is forfeited even when another piece was moved", () => {
    const r = run({
      ...claimed,
      whatNext: "moved-other",
      touchedText: "e2",
      obligation: touchObligation(port, "white", "e2", START),
    });
    expect(r.decision.intervention).toBe("no-intervention");
    expect(r.decision.touchMoveViolation).toBeUndefined();
  });

  it("the arbiter observed the violation → intervenes despite the late claim", () => {
    const r = run({ ...claimed, arbiterObserved: true, ...changed });
    expect(r.decision.intervention).toBe("immediate");
    expect(r.decision.confidence).toBe("high");
  });

  it("a timely claim continues to the decision", () => {
    const r = run({ ...claimed, claimBeforeOwnTouch: true, ...changed });
    expect(r.decision.intervention).toBe("immediate");
    expect(articles(r)).toContain("FIDE 4.7");
    expect(r.decision.confidence).toBe("high");
  });

  it("neither observed nor claimed (e.g. a spectator's report) → check the facts first, medium confidence", () => {
    const r = run({
      ...ON_MOVE,
      arbiterObserved: false,
      claimedByOpponent: false,
      ...changed,
    });
    expect(r.decision.intervention).toBe("immediate");
    expect(r.decision.confidence).toBe("medium");
    expect(r.decision.actions.join("\n")).toContain("事実を確認");
  });

  it("the 'no' answer is not described as an arbiter observation", () => {
    const no = QUESTIONS.touchClaimedByOpponent.options.find(
      (o) => o.value === "false"
    );
    expect(no?.label).not.toContain("アービター");
  });
});

describe("DT-007 Touch Move: the touched piece was moved (4.7 / 4.4.4)", () => {
  const moved = { ...ON_MOVE, whatNext: "moved-touched" as const };
  it("released, then moved to another square → restore; recorded as a violation (4.7)", () => {
    const r = run({
      ...moved,
      released: true,
      promotion: "none",
      changedAfter: true,
      priorViolations: 0,
    });
    expect(r.decision.intervention).toBe("immediate");
    expect(r.decision.penalties).toEqual([]);
    expect(r.decision.touchMoveViolation).toBe(true);
    expect(r.decision.actions.join("\n")).toContain("今回を含めて 1 回");
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE 4.7", "JCF NA p.20", "FIDE 12.9"])
    );
  });
  it("released and not changed → the move stands, no violation", () => {
    const r = run({
      ...moved,
      released: true,
      promotion: "none",
      changedAfter: false,
    });
    expect(r.decision.intervention).toBe("no-intervention");
    expect(r.decision.touchMoveViolation).toBeUndefined();
    expect(articles(r)).toContain("FIDE 4.7");
  });
  it("not released → no violation; another square is still possible", () => {
    const r = run({ ...moved, released: false, promotion: "none" });
    expect(r.decision.intervention).toBe("no-intervention");
  });
  it("promotion piece touched the square, then swapped → restore the first piece (4.4.4), violation", () => {
    const r = run({
      ...moved,
      released: false,
      promotion: "promotion-placed",
      changedAfter: true,
    });
    expect(r.decision.conclusion).toContain("4.4.4");
    expect(r.decision.touchMoveViolation).toBe(true);
    expect(articles(r)).toContain("FIDE 4.4");
  });
  it("promotion piece touched the square and kept → no violation", () => {
    const r = run({
      ...moved,
      released: false,
      promotion: "promotion-placed",
      changedAfter: false,
    });
    expect(r.decision.intervention).toBe("no-intervention");
    expect(r.decision.conclusion).toContain("4.4.4");
  });
});

describe("DT-007 Touch Move: which piece must be moved (4.3 / 4.4 / 4.5)", () => {
  const obligation = (text: string, fen?: string) =>
    touchObligation(port, "white", text, fen);

  it("not moved yet → tells the player which piece, no penalty, not a violation", () => {
    const r = run({
      ...ON_MOVE,
      whatNext: "not-moved",
      touchedText: "e2 d1",
      obligation: obligation("e2 d1", START),
    });
    expect(r.status).toBe("decided");
    expect(r.decision.conclusion).toContain(
      "白ポーン（e2）を動かさなければなりません"
    );
    expect(r.decision.actions).toContain("許される手: e3, e4");
    expect(r.decision.confidence).toBe("high");
    expect(r.decision.penalties).toEqual([]);
    expect(r.decision.touchMoveViolation).toBeUndefined();
  });

  it("moved another piece → restore, play the touched piece; recorded as a violation; penalty only at discretion", () => {
    const r = run({
      ...ON_MOVE,
      whatNext: "moved-other",
      touchedText: "e2",
      obligation: obligation("e2", START),
      priorViolations: 1,
    });
    expect(r.decision.intervention).toBe("immediate");
    expect(r.decision.penalties).toEqual([]);
    expect(r.decision.touchMoveViolation).toBe(true);
    expect(r.decision.actions.join("\n")).toContain("今回を含めて 2 回");
    expect(r.decision.actions.join("\n")).toContain(
      "7.5 の違法手の回数には含めません"
    );
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE 4.3", "FIDE 12.9", "JCF NA p.20"])
    );
  });

  it("without a position → steps to check on the board, medium confidence", () => {
    const r = run({
      ...ON_MOVE,
      whatNext: "not-moved",
      touchedText: "Pe2",
      obligation: touchObligation(undefined, "white", "Pe2"),
    });
    expect(r.decision.confidence).toBe("medium");
    expect(r.decision.actions.join("\n")).toContain("盤上で確認");
  });

  it("4.5: none of the touched pieces can move → any legal move", () => {
    const r = run({
      ...ON_MOVE,
      whatNext: "not-moved",
      touchedText: "a1",
      obligation: obligation("a1", START),
    });
    expect(r.decision.conclusion).toContain("任意の合法手");
    expect(articles(r)).toContain("FIDE 4.5");
  });

  it("castling obligation cites 4.4", () => {
    const fen = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";
    const r = run({
      ...ON_MOVE,
      whatNext: "not-moved",
      touchedText: "e1 h1",
      obligation: obligation("e1 h1", fen),
    });
    expect(r.decision.conclusion).toContain("キャスリング");
    expect(articles(r)).toContain("FIDE 4.4");
  });

  it("an unreadable list or a wrong position → asks again with the reason", () => {
    const r = run({
      ...ON_MOVE,
      whatNext: "not-moved",
      touchedText: "e4",
      obligation: obligation("e4", START),
    });
    expect(ids(r)).toEqual(["touchedPieces", "touchFen"]);
    expect(r.decision.conclusion).toContain("e4 に駒がありません");
  });
});

// ---------------------------------------------------------------------------
// DecisionEngine・回答の反映・回数
// ---------------------------------------------------------------------------

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-t",
    gameId: "g1",
    category: "illegal-move",
    subtype: "touch-move",
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
const BLITZ: RulesetContext = {
  competitionType: "blitz",
  supervisionRegime: "basic-rules",
  rulesVersion: "FIDE-2023",
};

function evaluate(ctx: Partial<DecisionEngineContext>) {
  return new DecisionEngine(fixedProviders(), {
    positions: port,
  }).processIncident({ incident: incident(), ruleset: STANDARD, ...ctx });
}

const ANSWERS = {
  touchPlayer: "white",
  touchHow: "grasped",
  touchAdjustDeclared: "false",
  touchOnMove: "true",
  touchWhatNext: "moved-other",
  touchedPieces: "e2",
  touchFen: START,
} as const;

describe("DecisionEngine: touch-move goes to DT-007 (ADR-014 §6)", () => {
  it("routes touch-move to DT-007 before DT-001/002/003, in every competition type", () => {
    for (const ruleset of [STANDARD, BLITZ]) {
      const r = evaluate({ ruleset });
      expect(r.decision.treeId).toBe(DT_007_ID);
      expect(r.followUpQuestions[0].id).toBe("touchPlayer");
    }
  });

  it("still requires the explicit ruleset", () => {
    const r = evaluate({ ruleset: {} });
    expect(r.decision.kind).toBe("context-required");
  });

  it("decides from the answers, replaying the touched piece on the device", () => {
    const answered = applyIncidentAnswers(incident(), ANSWERS);
    expect(answered.playerColor).toBe("white");
    expect(answered.touchMoveFacts).toMatchObject({
      how: "grasped",
      onMove: true,
      whatNext: "moved-other",
      touchedText: "e2",
      fen: START,
    });
    const r = evaluate({
      incident: answered,
      touchMoveViolations: { white: 2, black: 0 },
    });
    expect(r.requiresFollowUp).toBe(false);
    expect(r.decision.treeId).toBe(DT_007_ID);
    expect(r.decision.touchMoveViolation).toBe(true);
    expect(r.decision.actions).toContain("許される手: e3, e4");
    expect(r.decision.actions.join("\n")).toContain("今回を含めて 3 回");
  });

  it("the 7.5 subtype question offers touch-move and switches the tree", () => {
    const options = QUESTIONS.subtype.options.map((o) => o.value);
    expect(options).toContain("touch-move");
    const base = incident({ subtype: undefined });
    const switched = applyIncidentAnswers(base, { subtype: "touch-move" });
    expect(switched.subtype).toBe("touch-move");
    expect(switched.illegalMoveFacts?.subtype).toBeUndefined();
    expect(evaluate({ incident: switched }).decision.treeId).toBe(DT_007_ID);
    const back = applyIncidentAnswers(switched, { subtype: "two-hands" });
    expect(back.subtype).toBe("two-hands");
    expect(evaluate({ incident: back }).decision.treeId).toBe(
      "DT-001-illegal-move-standard"
    );
  });

  it("an unknown 7.5 type never enumerates touch-move", () => {
    expect(enumerableValues(QUESTIONS.subtype)).not.toContain("touch-move");
  });

  it("an unknown answer that changes the result → manual review with the unconfirmed fact", () => {
    const answered = applyIncidentAnswers(incident(), {
      ...ANSWERS,
      touchWhatNext: "moved-touched",
      touchPromotion: "none",
      touchReleased: "unknown",
      touchChangedAfter: "true",
    });
    expect(answered.unknownAnswers).toEqual(["touchReleased"]);
    const r = evaluate({ incident: answered });
    expect(r.requiresFollowUp).toBe(false);
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.unconfirmedFacts).toContain(
      QUESTIONS.touchReleased.label
    );
  });

  it("toucher unknown → clears the colour, enumerates both, and a one-sided FEN cannot agree", () => {
    const withPlayer = applyIncidentAnswers(incident(), ANSWERS);
    const answered = applyIncidentAnswers(withPlayer, {
      touchPlayer: "unknown",
    });
    expect(answered.playerColor).toBeUndefined();
    expect(answered.unknownAnswers).toEqual(["touchPlayer"]);
    const r = evaluate({ incident: answered });
    // 白: 違反（局面から判定）／黒: 局面の手番が合わない → 判断が分かれる
    expect(r.requiresFollowUp).toBe(false);
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.unconfirmedFacts).toContain(QUESTIONS.touchPlayer.label);
  });

  it("'how' unknown: the adjust question is still answered, and the branches are compared", () => {
    const answered = applyIncidentAnswers(incident(), {
      ...ANSWERS,
      touchHow: "unknown",
    });
    const r = evaluate({ incident: answered });
    // 偶然の接触（義務なし）と意図した接触（違反）で判断が分かれる
    expect(r.requiresFollowUp).toBe(false);
    expect(r.decision.kind).toBe("manual-review");
  });

  it("an unknown answer that does not change the result → decided", () => {
    // 偶然の接触なら、手番かどうかに関係なく義務はない
    const answered = applyIncidentAnswers(incident(), {
      touchPlayer: "white",
      touchHow: "brushed",
      touchOnMove: "unknown",
    });
    const r = evaluate({ incident: answered });
    expect(r.requiresFollowUp).toBe(false);
    expect(r.decision.kind).toBe("recommendation");
  });
});

describe("Report shortcuts and suggestions", () => {
  it("offers touch-move as a quick report and accepts it as a known subtype", () => {
    expect(
      QUICK_REPORTS.some(
        (q) => q.category === "illegal-move" && q.subtype === "touch-move"
      )
    ).toBe(true);
    expect(isKnownSubtype("illegal-move", "touch-move")).toBe(true);
    // 7.5 の種類は決定木の質問で確認する（報告時には確定しない）
    expect(isKnownSubtype("illegal-move", "two-hands")).toBe(false);
  });

  it("keyword suggestion: touch move text → touch-move", () => {
    for (const text of [
      "白がタッチムーブを主張した",
      "触った駒と違う駒を動かした",
      "touch move claim",
    ]) {
      const c = classifyByKeywords(text);
      expect(c?.category, text).toBe("illegal-move");
      expect(c?.subtype, text).toBe("touch-move");
    }
    expect(classifyByKeywords("違法手を指した")?.subtype).toBeUndefined();
  });
});

describe("IncidentCounter: touch moves are counted apart from 7.5 illegal moves", () => {
  function record(id: string, subtype: string, decision: Partial<Decision>) {
    return {
      incident: incident({ id, subtype, playerColor: "white" }),
      decision: {
        id: `d-${id}`,
        incidentId: id,
        conclusion: "",
        actions: [],
        intervention: "immediate",
        penalties: [],
        sources: [],
        confidence: "high",
        escalationRecommended: false,
        generatedBy: "decision-tree",
        validationPassed: true,
        createdAt: FIXED_NOW,
        ...decision,
      } as Decision,
    };
  }
  const touch = record("t1", "touch-move", {
    treeId: DT_007_ID,
    touchMoveViolation: true,
  });
  // 誤って時間加算が付いた touch-move の判断でも 7.5 には数えない
  const touchWithPenalty = record("t2", "touch-move", {
    treeId: "DT-001-illegal-move-standard",
    penalties: [
      { type: "time-addition-opponent", description: "", playerColor: "black" },
    ],
  });
  const illegal = record("i1", "illegal-move", {
    treeId: "DT-001-illegal-move-standard",
    penalties: [
      { type: "time-addition-opponent", description: "", playerColor: "black" },
    ],
  });
  const notMoved = record("t3", "touch-move", { treeId: DT_007_ID });
  const records = [touch, touchWithPenalty, illegal, notMoved];

  it("7.5 counts never include touch-move incidents", () => {
    expect(IncidentCounter.countIllegalMovesByColor(records, "g1")).toEqual({
      white: 1,
      black: 0,
    });
  });

  it("touch-move violations are counted separately (only DT-007 violations)", () => {
    expect(IncidentCounter.touchMoveViolationsByColor(records, "g1")).toEqual({
      white: 1,
      black: 0,
    });
    expect(
      IncidentCounter.touchMoveViolationsByColor(records, "g1", {
        excludeIncidentId: "t1",
      }).white
    ).toBe(0);
    expect(
      IncidentCounter.touchMoveViolationsByColor(records, "g2").white
    ).toBe(0);
  });
});
