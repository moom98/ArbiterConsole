import { FinishReason, GoogleGenAI } from "@google/genai";
import type { GenerateJsonFn } from "./generate";

/**
 * Google Gen AI SDK（@google/genai）による GenerateJsonFn の実装。サーバー専用（ADR-006）。
 * このファイルは Route Handler からのみ import すること（クライアントバンドルに含めない）。
 */

const clients = new Map<string, GoogleGenAI>();

function clientFor(apiKey: string): GoogleGenAI {
  let client = clients.get(apiKey);
  if (!client) {
    // キーの変更（ローテーション）に備え、保持するクライアントは1つだけにする
    clients.clear();
    client = new GoogleGenAI({ apiKey });
    clients.set(apiKey, client);
  }
  return client;
}

const BLOCKING_FINISH_REASONS: ReadonlySet<string> = new Set([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

export const geminiGenerateJson: GenerateJsonFn = async (req) => {
  const response = await clientFor(req.apiKey).models.generateContent({
    model: req.model,
    contents: req.userContent,
    config: {
      systemInstruction: req.systemInstruction,
      responseMimeType: "application/json",
      responseJsonSchema: req.responseJsonSchema,
      temperature: 0,
      maxOutputTokens: req.maxOutputTokens,
      abortSignal: req.signal,
      // 再試行はアプリ側（withRetry）で制御する
      httpOptions: { timeout: req.timeoutMs, retryOptions: { attempts: 1 } },
    },
  });

  const finishReason = response.candidates?.[0]?.finishReason;
  const blocked =
    response.promptFeedback?.blockReason !== undefined ||
    (finishReason !== undefined && BLOCKING_FINISH_REASONS.has(finishReason));
  return {
    text: response.text,
    blocked,
    truncated: finishReason === FinishReason.MAX_TOKENS,
  };
};
