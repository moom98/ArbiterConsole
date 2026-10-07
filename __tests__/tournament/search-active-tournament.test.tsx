import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Rule } from "@/lib/domain/entities";
import type { HybridSearchOptions } from "@/lib/infrastructure/ai/hybrid-search";
import { makeRule, makeSource } from "../rule-search/fixtures";

const fideSource = makeSource({ id: "fide-src" });
const corpus = {
  rules: [
    makeRule({
      id: "fide",
      source: "FIDE",
      sourceId: "fide-src",
      article: "FIDE-7.5.5",
    }),
    makeRule({
      id: "t-active",
      source: "tournament",
      tournamentId: "T-ACTIVE",
      article: "大会-5",
    }),
    makeRule({
      id: "t-other",
      source: "tournament",
      tournamentId: "T-OTHER",
      article: "他大会-5",
    }),
  ],
  sources: [fideSource],
};

const calls: HybridSearchOptions[] = [];

// 実際の hybridSearch（優先順位付け・大会フィルタ）を、固定コーパスで実行する
vi.mock("@/lib/infrastructure/ai", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/infrastructure/ai/hybrid-search")
  >("@/lib/infrastructure/ai/hybrid-search");
  return {
    hybridSearch: (query: string, options: HybridSearchOptions) => {
      calls.push(options);
      return actual.hybridSearch(query, options, {
        loadCorpus: async () => corpus,
        vector: async (_q: string, candidates: readonly Rule[]) =>
          candidates.map((r) => ({
            ruleId: r.id,
            score: r.id === "fide" ? 0.95 : 0.6,
          })),
        fulltext: async (_q: string, candidates: readonly Rule[]) =>
          candidates.map((r) => ({ ruleId: r.id, score: 5 })),
      });
    },
  };
});

import SearchPage from "@/app/(tabs)/search/page";
import { db } from "@/lib/infrastructure/db";
import { useTournamentStore } from "@/lib/stores/tournament-store";
import { tournament } from "./fixtures";

describe("Search page with the active tournament", () => {
  beforeEach(async () => {
    calls.length = 0;
    await Promise.all(db.tables.map((t) => t.clear()));
    useTournamentStore.setState({ active: null, tournaments: [], rounds: [] });
  });
  afterEach(cleanup);

  async function search() {
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "違法手" },
    });
    fireEvent.click(screen.getByRole("button", { name: "検索" }));
    return screen.findAllByRole("button", { name: /FIDE-7.5.5|大会-5/ });
  }

  it("passes the active tournament id and ranks its regulations first (Tournament > FIDE)", async () => {
    await db.tournaments.put(tournament({ id: "T-ACTIVE", name: "秋季大会" }));
    await db.appState.put({
      key: "activeTournamentId",
      value: "T-ACTIVE",
      updatedAt: new Date(),
    });
    render(<SearchPage />);
    expect(await screen.findByText("大会規定を優先: 秋季大会")).toBeTruthy();

    const cards = await search();
    expect(calls.at(-1)?.tournamentId).toBe("T-ACTIVE");
    expect(cards[0].textContent).toContain("大会-5");
    expect(cards.some((c) => c.textContent?.includes("FIDE-7.5.5"))).toBe(true);
    expect(screen.queryByText(/他大会-5/)).toBeNull();
  });

  it("excludes tournament regulations when no tournament is selected", async () => {
    render(<SearchPage />);
    expect(
      await screen.findByText("大会未選択（大会固有規定は検索対象外）")
    ).toBeTruthy();
    const cards = await search();
    expect(calls.at(-1)?.tournamentId).toBeUndefined();
    expect(cards.map((c) => c.textContent).join()).not.toContain("大会-5");
  });
});
