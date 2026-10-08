import { describe, it, expect } from "vitest";
import {
  findSpeculativeLanguage,
  normalizeForQuote,
  quoteMatchesArticle,
  validateLlmDecisionDraft,
} from "@/lib/domain/llm/output-validator";
import {
  buildLlmDecision,
  LLM_REJECTED_CONCLUSION,
} from "@/lib/domain/llm/llm-decision";
import { fixedProviders } from "../helpers";
import { ARTICLES, ARTICLE_FIDE_11_3, validDraft } from "./fixtures";

function validate(
  raw: unknown,
  opts: { category?: "player-behavior" | "fair-play"; stored?: string[] } = {}
) {
  return validateLlmDecisionDraft({
    raw,
    articles: ARTICLES,
    storedArticleIds: opts.stored,
    category: opts.category ?? "player-behavior",
  });
}

function errorsOf(raw: unknown, opts?: Parameters<typeof validate>[1]) {
  const r = validate(raw, opts);
  if (r.valid) throw new Error("expected invalid");
  return r.errors.join("\n");
}

describe("validateLlmDecisionDraft", () => {
  it("accepts a well-formed draft whose quotes match the stored article text", () => {
    const r = validate(validDraft());
    expect(r.valid).toBe(true);
  });

  describe("schema", () => {
    it("rejects non-object output", () => {
      expect(errorsOf("just text")).toMatch(/JSON/);
      expect(errorsOf(null)).toMatch(/JSON/);
    });

    it("rejects missing conclusion / invalid enums / wrong types", () => {
      expect(errorsOf(validDraft({ conclusion: "" }))).toMatch(/conclusion/);
      expect(errorsOf(validDraft({ intervention: "wait-next-move" }))).toMatch(
        /intervention/
      );
      expect(errorsOf(validDraft({ confidence: "certain" }))).toMatch(
        /confidence/
      );
      expect(errorsOf(validDraft({ escalationRecommended: "no" }))).toMatch(
        /escalationRecommended/
      );
      expect(errorsOf(validDraft({ actions: "stop the clock" }))).toMatch(
        /actions/
      );
      expect(
        errorsOf(
          validDraft({
            penalties: [
              {
                type: "disqualify",
                description: "x",
                sourceArticleIds: ["rule-tournament-5"],
              },
            ],
          })
        )
      ).toMatch(/penalties\[0\]\.type/);
    });

    it("rejects out-of-range time adjustments", () => {
      expect(
        errorsOf(
          validDraft({
            penalties: [
              {
                type: "time-addition-opponent",
                timeAdjustmentSeconds: 1.5,
                description: "x",
                sourceArticleIds: ["rule-tournament-5"],
              },
            ],
          })
        )
      ).toMatch(/timeAdjustmentSeconds/);
    });
  });

  describe("penalty sources", () => {
    it("rejects a penalty without sourceArticleIds", () => {
      const draft = validDraft();
      (draft.penalties as Array<Record<string, unknown>>)[0].sourceArticleIds =
        [];
      expect(errorsOf(draft)).toMatch(/根拠条文がありません/);
    });

    it("rejects a penalty that references an article not in citations", () => {
      const draft = validDraft({
        citations: [validDraft().citations[1]],
      });
      expect(errorsOf(draft)).toMatch(/citations に含まれていません/);
    });

    it("rejects a non-escalated recommendation with no citations", () => {
      expect(errorsOf(validDraft({ penalties: [], citations: [] }))).toMatch(
        /根拠条文のない推奨/
      );
    });

    it("allows an escalation without citations or penalties", () => {
      const r = validate(
        validDraft({
          conclusion: "該当する規則が見つかりませんでした。",
          actions: ["CAへ確認してください。"],
          intervention: "consult-ca",
          penalties: [],
          citations: [],
          confidence: "low",
          escalationRecommended: true,
        })
      );
      expect(r.valid).toBe(true);
    });
  });

  describe("fabricated articles", () => {
    it("rejects a cited article id that was not provided", () => {
      const draft = validDraft({
        citations: [
          ...validDraft().citations,
          {
            articleId: "rule-fide-99-9",
            quote: "The arbiter shall always expel the player.",
            relevance: "x",
          },
        ],
      });
      expect(errorsOf(draft)).toMatch(
        /rule-fide-99-9.*提示した条文に含まれていません/
      );
    });

    it("rejects a cited article that is no longer stored in IndexedDB", () => {
      expect(
        errorsOf(validDraft(), { stored: [ARTICLE_FIDE_11_3.id] })
      ).toMatch(/rule-tournament-5.*登録規則に存在しません/);
    });
  });

  describe("quotes", () => {
    it("rejects a paraphrased / mismatched quote", () => {
      const draft = validDraft({
        citations: [
          {
            articleId: "rule-tournament-5",
            quote: "選手はいかなる電子機器も会場に持ち込んではならない。",
            relevance: "x",
          },
          validDraft().citations[1],
        ],
      });
      expect(errorsOf(draft)).toMatch(
        /引用文が条文「第5条」の本文と一致しません/
      );
    });

    it("rejects a trivially short quote", () => {
      const draft = validDraft({
        citations: [
          { articleId: "rule-tournament-5", quote: "選手", relevance: "x" },
        ],
      });
      expect(errorsOf(draft)).toMatch(/一致しません/);
    });

    it("matches across whitespace, line breaks, full-width chars and curly quotes", () => {
      expect(
        quoteMatchesArticle(
          "provided the device is completely  switched off",
          ARTICLE_FIDE_11_3.content
        )
      ).toBe(true);
      expect(
        quoteMatchesArticle(
          "stored in a player's bag",
          ARTICLE_FIDE_11_3.content
        )
      ).toBe(true);
      expect(
        quoteMatchesArticle(
          "ＤＵＲＩＮＧ ＰＬＡＹ, a player is forbidden",
          ARTICLE_FIDE_11_3.content
        )
      ).toBe(true);
      expect(normalizeForQuote(" A\nb　C ")).toBe("abc");
    });

    it("accepts one ellipsis with long fragments, in order, within the gap limit", () => {
      expect(
        quoteMatchesArticle(
          "During play, a player is … specifically approved by the arbiter",
          ARTICLE_FIDE_11_3.content
        )
      ).toBe(false); // 省略部分に "forbidden" を含む（意味の反転を防ぐ）
      expect(
        quoteMatchesArticle(
          "the regulations of an event … stored in a player's bag",
          ARTICLE_FIDE_11_3.content
        )
      ).toBe(true);
      // 全角の省略記号（．．．）も正規化してから分割する
      expect(
        quoteMatchesArticle(
          "the regulations of an event．．．stored in a player's bag",
          ARTICLE_FIDE_11_3.content
        )
      ).toBe(true);
      expect(
        quoteMatchesArticle(
          "stored in a player's bag ... the regulations of an event",
          ARTICLE_FIDE_11_3.content
        )
      ).toBe(false);
    });

    it("rejects more than one ellipsis and short fragments", () => {
      expect(
        quoteMatchesArticle(
          "the regulations of an event … stored in a player's bag … completely switched off",
          ARTICLE_FIDE_11_3.content
        )
      ).toBe(false);
      expect(
        quoteMatchesArticle("D … p … a … e … v", ARTICLE_FIDE_11_3.content)
      ).toBe(false);
      expect(
        quoteMatchesArticle(
          "During play … the playing venue",
          ARTICLE_FIDE_11_3.content
        )
      ).toBe(false);
      expect(quoteMatchesArticle("electronic", ARTICLE_FIDE_11_3.content)).toBe(
        false
      );
    });

    it("rejects stitched quotes that invert the meaning (English negation in the gap)", () => {
      const content =
        "In this case the arbiter shall not declare the game lost, but shall add two minutes.";
      expect(
        quoteMatchesArticle(
          "In this case the arbiter shall … declare the game lost",
          content
        )
      ).toBe(false);
      expect(
        quoteMatchesArticle("the arbiter shall declare the game lost", content)
      ).toBe(false);
    });

    it("rejects Japanese quotes cut before a negation / prohibition", () => {
      const content =
        "競技者は、対局中に会場内で電子機器を所持してはならない。ただし大会規定で認める場合を除く。";
      expect(
        quoteMatchesArticle("競技者は、対局中に会場内で電子機器を所持", content)
      ).toBe(false);
      expect(
        quoteMatchesArticle("競技者は、対局中に…電子機器を所持…", content)
      ).toBe(false);
      expect(
        quoteMatchesArticle(
          "競技者は、対局中に会場内で電子機器を所持してはならない",
          content
        )
      ).toBe(true);
      // 省略部分に「ただし」「除く」（例外）を含む
      expect(
        quoteMatchesArticle(
          "電子機器を所持してはならない。…場合を除く。",
          content
        )
      ).toBe(false);
    });
  });

  describe("speculative language", () => {
    it.each([
      ["conclusion", { conclusion: "おそらく負けとなる。" }],
      ["conclusion", { conclusion: "負けと思われる。" }],
      ["conclusion", { conclusion: "負けになる可能性がある。" }],
      ["actions", { actions: ["負けにするかもしれない"] }],
      ["conclusion", { conclusion: "The player probably loses." }],
      ["actions", { actions: ["The arbiter might declare the game lost"] }],
    ])("rejects speculative wording in %s", (_field, override) => {
      expect(errorsOf(validDraft(override))).toMatch(/推測的な表現/);
    });

    it.each([
      [
        "citations[0].relevance",
        {
          citations: [
            { ...validDraft().citations[0], relevance: "適用される恐れがある" },
            validDraft().citations[1],
          ],
        },
      ],
      [
        "missingInformation[0]",
        { missingInformation: ["電源が入っていたようだ"] },
      ],
      ["escalationReason", { escalationReason: "The device could be allowed" }],
      ["actions[0]", { actions: ["The arbiter may declare the game lost"] }],
      ["conclusion", { conclusion: "違反と見られる。" }],
      ["conclusion", { conclusion: "It appears the player loses." }],
    ])("scans every free-text field: %s", (field, override) => {
      expect(errorsOf(validDraft(override))).toContain(
        `${field}: 推測的な表現`
      );
    });

    it("rejects speculative wording in a penalty description", () => {
      const draft = validDraft();
      (draft.penalties as Array<Record<string, unknown>>)[0].description =
        "たぶん負け";
      expect(errorsOf(draft)).toMatch(/penalties\[0\]\.description.*推測的/);
    });

    it("does not flag quotes or neutral words", () => {
      expect(findSpeculativeLanguage("新しい駒を置く")).toBeNull();
      expect(
        findSpeculativeLanguage("The arbiter shall stop the clocks")
      ).toBeNull();
      expect(findSpeculativeLanguage("Mighty")).toBeNull();
      expect(findSpeculativeLanguage("The mayor arrived")).toBeNull();
      expect(findSpeculativeLanguage("couldron")).toBeNull();
    });
  });

  describe("confidence and escalation", () => {
    it("caps 'high' confidence to medium", () => {
      const r = validate(validDraft({ confidence: "high" }));
      expect(r.valid).toBe(true);
      if (r.valid) {
        expect(r.draft.confidence).toBe("medium");
        expect(r.adjustments.join()).toMatch(/medium/);
      }
    });

    it.each(["game-loss", "both-lose", "expulsion"])(
      "forces CA escalation for a severe penalty (%s)",
      (type) => {
        const draft = validDraft();
        (draft.penalties as Array<Record<string, unknown>>)[0].type = type;
        const r = validate(draft);
        expect(r.valid).toBe(true);
        if (r.valid) {
          expect(r.draft.escalationRecommended).toBe(true);
          expect(r.draft.intervention).toBe("consult-ca");
          expect(r.adjustments.join()).toMatch(/重大な結果/);
        }
      }
    );

    it("does not force escalation for a warning", () => {
      const draft = validDraft();
      (draft.penalties as Array<Record<string, unknown>>)[0].type = "warning";
      const r = validate(draft);
      expect(r.valid && r.draft.escalationRecommended).toBe(false);
    });

    it("forces escalation and consult-ca for low confidence", () => {
      const r = validate(validDraft({ confidence: "low" }));
      expect(r.valid).toBe(true);
      if (r.valid) {
        expect(r.draft.escalationRecommended).toBe(true);
        expect(r.draft.intervention).toBe("consult-ca");
      }
    });

    it("rejects penalties for fair-play incidents and forces escalation", () => {
      expect(errorsOf(validDraft(), { category: "fair-play" })).toMatch(
        /フェアプレー/
      );
      const r = validate(validDraft({ penalties: [] }), {
        category: "fair-play",
      });
      expect(r.valid).toBe(true);
      if (r.valid) {
        expect(r.draft.escalationRecommended).toBe(true);
        expect(r.draft.intervention).toBe("consult-ca");
      }
    });
  });
});

describe("buildLlmDecision", () => {
  const input = {
    incidentId: "inc-1",
    category: "player-behavior" as const,
    rulesVersion: "FIDE-2023",
    model: "gemini-test",
    articles: ARTICLES,
  };

  it("builds an llm decision with citations from RuleSource metadata", () => {
    const d = buildLlmDecision(fixedProviders(), {
      ...input,
      raw: validDraft({ confidence: "high" }),
    });
    expect(d.generatedBy).toBe("llm");
    expect(d.validationPassed).toBe(true);
    expect(d.confidence).toBe("medium");
    expect(d.kind).toBe("recommendation");
    expect(d.llm).toMatchObject({ status: "passed", model: "gemini-test" });
    expect(d.sources).toHaveLength(2);
    expect(d.sources[0]).toMatchObject({
      article: "大会規定 第5条",
      source: "tournament",
      edition: "第1回テスト大会 大会規定 2026",
      page: 2,
      ruleId: "rule-tournament-5",
    });
    expect(d.sources[1].article).toBe("FIDE 11.3.2.1");
    expect(d.penalties[0]).toMatchObject({
      type: "game-loss",
      playerColor: "black",
    });
  });

  it("replaces an invalid draft with a CA escalation listing validation errors", () => {
    const d = buildLlmDecision(fixedProviders(), {
      ...input,
      raw: validDraft({ conclusion: "おそらく負け" }),
    });
    expect(d.generatedBy).toBe("llm");
    expect(d.validationPassed).toBe(false);
    expect(d.conclusion).toBe(LLM_REJECTED_CONCLUSION);
    expect(d.intervention).toBe("consult-ca");
    expect(d.escalationRecommended).toBe(true);
    expect(d.penalties).toEqual([]);
    expect(d.sources).toEqual([]);
    expect(d.confidence).toBe("low");
    expect(d.validationErrors?.join()).toMatch(/推測的な表現/);
    expect(d.llm?.status).toBe("rejected");
  });

  it("appends missing information to the actions", () => {
    const d = buildLlmDecision(fixedProviders(), {
      ...input,
      raw: validDraft({ missingInformation: ["着用に気付いた時刻"] }),
    });
    expect(d.actions.at(-1)).toBe("確認が必要な情報: 着用に気付いた時刻");
  });

  describe("re-identification on the device (external-ai-data-protection.md §6)", () => {
    // 送った大会規定（置き換え後）。引用の照合と前後の文脈の切り出しはこの本文で行う
    const SENT_TOURNAMENT = {
      ...ARTICLES[0],
      content:
        "対局中、選手はスマートウォッチを含む電子機器を身に着けてはならない（担当: 〈人物1〉さん）。違反した場合、その対局は負けとする。",
      sourceName: "大会規定",
      sourceVersion: undefined,
    };
    const MAP: Record<string, string> = {
      "〈選手A〉": "田中 太郎",
      "〈人物1〉": "佐藤",
    };
    const reidentify = (text: string) => {
      const unknown: string[] = [];
      const out = text.replace(/〈[^〉]+〉/g, (ph) => {
        if (MAP[ph] !== undefined) return MAP[ph];
        unknown.push(ph);
        return ph;
      });
      return { text: out, unknownPlaceholders: unknown };
    };

    it("validates and extracts quote context on the sent text, then re-identifies the displayed fields", () => {
      const d = buildLlmDecision(fixedProviders(), {
        ...input,
        articles: [SENT_TOURNAMENT, ARTICLES[1]],
        reidentify,
        localSourceLabels: {
          "rule-tournament-5": {
            sourceName: "第1回テスト大会 大会規定",
            sourceVersion: "2026",
          },
        },
        raw: validDraft({
          conclusion: "〈選手A〉は大会規定第5条により負けとなる。",
          actions: ["〈選手A〉に確認する", "〈人物1〉さんへ連絡する"],
          penalties: [
            {
              type: "game-loss",
              playerColor: "black",
              description: "〈選手A〉の電子機器の着用",
              sourceArticleIds: ["rule-tournament-5"],
            },
          ],
          escalationRecommended: true,
          escalationReason: "〈選手A〉の負けはCAが確認する",
          citations: [
            {
              articleId: "rule-tournament-5",
              quote:
                "対局中、選手はスマートウォッチを含む電子機器を身に着けてはならない",
              relevance: "x",
            },
          ],
        }),
      });
      expect(d.validationPassed).toBe(true);
      expect(d.conclusion).toBe("田中 太郎は大会規定第5条により負けとなる。");
      expect(d.actions).toEqual(["田中 太郎に確認する", "佐藤さんへ連絡する"]);
      expect(d.penalties[0].description).toBe("田中 太郎の電子機器の着用");
      expect(d.escalationReason).toBe("田中 太郎の負けはCAが確認する");
      expect(d.sources[0].edition).toBe("第1回テスト大会 大会規定 2026");
      expect(d.sources[0].quoteContext?.after).toBe("（担当: 佐藤さん）。");
      expect(d.llm?.needsReview).toBeUndefined();
    });

    it("an unknown placeholder is kept, and the decision needs review with a CA escalation", () => {
      const d = buildLlmDecision(fixedProviders(), {
        ...input,
        reidentify,
        raw: validDraft({ conclusion: "〈選手B〉に確認する。" }),
      });
      expect(d.validationPassed).toBe(true);
      expect(d.conclusion).toBe("〈選手B〉に確認する。");
      expect(d.llm?.needsReview).toBe(true);
      expect(d.llm?.message).toMatch(/〈選手B〉/);
      expect(d.escalationRecommended).toBe(true);
      expect(d.escalationReason).toMatch(/置き換え記号/);
    });
  });
});
