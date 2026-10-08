import { describe, it, expect } from "vitest";
import { IllegalMoveFastCompetitionTree } from "@/lib/domain/decision-trees/dt-002-illegal-move-fast-competition";
import { IllegalMoveFastBasicTree } from "@/lib/domain/decision-trees/dt-003-illegal-move-fast-basic";
import { IllegalMoveStandardTree } from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";
import type { IllegalMoveFastInput } from "@/lib/domain/decision-trees/illegal-move-fast-shared";
import { fixedProviders, FIXED_NOW, mateOf } from "./helpers";

const BASE: Partial<IllegalMoveFastInput> = {
  playerColor: "white",
  subtype: "illegal-move",
  endEvent: "in-progress",
  clockPressed: true,
  playerIncidentCount: 0,
};

const A5_BASE: Partial<IllegalMoveFastInput> = {
  ...BASE,
  opponentMadeNextMove: false,
  detectedBy: "arbiter",
};

const PRIOR = [
  { incidentId: "p1", reportedAt: FIXED_NOW, subtype: "illegal-move" as const },
];

function a4(type: "rapid" | "blitz" = "rapid") {
  return new IllegalMoveFastCompetitionTree(fixedProviders(), type);
}
function a5(type: "rapid" | "blitz" = "rapid") {
  return new IllegalMoveFastBasicTree(fixedProviders(), type);
}
function articles(r: { decision: { sources: { article: string }[] } }) {
  return r.decision.sources.map((s) => s.article);
}

describe("DT-002 Illegal move — Rapid A.4 / Blitz B.2 (competition rules)", () => {
  it("asks the basic facts when nothing is known", () => {
    const r = a4().evaluate({});
    expect(r.status).toBe("needs-input");
    if (r.status !== "needs-input") return;
    expect(r.questions.map((q) => q.id)).toEqual([
      "playerColor",
      "subtype",
      "gameEndEvent",
      "gameRecordState",
      "clockPressed",
    ]);
  });

  it("Rapid 1st offence: opponent +1 minute (A.3), not 2 minutes as in standard", () => {
    const r = a4().evaluate(BASE);
    expect(r.status).toBe("decided");
    expect(r.decision.treeId).toBe("DT-002-illegal-move-fast-competition");
    expect(r.decision.penalties).toEqual([
      expect.objectContaining({
        type: "time-addition-opponent",
        playerColor: "black",
        timeAdjustmentSeconds: 60,
      }),
    ]);
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE A.4", "FIDE 7.5.5", "FIDE A.3"])
    );
    expect(r.decision.confidence).toBe("high");

    const std = new IllegalMoveStandardTree(fixedProviders()).evaluate({
      ...BASE,
    } as never);
    expect(std.decision.penalties[0].timeAdjustmentSeconds).toBe(120);
  });

  it("Blitz B.2 1st offence: amount is not verifiable from the sources → time addition without amount, escalate", () => {
    const r = a4("blitz").evaluate(BASE);
    expect(r.decision.penalties[0].type).toBe("time-addition-opponent");
    expect(r.decision.penalties[0].timeAdjustmentSeconds).toBeUndefined();
    expect(r.decision.escalationRecommended).toBe(true);
    expect(r.decision.confidence).toBe("medium");
    expect(articles(r)).toEqual(expect.arrayContaining(["FIDE B.2"]));
    expect(r.decision.validationPassed).toBe(true);
  });

  it("does not depend on whether the opponent has moved (that is A.5.2 only)", () => {
    const moved = a4().evaluate({ ...BASE, opponentMadeNextMove: true });
    expect(moved.decision.penalties[0].timeAdjustmentSeconds).toBe(60);
  });

  it("2nd offence asks whether the opponent can mate, listing the counted move", () => {
    const r = a4().evaluate({
      ...BASE,
      playerIncidentCount: 1,
      priorIllegalMoves: PRIOR,
    });
    expect(r.status).toBe("needs-input");
    if (r.status !== "needs-input") return;
    expect(r.questions.map((q) => q.id)).toEqual([
      "matePosition",
      "reinstatedFen",
    ]);
    expect(r.decision.conclusion).toContain("記録済み 1回目");
  });

  it.each([
    [true, "game-loss", "white"],
    [false, "draw", "white"],
  ] as const)(
    "2nd offence, opponent can mate=%s → %s",
    (canMate, type, color) => {
      const r = a4().evaluate({
        ...BASE,
        playerIncidentCount: 1,
        ...mateOf(canMate),
      });
      expect(r.decision.penalties[0].type).toBe(type);
      expect(r.decision.penalties[0].playerColor).toBe(color);
    }
  );

  it("2nd offence in Blitz B.2 is still a loss (7.5.5)", () => {
    const r = a4("blitz").evaluate({
      ...BASE,
      playerIncidentCount: 1,
      ...mateOf(true),
    });
    expect(r.decision.penalties[0].type).toBe("game-loss");
  });

  it("2nd offence with unknown mate ability → consult CA without penalty", () => {
    const r = a4().evaluate({
      ...BASE,
      playerIncidentCount: 1,
      ...mateOf("unknown"),
    });
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.penalties).toHaveLength(0);
  });

  it("game already over → result stands", () => {
    const r = a4().evaluate({ ...BASE, endEvent: "resignation" });
    expect(r.decision.intervention).toBe("no-intervention");
    expect(r.decision.penalties).toHaveLength(0);
  });

  it("clock not pressed → no illegal move", () => {
    const r = a4().evaluate({ ...BASE, clockPressed: false });
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.intervention).toBe("no-intervention");
  });

  it("two hands without pressing the clock → intervene under 4.1", () => {
    const r = a4().evaluate({
      ...BASE,
      subtype: "two-hands",
      clockPressed: false,
    });
    expect(r.decision.intervention).toBe("immediate");
    expect(articles(r)).toContain("FIDE 4.1");
  });

  it("invalid history count → manual review, no loss", () => {
    const r = a4().evaluate({ ...BASE, playerIncidentCount: -1 });
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.penalties).toHaveLength(0);
  });

  it("increment reduction note for Rapid/Blitz is cited", () => {
    const r = a4().evaluate(BASE);
    expect(articles(r)).toContain(
      "FIDE Arbiters' Manual: Article 7.5 (increment in Rapid and Blitz)"
    );
  });
});

describe("DT-003 Illegal move — Rapid A.5 / Blitz B.3 (basic rules)", () => {
  it("asks the A.5.2 questions together with the basic facts", () => {
    const r = a5().evaluate({});
    if (r.status !== "needs-input") throw new Error("expected questions");
    expect(r.questions.map((q) => q.id)).toEqual([
      "playerColor",
      "subtype",
      "gameEndEvent",
      "gameRecordState",
      "clockPressed",
      "opponentMadeNextMove",
      "detectedBy",
    ]);
  });

  it("asks only the missing A.5.2 questions when basic facts are known", () => {
    const r = a5().evaluate({ ...BASE });
    if (r.status !== "needs-input") throw new Error("expected questions");
    expect(r.questions.map((q) => q.id)).toEqual([
      "opponentMadeNextMove",
      "detectedBy",
    ]);
  });

  it.each(["arbiter", "opponent-claim"] as const)(
    "observed by %s before the opponent moved → 7.5.5 with 1 minute",
    (detectedBy) => {
      const r = a5().evaluate({ ...A5_BASE, detectedBy });
      expect(r.decision.treeId).toBe("DT-003-illegal-move-fast-basic");
      expect(r.decision.penalties[0].timeAdjustmentSeconds).toBe(60);
      expect(articles(r)[0]).toBe("FIDE A.5.2");
    }
  );

  it("Blitz B.3: 1 minute (B.3 applies A.3)", () => {
    const r = a5("blitz").evaluate(A5_BASE);
    expect(r.decision.penalties[0].timeAdjustmentSeconds).toBe(60);
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE B.3", "FIDE A.3"])
    );
    expect(r.decision.escalationRecommended).toBe(false);
  });

  it("opponent already moved → illegal move stands, no penalty, no intervention", () => {
    const r = a5().evaluate({ ...A5_BASE, opponentMadeNextMove: true });
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.intervention).toBe("no-intervention");
    expect(r.decision.actions.join("\n")).toContain("合意");
  });

  it("opponent already moved even if the arbiter saw it late → still stands", () => {
    const r = a5().evaluate({
      ...A5_BASE,
      opponentMadeNextMove: true,
      detectedBy: "opponent-claim",
      playerIncidentCount: 1,
    });
    expect(r.decision.penalties).toHaveLength(0);
  });

  it("promotion not replaced and opponent moved → A.5.4 illegal position procedure", () => {
    const r = a5().evaluate({
      ...A5_BASE,
      subtype: "promotion-not-replaced",
      opponentMadeNextMove: true,
    });
    expect(articles(r)).toContain("FIDE A.5.4");
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.intervention).toBe("wait-next-move");
  });

  it("R5: an illegal move that stood notes the A.5.4 both-kings-in-check procedure", () => {
    const r = a5().evaluate({ ...A5_BASE, opponentMadeNextMove: true });
    const actions = r.decision.actions;
    expect(actions).toContain(
      "盤上で両方のキングがチェックされている場合（A.5.4）: 次の手が完了するまで待つ。次の手の後も両キングがチェックのままなら引き分けを宣言する"
    );
    expect(actions).toContain(
      "最初の手番側がチェックを外した後、チェックされたままの相手が自分の次の手を完了してもチェックが外れていなければ、その相手の違法手とする（解説）"
    );
    // 両キングがチェックのまま → 違法手ではなく引き分け（違法手とする記述は相手の次の手の後のみ）
    expect(
      actions.some((a) =>
        a.includes("チェックを外さなかった場合は、その手番側の違法手")
      )
    ).toBe(false);
    expect(articles(r)).toEqual(
      expect.arrayContaining([
        "FIDE A.5.4",
        "FIDE Arbiters' Manual: Appendix A (both kings in check)",
      ])
    );
  });

  it("R3: Blitz B.2 game loss does not cite the Rapid one-minute commentary", () => {
    const r = a4("blitz").evaluate({
      ...BASE,
      playerIncidentCount: 1,
      ...mateOf(true),
    });
    expect(articles(r)).not.toContain(
      "FIDE Arbiters' Manual: Appendix A (illegal move penalty)"
    );
  });

  it("R2: Blitz B.2 suggests 2 minutes as the literal reading", () => {
    const r = a4("blitz").evaluate(BASE);
    expect(r.decision.conclusion).toContain("2分（文言上の解釈・要確認）");
    expect(r.decision.penalties[0].timeAdjustmentSeconds).toBeUndefined();
  });

  it("reported by a spectator → consult CA", () => {
    const r = a5().evaluate({ ...A5_BASE, detectedBy: "other" });
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.escalationRecommended).toBe(true);
  });

  it("2nd penalised offence → loss when the opponent can mate", () => {
    const r = a5().evaluate({
      ...A5_BASE,
      playerIncidentCount: 1,
      ...mateOf(true),
    });
    expect(r.decision.penalties[0].type).toBe("game-loss");
  });

  it("2nd offence → draw when the opponent cannot mate", () => {
    const r = a5().evaluate({
      ...A5_BASE,
      playerIncidentCount: 1,
      ...mateOf(false),
    });
    expect(r.decision.penalties[0].type).toBe("draw");
  });

  it("clock-without-move does not ask clockPressed", () => {
    const r = a5().evaluate({
      playerColor: "black",
      subtype: "clock-without-move",
      endEvent: "in-progress",
    });
    if (r.status !== "needs-input") throw new Error("expected questions");
    expect(r.questions.map((q) => q.id)).not.toContain("clockPressed");
  });

  it("every decided output passes validation and keeps sources", () => {
    const inputs: Partial<IllegalMoveFastInput>[] = [
      A5_BASE,
      { ...A5_BASE, opponentMadeNextMove: true },
      { ...A5_BASE, detectedBy: "other" },
      { ...A5_BASE, endEvent: "resignation" },
      { ...A5_BASE, playerIncidentCount: 1, ...mateOf("unknown") },
    ];
    for (const i of inputs) {
      const r = a5().evaluate(i);
      expect(r.decision.validationPassed).toBe(true);
      expect(r.decision.sources.length).toBeGreaterThan(0);
    }
  });
});
