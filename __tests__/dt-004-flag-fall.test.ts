import { describe, it, expect } from "vitest";
import {
  FlagFallTree,
  type FlagFallInput,
} from "@/lib/domain/decision-trees/dt-004-flag-fall";
import type { MatePossibility } from "@/lib/domain/services/mate-possibility";
import { fixedProviders } from "./helpers";

const CAN: MatePossibility = {
  verdict: "can-mate",
  reason: "黒がメイトする手順があります: 60. Kh1 Qg2#",
  line: "60. Kh1 Qg2#",
};
const CANNOT: MatePossibility = {
  verdict: "cannot-mate",
  reason: "キングのみではチェックメイトできません",
};
const NOT_FOUND: MatePossibility = {
  verdict: "unknown",
  cause: "not-found",
  reason: "局面からメイトの手順を見つけられませんでした",
};

const BASE: Partial<FlagFallInput> = {
  competitionType: "standard",
  flagFallen: "white",
  gameEndedBeforeFlag: false,
  movesNotCompleted: true,
};

function withMate(mate: MatePossibility): Partial<FlagFallInput> {
  return { ...BASE, matePosition: "fen", fen: "fen", mate };
}

function run(input: Partial<FlagFallInput>) {
  return new FlagFallTree(fixedProviders()).evaluate(input);
}
function ids(r: ReturnType<typeof run>) {
  return r.status === "needs-input" ? r.questions.map((q) => q.id) : [];
}
function articles(r: ReturnType<typeof run>) {
  return r.decision.sources.map((s) => s.article);
}

describe("DT-004 Flag fall", () => {
  it("asks who flagged and whether the game had ended first", () => {
    expect(ids(run({ competitionType: "standard" }))).toEqual([
      "flagFallen",
      "gameEndedBeforeFlag",
    ]);
  });

  it("R6: asks the move count together with the position once the flagged player is known", () => {
    const r = run({
      competitionType: "standard",
      flagFallen: "black",
      gameEndedBeforeFlag: false,
    });
    expect(ids(r)).toEqual([
      "movesNotCompleted",
      "matePosition",
      "positionFen",
    ]);
    // 局面は「規定手数を完了していない」場合のみ表示（完了していた場合は不要）。
    // FEN 欄は「FEN を入力する」を選んだ場合のみ
    if (r.status !== "needs-input") throw new Error("expected questions");
    const [, method, fen] = r.questions;
    expect(method.showWhen).toEqual({
      questionId: "movesNotCompleted",
      values: ["true"],
    });
    expect(fen.showWhen).toEqual({
      questionId: "matePosition",
      values: ["fen"],
    });
    // 駒数・閉塞局面の質問は廃止（ADR-014 §5）
    expect(
      ids(r).some((id) => /Queens|materialConfirmed|positionBlocked/.test(id))
    ).toBe(false);
    // 完了していた → 局面なしで結論
    const done = run({
      competitionType: "standard",
      flagFallen: "black",
      gameEndedBeforeFlag: false,
      movesNotCompleted: false,
    });
    expect(done.status).toBe("decided");
    expect(r.decision.conclusion).toContain("黒のフラッグ");
  });

  it("R6: with both flags, the order is asked before the move count", () => {
    const r = run({
      competitionType: "standard",
      flagFallen: "both",
      gameEndedBeforeFlag: false,
    });
    expect(ids(r)).toEqual(["bothFlagsOrder"]);
  });

  it("result reached before the flag was noticed stands", () => {
    const r = run({ ...BASE, gameEndedBeforeFlag: true });
    expect(r.decision.intervention).toBe("no-intervention");
    expect(articles(r)).toContain("FIDE 6.8");
  });

  it("moves completed (6.4) → not a time forfeit, consult CA", () => {
    const r = run({ ...BASE, movesNotCompleted: false });
    expect(r.decision.penalties).toHaveLength(0);
    expect(articles(r)).toContain("FIDE 6.4");
  });

  it("move completion unknown → consult CA", () => {
    const r = run({ ...BASE, movesNotCompleted: "unknown" });
    expect(r.decision.kind).toBe("manual-review");
  });

  it("asks for the position (input method + FEN)", () => {
    expect(ids(run(BASE))).toEqual(["matePosition", "positionFen"]);
  });

  it("can-mate (a verified helpmate line) → flagged player loses, line shown", () => {
    const r = run(withMate(CAN));
    expect(r.status).toBe("decided");
    expect(r.decision.penalties[0]).toEqual(
      expect.objectContaining({ type: "game-loss", playerColor: "white" })
    );
    expect(r.decision.conclusion).toContain("60. Kh1 Qg2#");
    expect(r.decision.actions.join()).toContain("盤上と一致");
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE 6.8", "FIDE 6.9"])
    );
  });

  it("cannot-mate (material) → draw", () => {
    const r = run(withMate(CANNOT));
    expect(r.decision.penalties[0].type).toBe("draw");
    expect(r.decision.confidence).toBe("high");
    expect(r.decision.conclusion).toContain("キングのみ");
  });

  it("no helpmate found → consult CA, no penalty (never a loss from counts)", () => {
    const r = run(withMate(NOT_FOUND));
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.penalties).toHaveLength(0);
    expect(r.decision.conclusion).toContain("局面を確認");
  });

  it("position unavailable → consult CA", () => {
    const r = run({ ...BASE, matePosition: "unknown" });
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.penalties).toHaveLength(0);
  });

  it("fen chosen but missing or invalid → asks again with the error", () => {
    const missing = run({
      ...BASE,
      matePosition: "fen",
      mate: { verdict: "unknown", cause: "no-position", reason: "x" },
    });
    expect(ids(missing)).toEqual(["matePosition", "positionFen"]);
    const invalid = run({
      ...BASE,
      matePosition: "fen",
      mate: {
        verdict: "unknown",
        cause: "invalid-position",
        reason: "FEN を解釈できません（bad）",
      },
    });
    expect(invalid.status).toBe("needs-input");
    expect(invalid.decision.conclusion).toContain("FEN を解釈できません");
  });

  it("an invalid FEN in the move-count round is reported with the questions", () => {
    const r = run({
      ...BASE,
      movesNotCompleted: undefined,
      matePosition: "fen",
      mate: { verdict: "unknown", cause: "invalid-position", reason: "bad" },
    });
    expect(ids(r)).toEqual([
      "movesNotCompleted",
      "matePosition",
      "positionFen",
    ]);
    expect(r.decision.conclusion).toContain("bad");
  });

  describe("both flags", () => {
    const both: Partial<FlagFallInput> = { ...BASE, flagFallen: "both" };

    it("asks which fell first", () => {
      expect(ids(run(both))).toEqual(["bothFlagsOrder"]);
    });

    it("first flag known → that player is treated as flagged", () => {
      const r = run({
        ...both,
        bothFlagsOrder: "black-first",
        matePosition: "fen",
        mate: CAN,
      });
      expect(r.decision.penalties[0]).toEqual(
        expect.objectContaining({ type: "game-loss", playerColor: "black" })
      );
    });

    it("A.5: cites the Manual note on both clocks showing 0.00", () => {
      const r = run({
        ...both,
        competitionType: "rapid",
        supervisionRegime: "basic-rules",
        bothFlagsOrder: "white-first",
        matePosition: "fen",
        mate: CAN,
      });
      expect(articles(r)).toEqual(
        expect.arrayContaining(["FIDE A.5.3", "FIDE A.5.5"])
      );
      expect(articles(r).some((a) => a.includes("both clocks show 0.00"))).toBe(
        true
      );
    });

    it("order unknown, Guidelines III, last period → draw (III.3.1.2)", () => {
      const r = run({
        ...both,
        bothFlagsOrder: "unknown",
        quickplayGuidelinesApply: true,
        lastPeriod: true,
      });
      expect(r.decision.penalties[0].type).toBe("draw");
      expect(articles(r)).toContain("FIDE III.3.1");
    });

    it("order unknown, Guidelines III, not last period → continue", () => {
      const r = run({
        ...both,
        bothFlagsOrder: "unknown",
        quickplayGuidelinesApply: true,
        lastPeriod: false,
      });
      expect(r.decision.penalties).toHaveLength(0);
      expect(r.decision.kind).toBe("recommendation");
    });

    it("order unknown without Guidelines III → consult CA", () => {
      const r = run({
        ...both,
        bothFlagsOrder: "unknown",
        quickplayGuidelinesApply: false,
        lastPeriod: true,
      });
      expect(r.decision.kind).toBe("manual-review");
    });

    it("order unknown in Blitz → consult CA (III.2.2 excludes blitz)", () => {
      const r = run({
        ...both,
        competitionType: "blitz",
        supervisionRegime: "competition-rules",
        bothFlagsOrder: "unknown",
      });
      expect(r.decision.kind).toBe("manual-review");
      expect(articles(r)).toContain("FIDE III.2.2");
    });
  });

  it.each([
    ["standard", undefined, "FIDE 6.8"],
    ["rapid", "competition-rules", "FIDE 6.8"],
    ["rapid", "basic-rules", "FIDE A.5.3"],
    ["blitz", "basic-rules", "FIDE B.3"],
  ] as const)(
    "%s / %s cites %s",
    (competitionType, supervisionRegime, article) => {
      const r = run({
        ...withMate(CAN),
        competitionType,
        supervisionRegime,
      });
      expect(r.decision.penalties[0].type).toBe("game-loss");
      expect(articles(r)[0]).toBe(article);
    }
  );
});
