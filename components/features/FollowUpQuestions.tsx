"use client";

import { useState } from "react";
import type { FollowUpQuestion } from "@/lib/domain/follow-up";

interface FollowUpQuestionsProps {
  questions: FollowUpQuestion[];
  disabled?: boolean;
  onSubmit: (answers: Record<string, string>) => void;
}

/**
 * 追加確認質問の表示（質問の定義はドメインから受け取る）。
 * すべての質問に回答したら再評価できる。
 */
export function FollowUpQuestions({
  questions,
  disabled,
  onSubmit,
}: FollowUpQuestionsProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const allAnswered = questions.every((q) => answers[q.id] !== undefined);

  return (
    <div className="space-y-6">
      {questions.map((q) => (
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
                  onClick={() =>
                    setAnswers((prev) => ({ ...prev, [q.id]: opt.value }))
                  }
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
      ))}
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
