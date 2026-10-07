"use client";

import { useState } from "react";
import {
  getLlmAccessToken,
  setLlmAccessToken,
} from "@/lib/infrastructure/llm/access-token";

interface LlmAccessTokenFieldProps {
  /** 保存後に呼ぶ（例: AI 参考情報の再取得） */
  onSaved?: () => void;
}

/**
 * AI機能のアクセストークン入力（サーバーで LLM_ACCESS_TOKEN が設定されている場合のみ必要）。
 * Gemini の API キーではない。端末に保存される（ADR-007）。設定画面にも配置できる。
 */
export function LlmAccessTokenField({ onSaved }: LlmAccessTokenFieldProps) {
  const [value, setValue] = useState(() => getLlmAccessToken() ?? "");
  const [saved, setSaved] = useState(false);

  return (
    <div className="p-3 border border-gray-300 rounded-lg">
      <label htmlFor="llm-access-token" className="block font-semibold mb-1">
        AI機能のアクセストークン
      </label>
      <p className="text-xs text-gray-600 mb-2">
        大会の管理者から受け取ったトークンを入力してください（この端末に保存されます）。
      </p>
      <input
        id="llm-access-token"
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        className="w-full min-h-12 px-3 border border-gray-300 rounded-lg"
      />
      <button
        type="button"
        onClick={() => {
          setLlmAccessToken(value);
          setSaved(true);
          onSaved?.();
        }}
        className="mt-2 w-full min-h-12 px-4 bg-gray-800 text-white rounded-lg font-semibold"
      >
        保存
      </button>
      {saved && (
        <p role="status" className="mt-1 text-sm text-green-700">
          保存しました
        </p>
      )}
    </div>
  );
}
