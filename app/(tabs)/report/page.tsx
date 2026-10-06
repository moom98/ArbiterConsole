"use client";

import { useEffect, useState } from "react";
import { useIncidentStore } from "@/lib/stores/incident-store";
import { DecisionDisplay } from "@/components/features/DecisionDisplay";
import { FollowUpQuestions } from "@/components/features/FollowUpQuestions";
import type {
  CompetitionType,
  IncidentCategory,
  SupervisionRegime,
} from "@/lib/domain/entities";
import { QUESTIONS, type IncidentQuestionId } from "@/lib/domain/follow-up";
import {
  validateReportContext,
  type ReportContext,
} from "@/lib/domain/services/game-context";

const INCIDENT_CATEGORIES: Array<{
  value: IncidentCategory;
  label: string;
  icon: string;
}> = [
  { value: "illegal-move", label: "違法手", icon: "⚠️" },
  { value: "clock-time", label: "時計/時間", icon: "⏰" },
  { value: "draw", label: "ドロー", icon: "🤝" },
  { value: "board-piece", label: "盤面/駒", icon: "♟️" },
  { value: "scoresheet", label: "記録用紙", icon: "📝" },
  { value: "player-behavior", label: "プレイヤー行動", icon: "🙋" },
  { value: "game-result", label: "ゲーム結果", icon: "🏁" },
  { value: "team", label: "団体戦", icon: "👥" },
  { value: "fair-play", label: "フェアプレー", icon: "🛡️" },
  { value: "tournament-admin", label: "大会運営", icon: "📋" },
];

const RULES_VERSION_OPTIONS = [
  { value: "FIDE-2023", label: "FIDE Laws of Chess 2023" },
] as const;

type Step = "context" | "category" | "description" | "result";

type ContextDraft = Partial<ReportContext>;

function optionLabel(
  questionId: "competitionType" | "supervisionRegime",
  value: string | undefined
): string {
  return (
    QUESTIONS[questionId].options.find((o) => o.value === value)?.label ?? ""
  );
}

export default function ReportPage() {
  const [step, setStep] = useState<Step>("context");
  const [selectedCategory, setSelectedCategory] =
    useState<IncidentCategory | null>(null);
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<ContextDraft>({});

  const {
    currentDecision,
    followUpQuestions,
    isProcessing,
    error,
    lastContext,
    loadLastContext,
    submitIncident,
    answerFollowUp,
    reset,
  } = useIncidentStore();

  // 前回の判断を必ずクリアし、前回のコンテキストを読み込む
  useEffect(() => {
    reset();
    void loadLastContext();
  }, [reset, loadLastContext]);

  // 前回のコンテキストで初期化（ユーザーが未入力の場合のみ）
  useEffect(() => {
    if (lastContext) {
      setDraft((d) => (Object.keys(d).length === 0 ? { ...lastContext } : d));
    }
  }, [lastContext]);

  const contextErrors = validateReportContext(draft);
  const needsRegime =
    draft.competitionType !== undefined && draft.competitionType !== "standard";

  const handleCategorySelect = (category: IncidentCategory) => {
    setSelectedCategory(category);
    setStep("description");
  };

  // 違法手は構造化された追加質問で判断するため、説明は任意
  const descriptionRequired = selectedCategory !== "illegal-move";

  const handleSubmit = async () => {
    if (!selectedCategory || contextErrors.length > 0) return;
    if (descriptionRequired && !description.trim()) return;

    const res = await submitIncident({
      context: draft as ReportContext,
      category: selectedCategory,
      description,
      arbiterObserved: true,
    });
    if (res.ok) setStep("result");
  };

  const handleAnswers = async (answers: Record<string, string>) => {
    await answerFollowUp(
      answers as Partial<Record<IncidentQuestionId, string>>
    );
  };

  // 新しい報告では毎回、対局（ラウンド・ボード）を確認させる（前回値は初期値として表示）
  const handleReset = () => {
    setStep("context");
    setSelectedCategory(null);
    setDescription("");
    reset();
  };

  const incidentQuestions = followUpQuestions.filter(
    (q) => q.scope === "incident"
  );
  const contextQuestions = followUpQuestions.filter(
    (q) => q.scope === "game-context"
  );

  const contextSummary =
    contextErrors.length === 0
      ? [
          optionLabel("competitionType", draft.competitionType),
          needsRegime
            ? optionLabel("supervisionRegime", draft.supervisionRegime)
            : null,
          `R${draft.round}`,
          `Board ${draft.boardNumber}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">インシデント報告</h1>

      {step !== "context" && contextSummary && (
        <div className="mb-4 flex items-center justify-between gap-2 p-3 bg-gray-50 rounded-lg">
          <span className="text-sm font-semibold">{contextSummary}</span>
          {step !== "result" && (
            <button
              onClick={() => setStep("context")}
              className="min-h-11 px-3 text-sm text-blue-600 hover:underline"
            >
              変更
            </button>
          )}
        </div>
      )}

      {/* Game context */}
      {step === "context" && (
        <div className="space-y-5">
          <p className="text-gray-600">
            {lastContext
              ? "対局を確認してください（前回の値を表示しています。ラウンド・ボードが正しいか確認）"
              : "対局を指定してください"}
          </p>

          <fieldset>
            <legend className="font-semibold mb-2">
              {QUESTIONS.competitionType.label}
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {QUESTIONS.competitionType.options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={draft.competitionType === opt.value}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      competitionType: opt.value as CompetitionType,
                    }))
                  }
                  className={`min-h-14 rounded-lg border-2 font-semibold ${
                    draft.competitionType === opt.value
                      ? "border-blue-600 bg-blue-50"
                      : "border-gray-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          {needsRegime && (
            <fieldset>
              <legend className="font-semibold mb-2">
                {QUESTIONS.supervisionRegime.label}
              </legend>
              <div className="grid grid-cols-1 gap-2">
                {QUESTIONS.supervisionRegime.options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={draft.supervisionRegime === opt.value}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        supervisionRegime: opt.value as SupervisionRegime,
                      }))
                    }
                    className={`min-h-14 px-4 rounded-lg border-2 text-left font-semibold ${
                      draft.supervisionRegime === opt.value
                        ? "border-blue-600 bg-blue-50"
                        : "border-gray-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="font-semibold mb-2">規則バージョン</legend>
            <div className="grid grid-cols-1 gap-2">
              {RULES_VERSION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={draft.rulesVersion === opt.value}
                  onClick={() =>
                    setDraft((d) => ({ ...d, rulesVersion: opt.value }))
                  }
                  className={`min-h-14 px-4 rounded-lg border-2 text-left font-semibold ${
                    draft.rulesVersion === opt.value
                      ? "border-blue-600 bg-blue-50"
                      : "border-gray-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["round", "ラウンド"],
                ["boardNumber", "ボード"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="block font-semibold mb-2">{label}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={draft[key] ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      [key]:
                        e.target.value === ""
                          ? undefined
                          : Number(e.target.value),
                    }))
                  }
                  className="w-full min-h-14 px-4 text-lg border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            ))}
          </div>

          {contextErrors.length > 0 && Object.keys(draft).length > 0 && (
            <ul className="text-sm text-red-700 list-disc ml-5">
              {contextErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <button
            type="button"
            disabled={contextErrors.length > 0}
            onClick={() =>
              setStep(selectedCategory ? "description" : "category")
            }
            className="w-full min-h-14 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-semibold"
          >
            この対局で報告
          </button>
        </div>
      )}

      {/* Category Selection */}
      {step === "category" && (
        <div>
          <p className="text-gray-600 mb-4">
            発生したインシデントのカテゴリを選択してください
          </p>
          <div className="grid grid-cols-2 gap-3">
            {INCIDENT_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => handleCategorySelect(cat.value)}
                className="p-4 min-h-20 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left"
              >
                <div className="text-2xl mb-2">{cat.icon}</div>
                <div className="font-semibold">{cat.label}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Description Input */}
      {step === "description" && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {
                INCIDENT_CATEGORIES.find((c) => c.value === selectedCategory)
                  ?.label
              }
            </h2>
            <button
              onClick={() => setStep("category")}
              className="min-h-11 px-3 text-sm text-blue-600 hover:underline"
            >
              カテゴリを変更
            </button>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-semibold mb-2">
              {descriptionRequired ? "状況の説明" : "メモ（任意）"}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例: Nf3 の後、キングがチェックのまま"
              className="w-full h-28 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {!descriptionRequired && (
              <p className="text-sm text-gray-500 mt-2">
                判断に必要な事実は、次の画面で質問に回答して指定します。
              </p>
            )}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep("category")}
              className="min-h-14 px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              戻る
            </button>
            <button
              onClick={handleSubmit}
              disabled={
                (descriptionRequired && !description.trim()) || isProcessing
              }
              className="flex-1 min-h-14 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-semibold"
            >
              {isProcessing ? "処理中..." : "判断支援を表示"}
            </button>
          </div>
        </div>
      )}

      {/* Result / Follow-up */}
      {step === "result" && currentDecision && (
        <div>
          {followUpQuestions.length > 0 ? (
            <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
              <p className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-900">
                これは判断支援です。最終的な裁定はアービターが行ってください。
              </p>
              <h2 className="text-xl font-bold mb-2">追加確認</h2>
              <p className="mb-4 whitespace-pre-line">
                {currentDecision.conclusion}
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {error}
                </div>
              )}

              {incidentQuestions.length > 0 && (
                <FollowUpQuestions
                  key={incidentQuestions.map((q) => q.id).join("|")}
                  questions={incidentQuestions}
                  disabled={isProcessing}
                  onSubmit={handleAnswers}
                />
              )}

              {contextQuestions.length > 0 && (
                <div className="space-y-3">
                  <ul className="list-disc ml-5">
                    {currentDecision.missingFields?.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <button
                    onClick={() => setStep("context")}
                    className="w-full min-h-14 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold"
                  >
                    対局の設定を確認する
                  </button>
                </div>
              )}
            </div>
          ) : (
            <DecisionDisplay decision={currentDecision} />
          )}
          <button
            onClick={handleReset}
            className="w-full mt-4 min-h-14 px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            新しいインシデントを報告
          </button>
        </div>
      )}

      {/* Processing State */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-lg font-semibold">判断支援を準備中...</p>
          </div>
        </div>
      )}
    </div>
  );
}
