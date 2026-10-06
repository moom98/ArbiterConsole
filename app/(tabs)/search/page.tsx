"use client";

import { useRef, useState } from "react";
import type {
  HybridSearchResponse,
  RuleSearchResult,
} from "@/lib/infrastructure/ai";
import type { RuleSource, RuleSourceType } from "@/lib/domain/entities";

const SOURCE_LABEL: Record<RuleSourceType, string> = {
  tournament: "大会規定",
  JCF: "JCF",
  FIDE: "FIDE",
  commentary: "解説",
};

function formatDate(date?: Date): string | null {
  return date ? new Date(date).toLocaleDateString("ja-JP") : null;
}

function sourceLine(result: RuleSearchResult): string {
  const source = result.source;
  const parts = [
    source ? `${source.name}（${source.version}）` : "出典情報なし",
    result.rule.page ? `p.${result.rule.page}` : null,
  ];
  return parts.filter(Boolean).join(" ");
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<HybridSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RuleSearchResult | null>(null);
  const requestIdRef = useRef(0);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed || loading) {
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setSelected(null);

    try {
      const { hybridSearch } = await import("@/lib/infrastructure/ai");
      // 大会管理（Milestone 6）実装までは大会未選択。大会固有規定は対象外になる
      const searchResponse = await hybridSearch(trimmed, {
        tournamentId: undefined,
        limit: 10,
      });
      if (requestId !== requestIdRef.current) return;
      setResponse(searchResponse);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error("Search error:", err);
      setResponse(null);
      setError(
        "検索中にエラーが発生しました。ルールデータが登録されているか確認してください。"
      );
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  };

  if (selected) {
    return <ArticleDetail result={selected} onBack={() => setSelected(null)} />;
  }

  const results = response?.results ?? [];

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-4">ルール検索</h1>

      <form
        className="mb-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleSearch();
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例: 7.5.4、違法手、時計押し忘れ"
          className="flex-1 min-w-0 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="min-h-[48px] px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-400"
        >
          {loading ? "検索中" : "検索"}
        </button>
      </form>

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

      {!loading && !error && response === null && (
        <div className="text-center py-12 text-gray-500">
          <p>検索キーワードを入力してください</p>
          <p className="text-sm mt-2">
            条文番号・キーワード・自然文で、登録済みの FIDE Laws of Chess /
            JCF規則から検索します
          </p>
        </div>
      )}

      {!loading && !error && response !== null && (
        <>
          {response.failures.vector && (
            <p className="mb-3 text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg p-3">
              意味検索を利用できないため、キーワード一致の結果のみ表示しています
            </p>
          )}
          {response.failures.fulltext && (
            <p className="mb-3 text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg p-3">
              キーワード検索を利用できないため、意味検索の結果のみ表示しています
            </p>
          )}

          {results.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>該当する条文が見つかりませんでした</p>
              <p className="text-sm mt-2">
                別のキーワードや条文番号で検索してください
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {results.map((result) => (
                <li key={result.rule.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(result)}
                    className="w-full text-left bg-white rounded-lg shadow p-4 active:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-semibold">
                        {result.rule.article}
                        {result.rule.title && (
                          <span className="ml-2 font-normal text-gray-700">
                            {result.rule.title}
                          </span>
                        )}
                      </h3>
                      <span className="shrink-0 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {SOURCE_LABEL[result.rule.source]}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                      {sourceLine(result)}
                    </p>
                    <p className="text-sm text-gray-700 line-clamp-3">
                      {result.rule.content}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function SourceInfo({ source }: { source: RuleSource }) {
  const rows: Array<[string, string | null]> = [
    ["資料名", source.name],
    ["版", source.version],
    ["公開日", formatDate(source.publishedDate)],
    ["有効開始日", formatDate(source.effectiveDate)],
    ["言語", source.language === "ja" ? "日本語" : "英語"],
    ["ファイル", source.fileName],
  ];
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-gray-500">{label}</dt>
            <dd className="text-gray-800 break-words">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function ArticleDetail({
  result,
  onBack,
}: {
  result: RuleSearchResult;
  onBack: () => void;
}) {
  const { rule, source } = result;
  return (
    <div className="p-4 sm:p-6">
      <button
        type="button"
        onClick={onBack}
        className="min-h-[48px] mb-4 px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200"
      >
        ← 検索結果に戻る
      </button>

      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h1 className="text-xl font-bold">
            {rule.article}
            {rule.title && (
              <span className="block text-base font-normal text-gray-700">
                {rule.title}
              </span>
            )}
          </h1>
          <span className="shrink-0 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
            {SOURCE_LABEL[rule.source]}
          </span>
        </div>
        <p className="text-sm text-gray-600 mb-4">{sourceLine(result)}</p>
        <p className="whitespace-pre-wrap text-gray-900 leading-relaxed">
          {rule.content}
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="font-semibold mb-2">出典</h2>
        {source ? (
          <SourceInfo source={source} />
        ) : (
          <p className="text-sm text-gray-500">
            出典情報がありません。資料を再インポートしてください。
          </p>
        )}
        {rule.page && (
          <p className="text-sm text-gray-600 mt-2">
            原文ページ: p.{rule.page}
          </p>
        )}
      </div>
    </div>
  );
}
