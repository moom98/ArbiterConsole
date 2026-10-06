import { describe, expect, it } from "vitest";
import {
  FulltextIndex,
  clearFulltextIndex,
  getFulltextIndex,
} from "@/lib/infrastructure/ai/fulltext-search";
import { makeRule } from "./fixtures";

const rules = [
  makeRule({
    id: "ja-illegal",
    source: "JCF",
    article: "7.5.4",
    title: "違法手の処理",
    content: "違法手が完了した場合、1回目は相手の持ち時間に2分を加える。",
  }),
  makeRule({
    id: "ja-clock",
    source: "JCF",
    article: "6.2",
    title: "時計の操作",
    content: "プレーヤーは着手と同じ手で時計を押さなければならない。",
  }),
  makeRule({
    id: "en-illegal",
    source: "FIDE",
    article: "7.5.5",
    title: "Illegal moves",
    content:
      "For the second completed illegal move the arbiter shall declare the game lost.",
  }),
];

describe("FulltextIndex", () => {
  const index = new FulltextIndex(rules);

  it("finds Japanese rules with a Japanese query", () => {
    expect(index.search("違法手")[0]?.ruleId).toBe("ja-illegal");
    expect(index.search("時計押し忘れ")[0]?.ruleId).toBe("ja-clock");
  });

  it("finds Japanese rules by a single kanji", () => {
    expect(index.search("時").map((h) => h.ruleId)).toContain("ja-clock");
  });

  it("finds rules by exact article number", () => {
    expect(index.search("7.5.4")[0]?.ruleId).toBe("ja-illegal");
    expect(index.search("7.5.5")[0]?.ruleId).toBe("en-illegal");
  });

  it("matches sub-articles by article prefix", () => {
    const ids = index.search("7.5").map((h) => h.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["ja-illegal", "en-illegal"]));
  });

  it("is case-insensitive for English queries, with prefix matching", () => {
    expect(index.search("ILLEGAL")[0]?.ruleId).toBe("en-illegal");
    expect(index.search("arbit").map((h) => h.ruleId)).toContain("en-illegal");
  });

  it("returns nothing for empty or unmatched queries", () => {
    expect(index.search("   ")).toEqual([]);
    expect(index.search("キャスリング")).toEqual([]);
  });
});

describe("getFulltextIndex", () => {
  it("shares one in-flight build between concurrent callers", async () => {
    clearFulltextIndex();
    let loads = 0;
    const load = async () => {
      loads++;
      return rules;
    };
    const [a, b] = await Promise.all([
      getFulltextIndex(load),
      getFulltextIndex(load),
    ]);
    expect(a).toBe(b);
    expect(loads).toBe(1);
    await getFulltextIndex(load);
    expect(loads).toBe(1);

    clearFulltextIndex();
    await getFulltextIndex(load);
    expect(loads).toBe(2);
    clearFulltextIndex();
  });
});
