import { Chess, validateFen } from "chess.js";
import type {
  ChessPositionPort,
  NormalizedPosition,
  PortResult,
} from "@/lib/domain/services/position-analysis";

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

const RESULT_TOKENS = new Set(["1-0", "0-1", "1/2-1/2", "½-½", "*"]);

/** 全角英数字・記号を半角に変換する（例: "１．Ｎｆ３" → "1.Nf3"） */
function toHalfWidth(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    )
    .replace(/\u3000/g, " ");
}

/** 入れ子の変化（括弧）を取り除く */
function stripVariations(text: string): string {
  let out = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

function tokenizeMoves(text: string): string[] {
  const body = stripVariations(
    toHalfWidth(text)
      .replace(/\[[^\]]*\]/g, " ") // PGN ヘッダタグ
      .replace(/\{[^}]*\}/g, " ") // コメント
      .replace(/;[^\n]*/g, " ")
  ).replace(/\$\d+/g, " "); // NAG
  return body
    .split(/\s+/)
    .map((t) =>
      t
        .replace(/^\d+\.(\.\.)?/, "")
        .replace(/[!?]+$/, "")
        .trim()
    )
    .filter((t) => t !== "" && !RESULT_TOKENS.has(t) && !/^\d+\.*$/.test(t));
}

export const chessJsPositionPort: ChessPositionPort = {
  normalize(fen: string): PortResult<NormalizedPosition> {
    const loaded = load(fen);
    if (!loaded.ok) return loaded;
    const { chess } = loaded;
    const fields = chess.fen().split(" ");
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
      isCheckmate: chess.isCheckmate(),
      sideToMove: chess.turn() === "w" ? "white" : "black",
    };
  },

  replay(moves: string, startFen?: string): PortResult<{ fens: string[] }> {
    let chess: Chess;
    if (startFen) {
      const loaded = load(startFen);
      if (!loaded.ok) return loaded;
      chess = loaded.chess;
    } else {
      chess = new Chess();
    }
    const fens = [chess.fen()];
    const tokens = tokenizeMoves(moves);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      try {
        chess.move(token);
      } catch {
        return {
          ok: false,
          error: `${Math.floor(i / 2) + 1}${i % 2 === 0 ? "." : "..."} ${token} は直前の局面で合法手ではありません（${i + 1}半手目）`,
        };
      }
      fens.push(chess.fen());
    }
    return { ok: true, fens };
  },

  play(fen: string, san: string): PortResult<{ fen: string }> {
    const loaded = load(fen);
    if (!loaded.ok) return loaded;
    try {
      loaded.chess.move(san.trim());
      return { ok: true, fen: loaded.chess.fen() };
    } catch {
      return { ok: false, error: `「${san}」は合法手ではありません` };
    }
  },
};
