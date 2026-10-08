import type { LlmAssistPort } from "@/lib/domain/llm/ports";
import { mentionsFairPlay } from "@/lib/domain/llm/keyword-classifier";
import { db } from "@/lib/infrastructure/db";
import type { RuleSearchResult } from "@/lib/infrastructure/ai/hybrid-search";
import { LLM_LIMITS } from "@/lib/infrastructure/llm/contract";
import { browserIsOnline } from "@/lib/infrastructure/llm/llm-api-client";
import {
  prepareReasoning,
  type CandidateArticle,
  type ExternalAiGuardDeps,
} from "./external-ai-guard";

/**
 * LlmAssistPort の実装（ADR-007, ADR-012）。
 * 1. 外部AIガードで記述・検索語を置き換え、送信内容のプレビューを作る（止まれば not-sent）
 * 2. アービターの確認（approvalKey）がなければ、何も送らずに needs-confirmation を返す（D13）
 * 3. 確認済みなら、端末内の規則をハイブリッド検索で取得する（キーワード検索は元の記述で端末内、
 *    意味検索は置き換え後の検索語）
 * 4. 候補条文（大会規定は置き換え後）とコードを /api/llm/reason に送る
 * 5. 応答後に、候補条文が IndexedDB にまだ存在するかを再確認する
 * 出力の検証と元の表記への復元はドメイン（DecisionEngine → buildLlmDecision）が行う。
 */

export interface LlmAssistDeps extends ExternalAiGuardDeps {
  search?: (
    query: string,
    tournamentId: string | undefined,
    queryEmbedding: (() => Promise<number[]>) | undefined
  ) => Promise<RuleSearchResult[]>;
  /** 指定 ID のうち、IndexedDB に存在する Rule.id を返す */
  storedRuleIds?: (ids: string[]) => Promise<string[]>;
}

const MAX_CANDIDATES = 6;

async function defaultSearch(
  query: string,
  tournamentId: string | undefined,
  queryEmbedding: (() => Promise<number[]>) | undefined
): Promise<RuleSearchResult[]> {
  // 検索モジュール（lunr 等）は AI 参考情報が必要になった時点で読み込む
  const { hybridSearch } =
    await import("@/lib/infrastructure/ai/hybrid-search");
  const res = await hybridSearch(query, {
    tournamentId,
    limit: MAX_CANDIDATES,
    queryEmbedding,
  });
  return res.results;
}

async function defaultStoredRuleIds(ids: string[]): Promise<string[]> {
  const rules = await db.rules.bulkGet(ids);
  return rules.flatMap((r) => (r ? [r.id] : []));
}

/** 検索結果の条文（端末内のデータ）。送る形にはガードが整える */
export function toCandidateArticle(result: RuleSearchResult): CandidateArticle {
  const { rule, source } = result;
  return {
    id: rule.id,
    article: rule.article,
    title: rule.title,
    content: rule.content,
    source: rule.source,
    sourceName: source?.name,
    sourceVersion: source?.version,
    page: rule.page,
    priority: rule.priority,
  };
}

export function createLlmAssistPort(deps: LlmAssistDeps = {}): LlmAssistPort {
  const search = deps.search ?? defaultSearch;
  const storedRuleIds = deps.storedRuleIds ?? defaultStoredRuleIds;

  return {
    async assist(request, options = {}) {
      // 多重防御: フェアプレーに触れる記述は送信しない（通常は DecisionEngine で止まる）
      if (
        request.incident.category === "fair-play" ||
        mentionsFairPlay(request.incident.description)
      )
        return {
          status: "error",
          code: "fair-play-not-sent",
          message:
            "フェアプレー関連の記述はAIへ送信しません。CAへ報告してください",
        };

      const prepared = await prepareReasoning(
        {
          incident: request.incident,
          context: request.context,
          doNotSend: request.doNotSend,
        },
        deps
      );
      if (prepared.status === "local")
        return { status: "not-sent", reasons: prepared.reasons };

      // オフラインでは確認を求めず、規則検索もサーバー呼び出しも行わない
      if (!(deps.isOnline ?? browserIsOnline)()) return { status: "offline" };

      // 確認していない、または確認した内容と今の送信内容が違う: 送らずに確認を求める
      if (options.approvalKey !== prepared.approvalKey)
        return {
          status: "needs-confirmation",
          preview: prepared.preview,
          approvalKey: prepared.approvalKey,
        };

      let results: RuleSearchResult[];
      try {
        // キーワード検索は元の記述で端末内のみ。意味検索は置き換え後の検索語だけを送る
        results = await search(
          request.incident.description,
          request.tournamentId,
          prepared.queryEmbedding
        );
      } catch (error) {
        return {
          status: "error",
          code: "search-failed",
          message: `規則検索に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      const candidates = results
        .slice(0, LLM_LIMITS.maxArticles)
        .map(toCandidateArticle);
      const articles = prepared
        .toSentArticles(candidates)
        .filter((a) => a.content.trim() !== "");
      if (articles.length === 0) return { status: "no-articles" };

      const res = await prepared.send(articles);
      if (!res.ok) {
        if (res.error.code === "offline") return { status: "offline" };
        // サーバーの再確認（L5）で止まった。同じ内容を再送しても止まるため、再取得ではなく
        // ローカルで処理する（§4.3）。正しいクライアントでは起きない（版の違いなど）
        if (res.error.code === "not-sendable")
          return { status: "not-sent", reasons: ["residual"] };
        return {
          status: "error",
          code: res.error.code,
          message: res.error.message,
        };
      }

      const stored = await storedRuleIds(articles.map((a) => a.id));
      return {
        status: "ok",
        raw: res.result,
        model: res.model,
        articles,
        storedArticleIds: stored,
        reidentify: prepared.reidentify,
        // 表示用（端末内）: 大会規定の資料名・版は送っていないため、元のものを使う
        localSourceLabels: Object.fromEntries(
          candidates.map((c) => [
            c.id,
            { sourceName: c.sourceName, sourceVersion: c.sourceVersion },
          ])
        ),
      };
    },
  };
}
