"use client";

import { useRef, useState, useEffect } from "react";
import {
  ingestRulesFromPDF,
  getRuleStatistics,
  type RuleIngestionProgress,
} from "@/lib/domain/services/rule-ingestion";
import type { RuleSource } from "@/lib/domain/entities";

export default function SettingsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedSource, setSelectedSource] = useState<RuleSource | null>(null);
  const [progress, setProgress] = useState<RuleIngestionProgress | null>(null);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    const statistics = await getRuleStatistics();
    setStats(statistics);
  };

  const handleUploadClick = (source: RuleSource) => {
    setSelectedSource(source);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file || !selectedSource) return;

    try {
      const result = await ingestRulesFromPDF(
        file,
        selectedSource,
        undefined,
        (progress) => {
          setProgress(progress);
        }
      );

      alert(
        `インポート完了: ${result.ruleCount}件のルールを登録しました`
      );

      await loadStats();
    } catch (error) {
      console.error("PDF import error:", error);
      alert(`エラー: ${error}`);
    } finally {
      setProgress(null);
      setSelectedSource(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">設定</h1>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-4">ルールデータ管理</h2>

          {progress && (
            <div className="mb-4 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm font-semibold mb-2">{progress.message}</p>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{
                    width: `${(progress.current / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={() => handleUploadClick("FIDE")}
              disabled={!!progress}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-left disabled:bg-gray-400"
            >
              FIDE Laws of Chess をアップロード
              {stats && stats.bySource.FIDE > 0 && (
                <span className="ml-2 text-sm">
                  (登録済: {stats.bySource.FIDE}件)
                </span>
              )}
            </button>
            <button
              onClick={() => handleUploadClick("JCF")}
              disabled={!!progress}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-left disabled:bg-gray-400"
            >
              JCF規則をアップロード
              {stats && stats.bySource.JCF > 0 && (
                <span className="ml-2 text-sm">
                  (登録済: {stats.bySource.JCF}件)
                </span>
              )}
            </button>
            <button
              onClick={() => handleUploadClick("tournament")}
              disabled={!!progress}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-left disabled:bg-gray-400"
            >
              大会特別規定をアップロード
              {stats && stats.bySource.tournament > 0 && (
                <span className="ml-2 text-sm">
                  (登録済: {stats.bySource.tournament}件)
                </span>
              )}
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-4">
            ※ PDF形式のファイルをアップロードしてください
          </p>
          {stats && stats.total > 0 && (
            <p className="text-sm text-green-600 mt-2 font-semibold">
              合計 {stats.total}件のルールが登録されています
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-4">大会設定</h2>
          <p className="text-sm text-gray-500">
            Milestone 6で実装予定
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-4">AI設定</h2>
          <p className="text-sm text-gray-500">Claude API キー未設定</p>
          <button className="mt-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
            API キーを設定
          </button>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-4">データ管理</h2>
          <button className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
            全データを削除
          </button>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-2">アプリ情報</h2>
          <p className="text-sm text-gray-600">Version: 0.1.0 (MVP)</p>
          <p className="text-sm text-gray-600">Milestone 1 in progress</p>
        </div>
      </div>
    </div>
  );
}
