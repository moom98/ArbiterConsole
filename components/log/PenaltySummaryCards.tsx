import type { PenaltySummary } from "@/lib/domain/services/penalty-history";

interface PenaltySummaryCardsProps {
  summary: PenaltySummary;
  /** フィルタ適用中か（見出しに反映） */
  filtered: boolean;
}

/** 表示中（フィルタ後）の Incident に対する推奨ペナルティの集計 */
export function PenaltySummaryCards({
  summary,
  filtered,
}: PenaltySummaryCardsProps) {
  const cards: Array<{ label: string; value: number }> = [
    { label: "インシデント", value: summary.incidents },
    { label: "推奨ペナルティ", value: summary.penalties },
    { label: "警告", value: summary.warnings },
    { label: "時間調整", value: summary.timeAdjustments },
    { label: "負け", value: summary.gameLosses },
    { label: "対局結果", value: summary.results },
    { label: "うちドロー", value: summary.draws },
    { label: "除外・退場", value: summary.expulsions },
    { label: "CA確認", value: summary.escalations },
  ];
  return (
    <section aria-labelledby="log-summary-title" className="mb-4">
      <h2
        id="log-summary-title"
        className="text-sm font-semibold text-gray-700 mb-2"
      >
        集計（{filtered ? "絞り込み中" : "全件"}）
      </h2>
      <dl className="grid grid-cols-4 gap-2">
        {cards.map((c) => (
          <div
            key={c.label}
            className="bg-white rounded-lg shadow px-2 py-2 text-center"
          >
            <dt className="text-xs text-gray-600">{c.label}</dt>
            <dd className="text-xl font-bold">{c.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
