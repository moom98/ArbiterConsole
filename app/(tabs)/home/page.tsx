"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTournamentStore } from "@/lib/stores/tournament-store";
import {
  loadHomeSummary,
  type HomeSummary,
} from "@/lib/application/home-summary";
import { formatRulesetSummary } from "@/lib/domain/services/tournament-profile";
import {
  currentRound,
  ROUND_STATUS_LABEL,
} from "@/lib/domain/services/round-planning";
import { decisionOf } from "@/lib/domain/services/penalty-history";
import {
  categoryLabel,
  formatTime,
  gameLabel,
} from "@/lib/application/incident-labels";

const QUICK_LINKS = [
  { href: "/report", label: "報告" },
  { href: "/search", label: "検索" },
  { href: "/log", label: "ログ" },
] as const;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function HomePage() {
  const { tournaments, active, rounds, loaded, error, load, setActive } =
    useTournamentStore();
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSummary(null);
    setSummaryError(null);
    if (!active) return;
    let cancelled = false;
    loadHomeSummary(active.id, rounds)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((e) => {
        console.error("Failed to load home summary:", e);
        if (!cancelled)
          setSummaryError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [active, rounds]);

  // ラウンドの状態はストアのラウンドから直接求める（サマリーの読み込みを待たない）
  const round = currentRound(rounds);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Arbiter Console</h1>
      <p className="text-sm text-gray-600 mb-4">
        判断支援（Decision Support）— 最終的な裁定はアービターが行います
      </p>

      <div className="space-y-4">
        {/* 今すること: 報告がいちばん上 */}
        <Link
          href="/report"
          className="flex items-center justify-center w-full min-h-16 px-4 bg-blue-600 text-white text-lg font-bold rounded-lg shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          トラブルを報告
        </Link>

        <section
          aria-labelledby="tournament-title"
          className="bg-white rounded-lg shadow p-4"
        >
          <h2 id="tournament-title" className="text-sm text-gray-600 mb-1">
            現在の大会
          </h2>
          {error && (
            <div
              role="alert"
              className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700"
            >
              <p>大会情報を読み込めませんでした: {error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-2 w-full min-h-12 px-3 bg-blue-600 text-white rounded-lg font-semibold"
              >
                再試行
              </button>
            </div>
          )}
          {active ? (
            <>
              <p className="text-lg font-bold">{active.name}</p>
              <p className="text-sm text-gray-700">
                {formatRulesetSummary(active)}
              </p>
              <p className="mt-2 font-semibold" data-testid="round-status">
                {round
                  ? `Round ${round.roundNumber}${
                      active.totalRounds ? ` / ${active.totalRounds}` : ""
                    } · ${ROUND_STATUS_LABEL[round.status]}${
                      summary?.currentRoundBoards
                        ? ` · ${summary.currentRoundBoards}ボード`
                        : ""
                    }`
                  : "ラウンド未作成"}
              </p>
              {summary && summary.escalatedCount > 0 && (
                <p className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm font-semibold text-yellow-900">
                  CA確認を推奨したIncident: {summary.escalatedCount}件
                </p>
              )}
              {round && (
                <Link
                  href={`/tournament/${encodeURIComponent(active.id)}/rounds/${round.roundNumber}`}
                  className="mt-3 flex items-center justify-center min-h-14 px-3 bg-blue-50 border border-blue-300 text-blue-800 rounded-lg font-bold"
                >
                  ラウンドチェックリスト
                </Link>
              )}
              <Link
                href={`/tournament/${encodeURIComponent(active.id)}`}
                className="mt-2 flex items-center justify-center min-h-12 px-3 border border-gray-300 rounded-lg"
              >
                {round ? "ラウンド・ボード管理" : "ラウンドを作成"}
              </Link>
            </>
          ) : loaded && !error ? (
            <>
              <p className="text-gray-700 mb-3">
                大会が選択されていません。大会を作成すると、報告時にラウンド・ボードを選ぶだけで規則セットが適用されます。
              </p>
              <Link
                href="/tournament/new"
                className="flex items-center justify-center min-h-12 px-3 bg-blue-50 border border-blue-200 rounded-lg font-semibold"
              >
                大会を作成
              </Link>
            </>
          ) : !loaded ? (
            <p className="text-gray-500">読み込み中...</p>
          ) : null}

          {tournaments.length > 1 && (
            <label className="block mt-3 text-sm">
              <span className="text-gray-600">大会を切り替え</span>
              <select
                value={active?.id ?? ""}
                onChange={(e) => void setActive(e.target.value || null)}
                className="mt-1 w-full min-h-12 px-3 border border-gray-300 rounded-lg bg-white"
              >
                {!active && <option value="">選択してください</option>}
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tournaments.length > 0 && (
            <Link
              href="/tournament"
              className="inline-flex items-center min-h-12 mt-1 text-sm text-blue-700 underline"
            >
              大会一覧
            </Link>
          )}
        </section>

        <nav aria-label="クイックアクション" className="grid grid-cols-3 gap-2">
          {QUICK_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center justify-center min-h-14 bg-white rounded-lg shadow font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {active && (
          <section
            aria-labelledby="recent-title"
            className="bg-white rounded-lg shadow p-4"
          >
            <h2 id="recent-title" className="text-lg font-semibold mb-2">
              最近のIncident
            </h2>
            {!summary && !summaryError && (
              <p className="text-sm text-gray-500">読み込み中...</p>
            )}
            {summaryError && (
              <p role="alert" className="text-sm text-red-700">
                Incidentを読み込めませんでした: {summaryError}
              </p>
            )}
            {summary && summary.recent.length === 0 && (
              <p className="text-sm text-gray-600">まだ記録はありません。</p>
            )}
            <ul className="space-y-2">
              {summary?.recent.map((entry) => {
                const decision = decisionOf(entry);
                const penalty = decision?.penalties[0]?.description;
                return (
                  <li
                    key={entry.incident.id}
                    className="p-3 border border-gray-200 rounded-lg"
                  >
                    <p className="text-sm text-gray-600">
                      {entry.game ? gameLabel(entry.game) : "対局不明"} |{" "}
                      {formatTime(entry.incident.reportedAt)}
                    </p>
                    <p className="font-semibold">
                      {categoryLabel(entry.incident.category)}
                    </p>
                    {decision && (
                      <p className="text-sm">
                        →{" "}
                        {penalty ??
                          truncate(decision.conclusion.split("\n")[0], 40)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <Link
              href="/log"
              className="mt-2 inline-flex items-center min-h-12 text-blue-700 underline"
            >
              履歴をすべて見る
            </Link>
          </section>
        )}

        <section
          aria-labelledby="notice-title"
          className="bg-yellow-50 rounded-lg shadow p-4"
        >
          <h2 id="notice-title" className="text-lg font-semibold mb-2">
            注意事項
          </h2>
          <ul className="text-sm text-gray-700 space-y-1 list-disc ml-5">
            <li>
              このアプリは判断支援（Decision
              Support）ツールです。表示されるのは推奨であり、最終的な裁定はアービターが行います。
            </li>
            <li>重要な判定は必ずChief Arbiterへ相談してください。</li>
            <li>不正検出は自動化されません。必ず人間が判断します。</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
