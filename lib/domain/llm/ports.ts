import type { GateReasonCode, ReidentifyResult } from "@/lib/domain/privacy";
import type {
  ExternalAiPreview,
  LlmArticle,
  LlmIncidentSummary,
  LlmReasoningContext,
} from "./types";

/**
 * 決定木の対象外の事象について、AI 参考情報（LLM の下書き）を取得するポート。
 *
 * ドメイン（DecisionEngine）はこのインターフェースのみに依存する。
 * 実装（application）が外部AIガード（置き換え・確認）・規則の検索・サーバー呼び出し・
 * IndexedDB の再確認を行う。LLM の出力の検証はドメインの決定的な検証器（output-validator）が行う。
 *
 * 外部へ送る前に、必ずアービターの確認を受ける（ADR-012 改訂2, D13）:
 * 1回目の assist は送らずに needs-confirmation（プレビューと approvalKey）を返す。
 * アービターが確認した後、同じ approvalKey を付けて assist を呼ぶと送信する。
 * その時点の送信内容がプレビューと違えば（識別子の登録が変わった等）、もう一度確認を求める。
 */
export interface LlmAssistPort {
  assist(
    request: LlmAssistRequest,
    options?: LlmAssistOptions
  ): Promise<LlmAssistOutcome>;
}

export interface LlmAssistOptions {
  /** アービターが確認したプレビューの approvalKey。未指定なら送らずに確認を求める */
  approvalKey?: string;
}

export interface LlmAssistRequest {
  incident: LlmIncidentSummary;
  context: LlmReasoningContext;
  /** 端末内の規則検索の範囲（大会固有規定）。外部へは送らない */
  tournamentId?: string;
  /** 「外部AIに送らない」スイッチ（Sensitive Gate の L1） */
  doNotSend?: boolean;
}

export type LlmAssistOutcome =
  /** LLM が応答した（raw は未検証の JSON。プレースホルダーを含む） */
  | {
      status: "ok";
      raw: unknown;
      model?: string;
      /** LLM に提示した候補条文（送った本文。大会規定は置き換え後） */
      articles: LlmArticle[];
      /**
       * 応答受信後に IndexedDB で存在を再確認できた条文 ID。
       * 未指定の場合は articles をそのまま存在するものとみなす。
       */
      storedArticleIds?: string[];
      /**
       * このリクエストの対応表でプレースホルダーを元の表記に戻す（端末のメモリ内だけ。保存しない）。
       * 未指定なら戻さない
       */
      reidentify?: (text: string) => ReidentifyResult;
      /**
       * 条文 ID → 端末での表示用の資料名・版（大会規定は送るときに「大会規定」へ置き換えるため）。
       * 送っていない。未指定なら送った条文の資料名を表示する
       */
      localSourceLabels?: Record<
        string,
        { sourceName?: string; sourceVersion?: string }
      >;
    }
  /** 送る前にアービターの確認が必要（まだ何も送っていない） */
  | {
      status: "needs-confirmation";
      preview: ExternalAiPreview;
      /** 確認後の assist に渡す値（送信内容そのものから作る。端末のメモリ内だけ） */
      approvalKey: string;
    }
  /** Sensitive Gate・残存チェックにより外部へ送らない（ローカルで処理する） */
  | { status: "not-sent"; reasons: GateReasonCode[] }
  /** オフラインのため呼び出していない */
  | { status: "offline" }
  /** 関連する登録規則が見つからなかった（LLM を呼び出していない） */
  | { status: "no-articles" }
  /** 呼び出しに失敗した（code はサーバーの型付きエラーコード等） */
  | { status: "error"; code: string; message: string };
