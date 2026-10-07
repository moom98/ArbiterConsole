import { describe, expect, it, vi } from "vitest";
import {
  fuseHits,
  hybridSearch,
  selectCandidates,
  type HybridSearchDeps,
} from "@/lib/infrastructure/ai/hybrid-search";
import {
  isRuleApplicableToTournament,
  orderByRulePriority,
} from "@/lib/domain/services/rule-priority";
import type { Rule } from "@/lib/domain/entities";
import { makeRule, makeSource } from "./fixtures";

const weights = { vectorWeight: 0.6, fulltextWeight: 0.4, minScore: 0 };

describe("fuseHits", () => {
  it("normalises unbounded fulltext scores to [0, 1] before weighting", () => {
    const fused = fuseHits(
      [
        { ruleId: "a", score: 0.9 },
        { ruleId: "b", score: 0.1 },
      ],
      [
        { ruleId: "b", score: 40 },
        { ruleId: "a", score: 10 },
      ],
      weights
    );
    const byId = Object.fromEntries(fused.map((h) => [h.ruleId, h]));
    expect(byId.b.fulltextScore).toBe(1);
    expect(byId.a.fulltextScore).toBe(0.25);
    expect(byId.a.score).toBeCloseTo(0.6 * 0.9 + 0.4 * 0.25);
    expect(byId.b.score).toBeCloseTo(0.6 * 0.1 + 0.4 * 1);
    for (const hit of fused) {
      expect(hit.score).toBeGreaterThanOrEqual(0);
      expect(hit.score).toBeLessThanOrEqual(1);
    }
    expect(fused.map((h) => h.ruleId)).toEqual(["a", "b"]);
  });

  it("applies minScore to the fused score", () => {
    const fused = fuseHits(
      [
        { ruleId: "a", score: 0.9 },
        { ruleId: "b", score: 0.2 },
      ],
      [],
      { ...weights, minScore: 0.3 }
    );
    expect(fused.map((h) => h.ruleId)).toEqual(["a"]);
  });

  it("re-weights to the available side when one side is unavailable", () => {
    const fulltextOnly = fuseHits(null, [{ ruleId: "a", score: 7 }], weights);
    expect(fulltextOnly).toEqual([
      { ruleId: "a", score: 1, fulltextScore: 1, confidence: "main" },
    ]);

    const vectorOnly = fuseHits([{ ruleId: "a", score: 0.5 }], null, weights);
    expect(vectorOnly[0].score).toBeCloseTo(0.5);
  });

  it("returns nothing when both sides are unavailable", () => {
    expect(fuseHits(null, null, weights)).toEqual([]);
  });
});

describe("rule priority", () => {
  it("orders Tournament > JCF > FIDE > commentary, stable within a group", () => {
    const items = [
      { rule: makeRule({ id: "fide-1", source: "FIDE" }) },
      { rule: makeRule({ id: "comm", source: "commentary" }) },
      { rule: makeRule({ id: "jcf", source: "JCF" }) },
      { rule: makeRule({ id: "fide-2", source: "FIDE" }) },
      { rule: makeRule({ id: "t", source: "tournament", tournamentId: "T1" }) },
    ];
    expect(orderByRulePriority(items).map((i) => i.rule.id)).toEqual([
      "t",
      "jcf",
      "fide-1",
      "fide-2",
      "comm",
    ]);
  });

  it("only applies tournament rules for an explicitly matching tournamentId", () => {
    const t1 = makeRule({ source: "tournament", tournamentId: "T1" });
    expect(isRuleApplicableToTournament(t1, "T1")).toBe(true);
    expect(isRuleApplicableToTournament(t1, "T2")).toBe(false);
    expect(isRuleApplicableToTournament(t1, undefined)).toBe(false);
    expect(
      isRuleApplicableToTournament(makeRule({ source: "FIDE" }), undefined)
    ).toBe(true);
  });
});

describe("selectCandidates", () => {
  it("excludes rules from non-active (superseded) sources", () => {
    const active = makeSource({ id: "s-new" });
    const old = makeSource({ id: "s-old", status: "superseded" });
    const rules = [
      makeRule({ id: "new", sourceId: "s-new" }),
      makeRule({ id: "old", sourceId: "s-old" }),
      makeRule({ id: "orphan", sourceId: "s-missing" }),
      makeRule({ id: "legacy" }),
    ];
    const ids = selectCandidates(
      { rules, sources: [active, old] },
      undefined
    ).map((r) => r.id);
    expect(ids).toEqual(["new", "legacy"]);
  });
});

describe("hybridSearch", () => {
  const source = makeSource({ id: "fide" });
  const jcfSource = makeSource({ id: "jcf", sourceType: "JCF" });
  const fide = makeRule({ id: "fide", source: "FIDE", sourceId: "fide" });
  const jcf = makeRule({ id: "jcf", source: "JCF", sourceId: "jcf" });
  const t1 = makeRule({ id: "t1", source: "tournament", tournamentId: "T1" });
  const t2 = makeRule({ id: "t2", source: "tournament", tournamentId: "T2" });
  const corpus = { rules: [fide, jcf, t1, t2], sources: [source, jcfSource] };

  function deps(overrides: Partial<HybridSearchDeps> = {}): HybridSearchDeps {
    return {
      loadCorpus: async () => corpus,
      vector: async (_q, candidates: readonly Rule[]) =>
        candidates.map((r) => ({
          ruleId: r.id,
          score: r.id === "fide" ? 0.9 : 0.5,
        })),
      fulltext: async (_q, candidates: readonly Rule[]) =>
        candidates.map((r) => ({ ruleId: r.id, score: 5 })),
      ...overrides,
    };
  }

  it("falls back to fulltext results when vector search fails", async () => {
    const response = await hybridSearch(
      "違法手",
      { tournamentId: undefined },
      deps({
        vector: vi.fn().mockRejectedValue(new Error("model not available")),
      })
    );
    expect(response.failures.vector).toBe("model not available");
    expect(response.results.map((r) => r.rule.id).sort()).toEqual([
      "fide",
      "jcf",
    ]);
    expect(response.results.every((r) => r.methods.includes("fulltext"))).toBe(
      true
    );
  });

  it("falls back to vector results when fulltext search fails", async () => {
    const response = await hybridSearch(
      "illegal",
      { tournamentId: undefined },
      deps({ fulltext: vi.fn().mockRejectedValue(new Error("index broken")) })
    );
    expect(response.failures.fulltext).toBe("index broken");
    expect(response.results.length).toBe(2);
  });

  it("throws only when both methods fail", async () => {
    await expect(
      hybridSearch(
        "x",
        { tournamentId: undefined },
        deps({
          vector: vi.fn().mockRejectedValue(new Error("a")),
          fulltext: vi.fn().mockRejectedValue(new Error("b")),
        })
      )
    ).rejects.toThrow(/vector: a.*fulltext: b/);
  });

  it("excludes tournament rules when no tournament is selected", async () => {
    const response = await hybridSearch(
      "x",
      { tournamentId: undefined },
      deps()
    );
    const ids = response.results.map((r) => r.rule.id);
    expect(ids).not.toContain("t1");
    expect(ids).not.toContain("t2");
  });

  it("includes only the selected tournament's rules, ranked first", async () => {
    const response = await hybridSearch("x", { tournamentId: "T1" }, deps());
    const ids = response.results.map((r) => r.rule.id);
    // FIDE has the highest relevance, but precedence is Tournament > JCF > FIDE
    expect(ids).toEqual(["t1", "jcf", "fide"]);
  });

  it("attaches the rule source for traceability", async () => {
    const response = await hybridSearch(
      "x",
      { tournamentId: undefined },
      deps()
    );
    const fideResult = response.results.find((r) => r.rule.id === "fide");
    expect(fideResult?.source?.version).toBe("2023");
  });

  it("returns empty results for a blank query without searching", async () => {
    const vector = vi.fn();
    const response = await hybridSearch(
      "  ",
      { tournamentId: undefined },
      deps({ vector })
    );
    expect(response.results).toEqual([]);
    expect(vector).not.toHaveBeenCalled();
  });
});
