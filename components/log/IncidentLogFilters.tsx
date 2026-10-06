"use client";

import type { IncidentCategory, PlayerColor } from "@/lib/domain/entities";
import {
  FILTER_ALL,
  type FilterAll,
  type GameOption,
  type IncidentLogFilter,
} from "@/lib/domain/services/penalty-history";
import {
  CATEGORY_LABELS,
  COLOR_LABELS,
  formatDate,
  gameLabel,
} from "@/lib/application/incident-labels";

interface IncidentLogFiltersProps {
  filter: IncidentLogFilter;
  games: GameOption[];
  categoryCounts: Partial<Record<IncidentCategory, number>>;
  onChange: (filter: IncidentLogFilter) => void;
}

const COLOR_OPTIONS: Array<{ value: PlayerColor | FilterAll; label: string }> =
  [
    { value: FILTER_ALL, label: "すべて" },
    { value: "white", label: COLOR_LABELS.white },
    { value: "black", label: COLOR_LABELS.black },
  ];

const selectClass =
  "w-full min-h-12 px-3 border border-gray-300 rounded-lg bg-white text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

export function IncidentLogFilters({
  filter,
  games,
  categoryCounts,
  onChange,
}: IncidentLogFiltersProps) {
  const isFiltered =
    filter.gameId !== FILTER_ALL ||
    filter.playerColor !== FILTER_ALL ||
    filter.category !== FILTER_ALL;

  return (
    <fieldset className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
      <legend className="sr-only">絞り込み</legend>
      <div>
        <label
          htmlFor="log-filter-game"
          className="block text-sm font-semibold mb-1"
        >
          対局（ラウンド / ボード）
        </label>
        <select
          id="log-filter-game"
          value={filter.gameId}
          onChange={(e) => onChange({ ...filter, gameId: e.target.value })}
          className={selectClass}
        >
          <option value={FILTER_ALL}>すべての対局</option>
          {games.map((g) => (
            <option key={g.gameId} value={g.gameId}>
              {gameLabel(g)}
              {g.date ? ` ・${formatDate(g.date)}` : ""} ({g.incidentCount})
            </option>
          ))}
        </select>
      </div>

      <div>
        <span
          id="log-filter-color"
          className="block text-sm font-semibold mb-1"
        >
          対象プレーヤー
        </span>
        <div
          role="group"
          aria-labelledby="log-filter-color"
          className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1"
        >
          {COLOR_OPTIONS.map((o) => {
            const active = filter.playerColor === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ ...filter, playerColor: o.value })}
                className={`min-h-12 rounded-md text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  active ? "bg-white shadow text-blue-700" : "text-gray-700"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label
          htmlFor="log-filter-category"
          className="block text-sm font-semibold mb-1"
        >
          カテゴリ
        </label>
        <select
          id="log-filter-category"
          value={filter.category}
          onChange={(e) =>
            onChange({
              ...filter,
              category: e.target.value as IncidentCategory | FilterAll,
            })
          }
          className={selectClass}
        >
          <option value={FILTER_ALL}>すべてのカテゴリ</option>
          {(Object.keys(CATEGORY_LABELS) as IncidentCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]} ({categoryCounts[c] ?? 0})
            </option>
          ))}
        </select>
      </div>

      {isFiltered && (
        <div className="sm:col-span-3">
          <button
            type="button"
            onClick={() =>
              onChange({
                gameId: FILTER_ALL,
                playerColor: FILTER_ALL,
                category: FILTER_ALL,
              })
            }
            className="min-h-12 px-4 text-sm font-semibold text-blue-700 underline"
          >
            絞り込みを解除
          </button>
        </div>
      )}
    </fieldset>
  );
}
