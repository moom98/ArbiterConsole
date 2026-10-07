import type { ThinkingSetting } from "./config";

/**
 * LLM 呼び出しの抽象（SDK 非依存）と、タイムアウト・再試行（指数バックオフ）。
 * プロバイダーはこのインターフェース（GenerateJsonFn）の実装として差し替える（provider.ts）。
 * テストでは GenerateJsonFn を差し替える。
 */

export interface GenerateJsonRequest {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userContent: string;
  responseJsonSchema: unknown;
  maxOutputTokens: number;
  /** 思考（thinking）の設定。null は送らない（resolveThinking でモデル系列ごとに決める） */
  thinking: ThinkingSetting | null;
  /** 1回の試行のタイムアウト（ミリ秒） */
  timeoutMs: number;
  signal: AbortSignal;
}

export interface GenerateJsonResult {
  /** モデルの出力テキスト（JSON 文字列のはず）。安全性ブロック等で空の場合は undefined */
  text: string | undefined;
  /** 安全性フィルタ等でブロックされた */
  blocked?: boolean;
  /** MAX_TOKENS 等で途中で終了した */
  truncated?: boolean;
}

export type GenerateJsonFn = (
  req: GenerateJsonRequest
) => Promise<GenerateJsonResult>;

/** 上流呼び出しの失敗の分類 */
export class UpstreamError extends Error {
  constructor(
    readonly kind: "timeout" | "status" | "network" | "unknown",
    readonly status?: number
  ) {
    super(kind === "status" ? `upstream status ${status}` : `upstream ${kind}`);
    this.name = "UpstreamError";
  }

  get transient(): boolean {
    if (this.kind === "unknown") return false;
    if (this.kind !== "status") return true;
    const s = this.status ?? 0;
    return s === 408 || s === 429 || s >= 500;
  }
}

/** SDK 等の例外を UpstreamError に分類する（ApiError は status を持つ） */
export function toUpstreamError(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) return error;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return new UpstreamError("status", status);
  const e = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: unknown;
  } | null;
  if (e?.name === "AbortError" || e?.name === "TimeoutError")
    return new UpstreamError("timeout");
  if (isTransportError(e) || isTransportError(e?.cause as typeof e))
    return new UpstreamError("network");
  // 想定外の例外（プログラムの誤り等）は再試行しない
  return new UpstreamError("unknown");
}

/** 再試行してよい通信エラー（fetch の失敗・接続断・DNS 等）か */
const TRANSPORT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

function isTransportError(
  e: { name?: unknown; message?: unknown; code?: unknown } | null | undefined
): boolean {
  if (!e) return false;
  if (typeof e.code === "string" && TRANSPORT_CODES.has(e.code)) return true;
  return (
    e.name === "TypeError" &&
    typeof e.message === "string" &&
    /fetch failed|network|socket/i.test(e.message)
  );
}

export interface RetryOptions {
  /** 最大試行回数（初回を含む） */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** 全体の締め切り（ミリ秒、開始から） */
  totalDeadlineMs: number;
  /** 残り時間がこれ未満なら再試行しない */
  minRemainingForRetryMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export const DEFAULT_RETRY: Omit<RetryOptions, "now" | "sleep" | "random"> = {
  attempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
  // クライアントのタイムアウト（35 秒）より前に必ず応答する
  totalDeadlineMs: 30_000,
  minRemainingForRetryMs: 3_000,
};

/**
 * 1回の試行にタイムアウトを設けて実行する。タイムアウト時は AbortSignal で中断し
 * UpstreamError("timeout") を投げる。
 */
export async function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new UpstreamError("timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 一時的なエラー（408/429/5xx・通信失敗・タイムアウト）のみ指数バックオフで再試行する。
 * fn には締め切りまでの残り時間を渡す（1回の試行のタイムアウトはこれを超えないこと）。
 * 残り時間が minRemainingForRetryMs 未満になる場合は再試行しない。
 */
export async function withRetry<T>(
  fn: (attempt: number, remainingMs: number) => Promise<T>,
  options: RetryOptions
): Promise<{ value: T; attempts: number }> {
  const start = options.now();
  const remaining = () => options.totalDeadlineMs - (options.now() - start);
  let lastError: UpstreamError | undefined;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return { value: await fn(attempt, remaining()), attempts: attempt };
    } catch (error) {
      lastError = toUpstreamError(error);
      if (!lastError.transient || attempt === options.attempts) break;
      const exp = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * 2 ** (attempt - 1)
      );
      // full jitter の半分（[exp/2, exp)）
      const delay = Math.round(exp / 2 + (options.random() * exp) / 2);
      if (remaining() - delay < options.minRemainingForRetryMs) break;
      await options.sleep(delay);
    }
  }
  throw lastError ?? new UpstreamError("unknown");
}
