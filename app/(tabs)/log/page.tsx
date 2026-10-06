"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/infrastructure/db";
import type { Incident, Decision } from "@/lib/domain/entities";
import { DecisionDisplay } from "@/components/features/DecisionDisplay";

interface IncidentWithDecision {
  incident: Incident;
  decision?: Decision;
}

const CATEGORY_LABELS: Record<string, string> = {
  "illegal-move": "違法手",
  "clock-time": "時計/時間",
  draw: "ドロー",
  "board-piece": "盤面/駒",
  scoresheet: "記録用紙",
  "player-behavior": "プレイヤー行動",
  "game-result": "ゲーム結果",
  team: "団体戦",
  "fair-play": "フェアプレー",
  "tournament-admin": "大会運営",
};

export default function LogPage() {
  const [incidents, setIncidents] = useState<IncidentWithDecision[]>([]);
  const [filteredIncidents, setFilteredIncidents] = useState<
    IncidentWithDecision[]
  >([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedIncident, setSelectedIncident] =
    useState<IncidentWithDecision | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadIncidents();
  }, []);

  useEffect(() => {
    filterIncidents();
  }, [incidents, selectedCategory]);

  const loadIncidents = async () => {
    try {
      setLoading(true);
      const allIncidents = await db.incidents.toArray();

      // Load decisions for each incident
      const incidentsWithDecisions = await Promise.all(
        allIncidents.map(async (incident) => {
          const decision = incident.decisionId
            ? await db.decisions.get(incident.decisionId)
            : undefined;
          return { incident, decision };
        })
      );

      // Sort by most recent first
      incidentsWithDecisions.sort(
        (a, b) =>
          b.incident.reportedAt.getTime() - a.incident.reportedAt.getTime()
      );

      setIncidents(incidentsWithDecisions);
    } catch (error) {
      console.error("Failed to load incidents:", error);
    } finally {
      setLoading(false);
    }
  };

  const filterIncidents = () => {
    if (selectedCategory === "all") {
      setFilteredIncidents(incidents);
    } else {
      setFilteredIncidents(
        incidents.filter((i) => i.incident.category === selectedCategory)
      );
    }
  };

  const getPenaltySummary = () => {
    const summary = {
      total: 0,
      warnings: 0,
      timeAdjustments: 0,
      gameLosses: 0,
    };

    incidents.forEach(({ decision }) => {
      if (!decision) return;

      decision.penalties.forEach((penalty) => {
        summary.total++;
        switch (penalty.type) {
          case "warning":
            summary.warnings++;
            break;
          case "time-addition-opponent":
          case "time-deduction-player":
            summary.timeAdjustments++;
            break;
          case "game-loss":
          case "both-lose":
            summary.gameLosses++;
            break;
        }
      });
    });

    return summary;
  };

  const exportToCSV = () => {
    const headers = [
      "報告日時",
      "カテゴリ",
      "説明",
      "ステータス",
      "結論",
      "ペナルティ",
    ];

    const rows = incidents.map(({ incident, decision }) => [
      incident.reportedAt.toLocaleString("ja-JP"),
      CATEGORY_LABELS[incident.category] || incident.category,
      incident.description,
      incident.status === "resolved"
        ? "解決済"
        : incident.status === "escalated"
          ? "CA相談"
          : "保留中",
      decision?.conclusion || "-",
      decision?.penalties.map((p) => p.description).join("; ") || "-",
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `incidents_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  const penaltySummary = getPenaltySummary();

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">インシデント履歴</h1>
        {incidents.length > 0 && (
          <button
            onClick={exportToCSV}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-semibold"
          >
            CSV Export
          </button>
        )}
      </div>

      {/* Summary Stats */}
      {incidents.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600">総インシデント数</p>
            <p className="text-2xl font-bold">{incidents.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600">総ペナルティ数</p>
            <p className="text-2xl font-bold">{penaltySummary.total}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600">時間調整</p>
            <p className="text-2xl font-bold">
              {penaltySummary.timeAdjustments}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600">ゲーム負け</p>
            <p className="text-2xl font-bold">{penaltySummary.gameLosses}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      {incidents.length > 0 && (
        <div className="mb-6">
          <label className="block text-sm font-semibold mb-2">
            カテゴリでフィルタ
          </label>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full md:w-64 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">すべて ({incidents.length})</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => {
              const count = incidents.filter(
                (i) => i.incident.category === value
              ).length;
              return (
                <option key={value} value={value}>
                  {label} ({count})
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* Incident List */}
      {filteredIncidents.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p>
            {selectedCategory === "all"
              ? "インシデント履歴はまだありません"
              : "このカテゴリのインシデントはありません"}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredIncidents.map(({ incident, decision }) => (
            <div
              key={incident.id}
              className="bg-white rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setSelectedIncident({ incident, decision })}
            >
              <div className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded">
                        {CATEGORY_LABELS[incident.category] ||
                          incident.category}
                      </span>
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded ${
                          incident.status === "resolved"
                            ? "bg-green-100 text-green-800"
                            : incident.status === "escalated"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {incident.status === "resolved"
                          ? "解決済"
                          : incident.status === "escalated"
                            ? "CA相談"
                            : "保留中"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">
                      {incident.description.substring(0, 100)}
                      {incident.description.length > 100 && "..."}
                    </p>
                    {decision && (
                      <p className="text-sm font-semibold text-gray-800">
                        結論: {decision.conclusion.substring(0, 80)}
                        {decision.conclusion.length > 80 && "..."}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-sm text-gray-500 ml-4">
                    <p>{incident.reportedAt.toLocaleDateString("ja-JP")}</p>
                    <p>{incident.reportedAt.toLocaleTimeString("ja-JP")}</p>
                  </div>
                </div>

                {decision && decision.penalties.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {decision.penalties.map((penalty, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded"
                      >
                        {penalty.description}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Incident Detail Modal */}
      {selectedIncident && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">インシデント詳細</h2>
                <button
                  onClick={() => setSelectedIncident(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-semibold rounded">
                    {CATEGORY_LABELS[selectedIncident.incident.category] ||
                      selectedIncident.incident.category}
                  </span>
                  <span className="text-sm text-gray-600">
                    {selectedIncident.incident.reportedAt.toLocaleString(
                      "ja-JP"
                    )}
                  </span>
                </div>
                <h3 className="font-semibold mb-2">状況説明</h3>
                <p className="text-gray-700">
                  {selectedIncident.incident.description}
                </p>
              </div>

              {selectedIncident.decision && (
                <DecisionDisplay
                  decision={selectedIncident.decision}
                  onClose={() => setSelectedIncident(null)}
                />
              )}

              {!selectedIncident.decision && (
                <div className="text-center py-8 text-gray-500">
                  <p>このインシデントの裁定はまだ生成されていません。</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
