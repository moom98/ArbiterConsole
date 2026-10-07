"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTournamentStore } from "@/lib/stores/tournament-store";
import { formatRulesetSummary } from "@/lib/domain/services/tournament-profile";

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("ja-JP");
}

/** 大会一覧・切り替え */
export default function TournamentListPage() {
  const { tournaments, active, loaded, error, load, setActive } =
    useTournamentStore();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">大会</h1>

      <Link
        href="/tournament/new"
        className="flex items-center justify-center w-full min-h-14 mb-4 px-4 bg-blue-600 text-white rounded-lg font-semibold"
      >
        新しい大会を作成
      </Link>

      {error && (
        <p role="alert" className="mb-4 p-3 bg-red-50 text-red-700 rounded">
          {error}
        </p>
      )}

      {loaded && tournaments.length === 0 && (
        <p className="text-gray-600">登録された大会はありません。</p>
      )}

      <ul className="space-y-3">
        {tournaments.map((t) => {
          const isActive = active?.id === t.id;
          return (
            <li
              key={t.id}
              className={`p-3 rounded-lg border-2 ${
                isActive ? "border-blue-600 bg-blue-50" : "border-gray-200"
              }`}
            >
              <p className="font-semibold">
                {t.name}
                {isActive && (
                  <span className="ml-2 text-xs px-2 py-0.5 rounded bg-blue-600 text-white">
                    選択中
                  </span>
                )}
              </p>
              <p className="text-sm text-gray-600">
                {formatDate(t.startDate)}
                {t.endDate ? ` – ${formatDate(t.endDate)}` : ""} ·{" "}
                {formatRulesetSummary(t)}
              </p>
              <div className="mt-2 flex gap-2">
                {!isActive && (
                  <button
                    type="button"
                    onClick={() => void setActive(t.id)}
                    className="flex-1 min-h-12 px-3 bg-blue-600 text-white rounded-lg font-semibold"
                  >
                    この大会を選択
                  </button>
                )}
                <Link
                  href={`/tournament/${encodeURIComponent(t.id)}`}
                  className="flex-1 flex items-center justify-center min-h-12 px-3 border border-gray-300 rounded-lg"
                >
                  設定・ラウンド
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
