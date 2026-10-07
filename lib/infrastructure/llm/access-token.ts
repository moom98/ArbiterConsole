/**
 * /api/llm/* 用のアクセストークン（サーバーで LLM_ACCESS_TOKEN を設定した場合のみ必要）。ADR-007。
 *
 * これは Gemini の API キーではなく、このアプリの LLM ルートを第三者に使われないための
 * トークン。端末の localStorage に保存する（トレードオフ: 端末を共有すると利用できてしまう。
 * 漏えいした場合はサーバーの LLM_ACCESS_TOKEN を変更すれば無効化できる）。
 * NEXT_PUBLIC_ の環境変数には入れないこと（ビルド成果物に含まれて公開される）。
 */

const STORAGE_KEY = "arbiter-console:llm-access-token";

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function getLlmAccessToken(): string | undefined {
  try {
    return storage()?.getItem(STORAGE_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function setLlmAccessToken(token: string | undefined): void {
  const s = storage();
  if (!s) return;
  try {
    const v = token?.trim();
    if (v) s.setItem(STORAGE_KEY, v);
    else s.removeItem(STORAGE_KEY);
  } catch {
    // 保存できない環境（プライベートモード等）では何もしない
  }
}
