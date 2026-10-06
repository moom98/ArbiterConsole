import lunr from "lunr";
import { db } from "@/lib/infrastructure/db";
import type { Rule } from "@/lib/domain/entities";
import type { ScoredRule } from "./vector-search";

let searchIndex: lunr.Index | null = null;
let ruleMap: Map<string, Rule> | null = null;

/**
 * Lunr.jsのインデックスを構築
 */
export async function buildFulltextIndex(): Promise<void> {
  const allRules = await db.rules.toArray();

  // Ruleマップを作成
  ruleMap = new Map(allRules.map((rule) => [rule.id, rule]));

  // Lunrインデックスを構築
  searchIndex = lunr(function () {
    this.ref("id");
    this.field("article", { boost: 10 });
    this.field("title", { boost: 5 });
    this.field("content");

    // 日本語検索のための設定
    this.pipeline.remove(lunr.stemmer);
    this.pipeline.remove(lunr.stopWordFilter);

    allRules.forEach((rule) => {
      this.add({
        id: rule.id,
        article: rule.article,
        title: rule.title,
        content: rule.content,
      });
    });
  });

  console.log(`Fulltext index built with ${allRules.length} rules`);
}

/**
 * Full-text searchでルールを検索
 */
export async function fulltextSearch(
  query: string,
  limit: number = 10
): Promise<ScoredRule[]> {
  if (!searchIndex || !ruleMap) {
    await buildFulltextIndex();
  }

  if (!searchIndex || !ruleMap) {
    throw new Error("Failed to build fulltext index");
  }

  // Lunrで検索
  const results = searchIndex.query((q) => {
    // クエリを単語に分割
    const tokens = query.split(/\s+/).filter((t) => t.length > 0);

    tokens.forEach((token) => {
      // Exact match
      q.term(token, { boost: 10 });

      // Wildcard match
      if (token.length >= 2) {
        q.term(token, {
          wildcard: lunr.Query.wildcard.LEADING | lunr.Query.wildcard.TRAILING,
          boost: 1,
        });
      }
    });
  });

  // 結果をScoredRuleに変換
  const scoredRules: ScoredRule[] = results
    .map((result) => {
      const rule = ruleMap!.get(result.ref);
      if (!rule) {
        return null;
      }

      const scoredRule: ScoredRule = {
        rule,
        score: result.score,
        method: "fulltext",
      };
      return scoredRule;
    })
    .filter((item) => item !== null) as ScoredRule[];

  return scoredRules.slice(0, limit);
}

/**
 * Fulltext indexをクリア
 */
export function clearFulltextIndex(): void {
  searchIndex = null;
  ruleMap = null;
}
