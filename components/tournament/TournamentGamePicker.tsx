"use client";

import { useState } from "react";
import Link from "next/link";
import type { Game, Round, Tournament } from "@/lib/domain/entities";
import { ROUND_STATUS_LABEL } from "@/lib/domain/services/round-planning";

export interface TournamentGamePickerProps {
  tournament: Tournament;
  /** 大会プロファイルから導出した規則セットの表示（例: "Blitz · B.2 · 3分+2秒 · FIDE-2023"） */
  rulesetSummary: string;
  /** 規則セットを導出できない場合のエラー（あれば対局を選べない） */
  rulesetErrors: string[];
  rounds: Round[];
  selectedRound: number | null;
  games: Game[];
  loadingGames: boolean;
  disabled?: boolean;
  onSelectRound: (roundNumber: number) => void;
  /** ボードをタップ → その対局で報告へ進む */
  onPickGame: (game: Game) => void;
  /** 未作成のボード（ラウンド・ボード番号の直接入力） */
  onPickOther: (roundNumber: number, boardNumber: number) => void;
  /** 大会を使わずに報告する（暫定コンテキスト） */
  onUseAdHoc: () => void;
}

function playersLine(game: Game): string | null {
  const w = game.white.name;
  const b = game.black.name;
  if (!w && !b) return null;
  return `${w || "?"} – ${b || "?"}`;
}

/**
 * 報告フローの対局選択（大会あり）。ラウンドは「今のラウンド」が選択済みのため、
 * 通常はボードを1タップ、ラウンドを変える場合でも2タップで報告へ進める。
 */
export function TournamentGamePicker(props: TournamentGamePickerProps) {
  const {
    tournament,
    rulesetSummary,
    rulesetErrors,
    rounds,
    selectedRound,
    games,
    loadingGames,
    disabled,
  } = props;
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherRound, setOtherRound] = useState<string>("");
  const [otherBoard, setOtherBoard] = useState<string>("");
  const blocked = disabled || rulesetErrors.length > 0;

  const otherRoundNumber = Number(otherRound || selectedRound || "");
  const otherBoardNumber = Number(otherBoard);
  const otherValid =
    Number.isInteger(otherRoundNumber) &&
    otherRoundNumber >= 1 &&
    Number.isInteger(otherBoardNumber) &&
    otherBoardNumber >= 1;

  return (
    <div className="space-y-4">
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="font-semibold">{tournament.name}</p>
        <p className="text-sm text-gray-700">{rulesetSummary}</p>
        <p className="text-xs text-gray-600 mt-1">
          規則セットは大会設定から適用します
        </p>
      </div>

      {rulesetErrors.length > 0 && (
        <div
          role="alert"
          className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm"
        >
          <ul className="list-disc ml-5">
            {rulesetErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <Link
            href={`/tournament/${encodeURIComponent(tournament.id)}`}
            className="inline-flex items-center min-h-11 text-blue-700 underline"
          >
            大会設定を開く
          </Link>
        </div>
      )}

      {rounds.length > 0 && (
        <fieldset>
          <legend className="font-semibold mb-2">ラウンド</legend>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {rounds.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={selectedRound === r.roundNumber}
                onClick={() => props.onSelectRound(r.roundNumber)}
                className={`shrink-0 min-h-12 min-w-16 px-3 rounded-lg border-2 font-semibold ${
                  selectedRound === r.roundNumber
                    ? "border-blue-600 bg-blue-50"
                    : "border-gray-200"
                }`}
              >
                R{r.roundNumber}
                <span className="block text-xs font-normal text-gray-600">
                  {ROUND_STATUS_LABEL[r.status]}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {selectedRound !== null && (
        <fieldset>
          <legend className="font-semibold mb-2">
            ボード（R{selectedRound}）をタップ
          </legend>
          {loadingGames ? (
            <p className="text-sm text-gray-500">読み込み中...</p>
          ) : games.length === 0 ? (
            <p className="text-sm text-gray-600">
              このラウンドのボードは未作成です。下の「その他のボード」から指定できます。
            </p>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {games.map((g) => {
                const players = playersLine(g);
                return (
                  <button
                    key={g.id}
                    type="button"
                    disabled={blocked}
                    onClick={() => props.onPickGame(g)}
                    aria-label={`ボード${g.boardNumber}${players ? ` ${players}` : ""}`}
                    className="min-h-14 px-1 rounded-lg border-2 border-gray-200 hover:border-blue-500 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {g.boardNumber}
                    {players && (
                      <span className="block text-[10px] font-normal text-gray-600 truncate">
                        {players}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>
      )}

      {rounds.length === 0 && (
        <p className="text-sm text-gray-600">
          ラウンドが未作成です。
          <Link
            href={`/tournament/${encodeURIComponent(tournament.id)}`}
            className="text-blue-700 underline"
          >
            大会設定
          </Link>
          で「Round N, boards
          1–40」をまとめて作成するか、下の「その他のボード」から指定してください。
        </p>
      )}

      <div className="border-t pt-3">
        {!otherOpen ? (
          <button
            type="button"
            onClick={() => setOtherOpen(true)}
            className="min-h-12 px-3 text-blue-700 underline"
          >
            その他のボード（番号を入力）
          </button>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block font-semibold mb-1">ラウンド</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={otherRound || (selectedRound ?? "")}
                  onChange={(e) => setOtherRound(e.target.value)}
                  className="w-full min-h-12 px-3 text-lg border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block">
                <span className="block font-semibold mb-1">ボード</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={otherBoard}
                  onChange={(e) => setOtherBoard(e.target.value)}
                  className="w-full min-h-12 px-3 text-lg border border-gray-300 rounded-lg"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={blocked || !otherValid}
              onClick={() =>
                props.onPickOther(otherRoundNumber, otherBoardNumber)
              }
              className="w-full min-h-12 px-4 bg-blue-600 text-white rounded-lg font-semibold disabled:bg-gray-300"
            >
              この対局で報告
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={props.onUseAdHoc}
        className="min-h-12 px-3 text-sm text-gray-600 underline"
      >
        大会を使わずに報告（暫定の対局）
      </button>
    </div>
  );
}
