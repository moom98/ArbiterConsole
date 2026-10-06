import lunr from "lunr";
import type { Rule } from "@/lib/domain/entities";
import { tokenize, tokenizeDetailed, type SearchToken } from "./tokenizer";

export interface FulltextHit {
  ruleId: string;
  /** Lunrの生スコア（上限なし。ハイブリッド検索側で正規化する） */
  score: number;
  /**
   * クエリトークンのうち、この条文に一致したものの割合 (0, 1]。
   * 弱い部分一致（bi-gram 1個だけ等）を正規化後に過大評価しないために使う。
   */
  coverage?: number;
}

/**
 * Lunr.js による全文検索インデックス
 *
 * Lunr標準の tokenizer / trimmer / stemmer / stopWordFilter は英語前提で、
 * trimmer は非ASCII文字（日本語）を除去してしまうため使用しない。
 * 代わりに tokenizer.ts で事前にトークン化した配列を渡し、
 * インデックス時・クエリ時ともにパイプラインを空にして同一処理を保証する。
 */
export class FulltextIndex {
  private readonly index: lunr.Index;

  constructor(rules: readonly Rule[]) {
    this.index = lunr(function () {
      this.pipeline.reset();
      this.searchPipeline.reset();

      this.ref("id");
      this.field("article", { boost: 10 });
      this.field("title", { boost: 5 });
      this.field("content");

      rules.forEach((rule) => {
        // lunr は配列が渡された場合それをトークン列として扱う
        this.add({
          id: rule.id,
          article: tokenize(rule.article),
          title: tokenize(rule.title),
          content: tokenize(rule.content),
        });
      });
    });
  }

  search(query: string, limit: number = Infinity): FulltextHit[] {
    const tokens = tokenizeDetailed(query);
    if (tokens.length === 0) {
      return [];
    }

    const results = this.index.query((q) => {
      for (const token of tokens) {
        q.term(token.text, { boost: 10, usePipeline: false });

        if (token.kind === "article") {
          // "7.5" で "7.5.4" などの下位条文にも一致させる
          q.term(token.text, {
            boost: 2,
            usePipeline: false,
            wildcard: lunr.Query.wildcard.TRAILING,
          });
        } else if (token.kind === "word" && token.text.length >= 3) {
          // 語形変化の簡易吸収（"illegal" → "illegally" 等）
          q.term(token.text, {
            boost: 1,
            usePipeline: false,
            wildcard: lunr.Query.wildcard.TRAILING,
          });
        } else if (
          token.kind === "cjk" &&
          Array.from(token.text).length === 1
        ) {
          // 1文字の日本語クエリは bi-gram の前後どちらにも一致させる
          q.term(token.text, {
            boost: 1,
            usePipeline: false,
            wildcard:
              lunr.Query.wildcard.LEADING | lunr.Query.wildcard.TRAILING,
          });
        }
      }
    });

    const uniqueTokens = Array.from(
      new Map(tokens.map((t) => [t.text, t])).values()
    );

    return results.slice(0, limit).map((r) => {
      const matchedTerms = Object.keys(r.matchData.metadata);
      const matched = uniqueTokens.filter((token) =>
        matchedTerms.some((term) => tokenMatchesTerm(token, term))
      ).length;
      return {
        ruleId: r.ref,
        score: r.score,
        coverage: matched / uniqueTokens.length,
      };
    });
  }
}

function tokenMatchesTerm(token: SearchToken, term: string): boolean {
  if (term === token.text) return true;
  switch (token.kind) {
    case "article":
    case "word":
      return term.startsWith(token.text);
    case "cjk":
      return Array.from(token.text).length === 1 && term.includes(token.text);
  }
}

let cachedIndex: FulltextIndex | null = null;
let cachedStamp: string | null = null;
let buildPromise: Promise<FulltextIndex> | null = null;
let buildStamp: string | null = null;

/**
 * インデックスを取得（構築中の場合は同じPromiseを共有し二重構築しない）
 *
 * @param stamp ルールデータの版を表す文字列。キャッシュ構築時と異なる場合
 *   （別タブでの再インポート等）は再構築する。
 */
export function getFulltextIndex(
  loadRules: () => Promise<Rule[]>,
  stamp: string = ""
): Promise<FulltextIndex> {
  if (cachedIndex && cachedStamp === stamp) {
    return Promise.resolve(cachedIndex);
  }
  if (!buildPromise || buildStamp !== stamp) {
    const promise = loadRules()
      .then((rules) => {
        const index = new FulltextIndex(rules);
        // 構築中に clearFulltextIndex() や別の版での再構築が始まった場合はキャッシュしない
        if (buildPromise === promise) {
          cachedIndex = index;
          cachedStamp = stamp;
        }
        return index;
      })
      .finally(() => {
        if (buildPromise === promise) {
          buildPromise = null;
          buildStamp = null;
        }
      });
    buildPromise = promise;
    buildStamp = stamp;
  }
  return buildPromise;
}

/**
 * インデックスを破棄（ルール更新時に呼ぶ。次回検索時に再構築される）
 */
export function clearFulltextIndex(): void {
  cachedIndex = null;
  cachedStamp = null;
  buildPromise = null;
  buildStamp = null;
}
