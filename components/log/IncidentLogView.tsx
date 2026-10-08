"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IncidentCategory } from "@/lib/domain/entities";
import {
  EMPTY_FILTER,
  countExcludedForMissingColor,
  FILTER_ALL,
  filterIncidentRecords,
  illegalMoveCountsByGame,
  listGames,
  penaltyHistoryForGame,
  sortByReportedAtDesc,
  summarizePenalties,
  type IncidentLogEntry,
  type IncidentLogFilter,
} from "@/lib/domain/services/penalty-history";
import {
  buildIncidentCsv,
  incidentCsvFilename,
} from "@/lib/application/csv-export";
import { gameLabel } from "@/lib/application/incident-labels";
import { db as defaultDb, type ArbiterDatabase } from "@/lib/infrastructure/db";
import { loadIncidentLog } from "@/lib/infrastructure/db/incident-repository";
import {
  useIncidentStore,
  type createIncidentStore,
} from "@/lib/stores/incident-store";
import { Dialog } from "@/components/ui/Dialog";
import { IncidentLogFilters } from "./IncidentLogFilters";
import { IncidentRow } from "./IncidentRow";
import { IncidentDetail } from "./IncidentDetail";
import { PenaltyHistoryPanel } from "./PenaltyHistoryPanel";
import { PenaltySummaryCards } from "./PenaltySummaryCards";
import { downloadTextFile } from "./download";

interface IncidentLogViewProps {
  db?: ArbiterDatabase;
  /** AI 参考情報の再取得・送信確認に使うストア（テスト用に差し替え可能） */
  incidentStore?: ReturnType<typeof createIncidentStore>;
}

/** Incident Log 画面（実装計画 §3.1 / §3.3、要件 §24 / §25） */
export function IncidentLogView({
  db = defaultDb,
  incidentStore = useIncidentStore,
}: IncidentLogViewProps) {
  const [entries, setEntries] = useState<IncidentLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<IncidentLogFilter>(EMPTY_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // ダイアログを閉じたときにフォーカスを戻す行（Safari ではタップでボタンにフォーカスが移らないため）
  const triggerIdRef = useRef<string | null>(null);

  const {
    currentIncident,
    externalAiConfirmation,
    isProcessing: aiBusy,
    error: aiError,
    retryIncident,
    confirmExternalAiSend,
    reset: resetAi,
  } = incidentStore();
  // 最後に AI 参考情報の操作をした Incident（その Incident の詳細にだけ結果を出す）
  const [aiTargetId, setAiTargetId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const openIncident = useCallback((incidentId: string) => {
    triggerIdRef.current = incidentId;
    setSelectedId(incidentId);
  }, []);
  const closeIncident = useCallback(() => {
    setSelectedId(null);
    setAiTargetId(null);
    // 確認待ちの送信内容は閉じたら破棄する（開き直したら確認からやり直す）
    resetAi();
  }, [resetAi]);
  const findTrigger = useCallback((): HTMLElement | null => {
    const id = triggerIdRef.current;
    if (!id || !listRef.current) return null;
    return (
      Array.from(
        listRef.current.querySelectorAll<HTMLElement>("[data-incident-id]")
      ).find((el) => el.dataset.incidentId === id) ?? null
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadIncidentLog(db)
      .then((loaded) => {
        if (!cancelled) setEntries(sortByReportedAtDesc(loaded));
      })
      .catch((e: unknown) => {
        console.error("Failed to load incidents:", e);
        if (!cancelled) setError("インシデント履歴を読み込めませんでした");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [db]);

  /** 再評価で判断が置き換わったので、履歴を読み込み直す */
  const reload = useCallback(async () => {
    try {
      const loaded = await loadIncidentLog(db);
      if (mountedRef.current) setEntries(sortByReportedAtDesc(loaded));
    } catch (e: unknown) {
      console.error("Failed to reload incidents:", e);
      if (mountedRef.current)
        setError("インシデント履歴を読み込めませんでした");
    }
  }, [db]);
  const runAi = useCallback(
    async (incidentId: string, action: () => Promise<unknown>) => {
      setAiTargetId(incidentId);
      await action();
      await reload();
    },
    [reload]
  );

  const games = useMemo(() => listGames(entries), [entries]);
  const filtered = useMemo(
    () => filterIncidentRecords(entries, filter),
    [entries, filter]
  );
  const summary = useMemo(() => summarizePenalties(filtered), [filtered]);
  const excludedForMissingColor = useMemo(
    () => countExcludedForMissingColor(entries, filter),
    [entries, filter]
  );
  // 違法手回数は対局全体で数える（色・カテゴリのフィルタに左右されない）
  const illegalCounts = useMemo(
    () => illegalMoveCountsByGame(entries),
    [entries]
  );
  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<IncidentCategory, number>> = {};
    for (const { incident } of filterIncidentRecords(entries, {
      ...filter,
      category: FILTER_ALL,
    })) {
      counts[incident.category] = (counts[incident.category] ?? 0) + 1;
    }
    return counts;
  }, [entries, filter]);

  const selectedGame = games.find((g) => g.gameId === filter.gameId);
  const selectedGameHistory = useMemo(
    () =>
      filter.gameId === FILTER_ALL
        ? null
        : penaltyHistoryForGame(entries, filter.gameId),
    [entries, filter.gameId]
  );

  const selected = entries.find((e) => e.incident.id === selectedId) ?? null;
  const selectedHistory = useMemo(
    () =>
      selected
        ? penaltyHistoryForGame(entries, selected.incident.gameId)
        : null,
    [entries, selected]
  );

  const isFiltered =
    filter.gameId !== FILTER_ALL ||
    filter.playerColor !== FILTER_ALL ||
    filter.category !== FILTER_ALL;

  const exportCsv = () => {
    downloadTextFile(
      buildIncidentCsv(filtered),
      incidentCsvFilename(new Date())
    );
  };

  if (loading) {
    return (
      <div
        role="status"
        className="p-6 flex flex-col items-center justify-center min-h-[50dvh]"
      >
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4" />
        <p className="text-gray-600">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-bold">インシデント履歴</h1>
        {filtered.length > 0 && (
          <button
            type="button"
            onClick={exportCsv}
            className="min-h-12 px-4 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-semibold"
          >
            CSV出力（{filtered.length}件）
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-4 p-3 rounded bg-red-50 text-red-800">
          {error}
        </p>
      )}

      {entries.length > 0 && (
        <>
          <IncidentLogFilters
            filter={filter}
            games={games}
            categoryCounts={categoryCounts}
            onChange={setFilter}
          />
          {selectedGameHistory && (
            <PenaltyHistoryPanel
              title={selectedGame ? gameLabel(selectedGame) : "選択中の対局"}
              history={selectedGameHistory}
            />
          )}
          <PenaltySummaryCards summary={summary} filtered={isFiltered} />
          {excludedForMissingColor > 0 && (
            <p role="note" className="mb-4 text-sm text-gray-600">
              色情報のない旧データ{excludedForMissingColor}
              件は対象プレーヤーの絞り込みで除外されています
            </p>
          )}
        </>
      )}

      {filtered.length === 0 ? (
        !error && (
          <p className="text-center py-12 text-gray-500">
            {entries.length === 0
              ? "インシデント履歴はまだありません"
              : "条件に一致するインシデントはありません"}
          </p>
        )
      ) : (
        <ul ref={listRef} aria-label="インシデント一覧" className="space-y-3">
          {filtered.map((entry) => (
            <IncidentRow
              key={entry.incident.id}
              entry={entry}
              illegalMoveCounts={illegalCounts.get(entry.incident.gameId)}
              onSelect={openIncident}
            />
          ))}
        </ul>
      )}

      {selected && selectedHistory && (
        <Dialog
          title="インシデント詳細"
          onClose={closeIncident}
          returnFocus={findTrigger}
        >
          <IncidentDetail
            entry={selected}
            gameHistory={selectedHistory}
            onClose={closeIncident}
            ai={{
              confirmation:
                aiTargetId === selected.incident.id &&
                currentIncident?.id === selected.incident.id
                  ? (externalAiConfirmation?.preview ?? null)
                  : null,
              busy: aiTargetId === selected.incident.id && aiBusy,
              error: aiTargetId === selected.incident.id ? aiError : null,
              onRetry: () =>
                void runAi(selected.incident.id, () =>
                  retryIncident(selected.incident.id)
                ),
              onConfirm: () =>
                void runAi(selected.incident.id, confirmExternalAiSend),
            }}
          />
        </Dialog>
      )}
    </div>
  );
}
