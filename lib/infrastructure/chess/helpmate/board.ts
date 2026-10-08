/**
 * ヘルプメイト探索専用の軽量な盤面（0x88・指す／戻す）。
 *
 * chess.js は探索には遅すぎる（合法手生成が毎秒約2万回）ため、探索だけをこの盤面で行う。
 * 見つけた手順は必ず chess.js（ChessPositionPort.replay、strict）で再検証してから使う
 * （ADR-015）。この盤面に誤りがあっても「メイト可能」を誤って確定することはなく、
 * 見逃し（unknown）になるだけである。
 *
 * - キャスリングは生成しない（チェック中は指せないためメイトの判定には影響せず、
 *   手を省くのは探索の見逃しになるだけで健全）。
 * - アンパッサンは生成する（チェックの回避手になり得るため、メイト判定に必要）。
 */

export type Side = 1 | -1;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

const KNIGHT_OFFSETS = [33, 31, 18, 14, -14, -18, -31, -33];
const KING_OFFSETS = [1, -1, 16, -16, 17, 15, -15, -17];
const BISHOP_DIRS = [17, 15, -15, -17];
const ROOK_DIRS = [1, -1, 16, -16];

const PIECE_CHARS = " pnbrqk";

/** 手の符号化: from(7bit) | to(7bit)<<7 | 昇格駒(3bit)<<14 | フラグ<<17 */
export const FLAG_CAPTURE = 1;
export const FLAG_EP = 2;
export const FLAG_DOUBLE = 4;

export function encodeMove(
  from: number,
  to: number,
  promo = 0,
  flags = 0
): number {
  return from | (to << 7) | (promo << 14) | (flags << 17);
}
export const moveFrom = (m: number) => m & 0x7f;
export const moveTo = (m: number) => (m >> 7) & 0x7f;
export const movePromo = (m: number) => (m >> 14) & 0x7;
export const moveFlags = (m: number) => m >> 17;

export const onBoard = (sq: number) => (sq & 0x88) === 0;
export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => sq >> 4;

export function squareName(sq: number): string {
  return "abcdefgh"[fileOf(sq)] + String(rankOf(sq) + 1);
}

/** UCI 形式（例: e7e8q）。chess.js で SAN に変換するために使う */
export function moveToUci(m: number): string {
  const promo = movePromo(m);
  return (
    squareName(moveFrom(m)) +
    squareName(moveTo(m)) +
    (promo ? PIECE_CHARS[promo] : "")
  );
}

// --- Zobrist（2つの 32bit 値を 53bit の数値キーにまとめる） -------------------

function xorshift(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

const rand = xorshift(0x9e3779b9);
/** [piece+6][sq] （piece は -6..6） */
const Z1 = Array.from({ length: 13 }, () =>
  Array.from({ length: 128 }, () => rand())
);
const Z2 = Array.from({ length: 13 }, () =>
  Array.from({ length: 128 }, () => rand() & 0x1fffff)
);
const Z_SIDE1 = rand();
const Z_SIDE2 = rand() & 0x1fffff;
const Z_EP1 = Array.from({ length: 8 }, () => rand());
const Z_EP2 = Array.from({ length: 8 }, () => rand() & 0x1fffff);

/** 指した手を戻すための記録の最大数（探索の手順の長さの上限） */
const MAX_PLY = 1024;

export class Board {
  readonly sq = new Int8Array(128);
  side: Side = 1;
  ep = -1;
  halfmove = 0;
  /** king[0]: 白, king[1]: 黒 */
  readonly king = [-1, -1];
  h1 = 0;
  h2 = 0;
  // 戻すための記録（探索中の割り当てを避けるため型付き配列）
  private sp = 0;
  private readonly uMove = new Int32Array(MAX_PLY);
  private readonly uCaptured = new Int8Array(MAX_PLY);
  private readonly uEp = new Int16Array(MAX_PLY);
  private readonly uHalf = new Int32Array(MAX_PLY);
  private readonly uH1 = new Uint32Array(MAX_PLY);
  private readonly uH2 = new Int32Array(MAX_PLY);

  /** 指した手の数（make − unmake） */
  get ply(): number {
    return this.sp;
  }

  static fromFen(fen: string): Board {
    const b = new Board();
    const [placement, turn, , ep, half] = fen.trim().split(/\s+/);
    const ranks = (placement ?? "").split("/");
    if (ranks.length !== 8) throw new Error("FEN の段数が不正です");
    for (let r = 0; r < 8; r++) {
      let file = 0;
      for (const ch of ranks[r]) {
        if (/[1-8]/.test(ch)) {
          file += Number(ch);
          continue;
        }
        const t = PIECE_CHARS.indexOf(ch.toLowerCase());
        if (t <= 0 || file > 7) throw new Error("FEN の駒配置が不正です");
        const sq = (7 - r) * 16 + file;
        const piece = ch === ch.toLowerCase() ? -t : t;
        b.sq[sq] = piece;
        if (t === KING) b.king[piece > 0 ? 0 : 1] = sq;
        file++;
      }
      if (file !== 8) throw new Error("FEN の駒配置が不正です");
    }
    if (b.king[0] < 0 || b.king[1] < 0) throw new Error("キングがありません");
    b.side = turn === "b" ? -1 : 1;
    b.ep =
      ep && ep !== "-"
        ? (Number(ep[1]) - 1) * 16 + "abcdefgh".indexOf(ep[0])
        : -1;
    b.halfmove = Number(half) || 0;
    b.rehash();
    return b;
  }

  private rehash(): void {
    let h1 = 0;
    let h2 = 0;
    for (let s = 0; s < 128; s++) {
      if (!onBoard(s) || this.sq[s] === 0) continue;
      h1 ^= Z1[this.sq[s] + 6][s];
      h2 ^= Z2[this.sq[s] + 6][s];
    }
    if (this.side === -1) {
      h1 ^= Z_SIDE1;
      h2 ^= Z_SIDE2;
    }
    if (this.ep >= 0) {
      h1 ^= Z_EP1[fileOf(this.ep)];
      h2 ^= Z_EP2[fileOf(this.ep)];
    }
    this.h1 = h1 >>> 0;
    this.h2 = h2;
  }

  /** 局面キー（駒配置・手番・アンパッサン） */
  key(): number {
    return this.h1 * 0x200000 + this.h2;
  }

  kingSq(side: Side): number {
    return this.king[side === 1 ? 0 : 1];
  }

  /** sq が by 側の駒に利かされているか */
  isAttacked(sq: number, by: Side): boolean {
    const b = this.sq;
    // ポーン（白のポーンは +15 / +17 に利く）
    if (by === 1) {
      const a = sq - 15;
      const c = sq - 17;
      if (onBoard(a) && b[a] === PAWN) return true;
      if (onBoard(c) && b[c] === PAWN) return true;
    } else {
      const a = sq + 15;
      const c = sq + 17;
      if (onBoard(a) && b[a] === -PAWN) return true;
      if (onBoard(c) && b[c] === -PAWN) return true;
    }
    const n = KNIGHT * by;
    for (const o of KNIGHT_OFFSETS) {
      const t = sq + o;
      if (onBoard(t) && b[t] === n) return true;
    }
    const k = KING * by;
    for (const o of KING_OFFSETS) {
      const t = sq + o;
      if (onBoard(t) && b[t] === k) return true;
    }
    const bishop = BISHOP * by;
    const rook = ROOK * by;
    const queen = QUEEN * by;
    for (const d of BISHOP_DIRS) {
      let t = sq + d;
      while (onBoard(t)) {
        const p = b[t];
        if (p !== 0) {
          if (p === bishop || p === queen) return true;
          break;
        }
        t += d;
      }
    }
    for (const d of ROOK_DIRS) {
      let t = sq + d;
      while (onBoard(t)) {
        const p = b[t];
        if (p !== 0) {
          if (p === rook || p === queen) return true;
          break;
        }
        t += d;
      }
    }
    return false;
  }

  inCheck(side: Side = this.side): boolean {
    return this.isAttacked(this.kingSq(side), -side as Side);
  }

  /** 疑似合法手（自玉への王手放置を含む。キャスリングなし） */
  pseudoMoves(out: number[] = []): number[] {
    const b = this.sq;
    const side = this.side;
    for (let from = 0; from < 128; from++) {
      if (!onBoard(from)) {
        from += 7;
        continue;
      }
      const p = b[from] * side;
      if (p <= 0) continue;
      switch (p) {
        case PAWN:
          this.pawnMoves(from, out);
          break;
        case KNIGHT:
          this.stepMoves(from, KNIGHT_OFFSETS, out);
          break;
        case KING:
          this.stepMoves(from, KING_OFFSETS, out);
          break;
        case BISHOP:
          this.slideMoves(from, BISHOP_DIRS, out);
          break;
        case ROOK:
          this.slideMoves(from, ROOK_DIRS, out);
          break;
        case QUEEN:
          this.slideMoves(from, BISHOP_DIRS, out);
          this.slideMoves(from, ROOK_DIRS, out);
          break;
      }
    }
    return out;
  }

  private stepMoves(from: number, offsets: number[], out: number[]): void {
    for (const o of offsets) {
      const to = from + o;
      if (!onBoard(to)) continue;
      const t = this.sq[to] * this.side;
      if (t > 0) continue;
      out.push(encodeMove(from, to, 0, t < 0 ? FLAG_CAPTURE : 0));
    }
  }

  private slideMoves(from: number, dirs: number[], out: number[]): void {
    for (const d of dirs) {
      let to = from + d;
      while (onBoard(to)) {
        const t = this.sq[to] * this.side;
        if (t > 0) break;
        out.push(encodeMove(from, to, 0, t < 0 ? FLAG_CAPTURE : 0));
        if (t < 0) break;
        to += d;
      }
    }
  }

  private pawnMoves(from: number, out: number[]): void {
    const side = this.side;
    const fwd = 16 * side;
    const startRank = side === 1 ? 1 : 6;
    const lastRank = side === 1 ? 7 : 0;
    const push = (to: number, flags: number) => {
      if (rankOf(to) === lastRank) {
        for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT])
          out.push(encodeMove(from, to, promo, flags));
      } else {
        out.push(encodeMove(from, to, 0, flags));
      }
    };
    const one = from + fwd;
    if (onBoard(one) && this.sq[one] === 0) {
      push(one, 0);
      const two = one + fwd;
      if (rankOf(from) === startRank && this.sq[two] === 0)
        out.push(encodeMove(from, two, 0, FLAG_DOUBLE));
    }
    for (const d of [fwd - 1, fwd + 1]) {
      const to = from + d;
      if (!onBoard(to)) continue;
      if (this.sq[to] * side < 0) push(to, FLAG_CAPTURE);
      else if (to === this.ep)
        out.push(encodeMove(from, to, 0, FLAG_CAPTURE | FLAG_EP));
    }
  }

  private place(sq: number, piece: number): void {
    const old = this.sq[sq];
    if (old !== 0) {
      this.h1 ^= Z1[old + 6][sq];
      this.h2 ^= Z2[old + 6][sq];
    }
    this.sq[sq] = piece;
    if (piece !== 0) {
      this.h1 ^= Z1[piece + 6][sq];
      this.h2 ^= Z2[piece + 6][sq];
    }
  }

  make(m: number): void {
    const from = moveFrom(m);
    const to = moveTo(m);
    const promo = movePromo(m);
    const flags = moveFlags(m);
    const side = this.side;
    const piece = this.sq[from];
    let captured = this.sq[to];
    const i = this.sp++;
    if (i >= MAX_PLY) throw new Error("make: 手順が長すぎます");
    this.uMove[i] = m;
    this.uCaptured[i] = captured;
    this.uEp[i] = this.ep;
    this.uHalf[i] = this.halfmove;
    this.uH1[i] = this.h1;
    this.uH2[i] = this.h2;
    if (flags & FLAG_EP) {
      const victim = to - 16 * side;
      captured = this.sq[victim];
      this.place(victim, 0);
    }
    this.place(from, 0);
    this.place(to, promo ? promo * side : piece);
    if (piece * side === KING) this.king[side === 1 ? 0 : 1] = to;
    if (this.ep >= 0) {
      this.h1 ^= Z_EP1[fileOf(this.ep)];
      this.h2 ^= Z_EP2[fileOf(this.ep)];
    }
    this.ep = flags & FLAG_DOUBLE ? from + 16 * side : -1;
    if (this.ep >= 0) {
      this.h1 ^= Z_EP1[fileOf(this.ep)];
      this.h2 ^= Z_EP2[fileOf(this.ep)];
    }
    this.halfmove =
      piece * side === PAWN || captured !== 0 ? 0 : this.halfmove + 1;
    this.side = -side as Side;
    this.h1 = (this.h1 ^ Z_SIDE1) >>> 0;
    this.h2 ^= Z_SIDE2;
  }

  unmake(): void {
    if (this.sp === 0) throw new Error("unmake: 手がありません");
    const i = --this.sp;
    const m = this.uMove[i];
    const from = moveFrom(m);
    const to = moveTo(m);
    const flags = moveFlags(m);
    this.side = -this.side as Side;
    const side = this.side;
    const moved = movePromo(m) ? PAWN * side : this.sq[to];
    this.sq[from] = moved;
    this.sq[to] = flags & FLAG_EP ? 0 : this.uCaptured[i];
    if (flags & FLAG_EP) this.sq[to - 16 * side] = -PAWN * side;
    if (moved * side === KING) this.king[side === 1 ? 0 : 1] = from;
    this.ep = this.uEp[i];
    this.halfmove = this.uHalf[i];
    this.h1 = this.uH1[i];
    this.h2 = this.uH2[i];
  }

  /** 合法手（キャスリングなし） */
  legalMoves(out: number[] = []): number[] {
    const pseudo = this.pseudoMoves();
    const side = this.side;
    for (const m of pseudo) {
      this.make(m);
      if (!this.inCheck(side)) out.push(m);
      this.unmake();
    }
    return out;
  }

  /** 合法手が1つでもあるか（全生成より速い） */
  hasLegalMove(): boolean {
    const side = this.side;
    for (const m of this.pseudoMoves()) {
      this.make(m);
      const ok = !this.inCheck(side);
      this.unmake();
      if (ok) return true;
    }
    return false;
  }

  /** 手番側がチェックメイトされているか */
  isCheckmate(): boolean {
    return this.inCheck() && !this.hasLegalMove();
  }

  /** 盤上の駒を列挙する（探索の評価用） */
  forEachPiece(fn: (sq: number, piece: number) => void): void {
    for (let s = 0; s < 128; s++) {
      if (!onBoard(s)) {
        s += 7;
        continue;
      }
      if (this.sq[s] !== 0) fn(s, this.sq[s]);
    }
  }
}
