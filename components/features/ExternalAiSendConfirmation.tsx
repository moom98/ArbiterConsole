"use client";

import type { ExternalAiPreview } from "@/lib/domain/llm/types";

interface ExternalAiSendConfirmationProps {
  preview: ExternalAiPreview;
  onConfirm: () => void;
  /** 省略時は「送らない」ボタンを出さない（確認しなければ送らないため） */
  onDecline?: () => void;
  disabled?: boolean;
  confirmLabel?: string;
}

/**
 * 外部AIへ送る内容の確認（ADR-012 改訂2, D13）。
 * 置き換え後の送信内容を示し、アービターが確認するまで何も送らない。
 */
export function ExternalAiSendConfirmation({
  preview,
  onConfirm,
  onDecline,
  disabled,
  confirmLabel = "確認して送信",
}: ExternalAiSendConfirmationProps) {
  return (
    <section
      aria-label="外部AIへ送る内容の確認"
      className="p-3 bg-amber-50 border-2 border-amber-400 rounded-lg text-sm text-amber-950"
    >
      <p className="font-semibold">
        外部AIへ送る内容の確認（{preview.destination}）
      </p>
      <p className="mt-1">
        次の内容を送ります。選手名・健康・不正の疑いなど、送るべきでない内容が含まれていないか確認してください。
      </p>
      <dl className="mt-2 space-y-2">
        {preview.fields.map((f) => (
          <div key={f.label}>
            <dt className="text-xs font-semibold text-amber-900">{f.label}</dt>
            <dd className="mt-0.5 p-2 bg-white border border-amber-200 rounded whitespace-pre-wrap break-words text-gray-900">
              {f.text}
            </dd>
          </div>
        ))}
      </dl>
      {preview.notes.length > 0 && (
        <ul className="mt-2 list-disc ml-5 text-xs text-amber-900">
          {preview.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        {onDecline && (
          <button
            type="button"
            onClick={onDecline}
            disabled={disabled}
            className="min-h-12 px-4 border border-gray-400 bg-white rounded-lg font-semibold disabled:opacity-50"
          >
            送らない
          </button>
        )}
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled}
          className="flex-1 min-h-12 px-4 bg-amber-600 text-white rounded-lg font-semibold disabled:bg-gray-300"
        >
          {confirmLabel}
        </button>
      </div>
    </section>
  );
}
