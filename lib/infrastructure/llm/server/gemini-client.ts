import { FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { ThinkingSetting } from "./config";
import type { GenerateJsonFn } from "./generate";

const THINKING_LEVELS: Record<
  Extract<ThinkingSetting, { mode: "level" }>["level"],
  ThinkingLevel
> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
};

/**
 * Google Gen AI SDK（@google/genai）による GenerateJsonFn の実装。サーバー専用（ADR-007）。
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
      // 思考トークンは maxOutputTokens に含まれるため、量を抑えて JSON の途中切れを防ぐ
      ...(req.thinking
        ? {
            thinkingConfig:
              req.thinking.mode === "level"
                ? { thinkingLevel: THINKING_LEVELS[req.thinking.level] }
                : { thinkingBudget: req.thinking.tokens },
          }
        : {}),
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
