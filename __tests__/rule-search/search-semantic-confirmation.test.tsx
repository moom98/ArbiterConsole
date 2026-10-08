import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Rule } from "@/lib/domain/entities";
import type { HybridSearchOptions } from "@/lib/infrastructure/ai/hybrid-search";
import { makeRule, makeSource } from "./fixtures";

/**
 * 検索画面: キーワード結果を先に表示し、意味検索は置き換えた検索語の確認後だけ
 * （ADR-012 D13, external-ai-data-protection.md §11.2）
 */

const source = makeSource({ id: "fide-src" });
const corpus = {
  rules: [
    makeRule({ id: "a", source: "FIDE", sourceId: "fide-src", article: "A-1" }),
    makeRule({ id: "b", source: "FIDE", sourceId: "fide-src", article: "B-2" }),
  ],
  sources: [source],
};

const calls: HybridSearchOptions[] = [];
const vector = vi.fn(
  async (embed: () => Promise<number[]>, candidates: readonly Rule[]) => {
    await embed();
    return candidates.map((r) => ({ ruleId: r.id, score: 0.9 }));
  }
);

vi.mock("@/lib/infrastructure/ai", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/infrastructure/ai/hybrid-search")
  >("@/lib/infrastructure/ai/hybrid-search");
  return {
    hybridSearch: (query: string, options: HybridSearchOptions) => {
      calls.push(options);
      return actual.hybridSearch(query, options, {
        loadCorpus: async () => corpus,
        vector,
        fulltext: async (_q: string, candidates: readonly Rule[]) =>
          candidates
            .filter((r) => r.id === "a")
            .map((r) => ({ ruleId: r.id, score: 5 })),
      });
    },
    hasSemanticSearchData: async () => true,
  };
});

const embed = vi.fn(async () => [1]);
let guardResult: unknown;
vi.mock("@/lib/application/external-ai-guard", () => ({
  prepareEmbeddingQuery: vi.fn(async () => guardResult),
}));

import SearchPage from "@/app/(tabs)/search/page";

describe("Search page – semantic search only after confirming the query", () => {
  beforeEach(() => {
    calls.length = 0;
    vector.mockClear();
    embed.mockClear();
    guardResult = {
      status: "needs-confirmation",
      query: "〈選手A〉の時計",
      preview: {
        destination: "意味検索（Gemini（Google））",
        fields: [{ label: "送る検索語", text: "〈選手A〉の時計" }],
        notes: [],
      },
      send: embed,
    };
  });
  afterEach(cleanup);

  async function search() {
    render(<SearchPage />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "田中太郎の時計" },
    });
    fireEvent.click(screen.getByRole("button", { name: "検索" }));
  }

  it("shows keyword results without sending, then runs the vector search after confirmation", async () => {
    await search();
    expect(await screen.findByText("〈選手A〉の時計")).toBeTruthy();
    expect(calls[0].queryEmbedding).toBeUndefined();
    expect(vector).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "確認して意味検索も行う" })
    );
    await screen.findAllByRole("button", { name: /B-2/ });
    expect(calls.at(-1)?.queryEmbedding).toBe(embed);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "確認して意味検索も行う" })
    ).toBeNull();
  });

  it("a held-back query shows the reason and stays keyword-only", async () => {
    guardResult = { status: "local", reasons: ["health"] };
    await search();
    expect(
      await screen.findByText(/外部AIには送信していません（理由: 健康・医療/)
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "確認して意味検索も行う" })
    ).toBeNull();
    expect(embed).not.toHaveBeenCalled();
  });
});
