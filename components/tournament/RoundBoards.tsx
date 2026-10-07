"use client";

import { useState } from "react";
import type { Game, PlayerProfile } from "@/lib/domain/entities";

export interface RoundBoardsProps {
  games: Game[];
  players: PlayerProfile[];
  /** 白・黒の名前を保存する（登録済みプレーヤーと同名なら紐づけ） */
  onAssign: (
    gameId: string,
    names: { white: string; black: string }
  ) => Promise<void>;
}

function BoardRow({
  game,
  listId,
  onAssign,
}: {
  game: Game;
  listId: string;
  onAssign: RoundBoardsProps["onAssign"];
}) {
  const [white, setWhite] = useState(game.white.name);
  const [black, setBlack] = useState(game.black.name);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const dirty = white !== game.white.name || black !== game.black.name;

  const save = async () => {
    if (!dirty) return;
    setStatus("saving");
    try {
      await onAssign(game.id, { white, black });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  return (
    <li className="grid grid-cols-[3rem_1fr_1fr] gap-2 items-center">
      <span className="font-semibold text-center">{game.boardNumber}</span>
      <input
        aria-label={`ボード${game.boardNumber} 白`}
        placeholder="白"
        list={listId}
        value={white}
        onChange={(e) => setWhite(e.target.value)}
        onBlur={() => void save()}
        className="min-h-12 px-2 border border-gray-300 rounded-lg min-w-0"
      />
      <input
        aria-label={`ボード${game.boardNumber} 黒`}
        placeholder="黒"
        list={listId}
        value={black}
        onChange={(e) => setBlack(e.target.value)}
        onBlur={() => void save()}
        className="min-h-12 px-2 border border-gray-300 rounded-lg min-w-0"
      />
      {status === "error" && (
        <span role="alert" className="col-span-3 text-sm text-red-700">
          保存できませんでした
        </span>
      )}
    </li>
  );
}

/** ラウンドのボード一覧と白・黒の入力（入力欄から離れると保存） */
export function RoundBoards({ games, players, onAssign }: RoundBoardsProps) {
  const listId = "registered-players";
  if (games.length === 0)
    return <p className="text-sm text-gray-600">ボードがありません。</p>;
  return (
    <>
      <datalist id={listId}>
        {players.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      <ul className="space-y-2">
        {games.map((g) => (
          <BoardRow key={g.id} game={g} listId={listId} onAssign={onAssign} />
        ))}
      </ul>
    </>
  );
}
