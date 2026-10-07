"use client";

import { useState } from "react";
import type { FollowUpQuestion } from "@/lib/domain/follow-up";

interface FollowUpQuestionsProps {
  questions: FollowUpQuestion[];
  disabled?: boolean;
  onSubmit: (answers: Record<string, string>) => void;
}

function initialAnswers(questions: FollowUpQuestion[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    if (q.defaultValue !== undefined) out[q.id] = q.defaultValue;
  }
  return out;
}

/** 質問を表示順にまとめる（group を持つ連続した質問は1つのブロック） */
function blocks(
  questions: FollowUpQuestion[]
): { group?: string; items: FollowUpQuestion[] }[] {
  const out: { group?: string; items: FollowUpQuestion[] }[] = [];
  for (const q of questions) {
    const last = out[out.length - 1];
    if (q.group && last && last.group === q.group) last.items.push(q);
    else out.push({ group: q.group, items: [q] });
  }
  return out;
}

/**
 * 追加確認質問の表示（質問の定義・入力形式はドメインから受け取る）。
 * - choice: 大きな選択ボタン
 * - count:  大きな +/- ステッパー（既定値はドメインが指定）
 * - text:   任意入力（FEN / 棋譜など上級者向け）
 * 必須の質問すべてに回答したら再評価できる。判断ロジックは持たない。
 */
export function FollowUpQuestions({
  questions,
  disabled,
  onSubmit,
}: FollowUpQuestionsProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    initialAnswers(questions)
  );
  const allAnswered = questions.every(
    (q) => q.optional || (answers[q.id] !== undefined && answers[q.id] !== "")
  );
  const set = (id: string, value: string) =>
    setAnswers((prev) => ({ ...prev, [id]: value }));

  const renderQuestion = (q: FollowUpQuestion) => {
    const input = q.input ?? "choice";

    if (input === "count") {
      const value = Number(answers[q.id] ?? q.defaultValue ?? "0");
      const min = q.min ?? 0;
      const max = q.max ?? 99;
      return (
        <div key={q.id} className="flex items-center justify-between gap-2">
          <span className="font-semibold" id={`${q.id}-label`}>
            {q.label}
          </span>
          <div
            className="flex items-center gap-2"
            role="group"
            aria-labelledby={`${q.id}-label`}
          >
            <button
              type="button"
              aria-label={`${q.label}を減らす`}
              disabled={disabled || value <= min}
              onClick={() => set(q.id, String(Math.max(min, value - 1)))}
              className="min-h-12 min-w-12 rounded-lg border-2 border-gray-300 text-2xl font-bold disabled:opacity-40"
            >
              −
            </button>
            <output
              aria-live="polite"
              className="w-8 text-center text-xl font-bold"
            >
              {value}
            </output>
            <button
              type="button"
              aria-label={`${q.label}を増やす`}
              disabled={disabled || value >= max}
              onClick={() => set(q.id, String(Math.min(max, value + 1)))}
              className="min-h-12 min-w-12 rounded-lg border-2 border-gray-300 text-2xl font-bold disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      );
    }

    if (input === "text") {
      return (
        <details
          key={q.id}
          open={!q.optional}
          className="rounded-lg border border-gray-200 p-3"
        >
          <summary className="min-h-11 cursor-pointer font-semibold">
            {q.label}
          </summary>
          {q.help && <p className="text-sm text-gray-600 my-2">{q.help}</p>}
          <textarea
            value={answers[q.id] ?? ""}
            disabled={disabled}
            placeholder={q.placeholder}
            onChange={(e) => set(q.id, e.target.value)}
            aria-label={q.label}
            spellCheck={false}
            autoCapitalize="off"
            className="mt-2 w-full h-24 px-3 py-2 font-mono text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </details>
      );
    }

    return (
      <fieldset key={q.id}>
        <legend className="font-semibold mb-1">{q.label}</legend>
        {q.help && <p className="text-sm text-gray-600 mb-2">{q.help}</p>}
        <div
          className={`grid gap-2 ${q.options.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}
        >
          {q.options.map((opt) => {
            const selected = answers[q.id] === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => set(q.id, opt.value)}
                className={`min-h-14 px-4 py-3 rounded-lg border-2 text-left font-semibold ${
                  selected
                    ? "border-blue-600 bg-blue-50 text-blue-900"
                    : "border-gray-200 bg-white hover:border-blue-400"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  };

  return (
    <div className="space-y-6">
      {blocks(questions).map((b, i) =>
        b.group ? (
          <section
            key={`${b.group}-${i}`}
            aria-label={b.group}
            className="rounded-lg bg-gray-50 p-3 space-y-2"
          >
            <h3 className="font-bold">{b.group}</h3>
            {b.items.map(renderQuestion)}
          </section>
        ) : (
          b.items.map(renderQuestion)
        )
      )}
      <button
        type="button"
        disabled={!allAnswered || disabled}
        onClick={() => onSubmit(answers)}
        className="w-full min-h-14 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-semibold"
      >
        回答して再評価
      </button>
    </div>
  );
}
