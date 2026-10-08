import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { Board, moveToUci } from "@/lib/infrastructure/chess/helpmate/board";
import {
  DEFAULT_HELPMATE_LIMITS,
  findHelpmate,
} from "@/lib/infrastructure/chess/helpmate/search";
import { mateFixtures } from "./fixtures/mate-possibility-positions";

/** chess.js の合法手数（キャスリングを除く。探索用の盤面はキャスリングを生成しない） */
function chessJsPerft(c: Chess, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of c.moves({ verbose: true })) {
    if (m.isKingsideCastle() || m.isQueensideCastle()) continue;
    c.move(m);
    n += chessJsPerft(c, depth - 1);
    c.undo();
  }
  return n;
}

function boardPerft(b: Board, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of b.legalMoves()) {
    b.make(m);
    n += boardPerft(b, depth - 1);
    b.unmake();
  }
  return n;
}

/** UCI の手順を chess.js で指し、最終局面を返す（指せなければ例外） */
function playUci(fen: string, uci: string[]): Chess {
  const c = new Chess(fen);
  for (const u of uci)
    c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  return c;
}

describe("helpmate board (0x88)", () => {
  // 昇格・アンパッサン・ピン・チェック回避を含む局面（perft の定番局面）
  const cases: [string, number][] = [
    ["r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 2],
    ["8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 3],
    ["r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", 2],
    ["rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", 2],
    ["8/8/8/2k5/2pP4/8/B7/4K3 b - d3 0 3", 3],
    ["8/8/8/8/k2Pp2Q/8/8/3K4 b - d3 0 1", 3],
  ];
  it.each(cases)("perft matches chess.js without castling: %s", (fen, d) => {
    expect(boardPerft(Board.fromFen(fen), d)).toBe(
      chessJsPerft(new Chess(fen), d)
    );
  });

  it("make/unmake restores the position key", () => {
    const b = Board.fromFen(cases[0][0]);
    const key = b.key();
    for (const m of b.legalMoves()) {
      b.make(m);
      b.unmake();
      expect(b.key()).toBe(key);
    }
    expect(b.ply).toBe(0);
  });

  it("detects checkmate and encodes UCI with promotion", () => {
    expect(Board.fromFen("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1").isCheckmate()).toBe(
      true
    );
    const b = Board.fromFen("8/4P3/8/8/8/8/8/k6K w - - 0 1");
    expect(b.legalMoves().map(moveToUci)).toContain("e7e8n");
  });
});

describe("findHelpmate", () => {
  it("returns an empty line when the defender is already mated", () => {
    const r = findHelpmate("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1", "white");
    expect(r).toMatchObject({ status: "found", uci: [] });
  });

  it("finds a short helpmate in the opening (fool's mate pattern)", () => {
    const r = findHelpmate(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "black"
    );
    expect(r.status).toBe("found");
    if (r.status !== "found") return;
    const c = playUci(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      r.uci
    );
    expect(c.isCheckmate()).toBe(true);
    expect(c.turn()).toBe("w");
  });

  it("never reports a mate by the wrong side", () => {
    // 黒はキングのみ: 黒がメイトする手順は存在しない
    const r = findHelpmate("8/8/8/4k3/8/8/8/3QK3 w - - 0 1", "black", {
      ...DEFAULT_HELPMATE_LIMITS,
      maxExpansions: 2_000,
    });
    expect(r.status).toBe("not-found");
  });

  it("rejects an unreadable FEN", () => {
    expect(findHelpmate("not a fen", "white")).toMatchObject({
      status: "not-found",
      reason: "invalid-position",
    });
  });

  it("stops at the deadline", () => {
    let t = 0;
    const r = findHelpmate("8/8/8/3k4/8/1b6/P7/K7 w - - 0 70", "black", {
      ...DEFAULT_HELPMATE_LIMITS,
      deadline: 5,
      now: () => t++,
    });
    expect(r).toMatchObject({ status: "not-found", reason: "deadline" });
  });

  // ADR-014 §5 の受け入れ基準: 50局面以上の実戦的なフラッグ局面で 90% 以上
  it("acceptance: finds a verified helpmate in ≥90% of ≥50 realistic positions", () => {
    const fixtures = mateFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(50);
    const misses: string[] = [];
    for (const f of fixtures) {
      const r = findHelpmate(f.fen, f.attacker);
      if (r.status !== "found") {
        misses.push(f.name);
        continue;
      }
      // 手順は chess.js で合法に指せて、攻撃側のメイトで終わる
      const c = playUci(f.fen, r.uci);
      expect(c.isCheckmate(), f.name).toBe(true);
      expect(c.turn(), f.name).toBe(f.attacker === "white" ? "b" : "w");
    }
    const rate = (fixtures.length - misses.length) / fixtures.length;
    expect(rate, `misses: ${misses.join(", ")}`).toBeGreaterThanOrEqual(0.9);
  }, 120_000);
});
