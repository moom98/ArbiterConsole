import { describe, it, expect } from "vitest";
import {
  IllegalMoveStandardTree,
  type IllegalMoveStandardInput,
  type DecisionTreeResult,
} from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";
import type { Decision, IllegalMoveSubtype } from "@/lib/domain/entities";
import { fixedProviders, FIXED_NOW, mateOf } from "./helpers";

const base: IllegalMoveStandardInput = {
  playerColor: "white",
  subtype: "illegal-move",
  clockPressed: true,
  gameEnded: false,
  playerIncidentCount: 0,
  ...mateOf("unknown"),
};

function run(input: Partial<IllegalMoveStandardInput>): DecisionTreeResult {
  return new IllegalMoveStandardTree(fixedProviders()).evaluate(input);
}

function decided(input: Partial<IllegalMoveStandardInput>): Decision {
  const r = run(input);
  expect(r.status).toBe("decided");
  return r.decision;
}

function articles(d: Decision): string[] {
  return d.sources.map((s) => s.article);
}

describe("DT-001: Illegal Move (Standard, FIDE Laws 2023)", () => {
  describe("follow-up questions", () => {
    it("asks colour, subtype, gameEnded and clockPressed in one round when nothing is known", () => {
      const r = run({});
      expect(r.status).toBe("needs-input");
      if (r.status !== "needs-input") return;
      expect(r.questions.map((q) => q.id)).toEqual([
        "playerColor",
        "subtype",
        "gameEnded",
        "clockPressed",
      ]);
      expect(r.decision.kind).toBe("follow-up-required");
      expect(r.decision.penalties).toHaveLength(0);
      expect(r.decision.escalationRecommended).toBe(false);
      expect(r.decision.missingFields).toHaveLength(4);
    });

    it("asks whether the clock was pressed only after the basic facts", () => {
      const r = run({
        playerColor: "black",
        subtype: "illegal-move",
        gameEnded: false,
      });
      expect(r.status).toBe("needs-input");
      if (r.status !== "needs-input") return;
      expect(r.questions.map((q) => q.id)).toEqual(["clockPressed"]);
    });

    it("omits the clock question from the first round when the subtype is 7.5.3", () => {
      const r = run({ subtype: "clock-without-move" });
      expect(r.status).toBe("needs-input");
      if (r.status !== "needs-input") return;
      expect(r.questions.map((q) => q.id)).toEqual([
        "playerColor",
        "gameEnded",
      ]);
    });

    it("does not ask about the clock for 7.5.3 (clock pressed without a move)", () => {
      const d = decided({
        playerColor: "black",
        subtype: "clock-without-move",
        gameEnded: false,
        playerIncidentCount: 0,
      });
      expect(d.penalties[0].type).toBe("time-addition-opponent");
    });

    it("does not ask about the clock once the game has ended", () => {
      const d = decided({
        playerColor: "white",
        subtype: "illegal-move",
        gameEnded: true,
      });
      expect(d.intervention).toBe("no-intervention");
    });
  });

  describe("game already ended", () => {
    it("result stands, no correction, no penalty, regardless of history", () => {
      const d = decided({ ...base, gameEnded: true, playerIncidentCount: 1 });
      expect(d.kind).toBe("recommendation");
      expect(d.penalties).toHaveLength(0);
      expect(d.conclusion).toContain("結果はそのまま確定");
      expect(articles(d)).toEqual(
        expect.arrayContaining(["FIDE 7.5.1", "FIDE 8.7", "JCF NA p.47"])
      );
      expect(d.sources.some((s) => s.source === "commentary")).toBe(true);
    });
  });

  describe("clock not pressed", () => {
    it("illegal move not completed: no penalty, touch-move applies", () => {
      const d = decided({ ...base, clockPressed: false });
      expect(d.penalties).toHaveLength(0);
      expect(d.intervention).toBe("no-intervention");
      expect(d.actions.join("\n")).toMatch(/タッチムーブ（4\.3 \/ 4\.7）/);
      expect(articles(d)).toEqual(
        expect.arrayContaining(["FIDE 7.5.1", "FIDE 4.3", "FIDE 4.7"])
      );
    });

    it("two hands without pressing the clock: Article 4.1, no 7.5.5 penalty, consult CA", () => {
      const d = decided({ ...base, subtype: "two-hands", clockPressed: false });
      expect(d.penalties).toHaveLength(0);
      expect(d.intervention).toBe("immediate");
      expect(d.escalationRecommended).toBe(true);
      expect(articles(d)).toContain("FIDE 4.1");
    });

    it("clock-not-pressed outcome ignores an invalid history count", () => {
      const d = decided({
        ...base,
        clockPressed: false,
        playerIncidentCount: -3,
      });
      expect(d.penalties).toHaveLength(0);
    });
  });

  describe("first completed illegal move", () => {
    it("adds two minutes to the opponent (white offends)", () => {
      const d = decided(base);
      expect(d.conclusion).toContain("白の1回目の違法手");
      expect(d.penalties).toEqual([
        {
          type: "time-addition-opponent",
          playerColor: "black",
          timeAdjustmentSeconds: 120,
          description: "黒に2分追加",
        },
      ]);
      expect(d.intervention).toBe("immediate");
      expect(d.confidence).toBe("high");
      expect(d.escalationRecommended).toBe(false);
      expect(articles(d)).toEqual(
        expect.arrayContaining(["FIDE 7.5.1", "FIDE 7.5.5", "JCF NA p.48"])
      );
    });

    it("adds two minutes to white when black offends", () => {
      const d = decided({ ...base, playerColor: "black" });
      expect(d.penalties[0].playerColor).toBe("white");
      expect(d.conclusion).toContain("黒の1回目の違法手");
    });

    it("includes the touch-move obligation for the replacing move", () => {
      const d = decided(base);
      expect(d.actions.join("\n")).toMatch(/タッチムーブ（4\.3 \/ 4\.7）/);
      expect(articles(d)).toEqual(
        expect.arrayContaining(["FIDE 4.3", "FIDE 4.7"])
      );
    });

    it("includes the increment guidance", () => {
      const d = decided(base);
      expect(d.actions.join("\n")).toContain("インクリメント");
      expect(articles(d)).toContain(
        "FIDE Arbiters' Manual: Article 7.5 (increment)"
      );
    });

    it("7.5.3: notes the clock-started-in-error judgement and lowers confidence", () => {
      const d = decided({ ...base, subtype: "clock-without-move" });
      expect(d.confidence).toBe("medium");
      expect(d.actions.join("\n")).toContain("妨害（distraction）");
      expect(articles(d)).toContain(
        "FIDE Arbiters' Manual: Article 7.5.3 (clock started in error)"
      );
    });

    const subtypeCases: Array<[IllegalMoveSubtype, string, RegExp]> = [
      ["illegal-move", "FIDE 7.5.1", /局面を違反直前の局面に戻す/],
      ["promotion-not-replaced", "FIDE 7.5.2", /クイーンに置き換える/],
      ["clock-without-move", "FIDE 7.5.3", /手番で再開する/],
      ["two-hands", "FIDE 7.5.4", /局面を違反直前の局面に戻す/],
    ];
    it.each(subtypeCases)(
      "subtype %s cites %s and gives the matching corrective action",
      (subtype, article, action) => {
        const d = decided({ ...base, subtype });
        expect(articles(d)[0]).toBe(article);
        expect(articles(d)).toContain("FIDE 7.5.5");
        expect(d.actions.join("\n")).toMatch(action);
        expect(d.penalties[0].type).toBe("time-addition-opponent");
      }
    );

    it("promotion: pawn is replaced by a queen, no touch-move restoration", () => {
      const d = decided({ ...base, subtype: "promotion-not-replaced" });
      expect(d.actions.join("\n")).not.toContain("局面を違反直前");
    });

    it("two hands: notes that multiple irregularities in one move count once", () => {
      const d = decided({ ...base, subtype: "two-hands" });
      expect(d.actions.join("\n")).toContain("1回として数える");
      expect(articles(d)).toContain(
        "FIDE Arbiters' Manual: Article 7.5 (two irregularities in one move)"
      );
    });
  });

  describe("second completed illegal move", () => {
    it("asks for the reinstated position (never asks 'can the opponent mate?')", () => {
      const { matePosition: _omit, ...rest } = base;
      void _omit;
      const r = run({ ...rest, playerIncidentCount: 1 });
      expect(r.status).toBe("needs-input");
      if (r.status !== "needs-input") return;
      expect(r.questions.map((q) => q.id)).toEqual([
        "matePosition",
        "reinstatedFen",
      ]);
      expect(r.questions[0].options.map((o) => o.value)).toEqual([
        "fen",
        "unknown",
      ]);
      expect(r.decision.conclusion).toContain("違法手の直前に戻した局面");
      expect(r.decision.penalties).toHaveLength(0);
      expect(r.decision.conclusion).toContain("2回目");
    });

    it("'unknown' yields a final consult-CA decision citing 7.5.5, with no penalty", () => {
      const d = decided({
        ...base,
        playerIncidentCount: 1,
        ...mateOf("unknown"),
      });
      expect(d.kind).toBe("manual-review");
      expect(d.intervention).toBe("consult-ca");
      expect(d.penalties).toHaveLength(0);
      expect(d.escalationRecommended).toBe(true);
      expect(articles(d)).toContain("FIDE 7.5.5");
    });

    it("lists the previously counted illegal moves (time + subtype) for verification", () => {
      const reportedAt = new Date(2026, 0, 1, 10, 23);
      for (const canMate of [true, false, "unknown"] as const) {
        const d = decided({
          ...base,
          playerIncidentCount: 1,
          priorIllegalMoves: [
            { incidentId: "p1", reportedAt, subtype: "two-hands" },
          ],
          ...mateOf(canMate),
        });
        expect(d.actions.join("\n")).toContain(
          "記録済み 1回目: 10:23 両手で指した"
        );
      }
    });

    it("says the itemised record is missing when only a count is known", () => {
      const d = decided({
        ...base,
        playerIncidentCount: 1,
        ...mateOf(true),
      });
      expect(d.actions.join("\n")).toContain("明細なし");
    });

    it("declares the game lost when the opponent can checkmate", () => {
      const d = decided({
        ...base,
        playerIncidentCount: 1,
        ...mateOf(true),
      });
      expect(d.penalties).toEqual([
        { type: "game-loss", playerColor: "white", description: "白の負け" },
      ]);
      expect(d.escalationRecommended).toBe(false);
      expect(articles(d)).toContain("FIDE 7.5.5");
    });

    it("declares a draw when the opponent cannot checkmate (7.5.5 exception)", () => {
      const d = decided({
        ...base,
        playerIncidentCount: 1,
        ...mateOf(false),
      });
      expect(d.penalties).toHaveLength(1);
      expect(d.penalties[0].type).toBe("draw");
      expect(d.conclusion).toContain("ドロー");
      expect(articles(d)).toEqual(
        expect.arrayContaining(["FIDE 7.5.5", "JCF NA p.48"])
      );
    });

    it.each<IllegalMoveSubtype>([
      "promotion-not-replaced",
      "clock-without-move",
      "two-hands",
    ])(
      "subtype %s also leads to game loss on the second offence",
      (subtype) => {
        const d = decided({
          ...base,
          subtype,
          playerIncidentCount: 1,
          ...mateOf(true),
        });
        expect(d.penalties[0].type).toBe("game-loss");
      }
    );

    it("flags inconsistent history (already 2+ penalties) for CA review", () => {
      const d = decided({
        ...base,
        playerIncidentCount: 2,
        ...mateOf(true),
      });
      expect(d.penalties[0].type).toBe("game-loss");
      expect(d.escalationRecommended).toBe(true);
      expect(d.confidence).toBe("medium");
    });
  });

  describe("invalid playerIncidentCount never yields a game loss", () => {
    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, undefined])(
      "count %s → escalation, no penalty",
      (count) => {
        const d = decided({
          ...base,
          playerIncidentCount: count as number,
          ...mateOf(true),
        });
        expect(d.kind).toBe("manual-review");
        expect(d.penalties).toHaveLength(0);
        expect(d.intervention).toBe("consult-ca");
        expect(d.escalationRecommended).toBe(true);
      }
    );
  });

  describe("validation and reproducibility", () => {
    it("every decision with a penalty passes source validation", () => {
      for (const input of [
        base,
        { ...base, playerIncidentCount: 1, ...mateOf(true) },
        { ...base, playerIncidentCount: 1, ...mateOf(false) },
      ]) {
        const d = decided(input);
        expect(d.validationPassed).toBe(true);
        expect(d.validationErrors).toBeUndefined();
      }
    });

    it("produces identical output for identical input with injected providers", () => {
      const a = new IllegalMoveStandardTree(fixedProviders()).evaluate(base);
      const b = new IllegalMoveStandardTree(fixedProviders()).evaluate(base);
      expect(a).toEqual(b);
      expect(a.decision.id).toBe("id-1");
      expect(a.decision.createdAt).toEqual(FIXED_NOW);
      expect(a.decision.treeId).toBe("DT-001-illegal-move-standard");
      expect(a.decision.rulesVersion).toBe("FIDE-2023");
    });

    it("every citation carries an edition", () => {
      const d = decided(base);
      for (const s of d.sources) expect(s.edition).toBeTruthy();
    });
  });
});
