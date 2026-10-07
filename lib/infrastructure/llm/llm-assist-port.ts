import type { LlmAssistPort } from "@/lib/domain/llm/ports";
import type { LlmArticle, LlmReasoningRequest } from "@/lib/domain/llm/types";
import { db } from "@/lib/infrastructure/db";
import type { RuleSearchResult } from "@/lib/infrastructure/ai/hybrid-search";
import { mentionsFairPlay } from "@/lib/domain/llm/keyword-classifier";
import { LLM_LIMITS } from "./contract";
import {
  browserIsOnline,
  callLlmApi,
  type LlmApiClientDeps,
} from "./llm-api-client";

/**
 * LlmAssistPort の実装（ADR-007）。
 * 1. 端末内の規則（IndexedDB）をハイブリッド検索で取得する（オフラインでも動く既存の検索）
 * 2. 候補条文と構造化コンテキストのみを /api/llm/reason に送る
 * 3. 応答後に、候補条文が IndexedDB にまだ存在するかを再確認する
 * 出力の検証はドメイン（DecisionEngine → output-validator）が行う。
 */

export interface LlmAssistPortDeps extends LlmApiClientDeps {
  search?: (
    query: string,
    tournamentId: string | undefined
  ) => Promise<RuleSearchResult[]>;
  /** 指定 ID のうち、IndexedDB に存在する Rule.id を返す */
  storedRuleIds?: (ids: string[]) => Promise<string[]>;
  call?: typeof callLlmApi;
}

const MAX_CANDIDATES = 6;

async function defaultSearch(
  query: string,
  tournamentId: string | undefined
): Promise<RuleSearchResult[]> {
  // 検索モジュール（lunr 等）は AI 参考情報が必要になった時点で読み込む
  const { hybridSearch } =
    await import("@/lib/infrastructure/ai/hybrid-search");
  const res = await hybridSearch(query, {
    tournamentId,
    limit: MAX_CANDIDATES,
  });
  return res.results;
}

async function defaultStoredRuleIds(ids: string[]): Promise<string[]> {
  const rules = await db.rules.bulkGet(ids);
  return rules.flatMap((r) => (r ? [r.id] : []));
}

export function toLlmArticle(result: RuleSearchResult): LlmArticle {
  const { rule, source } = result;
  return {
    id: rule.id,
    article: rule.article.slice(0, LLM_LIMITS.maxArticleNumberChars),
    title: rule.title.slice(0, LLM_LIMITS.maxArticleTitleChars),
    // 長い条文は先頭のみ送る（検証も送った本文で行うため、引用は送った範囲に限られる）
    content: rule.content.slice(0, LLM_LIMITS.maxArticleContentChars),
    source: rule.source,
    sourceName: source?.name.slice(0, LLM_LIMITS.maxSourceNameChars),
    sourceVersion: source?.version.slice(0, LLM_LIMITS.maxShortChars),
    page: rule.page,
    priority: rule.priority,
    tournamentId: rule.tournamentId,
  };
}

export function createLlmAssistPort(
  deps: LlmAssistPortDeps = {}
): LlmAssistPort {
  const search = deps.search ?? defaultSearch;
  const storedRuleIds = deps.storedRuleIds ?? defaultStoredRuleIds;
  const call = deps.call ?? callLlmApi;

  return {
    async assist(request) {
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
      // オフラインでは規則検索もサーバー呼び出しも行わない
      if (!(deps.isOnline ?? browserIsOnline)()) return { status: "offline" };

      let results: RuleSearchResult[];
      try {
        results = await search(
          request.incident.description,
          request.context.tournamentId
        );
      } catch (error) {
        return {
          status: "error",
          code: "search-failed",
          message: `規則検索に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      const articles = results
        .slice(0, LLM_LIMITS.maxArticles)
        .map(toLlmArticle)
        .filter((a) => a.content.trim() !== "");
      if (articles.length === 0) return { status: "no-articles" };

      const body: LlmReasoningRequest = {
        incident: {
          ...request.incident,
          description: request.incident.description.slice(
            0,
            LLM_LIMITS.maxDescriptionChars
          ),
        },
        context: request.context,
        articles,
      };
      const res = await call("reason", body, deps);
      if (!res.ok) {
        if (res.error.code === "offline") return { status: "offline" };
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
      };
    },
  };
}
