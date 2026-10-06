"use client";

import { useState } from "react";
import { useIncidentStore } from "@/lib/stores/incident-store";
import { DecisionDisplay } from "@/components/features/DecisionDisplay";
import type { IncidentCategory } from "@/lib/domain/entities";

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

export default function ReportPage() {
  const [step, setStep] = useState<"category" | "description" | "result">(
    "category"
  );
  const [selectedCategory, setSelectedCategory] =
    useState<IncidentCategory | null>(null);
  const [description, setDescription] = useState("");

  const {
    currentDecision,
    isProcessing,
    error,
    createIncident,
    clearCurrentIncident,
  } = useIncidentStore();

  const handleCategorySelect = (category: IncidentCategory) => {
    setSelectedCategory(category);
    setStep("description");
  };

  const handleSubmit = async () => {
    if (!selectedCategory || !description.trim()) {
      return;
    }

    // デモ用: 固定のgameIdを使用（実際にはゲーム選択UIが必要）
    const demoGameId = "demo-game-1";

    await createIncident(demoGameId, selectedCategory, description, true);
    setStep("result");
  };

  const handleReset = () => {
    setStep("category");
    setSelectedCategory(null);
    setDescription("");
    clearCurrentIncident();
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">インシデント報告</h1>

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
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left"
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
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">
                {
                  INCIDENT_CATEGORIES.find((c) => c.value === selectedCategory)
                    ?.label
                }
              </h2>
              <button
                onClick={() => setStep("category")}
                className="text-sm text-blue-600 hover:underline"
              >
                カテゴリを変更
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-semibold mb-2">
              状況の説明
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例: 白がナイトを違法な位置に移動し、時計を押しました。黒はまだ次の手を指していません。"
              className="w-full h-32 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-sm text-gray-500 mt-2">
              できるだけ詳しく状況を記載してください。特に以下の情報が重要です：
            </p>
            <ul className="text-sm text-gray-600 mt-1 ml-4 list-disc">
              <li>どちらのプレイヤーか（白/黒）</li>
              <li>時計を押したかどうか</li>
              <li>相手が次の手を指したかどうか</li>
            </ul>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep("category")}
              className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              戻る
            </button>
            <button
              onClick={handleSubmit}
              disabled={!description.trim() || isProcessing}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-semibold"
            >
              {isProcessing ? "処理中..." : "裁定を確認"}
            </button>
          </div>
        </div>
      )}

      {/* Result Display */}
      {step === "result" && currentDecision && (
        <div>
          <DecisionDisplay decision={currentDecision} />
          <button
            onClick={handleReset}
            className="w-full mt-4 px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
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
            <p className="text-lg font-semibold">裁定を生成中...</p>
          </div>
        </div>
      )}
    </div>
  );
}
