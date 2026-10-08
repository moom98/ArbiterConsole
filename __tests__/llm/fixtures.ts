import type { LlmArticle } from "@/lib/domain/llm/types";

/** テスト用の条文（本文は架空の大会規定と FIDE 11.3 の要約ではなく、照合用の固定文） */
export const ARTICLE_FIDE_11_3: LlmArticle = {
  id: "rule-fide-11-3",
  article: "11.3.2.1",
  title: "Electronic devices",
  content:
    "During play, a player is forbidden to have any electronic device not specifically approved by the arbiter in the playing venue.\nHowever, the regulations of an event may allow such devices to be stored in a player’s bag, provided the device is completely switched off.",
  source: "FIDE",
  sourceName: "FIDE Laws of Chess",
  sourceVersion: "2023",
  page: 44,
  priority: 10,
};

export const ARTICLE_TOURNAMENT_5: LlmArticle = {
  id: "rule-tournament-5",
  article: "第5条",
  title: "電子機器",
  content:
    "対局中、選手は スマートウォッチ を含む電子機器を身に着けてはならない。違反した場合、その対局は負けとする。",
  source: "tournament",
  sourceName: "第1回テスト大会 大会規定",
  sourceVersion: "2026",
  page: 2,
  priority: 1000,
};

export const ARTICLES = [ARTICLE_TOURNAMENT_5, ARTICLE_FIDE_11_3];

/**
 * 外部AIガードが送る形の条文（external-ai-data-protection.md §5.3）: 大会規定の資料名は
 * 「大会規定」で、版は送らない
 */
const { sourceVersion: _omitVersion, ...TOURNAMENT_5_AS_SENT } =
  ARTICLE_TOURNAMENT_5;
export const SENT_ARTICLES: LlmArticle[] = [
  { ...TOURNAMENT_5_AS_SENT, sourceName: "大会規定" },
  ARTICLE_FIDE_11_3,
];

/** 検証に合格する下書き（ゲームロス・大会規定と FIDE を引用） */
export function validDraft(overrides: Record<string, unknown> = {}) {
  return {
    conclusion:
      "大会規定第5条により、スマートウォッチを身に着けていた選手は負けとなる。",
    actions: [
      "時計を止める",
      "スマートウォッチの着用を確認する",
      "負けを記録する",
    ],
    intervention: "immediate",
    penalties: [
      {
        type: "game-loss",
        playerColor: "black",
        description: "電子機器の着用により負け",
        sourceArticleIds: ["rule-tournament-5"],
      },
    ],
    citations: [
      {
        articleId: "rule-tournament-5",
        quote:
          "対局中、選手はスマートウォッチを含む電子機器を身に着けてはならない。",
        relevance: "大会規定で電子機器の着用を禁止している",
      },
      {
        articleId: "rule-fide-11-3",
        quote:
          "During play, a player is forbidden to have any electronic device not specifically approved by the arbiter",
        relevance: "FIDE の一般規定",
      },
    ],
    confidence: "medium",
    escalationRecommended: false,
    missingInformation: [],
    ...overrides,
  };
}
