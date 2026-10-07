import type {
  BoardMaterial,
  PlayerColor,
  SideMaterial,
} from "@/lib/domain/entities";

/**
 * メイト可能性の駒数チェック（純粋関数）。
 *
 * 判定対象: 「attacker が、あらゆる合法手の連続（相手の協力を含む）によって
 * defender のキングをチェックメイトできるか」（6.9 / 7.5.5 / A.5.3 の文言）。
 *
 * 駒数だけで確定できる場合のみ確定する（ADR-005）:
 * - cannot-mate（確定）
 *   - attacker がキングのみ
 *   - attacker が K+N のみ、または K+同色ビショップ（複数可）のみ で、defender がキングのみ
 *   - 盤上の駒が両キングと同色ビショップのみ（デッドポジション）
 * - can-mate
 *   - attacker にクイーン・ルーク・ポーンがある
 *   - attacker の小駒が N×2 以上 / B+N / 異色ビショップ
 *   ただし盤上にポーンがある場合は閉塞局面の可能性があるため positionDependent = true
 * - unknown: それ以外（例: K+N vs K+N、K+B vs K+P などヘルプメイトが局面に依存するもの）
 */
export type MateVerdict = "can-mate" | "cannot-mate" | "unknown";

export interface MateAssessment {
  verdict: MateVerdict;
  /** 表示用の理由 */
  reason: string;
  /**
   * can-mate でも、盤上にポーンがあり閉塞局面の可能性を駒数だけでは否定できない
   */
  positionDependent: boolean;
}

export const EMPTY_SIDE: SideMaterial = {
  queens: 0,
  rooks: 0,
  knights: 0,
  lightBishops: 0,
  darkBishops: 0,
  pawns: 0,
};

const MAX_PIECES = 15;

/** 駒数の妥当性（空配列なら有効） */
export function validateSideMaterial(
  side: Partial<SideMaterial> | undefined,
  label: string
): string[] {
  const errors: string[] = [];
  if (!side) return [`${label}の駒数がありません`];
  const keys = Object.keys(EMPTY_SIDE) as (keyof SideMaterial)[];
  for (const k of keys) {
    const v = side[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
      errors.push(`${label}の${k}が不正です`);
  }
  if (errors.length > 0) return errors;
  const s = side as SideMaterial;
  if (s.pawns > 8) errors.push(`${label}のポーンが8個を超えています`);
  const total =
    s.queens + s.rooks + s.knights + s.lightBishops + s.darkBishops + s.pawns;
  if (total > MAX_PIECES)
    errors.push(`${label}のキング以外の駒が15個を超えています`);
  // 初期配置を超える駒は昇格によるもの（昇格したポーンの数 ≤ 8 - 残りポーン）
  const promoted =
    Math.max(0, s.queens - 1) +
    Math.max(0, s.rooks - 2) +
    Math.max(0, s.knights - 2) +
    Math.max(0, s.lightBishops - 1) +
    Math.max(0, s.darkBishops - 1);
  if (promoted > 8 - s.pawns)
    errors.push(`${label}の駒数は昇格を考慮しても成立しません`);
  return errors;
}

function bishops(s: SideMaterial): number {
  return s.lightBishops + s.darkBishops;
}

function minorOnlyCount(s: SideMaterial): number {
  return s.knights + bishops(s);
}

function isBareKing(s: SideMaterial): boolean {
  return minorOnlyCount(s) + s.queens + s.rooks + s.pawns === 0;
}

/** 盤上のビショップがすべて同じ色のマスか（ビショップ以外の駒なし） */
function onlySameColourBishops(a: SideMaterial, b: SideMaterial): boolean {
  const noOthers =
    a.queens +
      a.rooks +
      a.knights +
      a.pawns +
      b.queens +
      b.rooks +
      b.knights +
      b.pawns ===
    0;
  if (!noOthers) return false;
  const light = a.lightBishops + b.lightBishops;
  const dark = a.darkBishops + b.darkBishops;
  return light === 0 || dark === 0;
}

export function assessMatingPossibility(
  attacker: SideMaterial,
  defender: SideMaterial
): MateAssessment {
  const pawnsOnBoard = attacker.pawns + defender.pawns > 0;

  if (isBareKing(attacker)) {
    return {
      verdict: "cannot-mate",
      reason: "キングのみではチェックメイトできません",
      positionDependent: false,
    };
  }

  if (onlySameColourBishops(attacker, defender)) {
    return {
      verdict: "cannot-mate",
      reason:
        "盤上の駒がキングと同じ色のマスのビショップのみのため、チェックメイトできません",
      positionDependent: false,
    };
  }

  if (attacker.queens + attacker.rooks + attacker.pawns > 0) {
    return {
      verdict: "can-mate",
      reason:
        attacker.queens + attacker.rooks > 0
          ? "クイーンまたはルークがあるため、メイトは可能です"
          : "ポーンがあり、昇格によりメイトは可能です",
      positionDependent: pawnsOnBoard,
    };
  }

  // ここから attacker は小駒のみ
  const hasBothBishopColours =
    attacker.lightBishops > 0 && attacker.darkBishops > 0;
  if (
    attacker.knights >= 2 ||
    (attacker.knights >= 1 && bishops(attacker) >= 1) ||
    hasBothBishopColours
  ) {
    return {
      verdict: "can-mate",
      reason:
        "小駒の組み合わせ（ナイト2個以上・ビショップとナイト・異色ビショップ）により、メイトは可能です",
      positionDependent: pawnsOnBoard,
    };
  }

  // attacker: K+N のみ、または K+同色ビショップのみ
  if (isBareKing(defender)) {
    return {
      verdict: "cannot-mate",
      reason:
        attacker.knights === 1
          ? "キングとナイト1個のみでは、キングのみの相手をメイトできません"
          : "キングと同色ビショップのみでは、キングのみの相手をメイトできません",
      positionDependent: false,
    };
  }

  return {
    verdict: "unknown",
    reason:
      "相手の駒の協力によるメイト（ヘルプメイト）が可能かは局面に依存します。駒数だけでは判定できません",
    positionDependent: true,
  };
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
      // FEN は8段目から。a8 は白マス（file + rank が偶数 → 白マス）
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
