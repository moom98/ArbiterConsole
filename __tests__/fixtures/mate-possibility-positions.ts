/**
 * メイト可能性（ADR-014 §5）の受け入れ用フィクスチャ。
 *
 * - OPENING_LINES: 実戦の定跡手順（SAN）。テストで chess.js（strict）により再生して局面を作るので、
 *   局面の合法性は再生で保証される。さらに決定的なプレイアウトで中盤・終盤の局面を作る。
 * - ENDGAMES: フラッグが落ちやすい終盤の局面（手作り）。
 *
 * すべて「攻撃側がメイト可能」な局面（attacker 側の駒で、協力手順によりメイトできる）。
 */

import { Chess } from "chess.js";

export interface OpeningLine {
  name: string;
  moves: string[];
}

export const OPENING_LINES: OpeningLine[] = [
  {
    name: "Ruy Lopez Closed",
    moves:
      "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 Nbd2 Bb7 Bc2 Re8 Nf1 Bf8 Ng3 g6".split(
        " "
      ),
  },
  {
    name: "Sicilian Najdorf English Attack",
    moves:
      "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7 g4 b5 g5 b4 Ne2 Ne8 f4 a5".split(
        " "
      ),
  },
  {
    name: "Queen's Gambit Declined Tartakower",
    moves:
      "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 Nxd5 Bxe7 Qxe7 Nxd5 exd5 Rc1 Be6 Qa4 c5 Qa3 Rc8 Bb5 a6".split(
        " "
      ),
  },
  {
    name: "King's Indian Mar del Plata",
    moves:
      "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 Ne1 Nd7 Nd3 f5 Bd2 Nf6 f3 f4 c5 g5".split(
        " "
      ),
  },
  {
    name: "French Winawer Poisoned Pawn",
    moves:
      "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 Qc7 Qxg7 Rg8 Qxh7 cxd4 Ne2 Nbc6 f4 dxc3".split(
        " "
      ),
  },
  {
    name: "Caro-Kann Classical",
    moves:
      "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6 Bd2 Ngf6 O-O-O Be7 Kb1 O-O".split(
        " "
      ),
  },
  {
    name: "Italian Giuoco Pianissimo",
    moves:
      "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6 a4 Ba7 h3 h6 Nbd2 Re8 Nf1 Be6 Bxe6 Rxe6".split(
        " "
      ),
  },
  {
    name: "London System",
    moves:
      "d4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6 Nbd2 Bd6 Bg3 O-O Bd3 b6 Ne5 Bb7 f4 Ne7 Qf3 Nf5 Bxf5 exf5".split(
        " "
      ),
  },
  {
    name: "Scandinavian",
    moves:
      "e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2 e6 Qe2 Bb4 O-O-O Nbd7 a3 Bxc3 Bxc3 Qc7".split(
        " "
      ),
  },
  {
    name: "English Reversed Sicilian",
    moves:
      "c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7 d3 O-O Be3 Be6 Rc1 f6".split(
        " "
      ),
  },
];

export interface EndgameFixture {
  name: string;
  fen: string;
  /** メイトする側（フラッグが落ちていない側） */
  attacker: "white" | "black";
}

export const ENDGAMES: EndgameFixture[] = [
  { name: "KQ v K", fen: "8/8/8/4k3/8/8/8/3QK3 b - - 0 60", attacker: "white" },
  { name: "KR v K", fen: "8/8/3k4/8/8/4K3/8/7R b - - 0 70", attacker: "white" },
  {
    name: "KP v K",
    fen: "8/8/8/3k4/8/8/4P3/4K3 b - - 0 50",
    attacker: "white",
  },
  {
    name: "KRP v KR",
    fen: "8/8/4k3/8/3P4/8/2r5/3RK3 b - - 0 55",
    attacker: "white",
  },
  {
    name: "KR v KR",
    fen: "8/8/2k5/8/8/5K2/r7/7R b - - 0 80",
    attacker: "white",
  },
  {
    name: "KQ v KR",
    fen: "8/8/3k4/3r4/8/8/5Q2/6K1 b - - 0 70",
    attacker: "white",
  },
  {
    name: "KBN v K",
    fen: "8/8/8/4k3/8/8/8/2BNK3 b - - 0 90",
    attacker: "white",
  },
  {
    name: "KNN v K",
    fen: "8/8/8/4k3/8/8/8/3NKN2 b - - 0 90",
    attacker: "white",
  },
  {
    name: "KN v KP (helpmate)",
    fen: "8/8/8/8/3k4/8/p7/4K1N1 b - - 0 70",
    attacker: "white",
  },
  {
    name: "KB v KP (helpmate)",
    fen: "8/7p/4k3/8/8/3K4/8/2B5 b - - 0 70",
    attacker: "white",
  },
  {
    name: "KB v KB opposite colours",
    fen: "8/8/3k4/8/3b4/7K/4B3/8 b - - 0 70",
    attacker: "white",
  },
  {
    name: "KN v KN",
    fen: "8/8/3kn3/8/8/3NK3/8/8 b - - 0 70",
    attacker: "white",
  },
  {
    name: "Rook ending with pawns",
    fen: "8/5pk1/6p1/7p/7P/6P1/r4PK1/3R4 b - - 0 45",
    attacker: "white",
  },
  {
    name: "Queen ending with pawns",
    fen: "6k1/5pp1/7p/8/8/6P1/q4PKP/3Q4 b - - 0 50",
    attacker: "white",
  },
  {
    name: "Knight v bishop, locked pawns",
    fen: "8/5pk1/4p1p1/3pP2p/3P1P1P/2N3P1/3b2K1/8 b - - 0 40",
    attacker: "white",
  },
  {
    name: "Opposite bishops with pawns",
    fen: "8/5k2/4p3/3pP3/1p1P4/1P1K4/5B2/7b b - - 0 50",
    attacker: "white",
  },
  {
    name: "KQ v KQ",
    fen: "8/8/3k4/2q5/8/8/5Q2/6K1 b - - 0 60",
    attacker: "white",
  },
  {
    name: "Black KQ v K (white flag)",
    fen: "8/8/8/2k5/8/8/1q6/4K3 w - - 0 60",
    attacker: "black",
  },
  {
    name: "KRB v KR",
    fen: "8/8/3k4/8/2r5/5B2/8/R3K3 b - - 0 70",
    attacker: "white",
  },
  {
    name: "KP v KP",
    fen: "8/p7/8/8/8/8/6Pk/4K3 b - - 0 50",
    attacker: "white",
  },
  {
    name: "Black rook ending (white flag)",
    fen: "8/5pk1/6p1/8/5P2/6P1/r5K1/8 w - - 0 48",
    attacker: "black",
  },
  {
    name: "Black KB v KP (white flag)",
    fen: "8/8/8/3k4/8/1b6/P7/K7 w - - 0 70",
    attacker: "black",
  },
];

export interface MateFixture {
  name: string;
  fen: string;
  attacker: "white" | "black";
}

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * 受け入れ用の局面一式（決定的）。
 * - 各定跡の最終局面
 * - 定跡から、駒取りを優先する決定的なプレイアウトで進めた局面
 *   （シード i+1 の +16/+40 半手: 探索の調整に使った組、シード i+101 の +24/+32 半手: 調整に使っていない組）
 * - 手作りの終盤
 * 手番の側をフラッグが落ちた（メイトされる）側とする。
 */
export function mateFixtures(): MateFixture[] {
  const out: MateFixture[] = [];
  const attackerOf = (c: Chess) => (c.turn() === "w" ? "black" : "white");
  OPENING_LINES.forEach((line, i) => {
    const start = new Chess();
    for (const m of line.moves) start.move(m, { strict: true });
    out.push({
      name: line.name,
      fen: start.fen(),
      attacker: attackerOf(start),
    });
    for (const [seed, plies] of [
      [i + 1, [16, 40]],
      [i + 101, [24, 32]],
    ] as const) {
      const c = new Chess(start.fen());
      const r = lcg(seed);
      for (let ply = 1; ply <= Math.max(...plies); ply++) {
        const ms = c.moves({ verbose: true });
        const caps = ms.filter((m) => m.captured);
        const pool = caps.length > 0 && r() < 0.6 ? caps : ms;
        c.move(pool[Math.floor(r() * pool.length)]);
        if (c.isGameOver()) break;
        if ((plies as readonly number[]).includes(ply))
          out.push({
            name: `${line.name} (seed ${seed}) +${ply}`,
            fen: c.fen(),
            attacker: attackerOf(c),
          });
      }
    }
  });
  return [...out, ...ENDGAMES];
}
