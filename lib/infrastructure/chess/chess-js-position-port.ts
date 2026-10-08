import { Chess, validateFen } from "chess.js";
import type {
  BoardPiece,
  ChessPositionPort,
  LegalMove,
  NormalizedPosition,
  PortResult,
  PositionMoves,
} from "@/lib/domain/services/position-analysis";
import type { GameHistory } from "@/lib/domain/services/game-history";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function load(fen: string): PortResult<{ chess: Chess }> {
  const v = validateFen(fen);
  if (!v.ok) return { ok: false, error: v.error ?? "FEN が不正です" };
  try {
    return { ok: true, chess: new Chess(fen) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * キャスリング権を、キングとルークが初期位置にある場合だけに限定して正規化する
 * （FEN の記述に依存しない。9.2.3.2: 権利はキングかルークが動いたときにのみ失われる）。
 */
function normalizedCastling(chess: Chess): string {
  const out: string[] = [];
  const at = (sq: Parameters<Chess["get"]>[0]) => chess.get(sq);
  const has = (
    sq: Parameters<Chess["get"]>[0],
    type: string,
    color: "w" | "b"
  ) => {
    const p = at(sq);
    return !!p && p.type === type && p.color === color;
  };
  const w = chess.getCastlingRights("w");
  const b = chess.getCastlingRights("b");
  if (w.k && has("e1", "k", "w") && has("h1", "r", "w")) out.push("K");
  if (w.q && has("e1", "k", "w") && has("a1", "r", "w")) out.push("Q");
  if (b.k && has("e8", "k", "b") && has("h8", "r", "b")) out.push("k");
  if (b.q && has("e8", "k", "b") && has("a8", "r", "b")) out.push("q");
  return out.length > 0 ? out.join("") : "-";
}

/** 合法なアンパッサン捕獲がある場合のみ、そのマスを返す（9.2.3.1） */
function legalEnPassantSquare(chess: Chess): string {
  const ep = chess.moves({ verbose: true }).find((m) => m.isEnPassant());
  return ep ? ep.to : "-";
}

/**
 * 1手を厳密に（strict: true）指す。過剰な曖昧さ回避（Ngf3）、座標表記（e2e4）、
 * 0-0 などの非標準表記と、曖昧な表記（Nd2 で2つのナイトが行ける）は不合格。
 */
function moveStrict(chess: Chess, san: string): string | undefined {
  try {
    return chess.move(san, { strict: true }).san;
  } catch {
    return undefined;
  }
}

function notationHint(san: string): string {
  if (/^e\.?p\.?$/i.test(san))
    return "アンパッサンの「e.p.」は書かずに、exd6 のように取る手だけを書いてください。";
  if (/^0-0(-0)?/.test(san))
    return "キャスリングは英字の O を使って O-O / O-O-O と書いてください。";
  if (/^[a-h][1-8]-?[a-h][1-8]/.test(san))
    return "座標表記（e2e4 など）ではなく、標準の代数式表記（SAN、例: e4, Nf3）で書いてください。";
  return "合法手でないか、表記が曖昧・標準でない可能性があります（例: 2つのナイトが行ける場合は Nbd2 のように書く）。";
}

export const chessJsPositionPort: ChessPositionPort = {
  normalize(fen: string): PortResult<NormalizedPosition> {
    const loaded = load(fen);
    if (!loaded.ok) return loaded;
    const { chess } = loaded;
    const fields = chess.fen().split(" ");
    const mover = chess.turn();
    const other = mover === "w" ? "b" : "w";
    const otherKing = chess.findPiece({ type: "k", color: other })[0];
    const key = [
      fields[0],
      chess.turn(),
      normalizedCastling(chess),
      fields[3] === "-" ? "-" : legalEnPassantSquare(chess),
    ].join(" ");
    return {
      ok: true,
      key,
      halfmoveClock: Number(fields[4]) || 0,
      fullmoveNumber: Number(fields[5]) || 1,
      isCheckmate: chess.isCheckmate(),
      sideToMove: chess.turn() === "w" ? "white" : "black",
      opponentInCheck:
        otherKing !== undefined && chess.isAttacked(otherKing, mover),
    };
  },

  replay(history: GameHistory): PortResult<{ fens: string[]; sans: string[] }> {
    let chess: Chess;
    if (history.startFen !== undefined) {
      const loaded = load(history.startFen);
      if (!loaded.ok)
        return {
          ok: false,
          error: `開始局面の FEN が不正です: ${loaded.error}`,
        };
      chess = loaded.chess;
    } else {
      chess = new Chess();
    }
    const fens = [chess.fen()];
    const sans: string[] = [];
    for (let i = 0; i < history.moves.length; i++) {
      const token = history.moves[i];
      const moveNumber = chess.moveNumber();
      const black = chess.turn() === "b";
      const san = moveStrict(chess, token);
      if (san === undefined) {
        return {
          ok: false,
          error: `${moveNumber}${black ? "..." : "."} ${token} を指せません（${i + 1}半手目）。${notationHint(token)}`,
        };
      }
      sans.push(san);
      fens.push(chess.fen());
    }
    return { ok: true, fens, sans };
  },

  play(fen: string, san: string): PortResult<{ fen: string }> {
    const loaded = load(fen);
    if (!loaded.ok) return loaded;
    const token = san.trim();
    if (moveStrict(loaded.chess, token) === undefined)
      return {
        ok: false,
        error: `「${token}」を指せません。${notationHint(token)}`,
      };
    return { ok: true, fen: loaded.chess.fen() };
  },

  legalMoves(fen: string): PortResult<PositionMoves> {
    const loaded = load(fen);
    if (!loaded.ok) return loaded;
    const { chess } = loaded;
    const pieces: BoardPiece[] = [];
    for (const row of chess.board())
      for (const cell of row)
        if (cell)
          pieces.push({
            square: cell.square,
            color: cell.color === "w" ? "white" : "black",
            kind: cell.type,
          });
    const moves: LegalMove[] = chess.moves({ verbose: true }).map((m) => {
      const move: LegalMove = { san: m.san, from: m.from, to: m.to };
      if (m.isEnPassant()) move.capturedSquare = `${m.to[0]}${m.from[1]}`;
      else if (m.captured) move.capturedSquare = m.to;
      if (m.isKingsideCastle()) move.castling = "king-side";
      else if (m.isQueensideCastle()) move.castling = "queen-side";
      if (m.isPromotion()) move.promotion = true;
      return move;
    });
    return {
      ok: true,
      sideToMove: chess.turn() === "w" ? "white" : "black",
      pieces,
      moves,
    };
  },
};
