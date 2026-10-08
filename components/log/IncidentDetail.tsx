import { useEffect, useRef } from "react";
import type { Decision } from "@/lib/domain/entities";
import {
  decisionOf,
  type IncidentLogEntry,
  type GamePenaltyHistory,
} from "@/lib/domain/services/penalty-history";
import {
  COLOR_LABELS,
  COMPETITION_TYPE_LABELS,
  DECISION_KIND_LABELS,
  REPORTED_BY_LABELS,
  STATUS_LABELS,
  categoryLabel,
  formatDateTime,
  gameLabel,
} from "@/lib/application/incident-labels";
import type { ExternalAiPreview } from "@/lib/domain/llm/types";
import { DecisionDisplay } from "@/components/features/DecisionDisplay";
import { ExternalAiSendConfirmation } from "@/components/features/ExternalAiSendConfirmation";
import { LlmAccessTokenField } from "@/components/features/LlmAccessTokenField";
import { PenaltyHistoryPanel } from "./PenaltyHistoryPanel";

/** 履歴から AI 参考情報を取得し直す操作（確認・再送は報告画面と同じ。D13） */
export interface IncidentDetailAiActions {
  /** この Incident について確認待ちの送信内容（まだ何も送っていない） */
  confirmation: ExternalAiPreview | null;
  busy: boolean;
  error: string | null;
  /** 再評価する（確認済みでなければ送らずに送信内容を示す） */
  onRetry: () => void;
  /** 示した送信内容を確認して送る */
  onConfirm: () => void;
}

interface IncidentDetailProps {
  entry: IncidentLogEntry;
  gameHistory: GamePenaltyHistory;
  onClose: () => void;
  ai?: IncidentDetailAiActions;
}

export function IncidentDetail({
  entry,
  gameHistory,
  onClose,
  ai,
}: IncidentDetailProps) {
  const { incident, game, tournament } = entry;
  const decision = decisionOf(entry);
  const rulesVersion = decision?.rulesVersion ?? tournament?.rulesVersion;

  const facts: Array<[string, string]> = [
    ["日時", formatDateTime(incident.reportedAt)],
    ["対局", game ? gameLabel(game) : "対局不明"],
    [
      "競技区分",
      tournament ? COMPETITION_TYPE_LABELS[tournament.competitionType] : "-",
    ],
    ["規則バージョン", rulesVersion ?? "-"],
    [
      "対象プレーヤー",
      incident.playerColor ? COLOR_LABELS[incident.playerColor] : "-",
    ],
    ["カテゴリ", categoryLabel(incident.category)],
    ["ステータス", STATUS_LABELS[incident.status]],
    ["報告者", REPORTED_BY_LABELS[incident.reportedBy] ?? incident.reportedBy],
    ["アービター直接観察", incident.arbiterObserved ? "はい" : "いいえ"],
  ];
  if (decision?.kind) {
    facts.push(["判断種別", DECISION_KIND_LABELS[decision.kind]]);
  }

  return (
    <div>
      <dl className="mb-4 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-500">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      {incident.description && (
        <div className="mb-4">
          <h3 className="font-semibold mb-1">メモ</h3>
          <p className="text-gray-700 whitespace-pre-wrap">
            {incident.description}
          </p>
        </div>
      )}

      {game && (
        <PenaltyHistoryPanel title={gameLabel(game)} history={gameHistory} />
      )}

      {decision ? (
        <>
          {ai && <AiActions status={decision.llm} ai={ai} />}
          <DecisionDisplay
            decision={decision}
            onClose={onClose}
            onRetry={ai?.onRetry}
            retrying={ai?.busy}
          />
        </>
      ) : (
        <p className="text-center py-6 text-gray-500">
          このインシデントの判断支援はまだ生成されていません（追加質問待ちなど）。
        </p>
      )}
    </div>
  );
}

/** 確認待ち（awaiting-confirmation）の判断で、送信内容の確認を始める・確認する */
function AiActions({
  status,
  ai,
}: {
  status: Decision["llm"];
  ai: IncidentDetailAiActions;
}) {
  // 送信内容が出たら、確認ボタンまで見えるようにする（スマホでは詳細の下の方にあるため）
  const regionRef = useRef<HTMLDivElement>(null);
  const hasConfirmation = ai.confirmation !== null;
  useEffect(() => {
    if (hasConfirmation)
      regionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [hasConfirmation]);

  return (
    <div ref={regionRef} className="mb-4 space-y-3">
      {ai.error && (
        <p role="alert" className="p-3 rounded bg-red-50 text-red-800 text-sm">
          {ai.error}
        </p>
      )}
      {ai.confirmation ? (
        <ExternalAiSendConfirmation
          preview={ai.confirmation}
          onConfirm={ai.onConfirm}
          disabled={ai.busy}
          confirmLabel="確認してAI参考情報を取得"
        />
      ) : (
        status?.status === "awaiting-confirmation" && (
          <button
            type="button"
            onClick={ai.onRetry}
            disabled={ai.busy}
            className="w-full min-h-12 px-4 bg-amber-600 text-white rounded-lg font-semibold disabled:bg-gray-300"
          >
            {ai.busy ? "準備中..." : "外部AIへ送る内容を確認する"}
          </button>
        )
      )}
      {/* 保存後の再取得: 同じ内容を確認済みならそのまま送り、そうでなければ送信内容の確認から */}
      {status?.errorCode === "unauthorized" && (
        <LlmAccessTokenField onSaved={ai.onRetry} />
      )}
    </div>
  );
}
