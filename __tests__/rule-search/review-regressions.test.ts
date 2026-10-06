import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenize } from "@/lib/infrastructure/ai/tokenizer";
import {
  FulltextIndex,
  clearFulltextIndex,
  getFulltextIndex,
} from "@/lib/infrastructure/ai/fulltext-search";
import {
  fuseHits,
  hybridSearch,
  type HybridSearchDeps,
} from "@/lib/infrastructure/ai/hybrid-search";
import {
  buildLines,
  parseArticlesFromPages,
  validatePdfFile,
} from "@/lib/infrastructure/pdf/extractor";
import { makeRule } from "./fixtures";

const weights = { vectorWeight: 0.6, fulltextWeight: 0.4, minScore: 0.25 };

const rules = [
  makeRule({
    id: "ja-illegal",
    source: "JCF",
    article: "7.5.4",
    title: "違法手の処理",
    content: "違法手が完了した場合、相手の持ち時間に2分を加える。",
  }),
  makeRule({ id: "en", article: "7.5.5", content: "illegal move" }),
];

describe("tokenizer prefixes and stop words", () => {
  it("keeps guideline/appendix numbers with roman or letter prefixes", () => {
    expect(tokenize("Guidelines III.4 and A.4")).toEqual([
      "guidelines",
      "iii.4",
      "a.4",
    ]);
  });

  it("drops English stop words (same at index and query time)", () => {
    expect(tokenize("the arbiter of the game")).toEqual(["arbiter", "game"]);
  });
});

describe("fulltext coverage and index invalidation", () => {
  afterEach(() => clearFulltextIndex());

  it("reports IDF-weighted coverage of the query's content tokens", () => {
    const index = new FulltextIndex(rules);
    // bi-grams: 違法 / 法手 / 手キ / キャ — only the first two exist
    const [partial] = index.search("違法手キャ");
    expect(partial.ruleId).toBe("ja-illegal");
    expect(partial.coverage).toBeGreaterThan(0);
    expect(partial.coverage).toBeLessThan(1);
    expect(index.search("違法手")[0].coverage).toBe(1);
    expect(index.search("7.5")[0].coverage).toBe(1);
  });

  it("rebuilds when the data stamp changes (import in another tab)", async () => {
    clearFulltextIndex();
    let loads = 0;
    const load = async () => {
      loads++;
      return rules;
    };
    await getFulltextIndex(load, "v1");
    await getFulltextIndex(load, "v1");
    expect(loads).toBe(1);
    await getFulltextIndex(load, "v2");
    expect(loads).toBe(2);
  });

  it("does not cache an index whose build was cleared mid-flight", async () => {
    clearFulltextIndex();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let loads = 0;
    const pending = getFulltextIndex(async () => {
      loads++;
      await gate;
      return rules;
    });
    clearFulltextIndex();
    release();
    await pending;
    await getFulltextIndex(async () => {
      loads++;
      return [];
    });
    expect(loads).toBe(2);
  });
});

describe("fuseHits gating", () => {
  it("ignores vector similarity below vectorMinSimilarity", () => {
    const fused = fuseHits(
      [
        { ruleId: "noise", score: 0.45 },
        { ruleId: "relevant", score: 0.7 },
      ],
      [],
      { ...weights, vectorMinSimilarity: 0.5 }
    );
    expect(fused.map((h) => h.ruleId)).toEqual(["relevant"]);
  });

  it("ranks by coverage-dampened fulltext score", () => {
    const fused = fuseHits(
      [],
      [
        { ruleId: "partial", score: 10, coverage: 0.2 },
        { ruleId: "complete", score: 9, coverage: 1 },
      ],
      weights
    );
    expect(fused.map((h) => h.ruleId)).toEqual(["complete", "partial"]);
  });

  it("fulltext-only: substantive hits are main regardless of minScore", () => {
    const fused = fuseHits(
      null,
      [
        { ruleId: "top", score: 10, coverage: 0.4 },
        { ruleId: "weak", score: 5, coverage: 0.1 },
        { ruleId: "tail", score: 0.5, coverage: 0.9 },
      ],
      { ...weights, minScore: 0.9 }
    );
    expect(fused.map((h) => [h.ruleId, h.confidence])).toEqual([
      ["top", "main"],
      ["weak", "related"],
    ]);
  });

  it("both sides: keeps substantive top fulltext hits below minScore as main", () => {
    const fulltext = [1, 2, 3, 4].map((i) => ({
      ruleId: `ft${i}`,
      score: 10 - i,
      coverage: 0.5,
    }));
    const fused = fuseHits(
      fulltext.map((h) => ({ ruleId: h.ruleId, score: 0.2 })),
      fulltext,
      { ...weights, minScore: 0.9, vectorMinSimilarity: 0.5 }
    );
    expect(
      fused.filter((h) => h.confidence === "main").map((h) => h.ruleId)
    ).toEqual(["ft1", "ft2", "ft3"]);
  });

  it("both sides: non-substantive top fulltext hits become related only", () => {
    const fulltext = [1, 2, 3, 4].map((i) => ({
      ruleId: `ft${i}`,
      score: 10 - i,
      coverage: 0.1,
    }));
    const fused = fuseHits(
      fulltext.map((h) => ({ ruleId: h.ruleId, score: 0.2 })),
      fulltext,
      { ...weights, vectorMinSimilarity: 0.5 }
    );
    expect(fused.every((h) => h.confidence === "related")).toBe(true);
    expect(fused.map((h) => h.ruleId)).toEqual(["ft1", "ft2", "ft3"]);
  });
});

describe("Japanese natural-language queries (offline / weak vector)", () => {
  const corpusRules = [
    makeRule({
      id: "11.3",
      source: "FIDE",
      article: "11.3",
      title: "電子機器",
      content:
        "対局中、対局者は携帯電話その他の電子機器を会場に持ち込んではならない。対局者の携帯電話が鳴った場合、その対局者は負けとなる。罰則は大会規定で変更できる。",
    }),
    makeRule({
      id: "6.2",
      source: "FIDE",
      article: "6.2",
      title: "時計の操作",
      content:
        "対局者は着手と同じ手で時計を押さなければならない。時計を押し忘れた場合、相手は指摘できる。",
    }),
    makeRule({
      id: "9.2",
      source: "FIDE",
      article: "9.2",
      title: "三回同一局面",
      content: "同一局面が三回現れた場合、対局者の請求によりドローとなる。",
    }),
    makeRule({
      id: "jcf-1.1",
      source: "JCF",
      article: "1.1",
      title: "対局者の義務",
      content:
        "対局者は対局中、会場を離れる場合はアービターの許可を得なければならない。",
    }),
  ];
  const fulltext = async (q: string) =>
    new FulltextIndex(corpusRules).search(q);
  const search = (query: string, vector: HybridSearchDeps["vector"]) =>
    hybridSearch(
      query,
      { tournamentId: undefined },
      {
        loadCorpus: async () => ({ rules: corpusRules, sources: [] }),
        vector,
        fulltext,
      }
    );
  const vectorFails = vi.fn().mockRejectedValue(new Error("model missing"));
  const lowVector: HybridSearchDeps["vector"] = async (_q, candidates) =>
    candidates.map((r) => ({ ruleId: r.id, score: 0.2 }));

  const longQuestion = "携帯電話が鳴ったときの罰則はどうなりますか";
  const irrelevant = "対局者が食事をする場合";

  it("long question: content coverage stays high despite many bi-grams", () => {
    const [hit] = new FulltextIndex(corpusRules).search(longQuestion);
    expect(hit.ruleId).toBe("11.3");
    expect(hit.coverage).toBeGreaterThan(0.5);
  });

  it("long question: 11.3 first when vector search fails", async () => {
    const response = await search(longQuestion, vectorFails);
    expect(response.failures.vector).toBeDefined();
    expect(response.results.map((r) => r.rule.id)).toEqual(["11.3"]);
  });

  it("long question: 11.3 first when vector similarity is low", async () => {
    const response = await search(longQuestion, lowVector);
    expect(response.results.map((r) => r.rule.id)).toEqual(["11.3"]);
  });

  it("irrelevant question: no main results when vector search fails", async () => {
    const response = await search(irrelevant, vectorFails);
    expect(response.results).toEqual([]);
    // generic matches (対局者 / 場合) are offered only as possibly related
    expect(response.related.length).toBeGreaterThan(0);
    expect(response.related.length).toBeLessThanOrEqual(3);
  });

  it("irrelevant question: no main results when vector similarity is low", async () => {
    const response = await search(irrelevant, lowVector);
    expect(response.results).toEqual([]);
  });

  it("generic JCF matches do not outrank a relevant FIDE rule", async () => {
    const response = await search("時計を押し忘れた場合", vectorFails);
    expect(response.results.map((r) => r.rule.id)).toEqual(["6.2"]);
    expect(response.related.map((r) => r.rule.id)).not.toContain("6.2");
  });
});

describe("Japanese article branch numbers and sub-paragraphs", () => {
  it("tokenises 第N条のM as N-M and 第N条 as N", () => {
    expect(tokenize("第3条の2")).toEqual(["3-2"]);
    expect(tokenize("第 7 条に従う")).toEqual(["7", "に従", "従う"]);
  });

  it("keeps (a)-style sub-paragraph markers", () => {
    expect(tokenize("Article 6.10 (a) and (ii)")).toEqual([
      "article",
      "6.10",
      "(a)",
      "(ii)",
    ]);
  });

  it("parses 第N条のM as its own article and does not merge it into 第N条", () => {
    const parsed = parseArticlesFromPages([
      {
        pageNumber: 4,
        lines: [
          "第3条 時計",
          "時計を押す。",
          "第3条の2 電子機器",
          "携帯電話を持ち込まない。",
        ],
      },
    ]);
    expect(parsed.map((r) => [r.article, r.title])).toEqual([
      ["3", "時計"],
      ["3-2", "電子機器"],
    ]);
  });

  it("finds 第3条の2 by the same notation in a query", () => {
    const index = new FulltextIndex([
      makeRule({ id: "a3", article: "3", content: "時計" }),
      makeRule({ id: "a3-2", article: "3-2", content: "電子機器" }),
    ]);
    expect(index.search("第3条の2")[0]?.ruleId).toBe("a3-2");
  });
});

describe("article parsing regressions", () => {
  it("does not treat a wrapped cross-reference as a heading", () => {
    const parsed = parseArticlesFromPages([
      {
        pageNumber: 1,
        lines: [
          "7.5.5 After the action taken as specified in Article",
          "7.5.4 the arbiter shall declare the game lost by this player.",
          "7.6 If, during a game, it is found that pieces have been displaced",
        ],
      },
    ]);
    expect(parsed.map((r) => r.article)).toEqual(["7.5.5", "7.6"]);
    expect(parsed[0].content).toContain("declare the game lost");
  });

  it("parses roman-numeral and appendix prefixes", () => {
    const parsed = parseArticlesFromPages([
      {
        pageNumber: 9,
        lines: ["III.4 Quickplay finish", "A.4.2 Rapid illegal move"],
      },
    ]);
    expect(parsed.map((r) => r.article)).toEqual(["III.4", "A.4.2"]);
  });

  it("does not treat a bare integer as a heading", () => {
    expect(
      parseArticlesFromPages([{ pageNumber: 1, lines: ["7 If the player"] }])
    ).toEqual([]);
  });

  it("buildLines handles empty EOL items and items without str", () => {
    const items = [
      { type: "beginMarkedContent" },
      { str: "Line one", transform: [1, 0, 0, 1, 0, 100] },
      { str: "", hasEOL: true, transform: [1, 0, 0, 1, 0, 100] },
      { str: "", hasEOL: true, transform: [1, 0, 0, 1, 0, 90] },
      { type: "endMarkedContent" },
      { str: "Line two", transform: [1, 0, 0, 1, 0, 80] },
    ];
    expect(buildLines(items)).toEqual(["Line one", "Line two"]);
  });

  it("accepts a %PDF- header that appears after leading bytes", async () => {
    const blob = new Blob(["\n\n   %PDF-1.4 body"]);
    await expect(
      validatePdfFile({
        name: "x.pdf",
        type: "application/pdf",
        size: blob.size,
        slice: blob.slice.bind(blob),
      })
    ).resolves.toBeUndefined();
  });
});

describe("generateEmbeddings (mocked transformers, no download)", () => {
  afterEach(() => {
    vi.doUnmock("@xenova/transformers");
    vi.resetModules();
  });

  it("splits batched output by dims, reports progress and loads the model once", async () => {
    const pipeline = vi.fn(async () =>
      vi.fn(async (texts: string[]) => {
        const dim = 2;
        const data = new Float32Array(texts.length * dim);
        texts.forEach((t, i) => {
          data[i * dim] = t.length;
          data[i * dim + 1] = i;
        });
        return { data, dims: [texts.length, dim] };
      })
    );
    const env = { backends: { onnx: { wasm: {} as Record<string, unknown> } } };
    vi.resetModules();
    vi.doMock("@xenova/transformers", () => ({ pipeline, env }));
    const generator = await import("@/lib/infrastructure/embeddings/generator");

    const progress: Array<[number, number]> = [];
    const vectors = await generator.generateEmbeddings(["a", "bb", "ccc"], {
      batchSize: 2,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(vectors).toEqual([
      [1, 0],
      [2, 1],
      [3, 0],
    ]);
    expect(progress).toEqual([
      [2, 3],
      [3, 3],
    ]);

    await Promise.all([
      generator.initEmbeddingModel(),
      generator.initEmbeddingModel(),
    ]);
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(env).toMatchObject({
      allowRemoteModels: false,
      localModelPath: "/models/",
      backends: { onnx: { wasm: { wasmPaths: "/ort/" } } },
    });
  });
});
