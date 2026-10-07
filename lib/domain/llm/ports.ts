import type {
  LlmArticle,
  LlmIncidentSummary,
  LlmReasoningContext,
} from "./types";

/**
 * 決定木の対象外の事象について、AI 参考情報（LLM の下書き）を取得するポート。
 *
 * ドメイン（DecisionEngine）はこのインターフェースのみに依存する。
 * 実装（infrastructure）が規則の検索・サーバー呼び出し・IndexedDB の再確認を行う。
 * LLM の出力の検証はドメインの決定的な検証器（output-validator）が行う。
 */
export interface LlmAssistPort {
  assist(request: LlmAssistRequest): Promise<LlmAssistOutcome>;
}

export interface LlmAssistRequest {
  incident: LlmIncidentSummary;
  context: LlmReasoningContext;
}

export type LlmAssistOutcome =
  /** LLM が応答した（raw は未検証の JSON） */
  | {
      status: "ok";
      raw: unknown;
      model?: string;
      /** LLM に提示した候補条文 */
      articles: LlmArticle[];
      /**
       * 応答受信後に IndexedDB で存在を再確認できた条文 ID。
       * 未指定の場合は articles をそのまま存在するものとみなす。
       */
      storedArticleIds?: string[];
    }
  /** オフラインのため呼び出していない */
  | { status: "offline" }
  /** 関連する登録規則が見つからなかった（LLM を呼び出していない） */
  | { status: "no-articles" }
  /** 呼び出しに失敗した（code はサーバーの型付きエラーコード等） */
  | { status: "error"; code: string; message: string };
