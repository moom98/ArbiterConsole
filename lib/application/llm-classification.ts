import { parseLlmClassification } from "@/lib/domain/llm/classification";
import { classifyByKeywords } from "@/lib/domain/llm/keyword-classifier";
import type { IncidentClassification } from "@/lib/domain/llm/types";
import { LLM_LIMITS } from "@/lib/infrastructure/llm/contract";
import {
  callLlmApi,
  type LlmApiClientDeps,
} from "@/lib/infrastructure/llm/llm-api-client";

/**
 * 自由記述のインシデント分類（要件 §11, ADR-007）。
 * オンラインでは Gemini（分類用の低コストモデル）を使い、オフライン・失敗・不正な出力の場合は
 * 端末内のキーワード分類にフォールバックする。
 *
 * 結果は**カテゴリ選択の提案（プレフィル）のみ**に使う。決定木の対象となる事象は、
 * 決定木の質問と判断が優先される（ADR-002）。
 */

export interface ClassifyTextResult {
  /** 分類できなかった場合は null（手動でカテゴリを選択する） */
  classification: IncidentClassification | null;
  /** キーワード分類に切り替えた理由など（表示用） */
  notice?: string;
}

export interface ClassifyTextDeps extends LlmApiClientDeps {
  call?: typeof callLlmApi;
}

export async function classifyIncidentText(
  text: string,
  deps: ClassifyTextDeps = {}
): Promise<ClassifyTextResult> {
  const input = text.trim().slice(0, LLM_LIMITS.maxClassifyTextChars);
  if (!input) return { classification: null };

  const fallback = (notice: string): ClassifyTextResult => ({
    classification: classifyByKeywords(input),
    notice,
  });

  // フェアプレー（不正の疑い・申告）と思われる記述は外部へ送信せず、端末内の分類のみ（§23）
  const local = classifyByKeywords(input);
  if (local?.category === "fair-play") {
    return {
      classification: local,
      notice:
        "フェアプレー関連の可能性があるため、端末内のキーワード分類のみを使用しています（AIへは送信しません）",
    };
  }

  const call = deps.call ?? callLlmApi;
  const res = await call("classify", { text: input }, deps);
  if (!res.ok) {
    return fallback(
      res.error.code === "offline"
        ? "オフラインのため端末内のキーワード分類を表示しています（AI分類はオンライン時のみ）"
        : `AI分類を利用できないため、キーワード分類を表示しています（${res.error.message}）`
    );
  }
  const parsed = parseLlmClassification(res.result);
  if (!parsed) {
    return fallback(
      "AIの分類結果を解釈できないため、キーワード分類を表示しています"
    );
  }
  return { classification: parsed };
}
