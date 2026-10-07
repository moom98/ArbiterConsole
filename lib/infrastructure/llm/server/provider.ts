import type { GenerateJsonFn } from "./generate";
import { geminiGenerateJson } from "./gemini-client";

/**
 * 使用する LLM プロバイダーの唯一の結合点（ADR-007）。
 *
 * - モデル ID は config.ts（環境変数 GEMINI_MODEL_REASONING / GEMINI_MODEL_CLASSIFIER と既定値）
 *   のみで定義する。ここや他のファイルにモデル ID を書かないこと。
 * - プロバイダーを替える場合は GenerateJsonFn を実装したアダプターを追加し、ここを差し替える
 *   （必要に応じて config.ts の環境変数名も変更する）。ドメイン・クライアント・UI は変更不要。
 */
export const llmProvider: GenerateJsonFn = geminiGenerateJson;
