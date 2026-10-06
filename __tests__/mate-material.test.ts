import { describe, it, expect } from "vitest";
import {
  EMPTY_SIDE,
  assessMatingPossibility,
  materialFromFen,
  validateSideMaterial,
} from "@/lib/domain/services/mate-material";
import type { SideMaterial } from "@/lib/domain/entities";

const K: SideMaterial = { ...EMPTY_SIDE };
const side = (m: Partial<SideMaterial>): SideMaterial => ({
  ...EMPTY_SIDE,
  ...m,
});

describe("assessMatingPossibility (attacker vs defender)", () => {
  it.each([
    // [label, attacker, defender, verdict, positionDependent]
    ["K vs K", K, K, "cannot-mate", false],
    [
      "K vs K+Q (lone king never mates)",
      K,
      side({ queens: 1 }),
      "cannot-mate",
      false,
    ],
    ["K+N vs K", side({ knights: 1 }), K, "cannot-mate", false],
    ["K+B vs K", side({ lightBishops: 1 }), K, "cannot-mate", false],
    [
      "K+2 same-colour B vs K",
      side({ darkBishops: 2 }),
      K,
      "cannot-mate",
      false,
    ],
    [
      "K+B vs K+B same colour",
      side({ lightBishops: 1 }),
      side({ lightBishops: 1 }),
      "cannot-mate",
      false,
    ],
    ["K+Q vs K", side({ queens: 1 }), K, "can-mate", false],
    ["K+R vs K+N", side({ rooks: 1 }), side({ knights: 1 }), "can-mate", false],
    ["K+P vs K (pawn on board)", side({ pawns: 1 }), K, "can-mate", true],
    ["K+2N vs K", side({ knights: 2 }), K, "can-mate", false],
    ["K+B+N vs K", side({ knights: 1, darkBishops: 1 }), K, "can-mate", false],
    [
      "K+opposite-colour BB vs K",
      side({ lightBishops: 1, darkBishops: 1 }),
      K,
      "can-mate",
      false,
    ],
    [
      "K+Q vs K+P (blockade possible)",
      side({ queens: 1 }),
      side({ pawns: 1 }),
      "can-mate",
      true,
    ],
    [
      "K+N vs K+N (helpmate position-dependent)",
      side({ knights: 1 }),
      side({ knights: 1 }),
      "unknown",
      true,
    ],
    [
      "K+B vs K+B opposite colour",
      side({ lightBishops: 1 }),
      side({ darkBishops: 1 }),
      "unknown",
      true,
    ],
    ["K+N vs K+P", side({ knights: 1 }), side({ pawns: 1 }), "unknown", true],
    [
      "K+B vs K+R",
      side({ darkBishops: 1 }),
      side({ rooks: 1 }),
      "unknown",
      true,
    ],
  ] as const)("%s → %s", (_label, attacker, defender, verdict, dep) => {
    const a = assessMatingPossibility(attacker, defender);
    expect(a.verdict).toBe(verdict);
    expect(a.positionDependent).toBe(dep);
    expect(a.reason).toBeTruthy();
  });

  it("is not symmetric: K+Q vs K means the queen side can mate, the lone king cannot", () => {
    expect(assessMatingPossibility(side({ queens: 1 }), K).verdict).toBe(
      "can-mate"
    );
    expect(assessMatingPossibility(K, side({ queens: 1 })).verdict).toBe(
      "cannot-mate"
    );
  });
});

describe("validateSideMaterial", () => {
  it("accepts the initial material", () => {
    expect(
      validateSideMaterial(
        {
          queens: 1,
          rooks: 2,
          knights: 2,
          lightBishops: 1,
          darkBishops: 1,
          pawns: 8,
        },
        "白"
      )
    ).toEqual([]);
  });
  it("rejects impossible counts", () => {
    expect(
      validateSideMaterial(side({ pawns: 9 }), "白").length
    ).toBeGreaterThan(0);
    expect(
      validateSideMaterial(side({ queens: 2, pawns: 8 }), "白").length
    ).toBeGreaterThan(0);
    expect(
      validateSideMaterial({ queens: -1 } as never, "白").length
    ).toBeGreaterThan(0);
    expect(validateSideMaterial(undefined, "白").length).toBeGreaterThan(0);
  });
});

describe("materialFromFen", () => {
  it("counts pieces and bishop square colours", () => {
    // 白: Bc1（黒マス）, Bf1（白マス）; 黒: Bc8（白マス）
    const r = materialFromFen("2b1k3/8/8/8/8/8/4P3/2B1KB2 w - - 0 1");
    if (!r.ok) throw new Error(r.error);
    expect(r.material.white).toEqual(
      side({ darkBishops: 1, lightBishops: 1, pawns: 1 })
    );
    expect(r.material.black).toEqual(side({ lightBishops: 1 }));
  });
  it("rejects malformed FEN", () => {
    expect(materialFromFen("8/8/8").ok).toBe(false);
    expect(materialFromFen("8/8/8/8/8/8/8/8 w - - 0 1").ok).toBe(false); // no kings
    expect(materialFromFen("9/8/8/8/8/8/8/K6k w - - 0 1").ok).toBe(false);
  });
});
