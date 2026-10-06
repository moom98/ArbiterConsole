"use client";

import { useState } from "react";
import { hybridSearch } from "@/lib/infrastructure/ai";
import type { ScoredRule } from "@/lib/infrastructure/ai";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScoredRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const searchResults = await hybridSearch(query, {
        limit: 10,
        vectorWeight: 0.6,
        fulltextWeight: 0.4,
        minScore: 0.3,
      });

      setResults(searchResults);
    } catch (err) {
      console.error("Search error:", err);
      setError(
        "検索中にエラーが発生しました。ルールデータが登録されているか確認してください。"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">ルール検索</h1>

      <div className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例: 違法手の処理、時間切れ、ドロー..."
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSearch();
              }
            }}
          />
          <button
            onClick={handleSearch}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            検索
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">検索中...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {!loading && !error && results.length === 0 && (
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
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <p>検索キーワードを入力してください</p>
          <p className="text-sm mt-2">
            FIDE Laws of Chess、JCF規則、大会特別規定から検索します
          </p>
        </div>
      )}

      {!loading && !error && results.length > 0 && (
        <div className="space-y-4">
          {results.map((result, index) => (
            <div key={index} className="bg-white rounded-lg shadow p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold">{result.rule.article}</h3>
                  <p className="text-sm text-gray-600">{result.rule.title}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    {result.rule.source}
                  </span>
                  <span className="text-xs text-gray-500">
                    Score: {result.score.toFixed(2)}
                  </span>
                </div>
              </div>
              <p className="text-sm text-gray-700 mt-2">
                {result.rule.content.substring(0, 200)}
                {result.rule.content.length > 200 && "..."}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
