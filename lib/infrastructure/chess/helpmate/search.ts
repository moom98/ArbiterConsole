/**
 * ヘルプメイト探索（FIDE 6.9 / 7.5.5 / A.5.3 の「あらゆる合法手の連続によるメイト」の証拠探し）。
 *
 * 両者が協力する手順を探すので、一人で解くパズル（経路探索）として扱える。
 * 1. 短い手順の全幅探索（反復深化）
 * 2. 誘導戦略: 攻撃側にメイトに足りる駒がなくポーンがあれば、まず昇格させ、その局面から探す
 * 3. ヒューリスティックによる最良優先探索を、重みの異なる複数の設定で順に試す
 *    （守備側キングを端・隅へ、攻撃側の駒をキングへ近づけ、逃げ道を塞ぐ）
 *
 * 展開数・局面数・時刻の上限で必ず止まる。見つからなくても「メイト不可能」の証明にはならない
 * （呼び出し側は unknown として扱う）。結果の手順は UCI 形式で、呼び出し側が chess.js で
 * SAN に変換・検証する（ADR-015）。
 */

import {
  BISHOP,
  Board,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  FLAG_CAPTURE,
  fileOf,
  moveFlags,
  moveToUci,
  onBoard,
  rankOf,
  type Side,
} from "./board";

export interface HeuristicWeights {
  /** 守備側キングの逃げ道1つあたり */
  flight: number;
  /** チェックしていない */
  noCheck: number;
  /** 守備側キングの端からの距離 */
  edge: number;
  /** 攻撃側キングと守備側キングの距離 */
  kingDist: number;
  /** 攻撃側の駒と守備側キングの平均距離 */
  avgDist: number;
  /** 攻撃側の駒と守備側キングの最小距離 */
  minDist: number;
  /** 守備側キングの近く（2マス以内）にある攻撃側の駒（最大3） */
  near: number;
  /** メイトに足りる駒がないときの、昇格までの距離 */
  promo: number;
  /** 単独のビショップ／ナイトでメイトするときの、適した隅までの距離 */
  corner: number;
  /** 攻撃側が失った駒の価値 */
  lost: number;
  /** 攻撃側が増やした駒の価値（昇格） */
  gained: number;
  /** 手数（大きいほど短い手順を優先） */
  depth: number;
}

const BASE_WEIGHTS: HeuristicWeights = {
  flight: 3,
  noCheck: 1.5,
  edge: 1.2,
  kingDist: 0.6,
  avgDist: 0.5,
  minDist: 0,
  near: 0,
  promo: 2.5,
  corner: 1.5,
  lost: 1.5,
  gained: 0.5,
  depth: 0.5,
};

/** 順に試す重みの設定と、展開数の配分 */
export const WEIGHT_PORTFOLIO: { weights: HeuristicWeights; share: number }[] =
  [
    {
      weights: { ...BASE_WEIGHTS, noCheck: 3, near: 1, minDist: 1 },
      share: 0.4,
    },
    {
      weights: { ...BASE_WEIGHTS, depth: 0.25, near: 1, minDist: 0.8 },
      share: 0.3,
    },
    { weights: { ...BASE_WEIGHTS, near: 1.5, minDist: 1 }, share: 0.3 },
  ];

export const DEFAULT_WEIGHTS = WEIGHT_PORTFOLIO[0].weights;

export interface HelpmateLimits {
  /** 最良優先探索で展開する局面数の上限（全段階の合計） */
  maxExpansions: number;
  /** 1段階で生成して保持する局面数の上限（メモリ） */
  maxNodes: number;
  /** 全幅探索の最大半手数 */
  shallowPlies: number;
  /** 全幅探索の局面数の上限 */
  shallowNodes: number;
  /** 打ち切り時刻（now() の値）。省略時は時刻で止めない */
  deadline?: number;
  now?: () => number;
  /** 試す重みの設定（省略時は WEIGHT_PORTFOLIO） */
  portfolio?: { weights: HeuristicWeights; share: number }[];
}

export const DEFAULT_HELPMATE_LIMITS: HelpmateLimits = {
  maxExpansions: 20_000,
  maxNodes: 300_000,
  shallowPlies: 3,
  shallowNodes: 20_000,
};

export type HelpmateSearchResult =
  | {
      status: "found";
      /** 開始局面からの手順（UCI）。空なら開始局面がすでにメイト */
      uci: string[];
      expansions: number;
    }
  | {
      status: "not-found";
      reason: "limit" | "deadline" | "invalid-position";
      expansions: number;
      error?: string;
    };

const VALUE = [0, 1, 3, 3, 5, 9, 0];
const KING_OFFSETS = [1, -1, 16, -16, 17, 15, -15, -17];
const CORNERS = [0x00, 0x07, 0x70, 0x77];

function cheb(a: number, b: number): number {
  return Math.max(
    Math.abs(fileOf(a) - fileOf(b)),
    Math.abs(rankOf(a) - rankOf(b))
  );
}

const isLight = (sq: number) => (fileOf(sq) + rankOf(sq)) % 2 === 1;

interface Force {
  material: number;
  heavy: number;
  knights: number;
  lightB: number;
  darkB: number;
  pawns: number;
}

function forceOf(b: Board, side: Side): Force {
  const f: Force = {
    material: 0,
    heavy: 0,
    knights: 0,
    lightB: 0,
    darkB: 0,
    pawns: 0,
  };
  b.forEachPiece((sq, p) => {
    const t = p * side;
    if (t <= 0 || t === KING) return;
    f.material += VALUE[t];
    if (t === PAWN) f.pawns++;
    else if (t === QUEEN || t === ROOK) f.heavy++;
    else if (t === KNIGHT) f.knights++;
    else if (isLight(sq)) f.lightB++;
    else f.darkB++;
  });
  return f;
}

/** 守備側の協力なしでもメイトに足りる駒（Q/R、N×2、N+B、異色ビショップ） */
function hasMatingForce(f: Force): boolean {
  const minors = f.knights + f.lightB + f.darkB;
  return (
    f.heavy > 0 ||
    f.knights >= 2 ||
    (f.knights >= 1 && minors >= 2) ||
    (f.lightB > 0 && f.darkB > 0)
  );
}

/** ポーンの昇格までの距離（前方の駒は1つにつき2手として数える） */
function promoDistance(b: Board, attacker: Side): number {
  let best = 99;
  b.forEachPiece((sq, p) => {
    if (p !== PAWN * attacker) return;
    const rank = rankOf(sq);
    let d = attacker === 1 ? 7 - rank : rank;
    for (let s = sq + 16 * attacker; onBoard(s); s += 16 * attacker)
      if (b.sq[s] !== 0) d += 2;
    if (d < best) best = d;
  });
  return best;
}

/**
 * 局面の評価（小さいほどメイトに近い）。
 */
function heuristic(
  b: Board,
  attacker: Side,
  rootMaterial: number,
  w: HeuristicWeights
): number {
  const defender = -attacker as Side;
  const kd = b.kingSq(defender);
  const ka = b.kingSq(attacker);

  // 守備側キングの逃げ道（自分の駒で塞がれたマスは逃げ道にならない）
  let flight = 0;
  for (const o of KING_OFFSETS) {
    const s = kd + o;
    if (!onBoard(s)) continue;
    if (b.sq[s] * defender > 0) continue;
    if (!b.isAttacked(s, attacker)) flight++;
  }
  const check = b.isAttacked(kd, attacker);

  // 攻撃側の駒を1回の走査で数える
  const force: Force = {
    material: 0,
    heavy: 0,
    knights: 0,
    lightB: 0,
    darkB: 0,
    pawns: 0,
  };
  let pieceDist = 0;
  let minDist = 8;
  let near = 0;
  let pieces = 0;
  const board = b.sq;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 8) {
      sq += 7;
      continue;
    }
    const t = board[sq] * attacker;
    if (t <= 0 || t === KING) continue;
    force.material += VALUE[t];
    if (t === PAWN) {
      force.pawns++;
      continue;
    }
    if (t === QUEEN || t === ROOK) force.heavy++;
    else if (t === KNIGHT) force.knights++;
    else if (isLight(sq)) force.lightB++;
    else force.darkB++;
    pieces++;
    const d = cheb(sq, kd);
    pieceDist += d > 1 ? d - 1 : 0;
    if (d < minDist) minDist = d;
    if (d <= 2) near++;
  }

  const edge = Math.min(fileOf(kd), 7 - fileOf(kd), rankOf(kd), 7 - rankOf(kd));

  let h = w.flight * flight + (check ? 0 : w.noCheck) + w.edge * edge;
  h += w.kingDist * Math.max(0, cheb(ka, kd) - 2);
  if (pieces > 0) {
    h += (w.avgDist * pieceDist) / pieces;
    h += w.minDist * Math.max(0, minDist - 1);
    h -= w.near * Math.min(near, 3);
  }
  if (!hasMatingForce(force)) {
    if (force.pawns > 0) h += w.promo * promoDistance(b, attacker);
    // 単独の小駒: 守備側キングを、その駒でチェックできる隅へ（自分の駒で塞がせる）
    if (force.heavy === 0 && pieces > 0) {
      const bishopsOnly = force.knights === 0;
      let best = 8;
      for (const c of CORNERS) {
        if (bishopsOnly && isLight(c) !== force.lightB > 0) continue;
        best = Math.min(best, cheb(kd, c));
      }
      h += w.corner * best;
      if (bishopsOnly && isLight(kd) !== force.lightB > 0) h += w.corner;
    }
  }
  const lost = rootMaterial - force.material;
  h += lost > 0 ? w.lost * lost : w.gained * lost;
  return h;
}

/** 昇格の誘導戦略の評価: 昇格までの距離と、失った駒 */
function promoHeuristic(
  b: Board,
  attacker: Side,
  rootMaterial: number
): number {
  const lost = rootMaterial - forceOf(b, attacker).material;
  return 2 * promoDistance(b, attacker) + (lost > 0 ? 1.5 * lost : 0);
}

/** 二分ヒープ（f の小さい順） */
class OpenList {
  private idx: number[] = [];
  private f: number[] = [];
  get size(): number {
    return this.idx.length;
  }
  push(node: number, f: number): void {
    const a = this.idx;
    const k = this.f;
    a.push(node);
    k.push(f);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.idx;
    const k = this.f;
    const top = a[0];
    const lastI = a.pop()!;
    const lastF = k.pop()!;
    if (a.length > 0) {
      a[0] = lastI;
      k[0] = lastF;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}

/** 攻撃側の手のあと: 守備側がチェックされていて合法手がない */
function attackerMated(b: Board, attacker: Side): boolean {
  return b.side === -attacker && b.inCheck() && !b.hasLegalMove();
}

interface Budget {
  expansions: number;
  deadline?: number;
  now: () => number;
  timedOut: boolean;
}

/** 短い手順の全幅探索（反復深化）。見つかれば手の列 */
function shallowSearch(
  b: Board,
  attacker: Side,
  maxPlies: number,
  maxNodes: number
): number[] | null {
  const path: number[] = [];
  let nodes = 0;
  const dfs = (depth: number): boolean => {
    for (const m of b.legalMoves()) {
      if (nodes++ >= maxNodes) return false;
      b.make(m);
      path.push(m);
      if (attackerMated(b, attacker)) return true;
      if (depth > 1 && dfs(depth - 1)) return true;
      path.pop();
      b.unmake();
    }
    return false;
  };
  for (let d = 1; d <= maxPlies && nodes < maxNodes; d++) {
    // 最後の手は攻撃側の手
    if ((d % 2 === 1) !== (b.side === attacker)) continue;
    if (dfs(d)) {
      const found = [...path];
      for (let i = 0; i < found.length; i++) b.unmake();
      return found;
    }
  }
  return null;
}

/**
 * 最良優先探索。goal を満たす局面に到達する手順（開始局面からの手の列）を返す。
 * 盤面は呼び出し前の状態に戻す。
 */
function bestFirst(
  b: Board,
  attacker: Side,
  goal: (b: Board) => boolean,
  evaluate: (b: Board) => number,
  depthWeight: number,
  maxExpansions: number,
  maxNodes: number,
  budget: Budget
): number[] | null {
  const parent = new Int32Array(maxNodes);
  const move = new Int32Array(maxNodes);
  const depth = new Uint16Array(maxNodes);
  parent[0] = -1;
  let nodes = 1;
  const seen = new Set<number>([b.key()]);
  const open = new OpenList();
  open.push(0, 0);
  let expansions = 0;
  const path: number[] = [];

  while (open.size > 0 && expansions < maxExpansions) {
    if (budget.expansions <= 0) return null;
    if (
      budget.deadline !== undefined &&
      (expansions & 31) === 0 &&
      budget.now() > budget.deadline
    ) {
      budget.timedOut = true;
      return null;
    }
    const node = open.pop();
    expansions++;
    budget.expansions--;
    path.length = 0;
    for (let n = node; n > 0; n = parent[n]) path.push(move[n]);
    path.reverse();
    for (const m of path) b.make(m);
    const g = depth[node] + 1;
    let found: number[] | null = null;
    for (const m of b.legalMoves()) {
      b.make(m);
      const key = b.key();
      if (!seen.has(key)) {
        seen.add(key);
        if (goal(b)) {
          found = [...path, m];
          b.unmake();
          break;
        }
        if (nodes < maxNodes) {
          parent[nodes] = node;
          move[nodes] = m;
          depth[nodes] = g;
          // 守備側が攻撃側の駒を取る手は少し後回し
          const penalty =
            moveFlags(m) & FLAG_CAPTURE && b.side === attacker ? 0.25 : 0;
          open.push(nodes, g * depthWeight + evaluate(b) + penalty);
          nodes++;
        }
      }
      b.unmake();
    }
    for (let i = 0; i < path.length; i++) b.unmake();
    if (found) return found;
  }
  return null;
}

/**
 * fen の局面から、attacker が守備側のキングをメイトする手順を探す。
 */
export function findHelpmate(
  fen: string,
  attacker: "white" | "black",
  limits: HelpmateLimits = DEFAULT_HELPMATE_LIMITS
): HelpmateSearchResult {
  let b: Board;
  try {
    b = Board.fromFen(fen);
  } catch (e) {
    return {
      status: "not-found",
      reason: "invalid-position",
      expansions: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const A: Side = attacker === "white" ? 1 : -1;
  const budget: Budget = {
    expansions: limits.maxExpansions,
    deadline: limits.deadline,
    now: limits.now ?? (() => Date.now()),
    timedOut: false,
  };
  const used = () => limits.maxExpansions - budget.expansions;
  const found = (moves: number[]): HelpmateSearchResult => ({
    status: "found",
    uci: moves.map(moveToUci),
    expansions: used(),
  });

  if (b.side === -A && b.isCheckmate()) return found([]);

  // 1. 短い手順の全幅探索
  const shallow = shallowSearch(b, A, limits.shallowPlies, limits.shallowNodes);
  if (shallow) return found(shallow);

  const mate = (x: Board) => attackerMated(x, A);
  const portfolio = limits.portfolio ?? WEIGHT_PORTFOLIO;

  // 2. 誘導戦略: 昇格してから探す
  const rootForce = forceOf(b, A);
  if (!hasMatingForce(rootForce) && rootForce.pawns > 0) {
    const share = Math.floor(limits.maxExpansions * 0.3);
    const queens = (x: Board) => forceOf(x, A).heavy > rootForce.heavy;
    const promoted = bestFirst(
      b,
      A,
      (x) => mate(x) || (x.side === -A && queens(x) && x.hasLegalMove()),
      (x) => promoHeuristic(x, A, rootForce.material),
      0.25,
      share / 2,
      limits.maxNodes,
      budget
    );
    if (promoted) {
      for (const m of promoted) b.make(m);
      const rest = mate(b)
        ? []
        : bestFirst(
            b,
            A,
            mate,
            (x) =>
              heuristic(x, A, forceOf(x, A).material, portfolio[0].weights),
            portfolio[0].weights.depth,
            share / 2,
            limits.maxNodes,
            budget
          );
      for (let i = 0; i < promoted.length; i++) b.unmake();
      if (rest) return found([...promoted, ...rest]);
    }
  }

  // 3. 重みの異なる最良優先探索を順に
  const remaining = budget.expansions;
  for (const { weights, share } of portfolio) {
    if (budget.timedOut || budget.expansions <= 0) break;
    const line = bestFirst(
      b,
      A,
      mate,
      (x) => heuristic(x, A, rootForce.material, weights),
      weights.depth,
      Math.ceil(remaining * share),
      limits.maxNodes,
      budget
    );
    if (line) return found(line);
  }
  return {
    status: "not-found",
    reason: budget.timedOut ? "deadline" : "limit",
    expansions: used(),
  };
}
