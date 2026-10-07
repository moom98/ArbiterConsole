"use client";

import { useState } from "react";
import type {
  ChecklistItemDefinition,
  ChecklistPhase,
} from "@/lib/domain/entities";
import {
  CHECKLIST_PHASE_LABEL,
  MAX_CUSTOM_LABEL_LENGTH,
} from "@/lib/domain/services/round-checklist";

interface Props {
  /** 表示中の段階のフェーズ（表示順） */
  phases: readonly ChecklistPhase[];
  items: ChecklistItemDefinition[];
  customized: boolean;
  /** 追加できたら true */
  onAdd: (phase: ChecklistPhase, label: string) => Promise<boolean>;
  onRemove: (itemId: string) => Promise<void>;
  onMove: (itemId: string, direction: -1 | 1) => Promise<void>;
  onReset: () => Promise<void>;
  onDone: () => void;
}

/** 大会ごとのチェックリスト編集（追加・削除・並べ替え）。変更は大会の全ラウンドに適用される */
export function ChecklistEditor({
  phases,
  items,
  customized,
  onAdd,
  onRemove,
  onMove,
  onReset,
  onDone,
}: Props) {
  const [phase, setPhase] = useState<ChecklistPhase>(phases[0]);
  const [label, setLabel] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        変更はこの大会のすべてのラウンドに適用されます。
      </p>
      {phases.map((p) => {
        const phaseItems = items.filter((i) => i.phase === p);
        return (
          <section key={p}>
            <h3 className="font-semibold mb-1">{CHECKLIST_PHASE_LABEL[p]}</h3>
            <ul className="divide-y">
              {phaseItems.map((item, index) => (
                <li key={item.id} className="flex items-center gap-1 py-1">
                  <span className="flex-1 min-w-0">
                    {item.label}
                    {item.custom && (
                      <span className="ml-1 text-xs text-gray-500">
                        （追加）
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label={`${item.label}を上へ`}
                    disabled={index === 0}
                    onClick={() => void onMove(item.id, -1)}
                    className="min-h-12 min-w-12 border border-gray-300 rounded-lg disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`${item.label}を下へ`}
                    disabled={index === phaseItems.length - 1}
                    onClick={() => void onMove(item.id, 1)}
                    className="min-h-12 min-w-12 border border-gray-300 rounded-lg disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`${item.label}を削除`}
                    onClick={() => void onRemove(item.id)}
                    className="min-h-12 px-2 text-sm text-red-700 border border-red-200 rounded-lg"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd(phase, label).then((ok) => {
            if (ok) setLabel("");
          });
        }}
      >
        <h3 className="font-semibold">項目を追加</h3>
        {phases.length > 1 && (
          <select
            aria-label="追加するフェーズ"
            value={phase}
            onChange={(e) => setPhase(e.target.value as ChecklistPhase)}
            className="w-full min-h-12 px-3 border border-gray-300 rounded-lg bg-white"
          >
            {phases.map((p) => (
              <option key={p} value={p}>
                {CHECKLIST_PHASE_LABEL[p]}
              </option>
            ))}
          </select>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            aria-label="追加する項目名"
            placeholder="例: 消毒液の配置"
            maxLength={MAX_CUSTOM_LABEL_LENGTH}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1 min-w-0 min-h-12 px-3 border border-gray-300 rounded-lg"
          />
          <button
            type="submit"
            disabled={!label.trim()}
            className="min-h-12 px-4 bg-blue-600 text-white rounded-lg disabled:bg-gray-300"
          >
            追加
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        {customized &&
          (!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="min-h-12 px-3 border border-gray-300 rounded-lg"
            >
              既定の項目に戻す
            </button>
          ) : (
            <div className="p-3 bg-red-50 rounded-lg space-y-2">
              <p className="text-sm text-red-800">
                追加した項目は削除され、並び順も既定に戻ります。
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void onReset().then(() => setConfirmReset(false))
                  }
                  className="flex-1 min-h-12 px-3 bg-red-600 text-white rounded-lg"
                >
                  既定に戻す
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="flex-1 min-h-12 px-3 bg-gray-100 rounded-lg"
                >
                  キャンセル
                </button>
              </div>
            </div>
          ))}
        <button
          type="button"
          onClick={onDone}
          className="min-h-12 px-3 bg-gray-800 text-white rounded-lg font-semibold"
        >
          編集を終了
        </button>
      </div>
    </div>
  );
}
