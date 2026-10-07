"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ChecklistStage } from "@/lib/domain/entities";
import type { RoundChecklistData } from "@/lib/application/round-checklist";
import { useTournamentStore } from "@/lib/stores/tournament-store";
import {
  CHECKLIST_STAGES,
  STAGE_PHASES,
} from "@/lib/domain/services/round-checklist";
import { ROUND_STATUS_LABEL } from "@/lib/domain/services/round-planning";
import { ChecklistItemRow } from "@/components/checklist/ChecklistItemRow";
import { ChecklistEditor } from "@/components/checklist/ChecklistEditor";
import { RoundTransitionControl } from "@/components/checklist/RoundTransitionControl";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** ラウンドチェックリスト（要件 §26）。ラウンドの状態に応じて開始前 / 対局中 / 終了時を表示する */
export default function RoundChecklistPage() {
  const params = useParams<{ id: string; round: string }>();
  const tournamentId = decodeURIComponent(params?.id ?? "");
  const roundNumber = Number(params?.round);
  const { checklist: service, load: reloadStore } = useTournamentStore();

  const [data, setData] = useState<RoundChecklistData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 利用者が選んだ段階（null = ラウンドの状態に対応する段階） */
  const [selectedStage, setSelectedStage] = useState<ChecklistStage | null>(
    null
  );
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const d = Number.isInteger(roundNumber)
        ? await service.load(tournamentId, roundNumber)
        : null;
      setData(d);
      setNotFound(d === null);
      setError(null);
    } catch (e) {
      console.error("Failed to load round checklist:", e);
      setError(message(e));
    }
  }, [service, tournamentId, roundNumber]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    }
  };

  if (notFound) {
    return (
      <div className="p-4 sm:p-6">
        <p className="mb-4">ラウンドが見つかりません。</p>
        <Link
          href={`/tournament/${encodeURIComponent(tournamentId)}`}
          className="inline-flex items-center min-h-12 text-blue-700 underline"
        >
          大会へ戻る
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-4">
        {error ? (
          <div role="alert" className="text-red-700">
            <p>チェックリストを読み込めませんでした: {error}</p>
            <button
              type="button"
              onClick={() => void reload()}
              className="mt-2 w-full min-h-12 px-3 bg-blue-600 text-white rounded-lg font-semibold"
            >
              再試行
            </button>
          </div>
        ) : (
          "読み込み中..."
        )}
      </div>
    );
  }

  const { tournament, round, view } = data;
  const stage = selectedStage ?? view.currentStage;
  const stageView = view.stages[stage];
  const { done, total } = stageView.progress;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const isCurrent = stage === view.currentStage;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <Link
          href={`/tournament/${encodeURIComponent(tournament.id)}`}
          className="inline-flex items-center min-h-12 text-sm text-blue-700 underline"
        >
          {tournament.name}
        </Link>
        <h1 className="text-2xl font-bold">
          Round {round.roundNumber} チェックリスト
        </h1>
        <p className="font-semibold" data-testid="round-status">
          {ROUND_STATUS_LABEL[round.status]}
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <nav aria-label="フェーズ" className="grid grid-cols-3 gap-1">
        {CHECKLIST_STAGES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === stage}
            onClick={() => setSelectedStage(s)}
            className={`min-h-12 px-2 rounded-lg text-sm font-semibold border ${
              s === stage
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300"
            }`}
          >
            {view.stages[s].label}
            {s === view.currentStage && (
              <span className="block text-xs font-normal">現在</span>
            )}
          </button>
        ))}
      </nav>

      <section
        aria-labelledby="stage-title"
        className="bg-white rounded-lg shadow p-4"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="stage-title" className="text-lg font-semibold">
            {stageView.label}チェック
          </h2>
          <p className="text-sm font-semibold" data-testid="checklist-progress">
            {done} / {total}
            {total > 0 && done === total ? " 完了" : ""}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label={`${stageView.label}チェックの進捗`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden"
        >
          <div
            className="h-full bg-green-600 transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        {!isCurrent && (
          <p className="mt-2 text-sm text-gray-600">
            現在のラウンドの状態は「{ROUND_STATUS_LABEL[round.status]}
            」です。この段階の項目も記録できます。
          </p>
        )}
        {stage !== "pre" && data.pendingIncidentCount > 0 && (
          <p className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm font-semibold text-yellow-900">
            このラウンドで保留中のIncident: {data.pendingIncidentCount}件
          </p>
        )}

        {editing ? (
          <div className="mt-4">
            <ChecklistEditor
              // 段階を切り替えたら追加先の区分を初期化する（別の段階に追加されないように）
              key={stage}
              phases={STAGE_PHASES[stage]}
              items={data.items}
              customized={data.customized}
              onAdd={(phase, label) =>
                act(() => service.addItem(tournament.id, phase, label))
              }
              onRemove={async (itemId) => {
                await act(() => service.removeItem(tournament.id, itemId));
              }}
              onMove={async (itemId, direction) => {
                await act(() =>
                  service.moveItem(tournament.id, itemId, direction)
                );
              }}
              onReset={async () => {
                await act(() => service.resetTemplate(tournament.id));
              }}
              onDone={() => setEditing(false)}
            />
          </div>
        ) : (
          <>
            {stageView.sections.map((section) => (
              <div key={section.phase} className="mt-3">
                {stageView.sections.length > 1 && (
                  <h3 className="text-sm font-semibold text-gray-600">
                    {section.label}
                  </h3>
                )}
                {section.items.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">項目はありません</p>
                ) : (
                  <ul>
                    {section.items.map((item) => (
                      <ChecklistItemRow
                        key={item.id}
                        item={item}
                        onToggle={(checked) =>
                          act(() => service.setDone(round.id, item.id, checked))
                        }
                        onSaveNote={(note) =>
                          act(() => service.setNote(round.id, item.id, note))
                        }
                      />
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-3 inline-flex items-center min-h-12 text-sm text-blue-700 underline"
            >
              項目を編集（この大会）
            </button>
          </>
        )}
      </section>

      {!editing && (
        <RoundTransitionControl
          key={round.status}
          round={round}
          service={service}
          onChanged={async () => {
            // 段階はラウンドの状態に追従させる（開始 → 対局中、終了 → 終了時）
            setSelectedStage(null);
            await reload();
            await reloadStore();
          }}
        />
      )}

      <p className="text-xs text-gray-500">
        チェックリストは進行業務の支援です。判断と最終的な裁定はアービターが行います。
      </p>
    </div>
  );
}
