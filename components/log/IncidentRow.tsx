import type { PlayerColor } from "@/lib/domain/entities";
import {
  decisionOf,
  type IncidentLogEntry,
} from "@/lib/domain/services/penalty-history";
import {
  COLOR_LABELS,
  STATUS_CLASSNAMES,
  STATUS_LABELS,
  categoryLabel,
  formatDate,
  formatTime,
  gameLabel,
  penaltyLabel,
} from "@/lib/application/incident-labels";
import { IllegalMoveBadge } from "./PenaltyHistoryPanel";

interface IncidentRowProps {
  entry: IncidentLogEntry;
  /** この対局での違法手回数（IncidentCounter） */
  illegalMoveCounts?: Record<PlayerColor, number>;
  onSelect: (incidentId: string) => void;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function IncidentRow({
  entry,
  illegalMoveCounts,
  onSelect,
}: IncidentRowProps) {
  const { incident, game } = entry;
  const decision = decisionOf(entry);
  const color = incident.playerColor;
  const penalties = decision?.penalties ?? [];
  // 違法手の Incident には、その対局・その色の現在の違法手回数を表示する
  const badgeColor =
    incident.category === "illegal-move" && illegalMoveCounts
      ? color
      : undefined;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(incident.id)}
        aria-haspopup="dialog"
        data-incident-id={incident.id}
        className="w-full min-h-12 text-left bg-white rounded-lg shadow hover:shadow-md p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-semibold text-gray-900">
              {game ? gameLabel(game) : "対局不明"}
            </span>
            {color && (
              <span className="px-2 py-0.5 text-xs font-semibold rounded border border-gray-300">
                {COLOR_LABELS[color]}
              </span>
            )}
            <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs font-semibold rounded">
              {categoryLabel(incident.category)}
            </span>
            <span
              className={`px-2 py-0.5 text-xs font-semibold rounded ${STATUS_CLASSNAMES[incident.status]}`}
            >
              {STATUS_LABELS[incident.status]}
            </span>
          </div>
          <span className="text-right text-xs text-gray-500 shrink-0">
            <time dateTime={incident.reportedAt.toISOString()}>
              {formatDate(incident.reportedAt)}
              <br />
              {formatTime(incident.reportedAt)}
            </time>
          </span>
        </div>

        {decision ? (
          <p className="text-sm text-gray-800">
            <span className="font-semibold">推奨: </span>
            {truncate(decision.conclusion, 80)}
          </p>
        ) : (
          <p className="text-sm text-gray-500">判断支援なし</p>
        )}

        {incident.description && (
          <p className="text-sm text-gray-600 mt-1">
            {truncate(incident.description, 60)}
          </p>
        )}

        {(badgeColor !== undefined || penalties.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {badgeColor && illegalMoveCounts && (
              <IllegalMoveBadge
                color={badgeColor}
                count={illegalMoveCounts[badgeColor]}
              />
            )}
            {penalties.map((p, i) => (
              <span
                key={i}
                className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded"
              >
                {penaltyLabel(p.type)}: {p.description}
              </span>
            ))}
          </div>
        )}
      </button>
    </li>
  );
}
