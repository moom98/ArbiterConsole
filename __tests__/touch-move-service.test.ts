import { describe, it, expect } from "vitest";
import {
  parseTouchedText,
  touchObligation,
} from "@/lib/domain/services/touch-move";
import { chessJsPositionPort as port } from "@/lib/infrastructure/chess/chess-js-position-port";

/**
 * 触れた駒の規則（FIDE 4.3〜4.5。ADR-014 §6）のドメインサービス。chess.js の合法手で判定する。
 */

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
/** 1. e4 d5: 白の手番。e4 のポーンで d5 を取れる */
const SCANDI = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2";
/** 両側にキャスリングできる */
const CASTLE = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";

function ok(r: ReturnType<typeof touchObligation>) {
  if (!r.ok) throw new Error(r.error);
  return r;
}

function at(fen: string, touched: string) {
  return ok(touchObligation(port, "white", touched, fen)).obligation;
}

describe("parseTouchedText", () => {
  it("reads pieces and squares in the order touched", () => {
    const r = parseTouchedText("Pe2 → qd8, e4");
    expect(r).toEqual({
      ok: true,
      entries: [
        { square: "e2", color: "white", kind: "p" },
        { square: "d8", color: "black", kind: "q" },
        { square: "e4" },
      ],
    });
  });
  it("accepts full-width input and keeps the first touch of a square", () => {
    const r = parseTouchedText("Ｐｅ２、Ｑｄ１ Pe2");
    expect(r.ok && r.entries.map((e) => e.square)).toEqual(["e2", "d1"]);
  });
  it("rejects unreadable tokens and empty input", () => {
    expect(parseTouchedText("e9").ok).toBe(false);
    expect(parseTouchedText("Xe2").ok).toBe(false);
    expect(parseTouchedText("  ").ok).toBe(false);
  });
});

describe("touchObligation with a position (chess.js)", () => {
  it("4.3.1: the first touched own piece that can be moved", () => {
    const o = at(START, "e2 d1");
    expect(o.rule).toBe("4.3.1");
    expect(o.piece?.square).toBe("e2");
    expect(o.moves).toEqual(["e3", "e4"]);
  });

  it("4.3.1: skips a touched piece that cannot be moved", () => {
    const o = at(START, "d1 e2");
    expect(o.rule).toBe("4.3.1");
    expect(o.piece?.square).toBe("e2");
  });

  it("4.5: none of the touched pieces can be moved → any legal move", () => {
    const o = at(START, "a1 d1");
    expect(o.rule).toBe("4.5");
    expect(o.moves).toBeUndefined();
  });

  it("4.3.2: the first touched opponent's piece that can be captured", () => {
    const o = at(SCANDI, "e7 d5");
    expect(o.rule).toBe("4.3.2");
    expect(o.target?.square).toBe("d5");
    expect(o.moves).toEqual(["exd5"]);
  });

  it("4.3.2: en passant captures the touched pawn on its own square", () => {
    const fen = "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3";
    const o = at(fen, "f5");
    expect(o.rule).toBe("4.3.2");
    expect(o.moves).toEqual(["exf6"]);
  });

  it("4.3.3: capture the first touched opponent's piece with the first touched own piece", () => {
    const o = at(SCANDI, "e4 d5");
    expect(o.rule).toBe("4.3.3");
    expect(o.piece?.square).toBe("e4");
    expect(o.target?.square).toBe("d5");
    expect(o.moves).toEqual(["exd5"]);
  });

  it("4.3.3: if that capture is illegal, the first touched piece that can be moved or captured", () => {
    // d2 のポーンは d5 を取れない → 触れた順: d2 を動かす
    const own = at(SCANDI, "d2 d5");
    expect(own.rule).toBe("4.3.3");
    expect(own.piece?.square).toBe("d2");
    expect(own.target).toBeUndefined();
    expect(own.moves).toEqual(["d3", "d4"]);
    // 相手の駒を先に触れた: d5 を取る
    const opp = at(SCANDI, "d5 d2");
    expect(opp.target?.square).toBe("d5");
    expect(opp.moves).toEqual(["exd5"]);
  });

  it("4.4.1: king then rook → castle on that side", () => {
    expect(at(CASTLE, "e1 h1")).toMatchObject({
      rule: "4.4.1",
      moves: ["O-O"],
    });
    expect(at(CASTLE, "e1 a1")).toMatchObject({
      rule: "4.4.1",
      moves: ["O-O-O"],
    });
  });

  it("4.4.3: castling with that rook is illegal → another legal king move, including the other side", () => {
    // c4 のビショップが f1 を攻撃している（キングサイドのキャスリングは不可）
    const fen = "r3k2r/pppppppp/8/8/2b5/8/PPPP1PPP/R3K2R w KQkq - 0 1";
    const o = at(fen, "e1 h1");
    expect(o.rule).toBe("4.4.3");
    expect(o.piece?.square).toBe("e1");
    expect(o.moves?.sort()).toEqual(["Kd1", "O-O-O"]);
  });

  it("4.4.2: rook then king → move the rook; no castling on that side", () => {
    const o = at(CASTLE, "h1 e1");
    expect(o.rule).toBe("4.4.2");
    expect(o.piece?.square).toBe("h1");
    expect(o.moves?.sort()).toEqual(["Rf1", "Rg1"]);
  });

  it("4.4.2: a rook that cannot move → the king, still without castling on that side", () => {
    const fen = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/RN2K2R w KQkq - 0 1";
    const o = at(fen, "a1 e1");
    expect(o.rule).toBe("4.4.2");
    expect(o.piece?.square).toBe("e1");
    expect(o.moves).not.toContain("O-O-O");
    expect(o.moves).toContain("O-O");
  });

  it("king then a rook off its castling square → 4.3.1 (the king)", () => {
    const fen = "4k3/8/8/8/3R4/8/8/4K3 w - - 0 1";
    const o = at(fen, "e1 d4");
    expect(o.rule).toBe("4.3.1");
    expect(o.piece?.square).toBe("e1");
  });

  it("king then a rook off its castling square, king boxed in → the rook (4.3.1), not 4.5", () => {
    // レビュー指摘: キングが動けない場合も、触れた順に次の駒（ルーク）を動かす
    const fen = "4k3/8/8/8/8/8/3PPP2/3QKR2 w - - 0 1";
    const o = at(fen, "e1 f1");
    expect(o.rule).toBe("4.3.1");
    expect(o.piece?.square).toBe("f1");
    expect(o.moves?.sort()).toEqual(["Rg1", "Rh1"]);
    const steps = ok(touchObligation(undefined, "white", "Ke1 Rf1")).obligation;
    expect(steps.rule).toBe("4.3.1");
  });

  it("another own piece touched before the king and rook → 4.3.1 order, not castling", () => {
    // レビュー指摘: 最初に触れたナイトが動けるので、ナイトを動かす
    const fen = "4k3/8/8/8/8/8/PPPPPPPP/RN2K2R w KQ - 0 1";
    const o = at(fen, "b1 e1 h1");
    expect(o.rule).toBe("4.3.1");
    expect(o.piece?.square).toBe("b1");
    expect(o.moves).not.toContain("O-O");
    const steps = ok(
      touchObligation(undefined, "white", "Nb1 Ke1 Rh1")
    ).obligation;
    expect(steps.rule).toBe("4.3.1");
    expect(steps.steps?.[0]).toContain("白ナイト（b1）");
  });

  it("king and rook touched first, then another piece → still 4.4.1", () => {
    expect(at(CASTLE, "e1 h1 a1")).toMatchObject({
      rule: "4.4.1",
      moves: ["O-O"],
    });
  });

  it("flags promotion moves (4.4.4 note)", () => {
    const fen = "8/4P3/8/8/8/8/k7/4K3 w - - 0 1";
    const o = at(fen, "e7");
    expect(o.includesPromotion).toBe(true);
    expect(o.moves).toContain("e8=Q");
  });

  it("checks the touched pieces against the position", () => {
    expect(touchObligation(port, "white", "e4", START)).toMatchObject({
      ok: false,
    });
    expect(touchObligation(port, "white", "Qe2", START)).toMatchObject({
      ok: false,
    });
  });

  it("rejects a position whose side to move is not the player", () => {
    const r = touchObligation(port, "black", "e7", START);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("手番");
  });

  it("rejects an invalid FEN", () => {
    expect(touchObligation(port, "white", "e2", "not a fen").ok).toBe(false);
  });
});

describe("touchObligation without a position (steps on the board)", () => {
  it("needs the piece letters", () => {
    const r = touchObligation(port, "white", "e2 d1");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("駒の記号");
  });

  it("lists the own pieces in the order touched, then 4.5", () => {
    const r = ok(touchObligation(undefined, "white", "Qd1 Pe2"));
    expect(r.fromPosition).toBe(false);
    expect(r.obligation.rule).toBe("4.3.1");
    expect(r.obligation.moves).toBeUndefined();
    expect(r.obligation.steps?.[0]).toContain("白クイーン（d1）");
    expect(r.obligation.steps?.[1]).toContain("白ポーン（e2）");
    expect(r.obligation.steps?.at(-1)).toContain("4.5");
  });

  it("opponent's pieces → capture (4.3.2); both colours → 4.3.3", () => {
    expect(ok(touchObligation(undefined, "black", "Pe4")).obligation.rule).toBe(
      "4.3.2"
    );
    const both = ok(touchObligation(undefined, "white", "nf6 Pe5")).obligation;
    expect(both.rule).toBe("4.3.3");
    expect(both.steps?.[0]).toContain("白ポーン（e5）で黒ナイト（f6）を取る");
  });

  it("king then rook → castling steps (4.4.1 / 4.4.3); rook then king → 4.4.2", () => {
    const k = ok(touchObligation(undefined, "black", "ke8 rh8")).obligation;
    expect(k.rule).toBe("4.4.1");
    expect(k.steps?.[0]).toContain("キングサイド");
    const r = ok(touchObligation(undefined, "white", "Ra1 Ke1")).obligation;
    expect(r.rule).toBe("4.4.2");
    expect(r.steps?.[0]).toContain("クイーンサイドへのキャスリングはできない");
  });

  it("falls back to the steps when no port is available, even with a FEN", () => {
    const r = ok(touchObligation(undefined, "white", "Pe2", START));
    expect(r.fromPosition).toBe(false);
  });
});
