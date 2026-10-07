"use client";

import { useId, useState } from "react";
import {
  MAX_NOTE_LENGTH,
  type ChecklistViewItem,
} from "@/lib/domain/services/round-checklist";
import { formatTime } from "@/lib/application/incident-labels";

interface Props {
  item: ChecklistViewItem;
  onToggle: (done: boolean) => unknown;
  onSaveNote: (note: string) => unknown;
}

/** チェック項目1行（行全体がタップ対象の大きなチェックボックス・メモ・根拠） */
export function ChecklistItemRow({ item, onToggle, onSaveNote }: Props) {
  const checkboxId = useId();
  const [editingNote, setEditingNote] = useState(false);
  const [draft, setDraft] = useState(item.note ?? "");

  const saveNote = async () => {
    setEditingNote(false);
    if (draft.trim() !== (item.note ?? "")) await onSaveNote(draft);
  };

  return (
    <li className="py-1">
      <div className="flex items-stretch gap-1">
        <label
          htmlFor={checkboxId}
          className={`flex-1 flex items-center gap-3 min-h-14 px-2 rounded-lg cursor-pointer select-none ${
            item.done ? "bg-green-50" : "hover:bg-gray-50"
          }`}
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={item.done}
            onChange={(e) => void onToggle(e.target.checked)}
            className="h-7 w-7 shrink-0 accent-green-600"
          />
          <span className="flex-1">
            <span
              className={`block font-medium ${
                item.done ? "text-gray-500 line-through" : ""
              }`}
            >
              {item.label}
            </span>
            {item.detail && (
              <span className="block text-sm text-gray-600">{item.detail}</span>
            )}
            {item.done && item.doneAt && (
              <span className="block text-xs text-gray-500">
                完了 {formatTime(item.doneAt)}
              </span>
            )}
          </span>
        </label>
        <button
          type="button"
          aria-label={`${item.label}のメモ`}
          aria-expanded={editingNote}
          onClick={() => {
            setDraft(item.note ?? "");
            setEditingNote((v) => !v);
          }}
          className={`min-h-14 min-w-12 px-2 text-sm rounded-lg border ${
            item.note
              ? "border-blue-300 text-blue-700 bg-blue-50"
              : "border-gray-200 text-gray-600"
          }`}
        >
          メモ
        </button>
      </div>

      {item.note && !editingNote && (
        <p className="ml-12 mt-1 text-sm text-gray-700 whitespace-pre-wrap">
          {item.note}
        </p>
      )}
      {editingNote && (
        <div className="ml-12 mt-1">
          <textarea
            aria-label={`${item.label}のメモを入力`}
            autoFocus
            rows={2}
            maxLength={MAX_NOTE_LENGTH}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void saveNote()}
            className="w-full p-2 border border-gray-300 rounded-lg text-base"
          />
        </div>
      )}

      {item.citations && item.citations.length > 0 && (
        <details className="ml-12 text-sm">
          <summary className="inline-flex items-center min-h-12 text-gray-600 cursor-pointer">
            根拠
          </summary>
          <ul className="space-y-2 pb-2">
            {item.citations.map((c) => (
              <li key={c.article + (c.text ?? "")}>
                <p className="font-semibold">
                  {c.article}
                  {c.page ? ` (p.${c.page})` : ""}
                </p>
                {c.text && <p className="text-gray-700">「{c.text}」</p>}
                {c.edition && (
                  <p className="text-xs text-gray-500">{c.edition}</p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
