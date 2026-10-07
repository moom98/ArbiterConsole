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

    it("accepts ellipsis fragments only in order", () => {
      expect(
        quoteMatchesArticle(
          "During play … in the playing venue",
          ARTICLE_FIDE_11_3.content
        )
      ).toBe(true);
      expect(
        quoteMatchesArticle(
          "in the playing venue ... During play, a player",
          ARTICLE_FIDE_11_3.content
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
});
