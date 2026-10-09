"use client";

import { useRef, useState } from "react";
import {
  PROBABILITY_HINT,
  classificationView,
  prepareIncidentClassification,
  type ClassificationStep,
  type ClassifyTextResult,
} from "@/lib/application/llm-classification";
import { ExternalAiSendConfirmation } from "./ExternalAiSendConfirmation";
import { ExternalAiOptOutSwitch } from "./ExternalAiOptOutSwitch";
import { CATEGORY_LABELS } from "@/lib/application/incident-labels";
import type { IncidentClassification } from "@/lib/domain/llm/types";
import {
  CLOCK_TIME_SUBTYPE_LABELS,
  DRAW_SUBTYPE_LABELS,
  TOUCH_MOVE_LABEL,
  usesStructuredQuestions,
} from "@/lib/domain/follow-up";
import {
  TOUCH_MOVE_SUBTYPE,
  type IncidentCategory,
} from "@/lib/domain/entities";

interface IncidentTextClassifierProps {
  disabled?: boolean;
  /** 「外部AIに送らない」（報告画面で共有。external-ai-data-protection.md §4.4） */
  doNotSend: boolean;
  onDoNotSendChange: (value: boolean) => void;
  /** 提案を採用する（カテゴリ・subtype・説明文のプレフィル） */
  onApply: (classification: IncidentClassification, text: string) => void;
  /** 候補のチップから選ぶ（カテゴリと説明文のプレフィル。jev-classifier-design §7） */
  onPickCategory: (category: IncidentCategory, text: string) => void;
}

function subtypeLabel(c: IncidentClassification): string | undefined {
  if (!c.subtype) return undefined;
  if (c.category === "clock-time")
    return CLOCK_TIME_SUBTYPE_LABELS[
      c.subtype as keyof typeof CLOCK_TIME_SUBTYPE_LABELS
    ];
  if (c.category === "draw")
    return DRAW_SUBTYPE_LABELS[c.subtype as keyof typeof DRAW_SUBTYPE_LABELS];
  if (c.category === "illegal-move" && c.subtype === TOUCH_MOVE_SUBTYPE)
    return TOUCH_MOVE_LABEL;
  return undefined;
}

/**
 * 自由記述からカテゴリを提案する（要件 §10, §11）。
 * 提案はプレフィルのみで、カテゴリはアービターが確定する。判断は決定木・判断支援が行う。
 */
export function IncidentTextClassifier({
  disabled,
  doNotSend,
  onDoNotSendChange,
  onApply,
  onPickCategory,
}: IncidentTextClassifierProps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ClassifyTextResult | null>(null);
  /** 外部AIへ送る内容の確認待ち（まだ送っていない。D13） */
  const [pending, setPending] = useState<Extract<
    ClassificationStep,
    { status: "needs-confirmation" }
  > | null>(null);

  /** 入力の変更・新しい分類で古い応答を捨てるための番号 */
  const requestIdRef = useRef(0);
  const clear = () => {
    requestIdRef.current++;
    setLoading(false);
    setResult(null);
    setPending(null);
  };

  const handleClassify = async () => {
    clear();
    setLoading(true);
    const id = requestIdRef.current;
    try {
      const step = await prepareIncidentClassification(text, { doNotSend });
      if (id !== requestIdRef.current) return;
      if (step.status === "done") setResult(step.result);
      else setPending(step);
    } finally {
      // 新しい要求の処理中は loading を解除しない
      if (id === requestIdRef.current) setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!pending) return;
    setLoading(true);
    const id = requestIdRef.current;
    try {
      const r = await pending.send();
      // 送信中に記述が変わった場合、古い記述の分類は表示しない（新しい記述に適用されないように）
      if (id !== requestIdRef.current) return;
      setPending(null);
      setResult(r);
    } finally {
      // 新しい要求の処理中は loading を解除しない
      if (id === requestIdRef.current) setLoading(false);
    }
  };

  const handleDecline = () => {
    if (!pending) return;
    setResult(pending.decline());
    setPending(null);
  };

  const c = result?.classification ?? null;
  const view = c ? classificationView(c) : null;

  return (
    <section
      aria-label="状況から分類"
      className="mb-6 p-3 border border-gray-200 rounded-lg"
    >
      <label htmlFor="incident-free-text" className="block font-semibold mb-2">
        状況を入力して分類（任意）
      </label>
      <textarea
        id="incident-free-text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          clear();
        }}
        placeholder="例: 黒がスマートウォッチを着けている（選手名ではなく「白」「黒」で書いてください）"
        className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <ExternalAiOptOutSwitch
        checked={doNotSend}
        onChange={(v) => {
          onDoNotSendChange(v);
          clear();
        }}
      />
      <button
        type="button"
        onClick={() => void handleClassify()}
        disabled={disabled || loading || !text.trim()}
        className="mt-2 w-full min-h-12 px-4 bg-gray-800 text-white rounded-lg font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {loading ? "分類中..." : "カテゴリを提案"}
      </button>

      {pending && (
        <div className="mt-3">
          <ExternalAiSendConfirmation
            preview={pending.preview}
            onConfirm={() => void handleSend()}
            onDecline={handleDecline}
            disabled={disabled || loading}
            confirmLabel="確認してAIで分類"
          />
        </div>
      )}

      {result && !c && (
        <p role="status" className="mt-3 text-sm text-gray-700">
          分類できませんでした。下のカテゴリから選択してください。
          {result.notice && (
            <span className="block text-gray-500">{result.notice}</span>
          )}
        </p>
      )}

      {c && (
        <div role="status" className="mt-3 p-3 bg-blue-50 rounded-lg">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-900">
              {c.method === "llm" ? "AI分類（提案）" : "キーワード分類（提案）"}
              {view?.percent !== undefined && ` · ${view.percent}%`}
            </span>
            {c.needsTournamentRules && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-purple-100 text-purple-900">
                大会規定を確認
              </span>
            )}
          </div>
          <p className="font-semibold">
            {CATEGORY_LABELS[c.category]}
            {subtypeLabel(c) && ` / ${subtypeLabel(c)}`}
          </p>
          {usesStructuredQuestions(c.category) && (
            <p className="text-sm text-gray-700 mt-1">
              このカテゴリは決定木の質問で判断します。
            </p>
          )}
          {result?.notice && (
            <p className="text-xs text-gray-600 mt-1">{result.notice}</p>
          )}
          {view?.showProbabilityHint && (
            <p className="text-xs text-gray-600 mt-1">{PROBABILITY_HINT}</p>
          )}
          {view && view.candidates.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-semibold text-gray-700">
                {view.candidatesLabel}
              </p>
              <div className="flex flex-wrap gap-2 mt-1">
                {view.candidates.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => onPickCategory(cat, text.trim())}
                    disabled={disabled}
                    className="min-h-12 px-4 py-2 rounded-full border-2 border-blue-300 bg-white font-semibold text-blue-900 disabled:opacity-40"
                  >
                    {CATEGORY_LABELS[cat]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {c.followUpQuestions.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-semibold text-gray-700">
                確認ポイント
              </p>
              <ul className="list-disc ml-5 text-sm text-gray-700">
                {c.followUpQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          {c.missingInformation.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-semibold text-gray-700">
                不足している情報
              </p>
              <ul className="list-disc ml-5 text-sm text-gray-700">
                {c.missingInformation.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {view?.showContinue && (
            <button
              type="button"
              onClick={() => onApply(c, text.trim())}
              disabled={disabled}
              className="mt-3 w-full min-h-12 px-4 bg-blue-600 text-white rounded-lg font-semibold disabled:bg-gray-300"
            >
              このカテゴリで続ける
            </button>
          )}
        </div>
      )}
    </section>
  );
}
