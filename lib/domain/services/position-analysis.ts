/**
 * 局面解析（同一局面・75手ルール）のドメインサービス。
 *
 * 合法手生成などのチェスのルール処理はドメインが定義するポート（ChessPositionPort）越しに行い、
 * 実装（chess.js アダプタ）はインフラ層に置く（ADR-005）。Decision Tree はこの結果だけを受け取る。
 */

export type PortResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface NormalizedPosition {
  /**
   * 9.2.3 の同一性キー: 駒配置 + 手番 + キャスリング権 + アンパッサン
   * （アンパッサンは合法なアンパッサン捕獲が実際に可能な場合のみ）
   */
  key: string;
  /** FEN の halfmove clock（ポーンの移動・駒取りからの半手数） */
  halfmoveClock: number;
  isCheckmate: boolean;
}

export interface ChessPositionPort {
  normalize(fen: string): PortResult<NormalizedPosition>;
  /** SAN の指し手列（手番号・結果記号を含んでよい）を再生し、開始局面を含む FEN 列を返す */
  replay(moves: string, startFen?: string): PortResult<{ fens: string[] }>;
  /** 局面に1手（SAN）を指した後の FEN */
  play(fen: string, san: string): PortResult<{ fen: string }>;
}

export interface RepetitionAnalysis {
  /** 対象局面（最後の局面、または記入した手を指した後の局面）の出現回数 */
  targetOccurrences: number;
  /** いずれかの局面の最大出現回数 */
  maxOccurrences: number;
  /** 最後の局面までの、ポーンの移動・駒取りのない半手数（FEN の halfmove clock） */
  halfmoveClock: number;
  /** 解析した局面数 */
  positions: number;
  /** 入力形式 */
  format: "moves" | "fens";
}

const FEN_LIKE = /^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}(\s|$)/;

/** 入力が FEN の列（1行に1局面）か、指し手列かを判定する */
export function detectPositionsFormat(text: string): "moves" | "fens" {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((l) => FEN_LIKE.test(l))
    ? "fens"
    : "moves";
}

/**
 * 入力（棋譜または FEN 列）から同一局面の回数を数える。
 * intendedMove を指定した場合（9.2.1）、最後の局面にその手を指した後の局面を対象にする。
 */
export function analyzeRepetition(
  port: ChessPositionPort,
  text: string,
  intendedMove?: string
): PortResult<RepetitionAnalysis> {
  const format = detectPositionsFormat(text);
  let fens: string[];
  if (format === "fens") {
    fens = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } else {
    const replayed = port.replay(text);
    if (!replayed.ok) return replayed;
    fens = replayed.fens;
  }
  if (fens.length === 0) return { ok: false, error: "局面がありません" };

  if (intendedMove) {
    const played = port.play(fens[fens.length - 1], intendedMove);
    if (!played.ok)
      return {
        ok: false,
        error: `記入した手「${intendedMove}」を指せません: ${played.error}`,
      };
    fens = [...fens, played.fen];
  }

  const counts = new Map<string, number>();
  let last: NormalizedPosition | undefined;
  for (let i = 0; i < fens.length; i++) {
    const n = port.normalize(fens[i]);
    if (!n.ok)
      return { ok: false, error: `${i + 1}番目の局面が不正です: ${n.error}` };
    counts.set(n.key, (counts.get(n.key) ?? 0) + 1);
    last = n;
  }
  return {
    ok: true,
    targetOccurrences: counts.get(last!.key) ?? 0,
    maxOccurrences: Math.max(...Array.from(counts.values())),
    halfmoveClock: last!.halfmoveClock,
    positions: fens.length,
    format,
  };
}
