"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RuleIngestionProgress } from "@/lib/application/rule-ingestion";
import type { RuleStatistics } from "@/lib/application/rule-library";
import type { RuleLanguage, RuleSourceType } from "@/lib/domain/entities";

type UploadableSource = Exclude<RuleSourceType, "commentary">;

interface FormState {
  sourceType: UploadableSource;
  name: string;
  version: string;
  effectiveDate: string;
  language: RuleLanguage;
  file: File | null;
}

const SOURCE_PRESETS: Record<
  UploadableSource,
  { label: string; name: string; language: RuleLanguage }
> = {
  FIDE: {
    label: "FIDE Laws of Chess",
    name: "FIDE Laws of Chess",
    language: "en",
  },
  JCF: { label: "JCF規則・NAセミナー資料", name: "", language: "ja" },
  tournament: { label: "大会特別規定", name: "", language: "ja" },
};

type Notice = { kind: "success" | "error" | "warning"; text: string };

function progressPercent(progress: RuleIngestionProgress): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.round((progress.current / progress.total) * 100));
}

export default function SettingsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [progress, setProgress] = useState<RuleIngestionProgress | null>(null);
  const [stats, setStats] = useState<RuleStatistics | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const { getRuleStatistics } =
        await import("@/lib/application/rule-library");
      setStats(await getRuleStatistics());
    } catch (error) {
      console.error("Failed to load rule statistics:", error);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const openForm = (sourceType: UploadableSource) => {
    const preset = SOURCE_PRESETS[sourceType];
    setNotice(null);
    setForm({
      sourceType,
      name: preset.name,
      version: "",
      effectiveDate: "",
      language: preset.language,
      file: null,
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImport = async () => {
    if (!form || !form.file) return;
    setNotice(null);

    try {
      // pdfjs 等を含むためクライアントで必要になった時点で読み込む
      const { ingestRulesFromPDF } =
        await import("@/lib/application/rule-ingestion");
      const result = await ingestRulesFromPDF(
        form.file,
        {
          sourceType: form.sourceType,
          name: form.name,
          version: form.version,
          language: form.language,
          effectiveDate: form.effectiveDate
            ? new Date(form.effectiveDate)
            : undefined,
          // 大会管理（Milestone 6）実装までは大会を指定できない
          tournamentId: undefined,
        },
        setProgress
      );

      setNotice(
        result.embeddingError
          ? {
              kind: "warning",
              text: `${result.ruleCount}件の条文を登録しました。意味検索用モデルを読み込めなかったため、キーワード検索のみ利用できます（${result.embeddingError}）`,
            }
          : {
              kind: "success",
              text: `インポート完了: ${result.ruleCount}件の条文を登録しました`,
            }
      );
      setForm(null);
      await loadStats();
    } catch (error) {
      console.error("PDF import error:", error);
      setNotice({
        kind: "error",
        text: `インポートに失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setProgress(null);
    }
  };

  const busy = progress !== null;
  const canImport =
    !!form &&
    !!form.file &&
    !!form.name.trim() &&
    !!form.version.trim() &&
    !busy;

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-4">設定</h1>

      <div className="space-y-6">
        <section className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-4">ルールデータ管理</h2>

          {progress && (
            <div className="mb-4 p-4 bg-blue-50 rounded-lg" aria-live="polite">
              <p className="text-sm font-semibold mb-2">{progress.message}</p>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${progressPercent(progress)}%` }}
                />
              </div>
            </div>
          )}

          {notice && (
            <p
              className={`mb-4 p-3 rounded-lg text-sm ${
                notice.kind === "success"
                  ? "bg-green-50 text-green-800"
                  : notice.kind === "warning"
                    ? "bg-yellow-50 text-yellow-800"
                    : "bg-red-50 text-red-700"
              }`}
              role="status"
            >
              {notice.text}
            </p>
          )}

          {!form && (
            <div className="space-y-3">
              {(["FIDE", "JCF"] as const).map((sourceType) => (
                <button
                  key={sourceType}
                  onClick={() => openForm(sourceType)}
                  disabled={busy}
                  className="w-full min-h-[48px] px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-left disabled:bg-gray-400"
                >
                  {SOURCE_PRESETS[sourceType].label} をアップロード
                  {stats && stats.bySource[sourceType] > 0 && (
                    <span className="ml-2 text-sm">
                      (登録済: {stats.bySource[sourceType]}件)
                    </span>
                  )}
                </button>
              ))}
              <button
                disabled
                className="w-full min-h-[48px] px-4 py-3 bg-gray-300 text-gray-600 rounded-lg text-left"
              >
                大会特別規定をアップロード
                <span className="block text-xs">
                  大会管理機能の実装後に利用できます
                </span>
              </button>
            </div>
          )}

          {form && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                handleImport();
              }}
            >
              <p className="font-semibold">
                {SOURCE_PRESETS[form.sourceType].label}
              </p>
              <label className="block text-sm">
                資料名
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block text-sm">
                版（Version）
                <input
                  type="text"
                  required
                  placeholder="例: 2023"
                  value={form.version}
                  onChange={(e) =>
                    setForm({ ...form, version: e.target.value })
                  }
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block text-sm">
                有効開始日（任意）
                <input
                  type="date"
                  value={form.effectiveDate}
                  onChange={(e) =>
                    setForm({ ...form, effectiveDate: e.target.value })
                  }
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block text-sm">
                言語
                <select
                  value={form.language}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      language: e.target.value as RuleLanguage,
                    })
                  }
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="ja">日本語</option>
                  <option value="en">英語</option>
                </select>
              </label>
              <label className="block text-sm">
                PDFファイル（50MBまで）
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  required
                  onChange={(e) =>
                    setForm({ ...form, file: e.target.files?.[0] ?? null })
                  }
                  className="mt-1 w-full text-sm"
                />
              </label>
              <p className="text-xs text-gray-500">
                同じ種別の登録済み資料は、この資料で置き換えられます。
              </p>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!canImport}
                  className="flex-1 min-h-[48px] px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
                >
                  インポート
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setForm(null)}
                  className="min-h-[48px] px-4 py-3 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                >
                  キャンセル
                </button>
              </div>
            </form>
          )}

          {stats && stats.sources.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {stats.sources.map(({ source, ruleCount, embeddingCount }) => (
                <li key={source.id} className="border-t pt-2">
                  <p className="font-semibold">
                    {source.name}（{source.version}）
                  </p>
                  <p className="text-gray-600">
                    {ruleCount}件の条文 / 意味検索用データ {embeddingCount}件 /{" "}
                    {source.fileName}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {stats && stats.total > 0 && (
            <p className="text-sm text-green-600 mt-2 font-semibold">
              合計 {stats.total}件のルールが登録されています
            </p>
          )}
        </section>

        <section className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-2">大会設定</h2>
          <p className="text-sm text-gray-500">Milestone 6で実装予定</p>
        </section>

        <section className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-2">AI設定</h2>
          <p className="text-sm text-gray-500">LLM連携は未実装です</p>
        </section>

        <section className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-2">アプリ情報</h2>
          <p className="text-sm text-gray-600">Version: 0.1.0 (MVP)</p>
        </section>
      </div>
    </div>
  );
}
