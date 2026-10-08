import { describe, it, expect } from "vitest";
import {
  EMPTY_SIDE,
  materialCannotMate,
  materialFromFen,
} from "@/lib/domain/services/mate-material";
import type { SideMaterial } from "@/lib/domain/entities";

const K: SideMaterial = { ...EMPTY_SIDE };
const side = (m: Partial<SideMaterial>): SideMaterial => ({
  ...EMPTY_SIDE,
  ...m,
});

/** 白がメイトする側 */
const cannot = (white: SideMaterial, black: SideMaterial) =>
  materialCannotMate({ white, black }, "white");

describe("materialCannotMate (ADR-014 §5: only the provable cases)", () => {
  it.each([
    ["K vs K", K, K],
    ["lone king vs K+Q", K, side({ queens: 1 })],
    ["K+N vs K", side({ knights: 1 }), K],
    ["K+B vs K", side({ lightBishops: 1 }), K],
    ["K+2 same-colour B vs K", side({ darkBishops: 2 }), K],
    [
      "only same-colour bishops on the board",
      side({ lightBishops: 1 }),
      side({ lightBishops: 2 }),
    ],
  ] as const)("%s → cannot mate", (_label, a, d) => {
    expect(cannot(a, d)).toBeTruthy();
  });

  it.each([
    // メイト可能とは限らないが、駒の構成だけでは不可能と証明できない → 局面で判定
    ["K+Q vs K", side({ queens: 1 }), K],
    ["K+P vs K", side({ pawns: 1 }), K],
    ["K+2N vs K", side({ knights: 2 }), K],
    ["K+B+N vs K", side({ knights: 1, darkBishops: 1 }), K],
    ["K+opposite B vs K", side({ lightBishops: 1, darkBishops: 1 }), K],
    ["K+N vs K+N (helpmate)", side({ knights: 1 }), side({ knights: 1 })],
    ["K+N vs K+P (helpmate)", side({ knights: 1 }), side({ pawns: 1 })],
    [
      "K+B vs K+B opposite colours",
      side({ lightBishops: 1 }),
      side({ darkBishops: 1 }),
    ],
    ["K+B vs K+R", side({ darkBishops: 1 }), side({ rooks: 1 })],
  ] as const)("%s → not decided by material", (_label, a, d) => {
    expect(cannot(a, d)).toBeUndefined();
  });

  it("is not symmetric: the side with the queen is not the one that cannot mate", () => {
    expect(
      materialCannotMate({ white: side({ queens: 1 }), black: K }, "white")
    ).toBeUndefined();
    expect(
      materialCannotMate({ white: side({ queens: 1 }), black: K }, "black")
    ).toBeTruthy();
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
