import { describe, it, expect } from "vitest";
import {
  extractQuoteContext,
  quoteMatchesArticle,
} from "@/lib/domain/llm/quote-match";

describe("quoteMatchesArticle – residual inversion cases", () => {
  it("rejects a quote preceded by an English negation", () => {
    const content =
      "No player shall be allowed to leave the playing venue without permission from the arbiter.";
    expect(
      quoteMatchesArticle(
        "shall be allowed to leave the playing venue",
        content
      )
    ).toBe(false);
    expect(
      quoteMatchesArticle(
        "No player shall be allowed to leave the playing venue",
        content
      )
    ).toBe(true);
  });

  it("rejects a Japanese prefix negation (不/無)", () => {
    const content = "対局者は対局中に不正確な棋譜を記入してはならない。";
    expect(quoteMatchesArticle("正確な棋譜を記入して", content)).toBe(false);
  });

  it.each([
    [
      "対局中に電子機器を所持する",
      "競技者は対局中に電子機器を所持することはできない。",
    ],
    [
      "アービターは時計を止める",
      "この場合、アービターは時計を止めるわけではない。",
    ],
    ["対局者はドローを申し出る", "対局者はドローを申し出るとは限らない。"],
    [
      "選手は会場を離れてよい",
      "選手は会場を離れてよい場合を除き、着席していること。",
    ],
  ])(
    "rejects a Japanese quote cut before a trailing negation: %s",
    (quote, content) => {
      expect(quoteMatchesArticle(quote, content)).toBe(false);
    }
  );

  it.each([
    "only if the opponent can checkmate",
    "unless the opponent cannot checkmate",
    "except when the position is dead",
    "provided that the opponent can checkmate",
  ])("rejects an English quote followed by a qualifier: …lost %s", (tail) => {
    const content = `The arbiter shall declare the game lost ${tail}.`;
    expect(
      quoteMatchesArticle("the arbiter shall declare the game lost", content)
    ).toBe(false);
  });

  it("still accepts a complete clause", () => {
    const content =
      "For the second completed illegal move by the same player the arbiter shall declare the game lost by this player.";
    expect(
      quoteMatchesArticle(
        "the arbiter shall declare the game lost by this player",
        content
      )
    ).toBe(true);
  });

  it.each([
    [
      "競技者は電子機器を対局場に持ち込ん",
      "競技者は電子機器を対局場に持ち込んではならない。",
    ],
    [
      "競技者は電子機器を対局場に持ち込んで",
      "競技者は電子機器を対局場に持ち込んではならない。",
    ],
    [
      "対局中に他の対局の棋譜を読ん",
      "対局者は対局中に他の対局の棋譜を読んではいけない。",
    ],
    [
      "対局者は飲食物を対局場に持ち込ん",
      "対局者は飲食物を対局場に持ち込んではならない。",
    ],
  ])("rejects a quote cut before a ん+で prohibition: %s", (quote, content) => {
    expect(quoteMatchesArticle(quote, content)).toBe(false);
  });

  it("looks back to the sentence start for an English negation (>30 chars)", () => {
    const content =
      "No player, having been warned once for this offence during the same game, shall be allowed to continue the game.";
    expect(
      quoteMatchesArticle("shall be allowed to continue the game", content)
    ).toBe(false);
  });

  it.each([
    "No player, in accordance with Article 6.5, shall be permitted to leave the playing venue without permission.",
    "No player, e.g. a junior, shall be permitted to leave the playing venue without permission.",
    "No player (see Art. 11.2) shall be permitted to leave the playing venue without permission.",
  ])(
    "article numbers and abbreviations do not hide a leading negation: %s",
    (content) => {
      expect(
        quoteMatchesArticle(
          "shall be permitted to leave the playing venue",
          content
        )
      ).toBe(false);
    }
  );

  it("does not carry a negation over from the previous sentence", () => {
    const content =
      "The arbiter shall not intervene. The player may claim a draw under Article 9.2 at any time.";
    expect(
      quoteMatchesArticle(
        "The player may claim a draw under Article 9.2",
        content
      )
    ).toBe(true);
  });
});

describe("extractQuoteContext – full sentence for display", () => {
  it("returns the whole sentence with the quote split out for highlighting", () => {
    const content =
      "7.5.5 After the action taken under Article 7.5.1, the arbiter shall give two minutes extra time to his/her opponent. However, the game is drawn if the opponent cannot checkmate.";
    const ctx = extractQuoteContext(
      "the arbiter shall give two minutes extra time",
      content
    );
    expect(ctx).toEqual({
      before: "7.5.5 After the action taken under Article 7.5.1, ",
      match: "the arbiter shall give two minutes extra time",
      after: " to his/her opponent.",
    });
  });

  it("maps back across PDF line breaks and full-width characters (Japanese)", () => {
    const content =
      "第4条 電子機器。対局中、選手は スマート\nウォッチを含む電子機器を身に着けてはならない。違反した場合は負けとする。";
    const ctx = extractQuoteContext(
      "選手はスマートウォッチを含む電子機器を身に着けてはならない",
      content
    );
    expect(ctx?.before).toBe("対局中、");
    expect(ctx?.match).toBe(
      "選手は スマート\nウォッチを含む電子機器を身に着けてはならない"
    );
    expect(ctx?.after).toBe("。");
  });

  it("spans both fragments of an ellipsis quote", () => {
    const content =
      "However, the regulations of an event may allow such devices to be stored in a player’s bag, provided the device is completely switched off.";
    const ctx = extractQuoteContext(
      "the regulations of an event … stored in a player's bag",
      content
    );
    expect(ctx?.before).toBe("However, ");
    expect(ctx?.match).toBe(
      "the regulations of an event may allow such devices to be stored in a player’s bag"
    );
    expect(ctx?.after).toBe(
      ", provided the device is completely switched off."
    );
  });

  it("returns null when the quote does not match", () => {
    expect(
      extractQuoteContext("not in the text at all here", "abc.")
    ).toBeNull();
  });
});
