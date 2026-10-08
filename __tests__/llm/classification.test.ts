import { describe, it, expect } from "vitest";
import {
  classifyByKeywords,
  detectPlayerColor,
} from "@/lib/domain/llm/keyword-classifier";
import { parseLlmClassification } from "@/lib/domain/llm/classification";

describe("classifyByKeywords (offline fallback)", () => {
  it.each([
    ["スマートウォッチを着けている", "player-behavior", undefined],
    ["対局中に携帯電話が鳴った", "player-behavior", undefined],
    ["黒が両手でキャスリングした", "illegal-move", undefined],
    ["白のフラッグが落ちた", "clock-time", "flag-fall"],
    ["黒の時間が落ちたけど白にはナイトしかない", "clock-time", "flag-fall"],
    ["三回同一局面を主張された", "draw", "threefold-repetition-claim"],
    ["75手ルールに達した", "draw", "75-move-rule"],
    ["白が50手ルールでドローを主張した", "draw", "fifty-move-claim"],
    ["キャプテンが選手に話しかけた", "team", undefined],
    ["バッグ検査を拒否した", "fair-play", undefined],
    ["棋譜を記入していない", "scoresheet", undefined],
    ["時計の表示が消えた", "clock-time", "other"],
  ])("%s → %s", (text, category, subtype) => {
    const c = classifyByKeywords(text);
    expect(c?.category).toBe(category);
    expect(c?.subtype).toBe(subtype);
    expect(c?.method).toBe("keyword");
    expect(c?.confidence).toBe("low");
  });

  it.each([
    "150手を超えた",
    "50手目にイリーガルムーブ",
    "50手目で反則手を指した",
  ])("does not read %s as the 50-move rule", (text) => {
    expect(classifyByKeywords(text)?.subtype).not.toBe("fifty-move-claim");
  });

  it("returns null when nothing matches", () => {
    expect(classifyByKeywords("よく分からない")).toBeNull();
  });

  it("flags categories that need tournament rules", () => {
    expect(classifyByKeywords("スマートウォッチ")?.needsTournamentRules).toBe(
      true
    );
    expect(classifyByKeywords("違法手")?.needsTournamentRules).toBe(false);
  });

  it("detects the player colour only when unambiguous", () => {
    expect(detectPlayerColor("黒が両手で")).toBe("black");
    expect(detectPlayerColor("白のフラッグ")).toBe("white");
    expect(detectPlayerColor("黒の時間が落ちたけど白には")).toBeUndefined();
  });
});

describe("parseLlmClassification", () => {
  it("normalises a valid output and caps confidence", () => {
    const c = parseLlmClassification({
      category: "player-behavior",
      subtype: "smartwatch",
      playerColor: "black",
      missingInformation: ["大会規定の電子機器の扱い"],
      followUpQuestions: ["電源は切れていましたか？"],
      needsTournamentRules: true,
      confidence: "high",
    });
    expect(c).toEqual({
      category: "player-behavior",
      subtype: undefined, // 未知の subtype は落とす
      playerColor: "black",
      missingInformation: ["大会規定の電子機器の扱い"],
      followUpQuestions: ["電源は切れていましたか？"],
      needsTournamentRules: true,
      confidence: "medium",
      method: "llm",
    });
  });

  it("keeps known subtypes", () => {
    expect(
      parseLlmClassification({ category: "clock-time", subtype: "flag-fall" })
        ?.subtype
    ).toBe("flag-fall");
  });

  it("rejects unknown categories and non-objects", () => {
    expect(parseLlmClassification({ category: "cheating" })).toBeNull();
    expect(parseLlmClassification("player-behavior")).toBeNull();
    expect(parseLlmClassification(null)).toBeNull();
  });
});
