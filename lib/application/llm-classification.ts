import type { IncidentCategory } from "@/lib/domain/entities";
import { parseLlmClassification } from "@/lib/domain/llm/classification";
import { notSentNotice } from "@/lib/domain/llm/external-ai";
import {
  classifyByKeywords,
  mentionsFairPlay,
} from "@/lib/domain/llm/keyword-classifier";
import type {
  ExternalAiPreview,
  IncidentClassification,
} from "@/lib/domain/llm/types";
import { browserIsOnline } from "@/lib/infrastructure/llm/llm-api-client";
import {
  prepareClassification,
  type ExternalAiGuardDeps,
} from "./external-ai-guard";

/**
 * 自由記述のインシデント分類（要件 §11, ADR-007, ADR-012）。
 *
 * 1. 外部AIガードが記述を確認する。止まった場合（機微な内容の可能性・「外部AIに送らない」）は
 *    端末内のキーワード分類と「外部AIには送信していません（理由: …）」を返す
 * 2. 通った場合は送信内容のプレビューを返す。アービターが確認してから send() で Gemini に送る（D13）
 * 3. オフライン・失敗・不正な出力の場合はキーワード分類にフォールバックする
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

export type ClassificationStep =
  /** 外部へ送らずに結果が決まった（キーワード分類） */
  | { status: "done"; result: ClassifyTextResult }
  /** 送信内容の確認が必要。send() で送り、decline() で送らずにキーワード分類にする */
  | {
      status: "needs-confirmation";
      preview: ExternalAiPreview;
      send(): Promise<ClassifyTextResult>;
      decline(): ClassifyTextResult;
    };

export interface ClassifyTextOptions {
  /** アービターが選んでいるカテゴリ（fair-play なら送らない） */
  category?: IncidentCategory;
  /** 「外部AIに送らない」 */
  doNotSend?: boolean;
}

export async function prepareIncidentClassification(
  text: string,
  options: ClassifyTextOptions = {},
  deps: ExternalAiGuardDeps = {}
): Promise<ClassificationStep> {
  const input = text.trim();
  if (!input) return { status: "done", result: { classification: null } };

  const keyword = (notice: string): ClassifyTextResult => ({
    classification: classifyByKeywords(input),
    notice,
  });

  // フェアプレー（不正の疑い・申告）と思われる記述は外部へ送信せず、端末内の分類のみ（§23）
  const local = classifyByKeywords(input);
  if (local?.category === "fair-play" || mentionsFairPlay(input)) {
    return {
      status: "done",
      result: {
        classification: local,
        notice:
          "フェアプレー関連の可能性があるため、端末内のキーワード分類のみを使用しています（AIへは送信しません）",
      },
    };
  }

  const guarded = await prepareClassification(input, options, deps);
  if (guarded.status === "local")
    return {
      status: "done",
      result: keyword(
        `${notSentNotice(guarded.reasons)}。端末内のキーワード分類を表示しています`
      ),
    };

  if (!(deps.isOnline ?? browserIsOnline)())
    return {
      status: "done",
      result: keyword(
        "オフラインのため端末内のキーワード分類を表示しています（AI分類はオンライン時のみ）"
      ),
    };

  return {
    status: "needs-confirmation",
    preview: guarded.preview,
    decline: () =>
      keyword(
        "外部AIには送信していません。端末内のキーワード分類を表示しています"
      ),
    async send() {
      const res = await guarded.send();
      if (!res.ok) {
        return keyword(
          res.error.code === "offline"
            ? "オフラインのため端末内のキーワード分類を表示しています（AI分類はオンライン時のみ）"
            : `AI分類を利用できないため、キーワード分類を表示しています（${res.error.message}）`
        );
      }
      const parsed = parseLlmClassification(res.result);
      if (!parsed) {
        return keyword(
          "AIの分類結果を解釈できないため、キーワード分類を表示しています"
        );
      }
      return { classification: parsed };
    },
  };
}
