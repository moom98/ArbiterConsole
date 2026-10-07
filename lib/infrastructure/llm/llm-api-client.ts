import {
  LLM_API_PATHS,
  type LlmApiKind,
  type LlmApiResponse,
} from "./contract";

/**
 * /api/llm/* を呼び出すクライアント（ブラウザ側）。ADR-006。
 * API キーは扱わない（サーバーのみが保持する）。
 * オフラインの場合は通信せずに offline を返す。
 */

export interface LlmApiClientDeps {
  fetch?: typeof fetch;
  /** 既定: navigator.onLine（navigator がない環境ではオンライン扱い） */
  isOnline?: () => boolean;
  /** クライアント側のタイムアウト（サーバーの全体締め切り 30 秒 + 余裕） */
  timeoutMs?: number;
}

export function browserIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

const DEFAULT_TIMEOUT_MS = 35_000;

function isApiResponse(v: unknown): v is LlmApiResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r.ok === true) return "result" in r && typeof r.model === "string";
  if (r.ok === false) {
    const e = r.error as Record<string, unknown> | undefined;
    return typeof e?.code === "string" && typeof e?.message === "string";
  }
  return false;
}

export async function callLlmApi(
  kind: LlmApiKind,
  body: unknown,
  deps: LlmApiClientDeps = {}
): Promise<LlmApiResponse> {
  const isOnline = deps.isOnline ?? browserIsOnline;
  if (!isOnline()) {
    return {
      ok: false,
      error: { code: "offline", message: "オフラインのためAIを利用できません" },
    };
  }
  const doFetch = deps.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  try {
    const res = await doFetch(LLM_API_PATHS[kind], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      payload = undefined;
    }
    if (isApiResponse(payload)) return payload;
    return {
      ok: false,
      error: {
        code: "upstream-error",
        message: `AIサーバーから不正な応答がありました（HTTP ${res.status}）`,
      },
    };
  } catch (error) {
    const aborted = (error as { name?: string } | null)?.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? {
            code: "upstream-timeout",
            message: "AIの応答がタイムアウトしました",
          }
        : {
            code: isOnline() ? "network-error" : "offline",
            message: "AIサーバーに接続できませんでした",
          },
    };
  } finally {
    clearTimeout(timer);
  }
}
