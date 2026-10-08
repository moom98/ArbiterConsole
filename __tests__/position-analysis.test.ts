import { describe, it, expect } from "vitest";
import { analyzeRepetition as analyzeValidated } from "@/lib/domain/services/position-analysis";
import {
  parseGameHistoryText,
  validateGameHistory,
} from "@/lib/domain/services/game-history";
import { chessJsPositionPort as port } from "@/lib/infrastructure/chess/chess-js-position-port";

/** テキスト → game.history → 検証 → 解析（DecisionEngine と同じ流れ） */
function analyzeRepetition(
  _port: typeof port,
  text: string,
  intendedMove?: string
) {
  const parsed = parseGameHistoryText(text);
  if (!parsed.ok) return parsed;
  const validated = validateGameHistory(port, parsed.history);
  if (!validated.ok) return validated;
  return analyzeValidated(port, validated, intendedMove);
}

function key(fen: string): string {
  const n = port.normalize(fen);
  if (!n.ok) throw new Error(n.error);
  return n.key;
}

describe("chess.js position port — 9.2.3 position identity", () => {
  it("ignores move counters", () => {
    expect(key("4k3/8/8/8/8/8/8/4K2R w K - 0 1")).toBe(
      key("4k3/8/8/8/8/8/8/4K2R w K - 37 80")
    );
  });

  it("different side to move → different positions", () => {
    expect(key("4k3/8/8/8/8/8/8/4K3 w - - 0 1")).not.toBe(
      key("4k3/8/8/8/8/8/8/4K3 b - - 0 1")
    );
  });

  it("castling rights differ → different positions (9.2.3.2)", () => {
    expect(key("4k3/8/8/8/8/8/8/4K2R w K - 0 1")).not.toBe(
      key("4k3/8/8/8/8/8/8/4K2R w - - 0 1")
    );
  });

  it("castling right claimed in FEN without the rook on its square is ignored", () => {
    expect(key("4k3/8/8/8/8/8/8/4K3 w K - 0 1")).toBe(
      key("4k3/8/8/8/8/8/8/4K3 w - - 0 1")
    );
  });

  it("en passant square counts only if an en passant capture is legal (9.2.3.1)", () => {
    expect(key("4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1")).toBe(
      key("4k3/8/8/8/4P3/8/8/4K3 b - - 0 1")
    );
    expect(key("4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1")).not.toBe(
      key("4k3/8/8/8/3pP3/8/8/4K3 b - - 0 1")
    );
  });

  it("en passant that would expose the king (pinned pawn) does not count", () => {
    // 黒キング a4、黒ポーン d4、白ポーン e4、白ルーク h4: dxe3 e.p. は違法
    expect(key("8/8/8/8/k2pP2R/8/8/4K3 b - e3 0 1")).toBe(
      key("8/8/8/8/k2pP2R/8/8/4K3 b - - 0 1")
    );
  });

  it("rejects an invalid FEN", () => {
    expect(port.normalize("not a fen").ok).toBe(false);
  });
});

describe("analyzeRepetition", () => {
  const knightDance = "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8";

  it("rejects a list of FENs (ADR-014 §4: no FEN-list mode)", () => {
    const r = analyzeRepetition(
      port,
      "4k3/8/8/8/8/8/8/4K3 w - - 0 1\n4k3/8/8/8/8/8/8/4K3 b - - 0 1"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("FEN");
  });

  it("initial position appears 3 times after the knight dance", () => {
    const r = analyzeRepetition(port, knightDance);
    if (!r.ok) throw new Error(r.error);
    expect(r.targetOccurrences).toBe(3);
    expect(r.positions).toBe(9);
  });

  it("9.2.1: counts the position after the intended move", () => {
    const r = analyzeRepetition(
      port,
      "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1",
      "Ng8"
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.targetOccurrences).toBe(3);
  });

  it("FEN after 1.e4 (ep square set, no capture possible) matches later identical positions", () => {
    const r = analyzeRepetition(
      port,
      "1. e4 Nf6 2. Nf3 Ng8 3. Ng1 Nf6 4. Nf3 Ng8 5. Ng1"
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.targetOccurrences).toBe(3);
  });

  it("castling right lost in between → not the same position", () => {
    const r = analyzeRepetition(
      port,
      "1. e4 e5 2. Ke2 Ke7 3. Ke1 Ke8 4. Ke2 Ke7 5. Ke1 Ke8"
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.targetOccurrences).toBe(2);
  });

  it("five occurrences are reported as maxOccurrences", () => {
    const r = analyzeRepetition(
      port,
      "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 5. Nf3 Nf6 6. Ng1 Ng8 7. Nf3 Nf6 8. Ng1 Ng8"
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.maxOccurrences).toBe(5);
  });

  it("illegal move in the list → error, not a guess", () => {
    expect(analyzeRepetition(port, "1. e4 e5 2. Ke3").ok).toBe(false);
  });

  it("illegal intended move → error", () => {
    expect(analyzeRepetition(port, "1. e4 e5", "Qh8").ok).toBe(false);
  });

  it("halfmove clock from a move list", () => {
    const r = analyzeRepetition(port, knightDance);
    if (!r.ok) throw new Error(r.error);
    expect(r.halfmoveClock).toBe(8);
  });
});

describe("analyzeRepetition — review regressions", () => {
  it("B2: 75 moves reached mid-sequence is detected even after a later capture", () => {
    const shuffle = Array.from({ length: 38 }, () => "Nf3 Nf6 Ng1 Ng8").join(
      " "
    );
    const r = analyzeRepetition(port, `1. e4 d5 ${shuffle} exd5`);
    if (!r.ok) throw new Error(r.error);
    expect(r.halfmoveClock).toBe(0);
    expect(r.maxHalfmoveClock).toBe(152);
    expect(r.seventyFiveReachedWithCheckmate).toBe(false);
  });

  it("L5: reports the side to move before the intended move", () => {
    const r = analyzeRepetition(port, "1. Nf3 Nf6 2. Ng1", "Ng8");
    if (!r.ok) throw new Error(r.error);
    expect(r.sideToMove).toBe("black");
  });

  it("L2: accepts headers, nested variations, comments and full-width move numbers", () => {
    const r = analyzeRepetition(
      port,
      '[Event "Test"]\n１．Ｎｆ３ Nf6 (1... d5 (1... e5)) {comment} 2. Ng1! Ng8 *'
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.targetOccurrences).toBe(2);
  });

  it("L2: illegal move error names the move", () => {
    const r = analyzeRepetition(port, "1. e4 e5 2. Ke3");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Ke3");
  });
});
