/**
 * 触れた駒の規則（FIDE Laws 2023 Article 4.3〜4.5。ADR-014 §6）のドメインサービス。
 *
 * 触れた駒（触れた順。tch.touched）から、どの駒を動かす・取る義務があるかを決める。
 * - 局面（FEN）がある場合: ChessPositionPort の合法手で、動かせる・取れる駒を判定し、許される手を返す。
 * - 局面がない場合: 規則の適用順（盤上で確認する手順）だけを返す（合法手は判定しない）。
 *
 * 触れた駒と局面は端末内だけで使い、外部へは送らない（ADR-012）。ペナルティは決めない。
 */

import type { PlayerColor } from "@/lib/domain/entities";
import type {
  BoardPiece,
  ChessPositionPort,
  LegalMove,
  PieceKind,
  PositionMoves,
} from "./position-analysis";

export interface TouchedPiece {
  square: string;
  color: PlayerColor;
  kind: PieceKind;
}

/** 入力の1件（局面がない場合は駒の種類と色が必須） */
interface TouchedEntry {
  square: string;
  color?: PlayerColor;
  kind?: PieceKind;
}

/**
 * 適用した条項。
 * - 4.3.1 自分の駒 / 4.3.2 相手の駒 / 4.3.3 両方の色の駒
 * - 4.4.1 キング→ルーク: その側へキャスリング / 4.4.3 キャスリングが合法でない: キングで指す
 * - 4.4.2 ルーク→キング: その側へのキャスリングは不可（4.3.1 に従う）
 * - 4.5 触れた駒はどれも動かせない・取れない: 任意の合法手
 */
export type TouchRule =
  "4.3.1" | "4.3.2" | "4.3.3" | "4.4.1" | "4.4.2" | "4.4.3" | "4.5";

export interface TouchObligation {
  rule: TouchRule;
  /** 動かす駒（4.3.2 では undefined、4.5 では undefined） */
  piece?: TouchedPiece;
  /** 取る相手の駒（4.3.2 / 4.3.3） */
  target?: TouchedPiece;
  /** 局面から判定した場合: 許される合法手（SAN）。4.5 では undefined（任意の合法手） */
  moves?: string[];
  /** 許される手に昇格の手を含む（4.4.4 の注意を表示する） */
  includesPromotion?: boolean;
  /** 局面がない場合: 盤上で確認する手順（優先順） */
  steps?: string[];
  /** 触れた駒（正規化済み。表示用） */
  touched: TouchedPiece[];
}

export type TouchObligationResult =
  | { ok: true; obligation: TouchObligation; fromPosition: boolean }
  | { ok: false; error: string };

const PIECE_JA: Record<PieceKind, string> = {
  k: "キング",
  q: "クイーン",
  r: "ルーク",
  b: "ビショップ",
  n: "ナイト",
  p: "ポーン",
};

const COLOR_JA: Record<PlayerColor, string> = { white: "白", black: "黒" };

export function touchedPieceJa(p: TouchedPiece): string {
  return `${COLOR_JA[p.color]}${PIECE_JA[p.kind]}（${p.square}）`;
}

const TOKEN = /^([KQRBNPkqrbnp])?([a-h][1-8])$/;

/**
 * 触れた駒のテキストを解析する。区切りは空白・カンマ・読点・矢印。
 * 例: "Pe2 Qd1"（白は大文字・黒は小文字）、"e2 → d1"（局面がある場合）。
 * 同じマスが2回出た場合は、最初に触れた順だけを使う。
 */
export function parseTouchedText(
  text: string
): { ok: true; entries: TouchedEntry[] } | { ok: false; error: string } {
  const tokens = text
    .normalize("NFKC")
    .split(/[\s,、，→>]+|->|-/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
  if (tokens.length === 0)
    return { ok: false, error: "触れた駒を入力してください。" };
  const entries: TouchedEntry[] = [];
  for (const token of tokens) {
    const m = TOKEN.exec(token);
    if (!m)
      return {
        ok: false,
        error: `「${token}」を読み取れません。駒の記号（白は大文字・黒は小文字: K Q R B N P）とマスで入力してください（例: Pe2 Qd1）。`,
      };
    const [, letter, square] = m;
    if (entries.some((e) => e.square === square)) continue;
    entries.push(
      letter === undefined
        ? { square }
        : {
            square,
            color: letter === letter.toUpperCase() ? "white" : "black",
            kind: letter.toLowerCase() as PieceKind,
          }
    );
  }
  return { ok: true, entries };
}

/** 入力を駒に解決する。局面がある場合は盤上の駒と照合する */
function resolveTouched(
  entries: TouchedEntry[],
  pieces: BoardPiece[] | undefined
): { ok: true; touched: TouchedPiece[] } | { ok: false; error: string } {
  const touched: TouchedPiece[] = [];
  for (const e of entries) {
    if (pieces) {
      const p = pieces.find((b) => b.square === e.square);
      if (!p)
        return {
          ok: false,
          error: `局面（FEN）の ${e.square} に駒がありません。触れたマスか局面を確認してください。`,
        };
      if (
        (e.color !== undefined && e.color !== p.color) ||
        (e.kind !== undefined && e.kind !== p.kind)
      )
        return {
          ok: false,
          error: `${e.square} の駒が局面（FEN）と一致しません（局面では ${touchedPieceJa({ ...p })}）。`,
        };
      touched.push({ square: p.square, color: p.color, kind: p.kind });
    } else {
      if (e.color === undefined || e.kind === undefined)
        return {
          ok: false,
          error: `局面（FEN）がない場合は、駒の記号も入力してください（例: P${e.square}。白は大文字・黒は小文字）。`,
        };
      touched.push({ square: e.square, color: e.color, kind: e.kind });
    }
  }
  return { ok: true, touched };
}

/** 初期位置のルークのキャスリングの側（初期位置にないルークは undefined） */
function castlingSideOf(
  rook: TouchedPiece
): "king-side" | "queen-side" | undefined {
  const rank = rook.color === "white" ? "1" : "8";
  if (rook.square === `h${rank}`) return "king-side";
  if (rook.square === `a${rank}`) return "queen-side";
  return undefined;
}

const SIDE_JA = {
  "king-side": "キングサイド",
  "queen-side": "クイーンサイド",
} as const;

/**
 * キング・ルークのキャスリング（4.4）を適用する組み合わせか。
 * 自分の駒だけに触れ、最初に触れた2つがキングと初期位置（キャスリングの位置）のルークの
 * 場合だけ。他の駒を先に触れた場合・初期位置にないルークは 4.3.1（触れた順）に従う。
 */
function castlingPair(
  own: TouchedPiece[],
  opp: TouchedPiece[]
):
  | {
      king: TouchedPiece;
      rook: TouchedPiece;
      side: "king-side" | "queen-side";
      kingFirst: boolean;
    }
  | undefined {
  if (opp.length > 0 || own.length < 2) return undefined;
  const [a, b] = own;
  const king = a.kind === "k" ? a : b.kind === "k" ? b : undefined;
  const rook = a.kind === "r" ? a : b.kind === "r" ? b : undefined;
  if (!king || !rook) return undefined;
  const side = castlingSideOf(rook);
  if (side === undefined) return undefined;
  return { king, rook, side, kingFirst: king === a };
}

/** 局面から、触れた駒の義務を判定する */
function fromPosition(
  position: PositionMoves,
  player: PlayerColor,
  touched: TouchedPiece[]
): TouchObligation {
  const { moves } = position;
  const own = touched.filter((p) => p.color === player);
  const opp = touched.filter((p) => p.color !== player);
  const from = (sq: string, exclude?: LegalMove["castling"]) =>
    moves.filter(
      (m) => m.from === sq && (exclude === undefined || m.castling !== exclude)
    );
  const captures = (sq: string) => moves.filter((m) => m.capturedSquare === sq);
  const result = (
    rule: TouchRule,
    selected: LegalMove[] | undefined,
    fields: Pick<TouchObligation, "piece" | "target"> = {}
  ): TouchObligation => ({
    rule,
    ...fields,
    moves: selected?.map((m) => m.san),
    includesPromotion: selected?.some((m) => m.promotion) || undefined,
    touched,
  });

  // 4.4: キングとルーク（自分の駒だけ）
  const pair = castlingPair(own, opp);
  if (pair) {
    const { side } = pair;
    if (pair.kingFirst) {
      const castle = moves.filter(
        (m) => m.from === pair.king.square && m.castling === side
      );
      if (castle.length > 0)
        return result("4.4.1", castle, { piece: pair.king });
      // 4.4.3: キングで別の合法手（反対側へのキャスリングを含む）。なければ任意の合法手
      const kingMoves = from(pair.king.square);
      if (kingMoves.length > 0)
        return result("4.4.3", kingMoves, { piece: pair.king });
      return result("4.5", undefined);
    }
    // 4.4.2: その側へのキャスリングは不可。4.3.1 に従い、触れた順に動かせる駒を動かす
    for (const p of own) {
      const ms = from(p.square, p.kind === "k" ? side : undefined);
      if (ms.length > 0) return result("4.4.2", ms, { piece: p });
    }
    return result("4.5", undefined);
  }

  if (opp.length === 0) {
    for (const p of own) {
      const ms = from(p.square);
      if (ms.length > 0) return result("4.3.1", ms, { piece: p });
    }
    return result("4.5", undefined);
  }
  if (own.length === 0) {
    for (const t of opp) {
      const ms = captures(t.square);
      if (ms.length > 0) return result("4.3.2", ms, { target: t });
    }
    return result("4.5", undefined);
  }
  // 4.3.3: 最初に触れた自分の駒で、最初に触れた相手の駒を取る。合法でなければ、
  // 触れた順に、動かせる（取れる）最初の駒
  const capture = moves.filter(
    (m) => m.from === own[0].square && m.capturedSquare === opp[0].square
  );
  if (capture.length > 0)
    return result("4.3.3", capture, { piece: own[0], target: opp[0] });
  for (const p of touched) {
    if (p.color === player) {
      const ms = from(p.square);
      if (ms.length > 0) return result("4.3.3", ms, { piece: p });
    } else {
      const ms = captures(p.square);
      if (ms.length > 0) return result("4.3.3", ms, { target: p });
    }
  }
  return result("4.5", undefined);
}

const ANY_LEGAL =
  "どれも動かせない（取れない）場合は、任意の合法手を指せる（4.5）";

/** 局面がない場合: 盤上で確認する手順 */
function steps(player: PlayerColor, touched: TouchedPiece[]): TouchObligation {
  const own = touched.filter((p) => p.color === player);
  const opp = touched.filter((p) => p.color !== player);
  const pair = castlingPair(own, opp);
  const base = { touched };

  if (pair) {
    const { side } = pair;
    if (pair.kingFirst) {
      return {
        ...base,
        rule: "4.4.1",
        piece: pair.king,
        steps: [
          `${SIDE_JA[side]}へキャスリングする（合法な場合。4.4.1）`,
          "キャスリングが合法でない場合は、キングで別の合法手を指す（反対側へのキャスリングを含む。4.4.3）",
          "キングに合法手がない場合は、任意の合法手を指せる（4.4.3）",
        ],
      };
    }
    return {
      ...base,
      rule: "4.4.2",
      piece: own[0],
      steps: [
        `この手番では${SIDE_JA[side]}へのキャスリングはできない（ルークを先に触れた。4.4.2）`,
        ...own.map(
          (p, i) =>
            `${i === 0 ? "" : "動かせなければ、"}${touchedPieceJa(p)}を動かす${p.kind === "k" ? "（その側へのキャスリングを除く）" : ""}（4.3.1）`
        ),
        ANY_LEGAL,
      ],
    };
  }

  if (opp.length === 0)
    return {
      ...base,
      rule: "4.3.1",
      piece: own[0],
      steps: [
        ...own.map(
          (p, i) =>
            `${i === 0 ? "" : "動かせなければ、"}${touchedPieceJa(p)}を動かす（4.3.1）`
        ),
        ANY_LEGAL,
      ],
    };
  if (own.length === 0)
    return {
      ...base,
      rule: "4.3.2",
      target: opp[0],
      steps: [
        ...opp.map(
          (p, i) =>
            `${i === 0 ? "" : "取れなければ、"}${touchedPieceJa(p)}を取る（4.3.2）`
        ),
        ANY_LEGAL,
      ],
    };
  return {
    ...base,
    rule: "4.3.3",
    piece: own[0],
    target: opp[0],
    steps: [
      `${touchedPieceJa(own[0])}で${touchedPieceJa(opp[0])}を取る（4.3.3）`,
      "合法でなければ、触れた順に、動かせる・取れる最初の駒で指す: " +
        touched
          .map(
            (p) =>
              `${touchedPieceJa(p)}${p.color === player ? "を動かす" : "を取る"}`
          )
          .join(" → "),
      ANY_LEGAL,
    ],
  };
}

/**
 * 触れた駒の義務を求める。fen を与え、port がある場合は局面の合法手で判定する
 * （fen の手番は触れたプレーヤーであること）。それ以外は盤上で確認する手順を返す。
 */
export function touchObligation(
  port: ChessPositionPort | undefined,
  player: PlayerColor,
  touchedText: string,
  fen?: string
): TouchObligationResult {
  const parsed = parseTouchedText(touchedText);
  if (!parsed.ok) return parsed;

  if (fen !== undefined && fen.trim() !== "" && port) {
    const position = port.legalMoves(fen.trim());
    if (!position.ok)
      return { ok: false, error: `局面（FEN）が不正です: ${position.error}` };
    if (position.sideToMove !== player)
      return {
        ok: false,
        error: `局面（FEN）の手番が、駒に触れたプレーヤー（${COLOR_JA[player]}）ではありません。触れた時点の局面（手番は触れたプレーヤー）を入力してください。`,
      };
    const resolved = resolveTouched(parsed.entries, position.pieces);
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      obligation: fromPosition(position, player, resolved.touched),
      fromPosition: true,
    };
  }

  const resolved = resolveTouched(parsed.entries, undefined);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    obligation: steps(player, resolved.touched),
    fromPosition: false,
  };
}
