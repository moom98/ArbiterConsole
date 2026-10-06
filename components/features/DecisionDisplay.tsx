import type { Decision } from "@/lib/domain/entities";
import { useState } from "react";

interface DecisionDisplayProps {
  decision: Decision;
  onClose?: () => void;
}

export function DecisionDisplay({
  decision,
  onClose,
}: DecisionDisplayProps) {
  const [showSources, setShowSources] = useState(false);

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold">裁定結果</h2>
          <div className="flex gap-2">
            <span
              className={`px-3 py-1 rounded text-xs font-semibold ${
                decision.confidence === "high"
                  ? "bg-green-100 text-green-800"
                  : decision.confidence === "medium"
                    ? "bg-yellow-100 text-yellow-800"
                    : "bg-red-100 text-red-800"
              }`}
            >
              信頼度: {decision.confidence === "high" ? "高" : decision.confidence === "medium" ? "中" : "低"}
            </span>
            <span className="px-3 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800">
              {decision.generatedBy === "decision-tree"
                ? "Decision Tree"
                : "LLM"}
            </span>
          </div>
        </div>
      </div>

      {/* Escalation Warning */}
      {decision.escalationRecommended && (
        <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 rounded">
          <div className="flex items-start">
            <svg
              className="w-6 h-6 text-red-500 mr-3 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="font-semibold text-red-800">CA相談推奨</p>
              {decision.escalationReason && (
                <p className="text-sm text-red-700 mt-1">
                  {decision.escalationReason}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Conclusion */}
      <div className="mb-6">
        <h3 className="font-semibold mb-2 text-gray-700">結論</h3>
        <p className="text-lg">{decision.conclusion}</p>
      </div>

      {/* Actions */}
      <div className="mb-6">
        <h3 className="font-semibold mb-3 text-gray-700">今すぐ行うこと</h3>
        <div className="space-y-2">
          {decision.actions.map((action, index) => (
            <div key={index} className="flex items-start">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-800 text-sm font-semibold mr-3 flex-shrink-0">
                {index + 1}
              </span>
              <p className="pt-0.5">{action}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Intervention Type */}
      <div className="mb-6">
        <h3 className="font-semibold mb-2 text-gray-700">介入タイプ</h3>
        <span
          className={`inline-block px-3 py-1 rounded ${
            decision.intervention === "immediate"
              ? "bg-red-100 text-red-800"
              : decision.intervention === "wait-for-claim"
                ? "bg-yellow-100 text-yellow-800"
                : "bg-gray-100 text-gray-800"
          }`}
        >
          {decision.intervention === "immediate"
            ? "即座に介入"
            : decision.intervention === "wait-for-claim"
              ? "クレーム待ち"
              : "CA相談"}
        </span>
      </div>

      {/* Penalties */}
      {decision.penalties.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-3 text-gray-700">ペナルティ</h3>
          <div className="space-y-2">
            {decision.penalties.map((penalty, index) => (
              <div
                key={index}
                className="p-3 bg-orange-50 border border-orange-200 rounded"
              >
                <p className="font-semibold text-orange-900">
                  {penalty.type === "time-addition-opponent"
                    ? "相手に時間追加"
                    : penalty.type === "time-deduction-player"
                      ? "時間減少"
                      : penalty.type === "game-loss"
                        ? "ゲーム負け"
                        : penalty.type === "warning"
                          ? "警告"
                          : penalty.type}
                </p>
                <p className="text-sm text-orange-800 mt-1">
                  {penalty.description}
                </p>
                {penalty.timeAdjustmentSeconds && (
                  <p className="text-sm text-orange-700 mt-1">
                    時間調整: {penalty.timeAdjustmentSeconds}秒
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sources */}
      <div className="mb-6">
        <button
          onClick={() => setShowSources(!showSources)}
          className="flex items-center justify-between w-full p-3 bg-gray-50 hover:bg-gray-100 rounded"
        >
          <h3 className="font-semibold text-gray-700">
            根拠となる規則 ({decision.sources.length}件)
          </h3>
          <svg
            className={`w-5 h-5 transition-transform ${showSources ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        {showSources && (
          <div className="mt-3 space-y-3">
            {decision.sources.map((source, index) => (
              <div
                key={index}
                className="p-3 border border-gray-200 rounded"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-blue-900">
                    {source.article}
                  </span>
                  <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded">
                    {source.source}
                  </span>
                </div>
                {source.text && (
                  <p className="text-sm text-gray-700">{source.text}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      {onClose && (
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
          >
            確認
          </button>
        </div>
      )}
    </div>
  );
}
