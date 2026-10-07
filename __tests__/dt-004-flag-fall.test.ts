import { describe, it, expect } from "vitest";
import {
  FlagFallTree,
  type FlagFallInput,
} from "@/lib/domain/decision-trees/dt-004-flag-fall";
import { EMPTY_SIDE } from "@/lib/domain/services/mate-material";
import type { SideMaterial } from "@/lib/domain/entities";
import { fixedProviders } from "./helpers";

const side = (m: Partial<SideMaterial>): SideMaterial => ({
  ...EMPTY_SIDE,
  ...m,
});

const BASE: Partial<FlagFallInput> = {
  competitionType: "standard",
  flagFallen: "white",
  gameEndedBeforeFlag: false,
  movesNotCompleted: true,
};

function withMaterial(white: SideMaterial, black: SideMaterial) {
  return { ...BASE, material: { white, black }, materialConfirmed: true };
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

  it("R6: asks the move count together with material once the flagged player is known", () => {
    const r = run({
      competitionType: "standard",
      flagFallen: "black",
      gameEndedBeforeFlag: false,
    });
    expect(ids(r)[0]).toBe("movesNotCompleted");
    expect(ids(r)).toContain("whiteQueens");
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

  it("asks for material (12 steppers + optional FEN + confirmation)", () => {
    const r = run(BASE);
    const q = ids(r);
    expect(q).toHaveLength(14);
    expect(q).toContain("whiteQueens");
    expect(q).toContain("blackLightBishops");
    expect(q).toContain("positionFen");
    expect(q).toContain("materialConfirmed");
  });

  it("unconfirmed default material is not used", () => {
    const r = run({ ...BASE, material: { white: K(), black: K() } });
    expect(r.status).toBe("needs-input");
  });

  it("opponent has a rook → flagged player loses", () => {
    const r = run(withMaterial(side({}), side({ rooks: 1 })));
    expect(r.status).toBe("decided");
    expect(r.decision.penalties[0]).toEqual(
      expect.objectContaining({ type: "game-loss", playerColor: "white" })
    );
    expect(articles(r)).toEqual(
      expect.arrayContaining(["FIDE 6.8", "FIDE 6.9"])
    );
  });

  it("opponent has only K+N and flagged side a bare king → draw", () => {
    const r = run(withMaterial(K(), side({ knights: 1 })));
    expect(r.decision.penalties[0].type).toBe("draw");
    expect(r.decision.confidence).toBe("high");
  });

  it("opponent K+N vs flagged K+Q → unknown (helpmate is position-dependent)", () => {
    const r = run(withMaterial(side({ queens: 1 }), side({ knights: 1 })));
    expect(r.decision.kind).toBe("manual-review");
  });

  it("opponent has only K+B and flagged side has a pawn → unknown → consult CA", () => {
    const r = run(withMaterial(side({ pawns: 1 }), side({ lightBishops: 1 })));
    expect(r.decision.kind).toBe("manual-review");
    expect(r.decision.penalties).toHaveLength(0);
  });

  it("pawns on board → asks about a blocked position before declaring a loss", () => {
    const input = withMaterial(side({ pawns: 3 }), side({ pawns: 2 }));
    expect(ids(run(input))).toEqual(["positionBlocked"]);
    expect(
      run({ ...input, positionBlocked: false }).decision.penalties[0].type
    ).toBe("game-loss");
    expect(run({ ...input, positionBlocked: "unknown" }).decision.kind).toBe(
      "manual-review"
    );
  });

  it("uses a valid FEN instead of the counts", () => {
    const r = run({ ...BASE, fen: "8/8/8/4k3/8/8/4K3/7N w - - 0 1" });
    // 黒: キングのみ → 白がフラッグ、黒はメイト不可能 → ドロー
    expect(r.decision.penalties[0].type).toBe("draw");
  });

  it("invalid FEN → asks again with an error", () => {
    const r = run({ ...BASE, fen: "nonsense" });
    expect(r.status).toBe("needs-input");
    expect(r.decision.conclusion).toContain("FEN");
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
        material: { white: side({ queens: 1 }), black: K() },
        materialConfirmed: true,
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
        material: { white: K(), black: side({ rooks: 1 }) },
        materialConfirmed: true,
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
        ...withMaterial(K(), side({ queens: 1 })),
        competitionType,
        supervisionRegime,
      });
      expect(r.decision.penalties[0].type).toBe("game-loss");
      expect(articles(r)[0]).toBe(article);
    }
  );
});

function K(): SideMaterial {
  return { ...EMPTY_SIDE };
}
