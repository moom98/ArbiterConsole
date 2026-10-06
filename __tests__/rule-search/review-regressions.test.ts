import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenize } from "@/lib/infrastructure/ai/tokenizer";
import {
  FulltextIndex,
  clearFulltextIndex,
  getFulltextIndex,
} from "@/lib/infrastructure/ai/fulltext-search";
import { fuseHits } from "@/lib/infrastructure/ai/hybrid-search";
import {
  buildLines,
  parseArticlesFromPages,
  validatePdfFile,
} from "@/lib/infrastructure/pdf/extractor";
import {
  ingestRulesFromPDF,
  type IngestionDeps,
  type RuleSourceMetadata,
} from "@/lib/application/rule-ingestion";
import { ArbiterDatabase } from "@/lib/infrastructure/db";
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

  it("reports the fraction of query tokens matched", () => {
    const index = new FulltextIndex(rules);
    // bi-grams: 違法 / 法手 / 手キ / キャ — only the first two exist
    const [hit] = index.search("違法手キャ");
    expect(hit.ruleId).toBe("ja-illegal");
    expect(hit.coverage).toBeCloseTo(2 / 4);
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

  it("scales the normalised fulltext score by query-token coverage", () => {
    expect(
      fuseHits(null, [{ ruleId: "weak", score: 3, coverage: 0.2 }], weights)
    ).toEqual([]);
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

describe("ingestion replacement scope by document name", () => {
  let database: ArbiterDatabase;
  beforeEach(async () => {
    database = new ArbiterDatabase();
    await database.open();
  });
  afterEach(async () => {
    await database.delete();
  });

  const deps = (): IngestionDeps => ({
    extract: async () => ({
      rules: [
        { article: "1.1", title: "a", content: "x", pageNumber: 1 },
        { article: "1.2", title: "b", content: "y", pageNumber: 2 },
      ],
      totalPages: 2,
      extractedAt: new Date(),
    }),
    embed: async (texts) => texts.map(() => [1, 0]),
    modelId: "test-model",
    database,
  });
  const jcf: RuleSourceMetadata = {
    sourceType: "JCF",
    name: "",
    version: "2023",
    language: "ja",
  };
  const file = new File(["%PDF-1.7"], "jcf.pdf", { type: "application/pdf" });

  it("keeps different JCF documents and replaces only the same name", async () => {
    await ingestRulesFromPDF(
      file,
      { ...jcf, name: "JCF競技規則" },
      undefined,
      deps()
    );
    await ingestRulesFromPDF(
      file,
      { ...jcf, name: "NAセミナー資料" },
      undefined,
      deps()
    );
    expect(await database.ruleSources.count()).toBe(2);
    expect(await database.rules.count()).toBe(4);

    await ingestRulesFromPDF(
      file,
      { ...jcf, name: "NAセミナー資料", version: "第4回 修正版" },
      undefined,
      deps()
    );
    const sources = await database.ruleSources.toArray();
    expect(sources.map((s) => `${s.name}/${s.version}`).sort()).toEqual([
      "JCF競技規則/2023",
      "NAセミナー資料/第4回 修正版",
    ]);
    expect(await database.rules.count()).toBe(4);
    expect(await database.embeddings.count()).toBe(4);
  });
});
