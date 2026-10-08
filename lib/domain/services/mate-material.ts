import type {
  BoardMaterial,
  PlayerColor,
  SideMaterial,
} from "@/lib/domain/entities";

/**
 * 駒の構成だけで確定できる「メイト不可能」の判定（純粋関数。ADR-014 §5）。
 *
 * 判定対象: 「attacker が、あらゆる合法手の連続（相手の協力を含む）によって
 * defender のキングをチェックメイトできるか」（6.9 / 7.5.5 / A.5.3 の文言）。
 *
 * 確定するのは、どのような合法手の連続でもメイトが不可能なことが証明できる場合だけ:
 * - attacker がキングのみ
 * - attacker が K+N のみ、または K+同色ビショップ（複数可）のみ で、defender がキングのみ
 * - 盤上の駒が両キングと同色ビショップのみ
 *
 * 「メイト可能」は駒数からは決して確定しない（局面から実際の手順を見つけた場合だけ。
 * mate-possibility.ts）。一般的な insufficientMaterial 判定も使わない。
 */

export const EMPTY_SIDE: SideMaterial = {
  queens: 0,
  rooks: 0,
  knights: 0,
  lightBishops: 0,
  darkBishops: 0,
  pawns: 0,
};

function bishops(s: SideMaterial): number {
  return s.lightBishops + s.darkBishops;
}

function isBareKing(s: SideMaterial): boolean {
  return s.queens + s.rooks + s.knights + bishops(s) + s.pawns === 0;
}

/** 盤上のビショップがすべて同じ色のマスか（ビショップ以外の駒なし） */
function onlySameColourBishops(a: SideMaterial, b: SideMaterial): boolean {
  const others =
    a.queens +
    a.rooks +
    a.knights +
    a.pawns +
    b.queens +
    b.rooks +
    b.knights +
    b.pawns;
  if (others > 0) return false;
  const light = a.lightBishops + b.lightBishops;
  const dark = a.darkBishops + b.darkBishops;
  return light === 0 || dark === 0;
}

/**
 * attacker が駒の構成上メイト不可能なら、その理由（表示用）。それ以外は undefined
 * （メイト可能とは限らない。局面で判定する）。
 */
export function materialCannotMate(
  material: BoardMaterial,
  attacker: PlayerColor
): string | undefined {
  const a = material[attacker];
  const d = material[attacker === "white" ? "black" : "white"];
  if (isBareKing(a)) return "キングのみではチェックメイトできません";
  if (onlySameColourBishops(a, d))
    return "盤上の駒がキングと同じ色のマスのビショップのみのため、チェックメイトできません";
  const lone =
    a.queens + a.rooks + a.pawns === 0 &&
    ((a.knights === 1 && bishops(a) === 0) ||
      (a.knights === 0 && (a.lightBishops === 0 || a.darkBishops === 0)));
  if (lone && isBareKing(d))
    return a.knights === 1
      ? "キングとナイト1個のみでは、キングのみの相手をメイトできません"
      : "キングと同色ビショップのみでは、キングのみの相手をメイトできません";
  return undefined;
}

/** FEN の駒配置から駒数を求める（純粋関数・最低限の検証） */
export function materialFromFen(
  fen: string
): { ok: true; material: BoardMaterial } | { ok: false; error: string } {
  const placement = fen.trim().split(/\s+/)[0] ?? "";
  const ranks = placement.split("/");
  if (ranks.length !== 8)
    return { ok: false, error: "FEN の段数が8ではありません" };
  const white: SideMaterial = { ...EMPTY_SIDE };
  const black: SideMaterial = { ...EMPTY_SIDE };
  const kings: Record<PlayerColor, number> = { white: 0, black: 0 };
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const ch of ranks[r]) {
      if (/[1-8]/.test(ch)) {
        file += Number(ch);
        continue;
      }
      if (!/[pnbrqkPNBRQK]/.test(ch))
        return { ok: false, error: `FEN に不正な文字があります: ${ch}` };
      if (file >= 8)
        return { ok: false, error: `FEN の第${8 - r}段のマス数が不正です` };
      const side = ch === ch.toUpperCase() ? white : black;
      const color: PlayerColor = side === white ? "white" : "black";
      // FEN は8段目から。a1 は黒マス（file + rank が奇数 → 白マス）
      const rank = 7 - r;
      const light = (file + rank) % 2 === 1;
      switch (ch.toLowerCase()) {
        case "p":
          side.pawns++;
          break;
        case "n":
          side.knights++;
          break;
        case "b":
          if (light) side.lightBishops++;
          else side.darkBishops++;
          break;
        case "r":
          side.rooks++;
          break;
        case "q":
          side.queens++;
          break;
        case "k":
          kings[color]++;
          break;
      }
      file++;
    }
    if (file !== 8)
      return { ok: false, error: `FEN の第${8 - r}段のマス数が不正です` };
  }
  if (kings.white !== 1 || kings.black !== 1)
    return { ok: false, error: "FEN のキングの数が不正です" };
  return { ok: true, material: { white, black } };
}
