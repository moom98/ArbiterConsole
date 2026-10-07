"use client";

import type {
  Decision,
  InterventionType,
  LlmAssistStatus,
  PenaltyType,
} from "@/lib/domain/entities";
import { useState } from "react";

interface DecisionDisplayProps {
  decision: Decision;
  onClose?: () => void;
  /** AI 参考情報を再取得する（オフライン・取得失敗時のみ表示） */
  onRetry?: () => void;
  retrying?: boolean;
}

/** AI 参考情報を取得できなかった場合の表示（ADR-006） */
const LLM_UNAVAILABLE_LABELS: Partial<Record<LlmAssistStatus, string>> = {
  offline: "オフラインのためAI参考情報を取得していません（オンライン必須）",
  unavailable: "AI参考情報を取得できませんでした",
  "no-articles": "登録済みの規則に関連する条文が見つかりませんでした",
};

const PENALTY_LABELS: Record<PenaltyType, string> = {
  warning: "警告",
  "time-addition-opponent": "相手に時間追加",
  "time-deduction-player": "違反者の時間減少",
  "game-loss": "負け",
  "both-lose": "両者負け",
  expulsion: "除外・退場",
  draw: "ドロー",
};

const INTERVENTION_LABELS: Record<
  InterventionType,
  { label: string; className: string }
> = {
  immediate: { label: "今すぐ介入", className: "bg-red-100 text-red-800" },
  "wait-for-claim": {
    label: "PlayerのClaimを待つ",
    className: "bg-yellow-100 text-yellow-800",
  },
  "wait-next-move": {
    label: "次の手の完了を待つ",
    className: "bg-yellow-100 text-yellow-800",
  },
  "consult-ca": { label: "CAへ確認", className: "bg-gray-100 text-gray-800" },
  "no-intervention": {
    label: "違法手としての介入なし",
    className: "bg-green-100 text-green-800",
  },
};

const CONFIDENCE_LABELS = { high: "高", medium: "中", low: "低" } as const;

function formatSeconds(seconds: number): string {
  const sign = seconds < 0 ? "-" : "+";
  const abs = Math.abs(seconds);
  if (abs % 60 === 0) return `${sign}${abs / 60}分`;
  return `${sign}${abs}秒`;
}

export function DecisionDisplay({
  decision,
  onClose,
  onRetry,
  retrying,
}: DecisionDisplayProps) {
  const isLlm = decision.generatedBy === "llm";
  // AI 参考情報は根拠の原文確認が前提のため、引用を最初から展開する
  const [showSources, setShowSources] = useState(isLlm);
  const intervention = INTERVENTION_LABELS[decision.intervention];
  const llmStatus = decision.llm?.status;
  const unavailableLabel = llmStatus
    ? LLM_UNAVAILABLE_LABELS[llmStatus]
    : undefined;
  const canRetry =
    onRetry !== undefined &&
    (llmStatus === "offline" || llmStatus === "unavailable");

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
      {/* Disclaimer (always visible) */}
      {isLlm ? (
        <div
          role="note"
          className="mb-4 p-3 bg-amber-50 border-2 border-amber-400 rounded text-sm text-amber-950"
        >
          <p className="font-semibold">AI参考情報です（裁定ではありません）</p>
          <p className="mt-1">
            AIが登録済みの規則から作成した参考情報です。誤りを含む可能性があります。
            必ず下の根拠条文の原文を確認し、最終的な裁定はアービター（必要に応じてCA）が行ってください。
          </p>
        </div>
      ) : (
        <div
          role="note"
          className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-900"
        >
          これは判断支援です。最終的な裁定はアービターが行ってください。
        </div>
      )}

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">判断支援（推奨）</h2>
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
            信頼度: {CONFIDENCE_LABELS[decision.confidence]}
          </span>
          {isLlm ? (
            <>
              <span className="px-3 py-1 rounded text-xs font-semibold bg-amber-200 text-amber-950">
                AI参考
              </span>
              <span
                className={`px-3 py-1 rounded text-xs font-semibold ${
                  decision.validationPassed
                    ? "bg-green-100 text-green-800"
                    : "bg-red-100 text-red-800"
                }`}
              >
                {decision.validationPassed
                  ? "根拠検証: 合格"
                  : "根拠検証: 不合格"}
              </span>
            </>
          ) : (
            <span className="px-3 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800">
              Decision Tree
            </span>
          )}
        </div>
      </div>

      {/* AI 参考情報を取得できなかった（オフライン等） */}
      {unavailableLabel && (
        <div
          role="status"
          className="mb-4 p-3 bg-gray-50 border border-gray-300 rounded text-sm text-gray-800"
        >
          <p className="font-semibold">{unavailableLabel}</p>
          {llmStatus === "unavailable" && decision.llm?.message && (
            <p className="mt-1 text-gray-600">{decision.llm.message}</p>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="mt-2 w-full min-h-12 px-4 bg-gray-800 text-white rounded-lg font-semibold disabled:bg-gray-300"
            >
              {retrying ? "取得中..." : "AI参考情報を再取得"}
            </button>
          )}
        </div>
      )}

      {/* Escalation Warning */}
      {decision.escalationRecommended && (
        <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 rounded">
          <p className="font-semibold text-red-800">CAへ確認してください</p>
          {decision.escalationReason && (
            <p className="text-sm text-red-700 mt-1">
              {decision.escalationReason}
            </p>
          )}
        </div>
      )}

      {/* Conclusion */}
      <div className="mb-4">
        <h3 className="font-semibold mb-2 text-gray-700">推奨される結論</h3>
        <p className="text-lg">{decision.conclusion}</p>
      </div>

      {/* Article IDs up front */}
      {decision.sources.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2" aria-label="根拠条文">
          {decision.sources.map((s, i) => (
            <span
              key={i}
              className="px-2 py-1 text-xs font-semibold rounded bg-gray-100 text-gray-800"
            >
              {s.article}
            </span>
          ))}
        </div>
      )}

      {/* Missing fields */}
      {decision.missingFields && decision.missingFields.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-2 text-gray-700">不足している情報</h3>
          <ul className="list-disc ml-5 space-y-1">
            {decision.missingFields.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      {decision.actions.length > 0 && !decision.missingFields?.length && (
        <div className="mb-6">
          <h3 className="font-semibold mb-3 text-gray-700">今すぐ行うこと</h3>
          <ol className="space-y-2">
            {decision.actions.map((action, index) => (
              <li key={index} className="flex items-start">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-800 text-sm font-semibold mr-3 flex-shrink-0">
                  {index + 1}
                </span>
                <p className="pt-0.5">{action}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Intervention Type */}
      <div className="mb-6">
        <h3 className="font-semibold mb-2 text-gray-700">介入</h3>
        <span
          className={`inline-block px-3 py-1 rounded ${intervention.className}`}
        >
          {intervention.label}
        </span>
      </div>

      {/* Penalties */}
      {decision.penalties.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-3 text-gray-700">
            推奨されるペナルティ・結果
          </h3>
          <div className="space-y-2">
            {decision.penalties.map((penalty, index) => (
              <div
                key={index}
                className="p-3 bg-orange-50 border border-orange-200 rounded"
              >
                <p className="font-semibold text-orange-900">
                  {PENALTY_LABELS[penalty.type] ?? penalty.type}
                </p>
                <p className="text-sm text-orange-800 mt-1">
                  {penalty.description}
                </p>
                {penalty.timeAdjustmentSeconds !== undefined &&
                  penalty.timeAdjustmentSeconds !== 0 && (
                    <p className="text-sm text-orange-700 mt-1">
                      時間調整: {formatSeconds(penalty.timeAdjustmentSeconds)}
                    </p>
                  )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Validation errors */}
      {!decision.validationPassed && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
          <p className="font-semibold">
            {isLlm
              ? "AIの出力が根拠の検証に失敗したため、採用しませんでした"
              : "根拠の検証に失敗しました"}
          </p>
          {decision.validationErrors?.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {/* Sources (full text collapsed) */}
      {decision.sources.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => setShowSources(!showSources)}
            aria-expanded={showSources}
            className="flex items-center justify-between w-full min-h-12 p-3 bg-gray-50 hover:bg-gray-100 rounded"
          >
            <span className="font-semibold text-gray-700">
              {`${isLlm ? "根拠の原文（登録規則と照合済み）" : "根拠の原文"} (${decision.sources.length}件)`}
            </span>
            <span aria-hidden>{showSources ? "▲" : "▼"}</span>
          </button>
          {showSources && (
            <div className="mt-3 space-y-3">
              {decision.sources.map((source, index) => (
                <div key={index} className="p-3 border border-gray-200 rounded">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span className="font-semibold text-blue-900">
                      {source.article}
                    </span>
                    <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded">
                      {source.source}
                    </span>
                  </div>
                  {source.edition && (
                    <p className="text-xs text-gray-500">{source.edition}</p>
                  )}
                  {source.page !== undefined && (
                    <p className="text-xs text-gray-500 mb-2">
                      {source.pageDocument ?? source.edition} p.{source.page}
                    </p>
                  )}
                  {source.text ? (
                    <p className="text-sm text-gray-700">{source.text}</p>
                  ) : (
                    <p className="text-sm text-gray-500">（原文未登録）</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI 参考情報のメタ情報 */}
      {isLlm && (decision.llm?.model || decision.llm?.message) && (
        <p className="mb-4 text-xs text-gray-500">
          {decision.llm?.model && <>モデル: {decision.llm.model}</>}
          {decision.llm?.message && (
            <span className="block">{decision.llm.message}</span>
          )}
        </p>
      )}

      {onClose && (
        <button
          onClick={onClose}
          className="w-full min-h-12 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
        >
          確認
        </button>
      )}
    </div>
  );
}
