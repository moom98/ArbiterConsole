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
import { DecisionDisplay } from "@/components/features/DecisionDisplay";
import { PenaltyHistoryPanel } from "./PenaltyHistoryPanel";

interface IncidentDetailProps {
  entry: IncidentLogEntry;
  gameHistory: GamePenaltyHistory;
  onClose: () => void;
}

export function IncidentDetail({
  entry,
  gameHistory,
  onClose,
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
        <DecisionDisplay decision={decision} onClose={onClose} />
      ) : (
        <p className="text-center py-6 text-gray-500">
          このインシデントの判断支援はまだ生成されていません（追加質問待ちなど）。
        </p>
      )}
    </div>
  );
}
