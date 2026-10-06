import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ingestRulesFromPDF,
  replaceRuleSource,
  type IngestionDeps,
  type RuleSourceMetadata,
} from "@/lib/application/rule-ingestion";
import { ArbiterDatabase } from "@/lib/infrastructure/db";
import type { Embedding, Rule } from "@/lib/domain/entities";
import { makeRule, makeSource } from "./fixtures";

const MODEL = "test-model";

let database: ArbiterDatabase;

beforeEach(async () => {
  database = new ArbiterDatabase();
  await database.open();
});

afterEach(async () => {
  await database.delete();
});

function deps(overrides: Partial<IngestionDeps> = {}): IngestionDeps {
  return {
    extract: async () => ({
      rules: [
        {
          article: "7.5.4",
          title: "Illegal move",
          content: "body 1",
          pageNumber: 12,
        },
        {
          article: "7.5.5",
          title: "Second illegal",
          content: "body 2",
          pageNumber: 13,
        },
      ],
      totalPages: 40,
      extractedAt: new Date(),
    }),
    // テストではモデルをダウンロードしない
    embed: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
    modelId: MODEL,
    database,
    ...overrides,
  };
}

const fideMeta: RuleSourceMetadata = {
  sourceType: "FIDE",
  name: "FIDE Laws of Chess",
  version: "2023",
  language: "en",
};

const file = new File(["%PDF-1.7"], "laws.pdf", { type: "application/pdf" });

describe("ingestRulesFromPDF", () => {
  it("stores the source, rules with page numbers and embeddings with model id", async () => {
    const result = await ingestRulesFromPDF(file, fideMeta, undefined, deps());
    expect(result).toEqual({
      ruleCount: 2,
      embeddingCount: 2,
      embeddingError: undefined,
    });

    const [source] = await database.ruleSources.toArray();
    expect(source).toMatchObject({
      name: "FIDE Laws of Chess",
      version: "2023",
      fileName: "laws.pdf",
      totalPages: 40,
      status: "active",
    });

    const rules = await database.rules.toArray();
    expect(rules.map((r) => [r.article, r.page, r.sourceId])).toEqual(
      expect.arrayContaining([
        ["7.5.4", 12, source.id],
        ["7.5.5", 13, source.id],
      ])
    );
    const embeddings = await database.embeddings.toArray();
    expect(embeddings.every((e) => e.model === MODEL)).toBe(true);
  });

  it("replaces the previous edition without orphaning embeddings", async () => {
    await ingestRulesFromPDF(file, fideMeta, undefined, deps());
    await ingestRulesFromPDF(
      file,
      { ...fideMeta, version: "2025" },
      undefined,
      deps()
    );

    const sources = await database.ruleSources.toArray();
    expect(sources.map((s) => s.version)).toEqual(["2025"]);

    const rules = await database.rules.toArray();
    expect(rules).toHaveLength(2);
    expect(rules.every((r) => r.sourceId === sources[0].id)).toBe(true);

    const ruleIds = new Set(rules.map((r) => r.id));
    const embeddings = await database.embeddings.toArray();
    expect(embeddings).toHaveLength(2);
    expect(embeddings.every((e) => ruleIds.has(e.ruleId))).toBe(true);
  });

  it("does not touch rules of other source types", async () => {
    await ingestRulesFromPDF(
      file,
      { ...fideMeta, sourceType: "JCF", name: "NA Seminar", language: "ja" },
      undefined,
      deps()
    );
    await ingestRulesFromPDF(file, fideMeta, undefined, deps());
    expect(await database.rules.count()).toBe(4);
    expect(await database.embeddings.count()).toBe(4);
  });

  it("requires a tournamentId for tournament regulations", async () => {
    await expect(
      ingestRulesFromPDF(
        file,
        { ...fideMeta, sourceType: "tournament", name: "Regulations" },
        undefined,
        deps()
      )
    ).rejects.toThrow(/大会/);
    expect(await database.rules.count()).toBe(0);
  });

  it("still saves rules for fulltext search when embedding generation fails", async () => {
    const result = await ingestRulesFromPDF(
      file,
      fideMeta,
      undefined,
      deps({ embed: vi.fn().mockRejectedValue(new Error("offline")) })
    );
    expect(result.embeddingError).toBe("offline");
    expect(await database.rules.count()).toBe(2);
    expect(await database.embeddings.count()).toBe(0);
  });

  it("reports progress through to completion", async () => {
    const stages: string[] = [];
    await ingestRulesFromPDF(
      file,
      fideMeta,
      (p) => stages.push(p.stage),
      deps({
        embed: async (texts, options) => {
          options.onProgress?.(texts.length, texts.length);
          return texts.map(() => [1]);
        },
      })
    );
    expect(stages).toEqual(
      expect.arrayContaining([
        "extracting",
        "generating-embeddings",
        "saving",
        "complete",
      ])
    );
    expect(stages[stages.length - 1]).toBe("complete");
  });
});

describe("replaceRuleSource", () => {
  const embeddingFor = (rule: Rule): Embedding => ({
    id: `e-${rule.id}`,
    ruleId: rule.id,
    vector: [1],
    model: MODEL,
    createdAt: new Date(0),
  });

  it("only replaces tournament regulations of the same tournament", async () => {
    const t1Source = makeSource({
      sourceType: "tournament",
      tournamentId: "T1",
    });
    const t2Source = makeSource({
      sourceType: "tournament",
      tournamentId: "T2",
    });
    const t1Rule = makeRule({
      source: "tournament",
      tournamentId: "T1",
      sourceId: t1Source.id,
    });
    const t2Rule = makeRule({
      source: "tournament",
      tournamentId: "T2",
      sourceId: t2Source.id,
    });
    await replaceRuleSource(
      database,
      t1Source,
      [t1Rule],
      [embeddingFor(t1Rule)]
    );
    await replaceRuleSource(
      database,
      t2Source,
      [t2Rule],
      [embeddingFor(t2Rule)]
    );

    const newT1Source = makeSource({
      sourceType: "tournament",
      tournamentId: "T1",
    });
    const newT1Rule = makeRule({
      source: "tournament",
      tournamentId: "T1",
      sourceId: newT1Source.id,
    });
    await replaceRuleSource(
      database,
      newT1Source,
      [newT1Rule],
      [embeddingFor(newT1Rule)]
    );

    const ruleIds = (await database.rules.toArray()).map((r) => r.id).sort();
    expect(ruleIds).toEqual([newT1Rule.id, t2Rule.id].sort());
    const embeddingRuleIds = (await database.embeddings.toArray())
      .map((e) => e.ruleId)
      .sort();
    expect(embeddingRuleIds).toEqual(ruleIds);
  });

  it("refuses tournament sources without tournamentId", async () => {
    await expect(
      replaceRuleSource(
        database,
        makeSource({ sourceType: "tournament" }),
        [],
        []
      )
    ).rejects.toThrow();
  });

  it("replaces legacy rules (without sourceId) of the same source type", async () => {
    const legacy = makeRule({ source: "FIDE" });
    await database.rules.add(legacy);
    await database.embeddings.add(embeddingFor(legacy));

    const source = makeSource();
    const fresh = makeRule({ source: "FIDE", sourceId: source.id });
    await replaceRuleSource(database, source, [fresh], [embeddingFor(fresh)]);

    expect((await database.rules.toArray()).map((r) => r.id)).toEqual([
      fresh.id,
    ]);
    expect((await database.embeddings.toArray()).map((e) => e.ruleId)).toEqual([
      fresh.id,
    ]);
  });
});
