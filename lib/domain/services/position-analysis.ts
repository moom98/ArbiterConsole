/**
 * 局面解析（同一局面・75手ルール）のドメインサービス。
 *
 * 合法手生成などのチェスのルール処理はドメインが定義するポート（ChessPositionPort）越しに行い、
 * 実装（chess.js アダプタ）はインフラ層に置く（ADR-005）。Decision Tree はこの結果だけを受け取る。
 *
 * 解析の入力は検証済みの対局履歴（game.history、ADR-014 §4）だけ。自由記述や FEN の列は使わない。
 */

import {
  summarizeGameHistory,
  trustedHalfmoveClock,
  type GameHistory,
  type GameHistorySummary,
  type ValidatedGameHistory,
} from "./game-history";

export type PortResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface NormalizedPosition {
  /**
   * 9.2.3 の同一性キー: 駒配置 + 手番 + キャスリング権 + アンパッサン
   * （アンパッサンは合法なアンパッサン捕獲が実際に可能な場合のみ）
   */
  key: string;
  /** FEN の halfmove clock（ポーンの移動・駒取りからの半手数） */
  halfmoveClock: number;
  /** FEN の fullmove number */
  fullmoveNumber: number;
  isCheckmate: boolean;
  sideToMove: "white" | "black";
  /**
   * 手番でない側のキングがチェックされている（実戦では起こりえない局面。
   * FEN の手番の誤りなど）
   */
  opponentInCheck: boolean;
}

export interface ChessPositionPort {
  normalize(fen: string): PortResult<NormalizedPosition>;
  /**
   * 対局履歴を再生し、開始局面を含む FEN 列と、正規化した SAN を返す。
   * 表記は厳密に解釈する（曖昧・非標準の表記は不合格。ADR-014 §4）。
   */
  replay(history: GameHistory): PortResult<{ fens: string[]; sans: string[] }>;
  /** 局面に1手（SAN、厳密に解釈）を指した後の FEN */
  play(fen: string, san: string): PortResult<{ fen: string }>;
  /**
   * 局面の駒配置と、手番の側の合法手の一覧（触れた駒の規則 4.3〜4.5 の判定に使う。ADR-014 §6）
   */
  legalMoves(fen: string): PortResult<PositionMoves>;
}

export type PieceKind = "k" | "q" | "r" | "b" | "n" | "p";

export interface BoardPiece {
  /** 例: "e2" */
  square: string;
  color: "white" | "black";
  kind: PieceKind;
}

export interface LegalMove {
  san: string;
  from: string;
  to: string;
  /** 取る駒のマス（アンパッサンでは to と異なる）。駒を取らない手は undefined */
  capturedSquare?: string;
  /** キャスリングの場合の側 */
  castling?: "king-side" | "queen-side";
  /** 昇格の手 */
  promotion?: boolean;
}

export interface PositionMoves {
  sideToMove: "white" | "black";
  pieces: BoardPiece[];
  moves: LegalMove[];
}

export interface RepetitionAnalysis {
  /** 対象局面（最後の局面、または記入した手を指した後の局面）の出現回数 */
  targetOccurrences: number;
  /** いずれかの局面の最大出現回数 */
  maxOccurrences: number;
  /**
   * 最後の局面の、ポーンの移動・駒取りのない半手数。
   * 途中からの履歴では、開始 FEN の値を信用せず履歴内で数えた値（下限）。
   */
  halfmoveClock: number;
  /**
   * 解析した全局面での halfmoveClock の最大値（同じく途中からの履歴では下限）。
   * 9.6.2 は途中で一度でも 75手（150半手）に達すれば成立する。
   */
  maxHalfmoveClock: number;
  /**
   * 150半手に初めて達した局面がチェックメイトか（9.6.2: その手がメイトならメイトが優先）。
   * 150半手に達していなければ undefined。
   */
  seventyFiveReachedWithCheckmate?: boolean;
  /**
   * 途中からの履歴で、履歴内で数えた 150 半手に（リセットなしで）達した局面がチェックメイト。
   * 実際の 150 半手はそれより前だった可能性があり（開始 FEN の値は信用しない）、
   * メイトとドローのどちらが先か確定できない（9.6.2）。
   */
  seventyFiveCheckmateUncertain?: boolean;
  /** 対局履歴の最後の局面（記入した手を指す前）の手番 */
  sideToMove: "white" | "black";
  /** 解析した局面数 */
  positions: number;
  /**
   * 初期配置からの履歴か。false の場合、「成立」は確定できるが「不成立」は確定できない
   * （開始局面より前の局面が分からないため。ADR-014 §4）。
   */
  complete: boolean;
  /** アービターが盤上と照合するための、対局履歴の最終局面（記入した手を指す前） */
  history: GameHistorySummary;
}

/** 75手 = 両プレーヤー各75手 = 150 半手（9.6.2） */
export const SEVENTY_FIVE_MOVES_PLIES = 150;

/**
 * 検証済みの対局履歴から同一局面の回数・手数を数える。
 * intendedMove を指定した場合（9.2.1）、最後の局面にその手を指した後の局面を対象にする。
 */
export function analyzeRepetition(
  port: ChessPositionPort,
  validated: ValidatedGameHistory,
  intendedMove?: string
): PortResult<RepetitionAnalysis> {
  const positions = [...validated.positions];
  if (positions.length === 0) return { ok: false, error: "局面がありません" };

  if (intendedMove) {
    const played = port.play(
      validated.fens[validated.fens.length - 1],
      intendedMove
    );
    if (!played.ok)
      return {
        ok: false,
        error: `記入した手「${intendedMove}」を指せません: ${played.error}`,
      };
    const n = port.normalize(played.fen);
    if (!n.ok) return n;
    positions.push(n);
  }

  const counts = new Map<string, number>();
  let maxHalfmoveClock = 0;
  let halfmoveClock = 0;
  let seventyFiveReachedWithCheckmate: boolean | undefined;
  let seventyFiveCheckmateUncertain = false;
  for (let i = 0; i < positions.length; i++) {
    const n = positions[i];
    counts.set(n.key, (counts.get(n.key) ?? 0) + 1);
    halfmoveClock = trustedHalfmoveClock(validated, n, i);
    if (halfmoveClock > maxHalfmoveClock) maxHalfmoveClock = halfmoveClock;
    if (
      seventyFiveReachedWithCheckmate === undefined &&
      halfmoveClock >= SEVENTY_FIVE_MOVES_PLIES
    ) {
      seventyFiveReachedWithCheckmate = n.isCheckmate;
      // 履歴内でリセットがなければ（FEN の値 >= 半手数）、実際に 150 半手に達したのは
      // この局面以前。その局面には次の手があるのでメイトではなく、メイトでない場合は
      // どちらでもドロー。メイトの場合だけ、どちらが先か分からない
      seventyFiveCheckmateUncertain =
        !validated.complete && n.isCheckmate && n.halfmoveClock >= i;
    }
  }
  const last = positions[positions.length - 1];
  return {
    ok: true,
    targetOccurrences: counts.get(last.key) ?? 0,
    maxOccurrences: Math.max(...Array.from(counts.values())),
    halfmoveClock,
    maxHalfmoveClock,
    seventyFiveReachedWithCheckmate,
    ...(seventyFiveCheckmateUncertain
      ? { seventyFiveCheckmateUncertain: true }
      : {}),
    sideToMove: validated.positions[validated.positions.length - 1].sideToMove,
    positions: positions.length,
    complete: validated.complete,
    history: summarizeGameHistory(validated),
  };
}
