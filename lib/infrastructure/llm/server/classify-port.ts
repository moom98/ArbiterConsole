import { resolveThinking, type LlmServerConfig } from "./config";
import type { GenerateJsonFn } from "./generate";
import { InvalidProviderOutput, type JevEvaluateFn } from "./jev-client";
import {
  buildJevClassificationQuestions,
  buildJevState,
  jevAnswersToRawClassification,
} from "./jev-questions";
import {
  buildClassificationUserContent,
  CLASSIFICATION_RESPONSE_SCHEMA,
  CLASSIFIER_SYSTEM_PROMPT,
} from "./prompts";

/**
 * 分類のタスク単位のポート（ADR-011, jev-classifier-design §4.1）。
 * GenerateJsonFn は文章生成の形のため Jev は実装できない。その1段上に置く。
 *
 * - 通信の失敗は UpstreamError 等を投げる（ハンドラーが再試行する）
 * - 応答が空・解釈できない場合は ok: false を返す（再試行しない）
 * - 成功時の result はプロバイダーの生の出力。しきい値の適用・検証はクライアントのドメインが行う
 */

export interface ClassifyIncidentRequest {
  /** 外部AIガードで置き換え・最小化し、サーバーで再確認（L5）した記述 */
  narrative: string;
  config: LlmServerConfig;
  /** 1回の試行のタイムアウト（ミリ秒） */
  timeoutMs: number;
  signal: AbortSignal;
}

export type ClassifyOutcome =
  | {
      ok: true;
      result: unknown;
      /** Jev は解決済みのバージョン、Gemini は設定のモデル ID */
      model: string;
      inputTokens?: number;
    }
  | {
      ok: false;
      code: "blocked" | "invalid-model-output";
      truncated?: boolean;
    };

export type ClassifyIncidentFn = (
  req: ClassifyIncidentRequest
) => Promise<ClassifyOutcome>;

const CLASSIFY_MAX_OUTPUT_TOKENS = 1_024;

/** 従来どおりの Gemini の分類（プロンプト・スキーマ・出力は変えない） */
export function geminiClassifyIncident(
  generate: GenerateJsonFn
): ClassifyIncidentFn {
  return async ({ narrative, config, timeoutMs, signal }) => {
    const model = config.classifierModel;
    const result = await generate({
      apiKey: config.apiKey ?? "",
      model,
      systemInstruction: CLASSIFIER_SYSTEM_PROMPT,
      userContent: buildClassificationUserContent({ narrative }),
      responseJsonSchema: CLASSIFICATION_RESPONSE_SCHEMA,
      maxOutputTokens: CLASSIFY_MAX_OUTPUT_TOKENS,
      thinking: resolveThinking(model, config),
      timeoutMs,
      signal,
    });
    if (result.blocked || !result.text?.trim())
      return { ok: false, code: "blocked" };
    try {
      return { ok: true, result: JSON.parse(result.text), model };
    } catch {
      return {
        ok: false,
        code: "invalid-model-output",
        truncated: result.truncated,
      };
    }
  };
}

/** Jev の分類（state は匿名化した記述だけ。jev-classifier-design §5） */
export function jevClassifyIncident(
  evaluate: JevEvaluateFn
): ClassifyIncidentFn {
  return async ({ narrative, config, signal }) => {
    let response;
    try {
      response = await evaluate({
        apiKey: config.typesafeApiKey ?? "",
        model: config.jevModel,
        state: buildJevState(narrative),
        questions: buildJevClassificationQuestions(),
        signal,
      });
    } catch (error) {
      if (error instanceof InvalidProviderOutput)
        return { ok: false, code: "invalid-model-output" };
      throw error;
    }
    const result = jevAnswersToRawClassification(response.answers);
    if (!result) return { ok: false, code: "invalid-model-output" };
    return {
      ok: true,
      result,
      model: response.model,
      inputTokens: response.usage?.inputTokens,
    };
  };
}

/** 設定のプロバイダーで分類の実装を選ぶ（結合点は provider.ts の classifierProvider） */
export function selectClassifier(
  config: Pick<LlmServerConfig, "classifierProvider">,
  impl: { generate: GenerateJsonFn; evaluate: JevEvaluateFn }
): ClassifyIncidentFn {
  return config.classifierProvider === "jev"
    ? jevClassifyIncident(impl.evaluate)
    : geminiClassifyIncident(impl.generate);
}
