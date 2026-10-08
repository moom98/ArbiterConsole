import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExistingSourceDecisionRequired,
  ingestRulesFromPDF,
  saveRuleSource,
  type IngestionDeps,
  type RuleSourceMetadata,
} from "@/lib/application/rule-ingestion";
import { ArbiterDatabase } from "@/lib/infrastructure/db";
import {
  deleteRuleSource,
  findActiveSourcesInScope,
  getImportScopeInfo,
} from "@/lib/application/rule-library";
import { selectCandidates } from "@/lib/infrastructure/ai/hybrid-search";
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

  it("requires an explicit choice when an active source of the type exists", async () => {
    await ingestRulesFromPDF(file, fideMeta, undefined, deps());
    const extract = vi.fn(deps().extract);
    await expect(
      ingestRulesFromPDF(
        file,
        { ...fideMeta, version: "2025" },
        undefined,
        deps({ extract })
      )
    ).rejects.toBeInstanceOf(ExistingSourceDecisionRequired);
    // checked before the (slow) PDF extraction
    expect(extract).not.toHaveBeenCalled();
    expect(await database.ruleSources.count()).toBe(1);
  });

  it("supersede: old edition is kept as superseded and excluded from search", async () => {
    await ingestRulesFromPDF(file, fideMeta, undefined, deps());
    await ingestRulesFromPDF(
      file,
      { ...fideMeta, version: "2025", onExisting: "supersede" },
      undefined,
      deps()
    );

    const sources = await database.ruleSources.toArray();
    expect(sources.map((s) => `${s.version}:${s.status}`).sort()).toEqual([
      "2023:superseded",
      "2025:active",
    ]);

    const corpus = { rules: await database.rules.toArray(), sources };
    const active = sources.find((s) => s.status === "active")!;
    const candidates = selectCandidates(corpus, undefined);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((r) => r.sourceId === active.id)).toBe(true);
  });

  it("keep-both: both sources stay active", async () => {
    const jcf = {
      ...fideMeta,
      sourceType: "JCF" as const,
      language: "ja" as const,
    };
    await ingestRulesFromPDF(
      file,
      { ...jcf, name: "JCF競技規則" },
      undefined,
      deps()
    );
    await ingestRulesFromPDF(
      file,
      { ...jcf, name: "NAセミナー資料", onExisting: "keep-both" },
      undefined,
      deps()
    );
    const sources = await database.ruleSources.toArray();
    expect(sources.every((s) => s.status === "active")).toBe(true);
    expect(await database.rules.count()).toBe(4);
  });

  it("does not ask about sources of other types", async () => {
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

  it("keeps the embeddings created before a failure and shows retry waits", async () => {
    const messages: string[] = [];
    const result = await ingestRulesFromPDF(
      file,
      fideMeta,
      (p) => messages.push(p.message),
      deps({
        embed: async (_texts, options) => {
          options.onRetry?.(5_000);
          const error = Object.assign(new Error("rate-limited"), {
            partialVectors: [[0.5, 0.5, 0.5]],
          });
          throw error;
        },
      })
    );
    expect(result).toMatchObject({
      ruleCount: 2,
      embeddingCount: 1,
      embeddingError: "rate-limited",
    });
    const [rules, embeddings] = await Promise.all([
      database.rules.toArray(),
      database.embeddings.toArray(),
    ]);
    expect(rules).toHaveLength(2);
    expect(embeddings).toHaveLength(1);
    expect(rules.map((r) => r.id)).toContain(embeddings[0].ruleId);
    expect(messages.some((m) => /5秒待って再試行/.test(m))).toBe(true);
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

describe("saveRuleSource / deleteRuleSource", () => {
  const embeddingFor = (rule: Rule): Embedding => ({
    id: `e-${rule.id}`,
    ruleId: rule.id,
    vector: [1],
    model: MODEL,
    createdAt: new Date(0),
  });

  it("scopes the existing-source check to the same tournament", async () => {
    const t1 = makeSource({ sourceType: "tournament", tournamentId: "T1" });
    const t2 = makeSource({ sourceType: "tournament", tournamentId: "T2" });
    await saveRuleSource(database, t1, [], []);
    // a different tournament does not need a decision
    await saveRuleSource(database, t2, [], []);
    await expect(
      saveRuleSource(
        database,
        makeSource({ sourceType: "tournament", tournamentId: "T1" }),
        [],
        []
      )
    ).rejects.toBeInstanceOf(ExistingSourceDecisionRequired);
    expect(
      (await findActiveSourcesInScope(database, "tournament", "T2")).map(
        (s) => s.id
      )
    ).toEqual([t2.id]);
  });

  it("refuses tournament sources without tournamentId", async () => {
    await expect(
      saveRuleSource(database, makeSource({ sourceType: "tournament" }), [], [])
    ).rejects.toThrow();
  });

  it("removes legacy rules (without sourceId) of the same source type", async () => {
    const legacy = makeRule({ source: "FIDE" });
    await database.rules.add(legacy);
    await database.embeddings.add(embeddingFor(legacy));

    const source = makeSource();
    const fresh = makeRule({ source: "FIDE", sourceId: source.id });
    // legacy data counts as existing data: deleting it needs an explicit choice
    await expect(
      saveRuleSource(database, source, [fresh], [embeddingFor(fresh)])
    ).rejects.toMatchObject({ legacyRuleCount: 1 });
    expect(await getImportScopeInfo("FIDE", undefined, database)).toEqual({
      activeSources: [],
      legacyRuleCount: 1,
    });

    await saveRuleSource(
      database,
      source,
      [fresh],
      [embeddingFor(fresh)],
      "supersede"
    );

    expect((await database.rules.toArray()).map((r) => r.id)).toEqual([
      fresh.id,
    ]);
    expect((await database.embeddings.toArray()).map((e) => e.ruleId)).toEqual([
      fresh.id,
    ]);
  });

  it("deletes a source together with its rules and embeddings", async () => {
    const keep = makeSource({ sourceType: "JCF" });
    const drop = makeSource();
    const keepRule = makeRule({ source: "JCF", sourceId: keep.id });
    const dropRule = makeRule({ source: "FIDE", sourceId: drop.id });
    await saveRuleSource(database, keep, [keepRule], [embeddingFor(keepRule)]);
    await saveRuleSource(database, drop, [dropRule], [embeddingFor(dropRule)]);

    await deleteRuleSource(drop.id, database);

    expect((await database.ruleSources.toArray()).map((s) => s.id)).toEqual([
      keep.id,
    ]);
    expect((await database.rules.toArray()).map((r) => r.id)).toEqual([
      keepRule.id,
    ]);
    expect((await database.embeddings.toArray()).map((e) => e.ruleId)).toEqual([
      keepRule.id,
    ]);
  });
});
