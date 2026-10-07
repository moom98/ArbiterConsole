"use client";

import { useState } from "react";
import Link from "next/link";
import type { Round } from "@/lib/domain/entities";
import type { RoundChecklistService } from "@/lib/application/round-checklist";
import { nextRoundStatus } from "@/lib/domain/services/round-planning";
import {
  describeTransitionWarning,
  type RoundTransitionAssessment,
} from "@/lib/domain/services/round-checklist";

const ACTION_LABEL = {
  active: "ラウンド開始",
  completed: "ラウンド終了",
} as const;

const CONFIRM_LABEL = {
  active: "確認して開始する",
  completed: "確認して終了する",
} as const;

interface Props {
  round: Pick<Round, "id" | "status" | "roundNumber">;
  service: RoundChecklistService;
  /** 状態を変更した後に呼ばれる */
  onChanged: (round: Round) => void | Promise<void>;
  /** 一覧などで使う小さめの表示 */
  compact?: boolean;
}

/**
 * ラウンドの開始・終了ボタン。警告（開始前チェック未完了・保留中の Incident）がある場合は
 * 画面内で確認を求め、アービターが確認したときだけ変更する（confirm() は使わない）。
 * 警告の判定は RoundChecklistService / ドメインが行う。
 */
export function RoundTransitionControl({
  round,
  service,
  onChanged,
  compact = false,
}: Props) {
  const [pending, setPending] = useState<RoundTransitionAssessment | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  // 確認した後に警告が増えて再確認になった
  const [reasked, setReasked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = nextRoundStatus(round.status);
  if (next === null || next === "pending") return null;

  const run = async (confirmed: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // 確認時は表示した警告を渡す（表示後に増えた警告があれば再確認になる）
      const result = await service.changeRoundStatus(round.id, next, {
        confirmed,
        acknowledged: confirmed ? (pending?.warnings ?? []) : undefined,
      });
      if (result.status === "confirmation-required") {
        setReasked(confirmed);
        setPending(result.assessment);
      } else {
        setPending(null);
        await onChanged(result.round);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const primary =
    next === "active" ? "bg-blue-600 text-white" : "bg-gray-800 text-white";

  return (
    <div className={compact ? "" : "space-y-2"}>
      {!pending && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(false)}
          className={
            compact
              ? "min-h-12 px-3 border border-blue-600 text-blue-700 rounded-lg disabled:opacity-50"
              : `w-full min-h-14 px-4 text-lg font-bold rounded-lg shadow disabled:opacity-50 ${primary}`
          }
        >
          {ACTION_LABEL[next]}
        </button>
      )}
      {pending && (
        <div
          role="alert"
          aria-label={`Round ${round.roundNumber} ${ACTION_LABEL[next]}の確認`}
          className="mt-2 p-3 bg-yellow-50 border border-yellow-300 rounded-lg text-sm text-yellow-900 space-y-2"
        >
          {reasked && (
            <p className="font-bold text-red-700">
              確認後に警告が増えました。内容を確認してください。
            </p>
          )}
          <ul className="list-disc ml-5 font-semibold">
            {pending.warnings.map((w) => (
              <li key={w.kind}>{describeTransitionWarning(w)}</li>
            ))}
          </ul>
          {pending.warnings.map((w) =>
            w.kind === "incomplete-pre-round" ? (
              <details key={`${w.kind}-items`}>
                <summary className="min-h-12 flex items-center cursor-pointer">
                  未完了の項目
                </summary>
                <ul className="list-disc ml-5">
                  {w.items.map((label, i) => (
                    <li key={`${i}-${label}`}>{label}</li>
                  ))}
                </ul>
              </details>
            ) : (
              <Link
                key={`${w.kind}-link`}
                href="/log"
                className="inline-flex items-center min-h-12 text-blue-700 underline"
              >
                ログで保留中のIncidentを確認
              </Link>
            )
          )}
          <p>続けるかどうかはアービターが判断してください。</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(true)}
              className="flex-1 min-h-12 px-3 bg-yellow-600 text-white rounded-lg font-semibold disabled:opacity-50"
            >
              {CONFIRM_LABEL[next]}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPending(null)}
              className="flex-1 min-h-12 px-3 bg-white border border-gray-300 rounded-lg"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="status" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
