/**
 * 端末に登録済みの識別子を読み込む（external-ai-data-protection.md §5.1, ADR-012）。
 *
 * - PlayerProfile の name / fideId / title（全大会）
 * - 保存済みの全対局の Game.white / Game.black（暫定大会で手入力した名前を含む）
 * - 選択中でまだ保存していない対局のプレーヤー（extra）
 * - Tournament の name / venue / chiefArbiter
 *
 * 置き換えの対象を増やす方向にだけ働く（多めに読み込んでも漏えいは増えない）。
 */
import type { Player } from "@/lib/domain/entities";
import type { KnownIdentifiers } from "@/lib/domain/privacy";
import type { ArbiterDatabase } from "@/lib/infrastructure/db/schema";

export interface KnownIdentifierExtras {
  /** 選択中の（未保存の）対局のプレーヤー */
  players?: readonly Pick<Player, "name" | "fideId">[];
}

export async function loadKnownIdentifiers(
  db: ArbiterDatabase,
  extras: KnownIdentifierExtras = {}
): Promise<KnownIdentifiers> {
  const [profiles, games, tournaments] = await Promise.all([
    db.players.toArray(),
    db.games.toArray(),
    db.tournaments.toArray(),
  ]);
  const players = new Map<
    string,
    { name: string; fideId?: string; title?: string }
  >();
  const add = (name: string | undefined, fideId?: string, title?: string) => {
    const n = name?.trim();
    if (!n) return;
    const key = `${n}\u0000${fideId ?? ""}\u0000${title ?? ""}`;
    if (!players.has(key)) players.set(key, { name: n, fideId, title });
  };
  for (const p of profiles) add(p.name, p.fideId, p.title);
  for (const g of games) {
    add(g.white?.name, g.white?.fideId);
    add(g.black?.name, g.black?.fideId);
  }
  for (const p of extras.players ?? []) add(p.name, p.fideId);

  const present = (v: string | undefined): v is string => !!v?.trim();
  return {
    players: Array.from(players.values()),
    tournaments: tournaments.map((t) => t.name).filter(present),
    venues: tournaments.map((t) => t.venue).filter(present),
    officials: tournaments.map((t) => t.chiefArbiter).filter(present),
  };
}
