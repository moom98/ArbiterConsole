import { describe, expect, it } from "vitest";
import { tokenize, tokenizeDetailed } from "@/lib/infrastructure/ai/tokenizer";

describe("tokenize", () => {
  it("splits Japanese runs into character bi-grams", () => {
    expect(tokenize("違法手")).toEqual(["違法", "法手"]);
    expect(tokenize("時計押し忘れ")).toEqual([
      "時計",
      "計押",
      "押し",
      "し忘",
      "忘れ",
    ]);
  });

  it("keeps a single CJK character as a unigram", () => {
    expect(tokenize("手")).toEqual(["手"]);
  });

  it("lowercases Latin words and drops punctuation", () => {
    expect(tokenize("Illegal Move, touched-piece!")).toEqual([
      "illegal",
      "move",
      "touched",
      "piece",
    ]);
  });

  it("keeps article numbers as single tokens", () => {
    expect(tokenizeDetailed("Article 7.5.4")).toEqual([
      { text: "article", kind: "word" },
      { text: "7.5.4", kind: "article" },
    ]);
    expect(tokenize("see A.4.2.")).toEqual(["see", "a.4.2"]);
  });

  it("normalises full-width characters (NFKC)", () => {
    expect(tokenize("７.５.４")).toEqual(["7.5.4"]);
    expect(tokenize("ＦＩＤＥ")).toEqual(["fide"]);
  });

  it("handles mixed Japanese / Latin / numbers", () => {
    expect(tokenize("FIDE 7.5.5 違法手2回目")).toEqual([
      "fide",
      "7.5.5",
      "違法",
      "法手",
      "2",
      "回目",
    ]);
  });
});
