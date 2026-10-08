/**
 * 端末内だけで使う対局履歴（game.history）のドメインサービス（ADR-014 §4, fact-model §3.5）。
 *
 * - 入力は構造化された `{ startFen?, moves: SAN[] }`。テキスト（PGN / 棋譜）は
 *   parseGameHistoryText で構造に変換する。FEN の列は受け付けない（局面が連続して
 *   出現したことを示せないため）。
 * - 指し手の合法性は ChessPositionPort.replay（strict: 曖昧・非標準の表記を拒否）で検証する。
 * - 外部（LLM・Jev）へは一切送らない（ADR-012）。
 */

import type {
  ChessPositionPort,
  NormalizedPosition,
  PortResult,
} from "./position-analysis";

export interface GameHistory {
  /** 開始局面（初期配置でない場合のみ）。PGN の [FEN "..."] ヘッダから取る */
  startFen?: string;
  /** SAN の指し手（手番号・結果記号・注釈を含まない） */
  moves: string[];
}

/** 初期配置の FEN（これと同じ開始局面は「初期配置からの履歴」として扱う） */
export const STANDARD_START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const RESULT_TOKENS = new Set(["1-0", "0-1", "1/2-1/2", "½-½", "*"]);

/** 局面配置（FEN の第1フィールド）に見える文字列 */
const FEN_PLACEMENT = /^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}$/;

/** 全角英数字・記号を半角に変換する（例: "１．Ｎｆ３" → "1.Nf3"） */
function toHalfWidth(text: string): string {
  return text
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
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

function normalizeSpaces(fen: string): string {
  return fen.trim().split(/\s+/).join(" ");
}

/**
 * PGN または棋譜のテキストを GameHistory に変換する（純粋関数。合法性は検証しない）。
 *
 * - PGN ヘッダ・コメント・変化・NAG・手番号・結果記号・!? 注釈を取り除く。
 * - 開始局面は `[FEN "..."]` ヘッダでのみ指定できる。
 * - FEN の行（局面の列）は受け付けない。
 */
export function parseGameHistoryText(
  text: string
): PortResult<{ history: GameHistory }> {
  // 「1…Nf6」の省略記号（U+2026）も手番号の「...」として扱う
  const half = toHalfWidth(text).replace(/\u2026/g, "...");

  const fenHeaders = Array.from(half.matchAll(/\[\s*FEN\s+"([^"]*)"\s*\]/gi));
  if (fenHeaders.length > 1)
    return { ok: false, error: "開始局面（[FEN] ヘッダ）が複数あります" };
  const startFen =
    fenHeaders.length === 1 ? normalizeSpaces(fenHeaders[0][1]) : undefined;
  if (startFen === "")
    return { ok: false, error: "開始局面（[FEN] ヘッダ）が空です" };

  const body = stripVariations(
    half
      .replace(/\[[^\]]*\]/g, " ") // PGN ヘッダタグ
      .replace(/\{[^}]*\}/g, " ") // コメント
      .replace(/;[^\n]*/g, " ")
  ).replace(/\$\d+/g, " "); // NAG

  const moves: string[] = [];
  for (const raw of body.split(/\s+/)) {
    if (raw === "") continue;
    if (FEN_PLACEMENT.test(raw))
      return {
        ok: false,
        error:
          'FEN（局面）の列は使えません。局面が続けて出現したことを示せないためです。棋譜（指し手）を入力してください。途中の局面から始める場合は [FEN "…"] の形で開始局面を書き、続けて指し手を入力してください。',
      };
    const token = raw
      .replace(/^\d+\.(\.\.)?/, "")
      .replace(/[!?]+$/, "")
      .trim();
    if (token === "" || RESULT_TOKENS.has(token) || /^\d+\.*$/.test(token))
      continue;
    moves.push(token);
  }

  return {
    ok: true,
    history: startFen === undefined ? { moves } : { startFen, moves },
  };
}

/** 検証済みの対局履歴（ChessPositionPort で最後まで合法に再生できたもの） */
export interface ValidatedGameHistory {
  history: GameHistory;
  /**
   * 初期配置から始まる履歴か。false（途中からの履歴）の場合、開始局面より前の局面は
   * 分からず、開始 FEN の halfmove clock は入力値のため信用しない（ADR-014 §4）。
   */
  complete: boolean;
  /** 開始局面を含む各局面（positions[i] は i 半手後） */
  positions: NormalizedPosition[];
  /** 開始局面を含む各局面の FEN */
  fens: string[];
  /** 再生した指し手の正規化した SAN */
  sans: string[];
  /** 再生した半手数 */
  plies: number;
}

/** 開始局面が初期配置と同じか（手数カウンタを含めて一致する場合のみ） */
export function isStandardStart(startFen: string | undefined): boolean {
  return (
    startFen === undefined || normalizeSpaces(startFen) === STANDARD_START_FEN
  );
}

/**
 * 対局履歴を再生・検証する。1手でも合法に指せない、または表記が曖昧・非標準なら
 * エラー（推測はしない）。
 */
export function validateGameHistory(
  port: ChessPositionPort,
  history: GameHistory
): PortResult<ValidatedGameHistory> {
  const replayed = port.replay(history);
  if (!replayed.ok) return replayed;
  const positions: NormalizedPosition[] = [];
  for (let i = 0; i < replayed.fens.length; i++) {
    const n = port.normalize(replayed.fens[i]);
    if (!n.ok)
      return { ok: false, error: `${i + 1}番目の局面が不正です: ${n.error}` };
    positions.push(n);
  }
  return {
    ok: true,
    history,
    complete: isStandardStart(history.startFen),
    positions,
    fens: replayed.fens,
    sans: replayed.sans,
    plies: replayed.sans.length,
  };
}

/**
 * i 半手目の局面での、信用できる「ポーンの移動・駒取りのない半手数」。
 * 途中からの履歴では、開始 FEN の halfmove clock を信用せず 0 から数える
 * （リセットがあればその後の値は正確なので、min(clock, i) で求まる）。
 */
export function trustedHalfmoveClock(
  v: Pick<ValidatedGameHistory, "complete">,
  position: Pick<NormalizedPosition, "halfmoveClock">,
  plyIndex: number
): number {
  return v.complete
    ? position.halfmoveClock
    : Math.min(position.halfmoveClock, plyIndex);
}

/** アービターが盤上と照合するための、最終局面の要約 */
export interface GameHistorySummary {
  complete: boolean;
  plies: number;
  /** 最後に指された手（例: "23... Kg7"）。手がなければ undefined */
  lastMove?: string;
  finalFen: string;
  sideToMove: "white" | "black";
  /** 最終局面の手数（FEN の fullmove number。次に指す手の番号） */
  fullmoveNumber: number;
}

export function summarizeGameHistory(
  v: ValidatedGameHistory
): GameHistorySummary {
  const last = v.positions[v.positions.length - 1];
  let lastMove: string | undefined;
  if (v.plies > 0) {
    const before = v.positions[v.positions.length - 2];
    const san = v.sans[v.sans.length - 1];
    lastMove =
      before.sideToMove === "white"
        ? `${before.fullmoveNumber}. ${san}`
        : `${before.fullmoveNumber}... ${san}`;
  }
  return {
    complete: v.complete,
    plies: v.plies,
    lastMove,
    finalFen: v.fens[v.fens.length - 1],
    sideToMove: last.sideToMove,
    fullmoveNumber: last.fullmoveNumber,
  };
}
