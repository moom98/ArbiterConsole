import type { PlayerColor } from "@/lib/domain/entities";
import type {
  GamePenaltyHistory,
  PenaltyHistoryItem,
} from "@/lib/domain/services/penalty-history";
import {
  COLOR_LABELS,
  formatTime,
  penaltyLabel,
} from "@/lib/application/incident-labels";

interface PenaltyHistoryPanelProps {
  title: string;
  history: GamePenaltyHistory;
}

/** 1件のペナルティ。違反者と、ペナルティが作用する側（対象）を明示する */
function PenaltyList({ items }: { items: PenaltyHistoryItem[] }) {
  return (
    <ul className="text-sm space-y-1">
      {items.map((p, i) => (
        <li key={`${p.incidentId}-${i}`}>
          <span className="text-gray-500 mr-2">{formatTime(p.reportedAt)}</span>
          {penaltyLabel(p.penalty.type)}
          {p.penalty.playerColor
            ? `（対象: ${COLOR_LABELS[p.penalty.playerColor]}）`
            : ""}
          : {p.penalty.description}
        </li>
      ))}
    </ul>
  );
}

/** 対局内の Penalty 履歴（違反者ごと）と違法手回数（要件 §25） */
export function PenaltyHistoryPanel({
  title,
  history,
}: PenaltyHistoryPanelProps) {
  return (
    <section
      aria-label={`${title} のPenalty履歴`}
      className="mb-4 bg-white rounded-lg shadow p-3"
    >
      <h2 className="font-semibold mb-2">{title} のPenalty履歴</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(["white", "black"] as const).map((color) => {
          const h = history[color];
          return (
            <div key={color} className="border border-gray-200 rounded p-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold">
                  {COLOR_LABELS[color]}の違反
                </span>
                <IllegalMoveBadge count={h.illegalMoveCount} />
              </div>
              {h.penalties.length === 0 ? (
                <p className="text-sm text-gray-500">推奨ペナルティなし</p>
              ) : (
                <PenaltyList items={h.penalties} />
              )}
            </div>
          );
        })}
      </div>
      {history.results.length > 0 && (
        <div className="mt-3 border border-gray-200 rounded p-2">
          <p className="font-semibold text-sm mb-1">対局結果</p>
          <PenaltyList items={history.results} />
        </div>
      )}
      {history.aiReference.length > 0 && (
        <div className="mt-3 border border-dashed border-amber-400 rounded p-2 bg-amber-50">
          <p className="font-semibold text-sm mb-1">
            AI参考（未確定）— 適用済みのペナルティではありません
          </p>
          <PenaltyList items={history.aiReference} />
        </div>
      )}
      {history.unknownOffender.length > 0 && (
        <div className="mt-3 border border-dashed border-gray-300 rounded p-2">
          <p className="font-semibold text-sm mb-1">違反者不明（旧データ）</p>
          <PenaltyList items={history.unknownOffender} />
        </div>
      )}
      <p className="mt-2 text-xs text-gray-500">
        違法手回数はアプリが推奨したペナルティ（相手への時間加算・負け）に基づきます。アービターの最終判断と異なる場合は記録を確認してください。違反者や判断ツリー（Decision
        Tree）が記録されていない旧データの判断は回数に含まれません。
      </p>
    </section>
  );
}

export function IllegalMoveBadge({
  count,
  color,
}: {
  count: number;
  color?: PlayerColor;
}) {
  const label = `${color ? COLOR_LABELS[color] + " " : ""}違法手 ${count}回`;
  return (
    <span
      className={`px-2 py-1 rounded text-xs font-semibold ${
        count >= 2
          ? "bg-red-100 text-red-800"
          : count === 1
            ? "bg-orange-100 text-orange-800"
            : "bg-gray-100 text-gray-700"
      }`}
    >
      {label}
    </span>
  );
}
