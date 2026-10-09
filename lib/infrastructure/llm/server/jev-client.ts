import { MODEL_ID } from "./config";
import { UpstreamError } from "./generate";

/**
 * TypeSafe AI Jev の API クライアント（ADR-011, jev-classifier-design §4.3）。
 *
 * - SDK を使わず fetch だけで呼ぶ（Cloudflare Workers で動き、依存を増やさない）
 * - API キーはヘッダーにだけ置き、ログ・例外・応答に含めない
 * - 上流のエラー本文は読まずに捨てる（422 は入力を返すため。jev-classifier-design §2.1, §6）
 * - 応答の形が違う場合は InvalidProviderOutput（再試行しない）
 */

export const JEV_API_URL = "https://api.typesafe.ai/v1/systemone";

export type JevQuestion =
  | {
      type: "choice";
      instructions: string;
      /** ラベル → 説明 */
      criteria: Record<string, string>;
    }
  | {
      type: "noul";
      instructions: string;
      criteria: { true: string; false: string };
    };

export interface JevEvaluateRequest {
  apiKey: string;
  model: string;
  /** 匿名化した記述だけを入れる（{ deidentified_incident }） */
  state: Record<string, string>;
  questions: Record<string, JevQuestion>;
  signal: AbortSignal;
}

export interface JevEvaluateResponse {
  /** 解決済みのモデルのバージョン（例: "jev-1.13.0"） */
  model: string;
  /** 質問 ID → 回答（形の確認は jev-questions.ts で行う） */
  answers: Record<string, unknown>;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export type JevEvaluateFn = (
  req: JevEvaluateRequest
) => Promise<JevEvaluateResponse>;

/** 上流の応答の形が想定と違う（再試行しない。invalid-model-output） */
export class InvalidProviderOutput extends Error {
  constructor() {
    super("invalid provider output");
    this.name = "InvalidProviderOutput";
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const tokens = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;

export function createJevEvaluate(fetchFn: typeof fetch): JevEvaluateFn {
  return async ({ apiKey, model, state, questions, signal }) => {
    // 通信の失敗・中断はそのまま投げる（toUpstreamError が network / timeout に分類する）
    const res = await fetchFn(JEV_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, state, questions }),
      signal,
    });
    if (!res.ok) {
      // エラー本文は入力を含みうるため読まない
      await res.body?.cancel().catch(() => {});
      throw new UpstreamError("status", res.status);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "AbortError")
        throw error;
      throw new InvalidProviderOutput();
    }
    if (
      !isObject(body) ||
      typeof body.model !== "string" ||
      !MODEL_ID.test(body.model) ||
      !isObject(body.answers)
    )
      throw new InvalidProviderOutput();
    const usage = isObject(body.usage) ? body.usage : {};
    return {
      model: body.model,
      answers: body.answers,
      usage: {
        inputTokens: tokens(usage.input_tokens),
        outputTokens: tokens(usage.output_tokens),
      },
    };
  };
}
