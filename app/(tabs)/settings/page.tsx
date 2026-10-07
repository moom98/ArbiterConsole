"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LlmAccessTokenField } from "@/components/features/LlmAccessTokenField";
import { useTournamentStore } from "@/lib/stores/tournament-store";
import { formatRulesetSummary } from "@/lib/domain/services/tournament-profile";
import type {
  ExistingSourceAction,
  RuleIngestionProgress,
} from "@/lib/application/rule-ingestion";
import type { RuleStatistics } from "@/lib/application/rule-library";
import type {
  RuleLanguage,
  RuleSource,
  RuleSourceType,
} from "@/lib/domain/entities";

type UploadableSource = Exclude<RuleSourceType, "commentary">;

interface FormState {
  sourceType: UploadableSource;
  name: string;
  version: string;
  effectiveDate: string;
  language: RuleLanguage;
  /** 大会特別規定の場合は選択中の大会（必須） */
  tournamentId?: string;
  tournamentName?: string;
  file: File | null;
  /** 同じ種別の有効な登録済み資料 */
  existing: RuleSource[];
  /** インポート時に削除される出典情報のない旧データ（v3以前）の件数 */
  legacyRuleCount: number;
  /** 既存資料がある場合の扱い（明示的な選択が必須） */
  onExisting: ExistingSourceAction | null;
}

/** <input type="date"> の "YYYY-MM-DD" をローカル日付として解釈する（UTC扱いによる日付ずれ防止） */
function parseLocalDate(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
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
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const [stats, setStats] = useState<RuleStatistics | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const {
    active: activeTournament,
    tournaments,
    load: loadTournaments,
  } = useTournamentStore();

  useEffect(() => {
    void loadTournaments();
  }, [loadTournaments]);

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

  const openForm = async (sourceType: UploadableSource) => {
    const preset = SOURCE_PRESETS[sourceType];
    setNotice(null);
    setConfirmDeleteId(null);
    // 大会特別規定は選択中の大会に紐づける（大会未選択では登録できない）
    const tournament =
      sourceType === "tournament" ? activeTournament : undefined;
    if (sourceType === "tournament" && !tournament) {
      setNotice({
        kind: "error",
        text: "大会特別規定を登録するには、先に大会を選択してください",
      });
      return;
    }
    const { getImportScopeInfo } =
      await import("@/lib/application/rule-library");
    const { activeSources: existing, legacyRuleCount } =
      await getImportScopeInfo(sourceType, tournament?.id);
    setForm({
      sourceType,
      tournamentId: tournament?.id,
      tournamentName: tournament?.name,
      name: preset.name || (tournament ? `${tournament.name} 大会規定` : ""),
      version: "",
      effectiveDate: "",
      language: preset.language,
      file: null,
      existing,
      legacyRuleCount,
      onExisting: null,
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async (sourceId: string) => {
    setConfirmDeleteId(null);
    try {
      const { deleteRuleSource } =
        await import("@/lib/application/rule-library");
      await deleteRuleSource(sourceId);
      setNotice({ kind: "success", text: "資料を削除しました" });
      await loadStats();
    } catch (error) {
      setNotice({
        kind: "error",
        text: `削除に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  const handleImport = async () => {
    // 二重送信防止（state更新を待たずに同期的にロック）
    if (!form || !form.file || importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
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
          effectiveDate: parseLocalDate(form.effectiveDate),
          tournamentId: form.tournamentId,
          onExisting: form.onExisting ?? undefined,
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
      importingRef.current = false;
      setImporting(false);
    }
  };

  const busy = importing || progress !== null;
  const canImport =
    !!form &&
    !!form.file &&
    !!form.name.trim() &&
    !!form.version.trim() &&
    ((form.existing.length === 0 && form.legacyRuleCount === 0) ||
      form.onExisting !== null) &&
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
                onClick={() => openForm("tournament")}
                disabled={busy || !activeTournament}
                className="w-full min-h-[48px] px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-left disabled:bg-gray-300 disabled:text-gray-600"
              >
                {SOURCE_PRESETS.tournament.label} をアップロード
                <span className="block text-xs">
                  {activeTournament
                    ? `対象: ${activeTournament.name}（検索で最優先）`
                    : "先に大会を作成・選択してください"}
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
                {form.tournamentName && (
                  <span className="block text-sm font-normal text-gray-700">
                    対象大会: {form.tournamentName}
                  </span>
                )}
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
              {(form.existing.length > 0 || form.legacyRuleCount > 0) && (
                <fieldset className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm">
                  <legend className="font-semibold px-1">
                    登録済みのデータがあります
                  </legend>
                  {form.existing.length > 0 && (
                    <ul className="mb-2 list-disc pl-5">
                      {form.existing.map((s) => (
                        <li key={s.id}>
                          {s.name}（{s.version}）
                        </li>
                      ))}
                    </ul>
                  )}
                  {form.legacyRuleCount > 0 && (
                    <p className="mb-2 font-semibold text-red-700">
                      出典情報のない旧データ{form.legacyRuleCount}
                      件を削除します
                    </p>
                  )}
                  {form.existing.length > 0 ? (
                    <>
                      <label className="flex items-start gap-2 py-2">
                        <input
                          type="radio"
                          name="onExisting"
                          checked={form.onExisting === "supersede"}
                          onChange={() =>
                            setForm({ ...form, onExisting: "supersede" })
                          }
                          className="mt-1"
                        />
                        <span>
                          置き換える（登録済みの資料は旧版として保存し、検索対象から外す）
                        </span>
                      </label>
                      <label className="flex items-start gap-2 py-2">
                        <input
                          type="radio"
                          name="onExisting"
                          checked={form.onExisting === "keep-both"}
                          onChange={() =>
                            setForm({ ...form, onExisting: "keep-both" })
                          }
                          className="mt-1"
                        />
                        <span>
                          両方を有効にする（別の資料の場合。同じ資料の別の版には使用しないでください）
                        </span>
                      </label>
                    </>
                  ) : (
                    <label className="flex items-start gap-2 py-2">
                      <input
                        type="checkbox"
                        checked={form.onExisting !== null}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            onExisting: e.target.checked ? "supersede" : null,
                          })
                        }
                        className="mt-1"
                      />
                      <span>旧データを削除して取り込む</span>
                    </label>
                  )}
                </fieldset>
              )}
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
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {source.name}（{source.version}）
                        <span
                          className={`ml-2 text-xs px-2 py-0.5 rounded ${
                            source.status === "active"
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-200 text-gray-700"
                          }`}
                        >
                          {source.status === "active" ? "現行" : "旧版"}
                        </span>
                      </p>
                      {source.sourceType === "tournament" && (
                        <p className="text-gray-700">
                          大会:{" "}
                          {tournaments.find((t) => t.id === source.tournamentId)
                            ?.name ?? "（削除済みの大会）"}
                        </p>
                      )}
                      <p className="text-gray-600">
                        {ruleCount}件の条文 / 意味検索用データ {embeddingCount}
                        件 / {source.fileName}
                      </p>
                    </div>
                    {confirmDeleteId !== source.id && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmDeleteId(source.id)}
                        className="shrink-0 min-h-[44px] px-3 py-2 text-red-700 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
                      >
                        削除
                      </button>
                    )}
                  </div>
                  {confirmDeleteId === source.id && (
                    <div className="mt-2 p-3 bg-red-50 rounded-lg">
                      <p className="mb-2 text-red-800">
                        この資料と{ruleCount}
                        件の条文を削除します。元に戻せません。
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleDelete(source.id)}
                          className="flex-1 min-h-[44px] px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                        >
                          削除する
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="flex-1 min-h-[44px] px-3 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  )}
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
          {activeTournament ? (
            <p className="text-sm mb-2">
              <span className="font-semibold">{activeTournament.name}</span>
              <span className="block text-gray-600">
                {formatRulesetSummary(activeTournament)}
              </span>
            </p>
          ) : (
            <p className="text-sm text-gray-600 mb-2">
              大会が選択されていません
            </p>
          )}
          <div className="flex gap-2">
            <Link
              href="/tournament"
              className="flex-1 flex items-center justify-center min-h-[48px] px-3 border border-gray-300 rounded-lg"
            >
              大会の選択・管理
            </Link>
            {activeTournament && (
              <Link
                href={`/tournament/${encodeURIComponent(activeTournament.id)}`}
                className="flex-1 flex items-center justify-center min-h-[48px] px-3 border border-gray-300 rounded-lg"
              >
                ラウンド・プロファイル
              </Link>
            )}
          </div>
        </section>

        <section className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-2">AI設定</h2>
          <p className="text-sm text-gray-600 mb-3">
            決定木の対象外の事象について、オンライン時にAI参考情報を表示します（最終判断はアービターが行います）。サーバーでアクセストークンが設定されている場合のみ、入力が必要です。
          </p>
          <LlmAccessTokenField />
        </section>

        <section className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-2">アプリ情報</h2>
          <p className="text-sm text-gray-600">Version: 0.1.0 (MVP)</p>
        </section>
      </div>
    </div>
  );
}
