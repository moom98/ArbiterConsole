import type { EmbedTextsFn, GenerateJsonFn } from "./generate";
import { geminiEmbedTexts, geminiGenerateJson } from "./gemini-client";
import { selectClassifier, type ClassifyIncidentFn } from "./classify-port";
import type { LlmServerConfig } from "./config";
import { createJevEvaluate, type JevEvaluateFn } from "./jev-client";

/**
 * 使用する LLM プロバイダーの唯一の結合点（ADR-007）。
 *
 * - モデル ID は config.ts（環境変数 GEMINI_MODEL_REASONING / GEMINI_MODEL_CLASSIFIER と既定値）
 *   のみで定義する。ここや他のファイルにモデル ID を書かないこと。
 * - プロバイダーを替える場合は GenerateJsonFn を実装したアダプターを追加し、ここを差し替える
 *   （必要に応じて config.ts の環境変数名も変更する）。ドメイン・クライアント・UI は変更不要。
 */
export const llmProvider: GenerateJsonFn = geminiGenerateJson;

/** 意味検索の埋め込み（ADR-010）。モデルは contract.ts の EMBEDDING_MODEL で固定 */
export const embedProvider: EmbedTextsFn = geminiEmbedTexts;

/** TypeSafe Jev（ADR-011）。SDK を使わず fetch で呼ぶ */
export const jevEvaluateProvider: JevEvaluateFn = createJevEvaluate(
  (input, init) => fetch(input, init)
);

/**
 * 分類のプロバイダー（ADR-011）。LLM_CLASSIFIER_PROVIDER で gemini / jev を選ぶ（既定 gemini）。
 * Jev のモデル ID は config.ts の JEV_MODEL（固定したバージョン）
 */
export function classifierProvider(
  config: LlmServerConfig
): ClassifyIncidentFn {
  return selectClassifier(config, {
    generate: llmProvider,
    evaluate: jevEvaluateProvider,
  });
}
