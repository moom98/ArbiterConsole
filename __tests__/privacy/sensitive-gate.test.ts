import { describe, it, expect } from "vitest";
import {
  CONTEXT_EXPRESSIONS,
  evaluateSensitivity,
  type GateReasonCode,
} from "@/lib/domain/privacy";

const verdict = (text: string, extra: object = {}) =>
  evaluateSensitivity({ text, ...extra }).verdict;
const codes = (text: string, extra: object = {}): GateReasonCode[] =>
  evaluateSensitivity({ text, ...extra }).reasons.map((r) => r.code);

describe("Sensitive Gate (external-ai-data-protection §4)", () => {
  describe("L0: explicit fair-play category", () => {
    it("blocks fair-play without looking at the text", () => {
      const r = evaluateSensitivity({
        text: "時計を押した",
        category: "fair-play",
      });
      expect(r).toEqual({
        verdict: "blocked",
        reasons: [{ code: "explicit-fair-play" }],
      });
    });

    it("does not block other categories by themselves", () => {
      expect(verdict("時計を押した", { category: "clock-time" })).toBe("clear");
    });
  });

  describe("L1: explicit flags", () => {
    it("the arbiter's 外部AIに送らない switch blocks", () => {
      expect(codes("時計を押した", { doNotSend: true })).toEqual([
        "arbiter-opt-out",
      ]);
      expect(verdict("時計を押した", { doNotSend: true })).toBe("blocked");
    });

    it("a fair-play flag set earlier blocks", () => {
      expect(verdict("時計を押した", { fairPlayFlag: true })).toBe("blocked");
    });
  });

  describe("L2: known sensitive expressions (each class)", () => {
    it.each([
      ["fair-play", "相手がカンニングをしている"],
      ["fair-play", "エンジンを使っている疑い"],
      ["fair-play", "ボディチェックを断った"],
      ["health", "白が体調不良を訴えた"],
      ["health", "救急車を呼んだ"],
      ["harassment", "暴言を吐かれた"],
      ["harassment", "相手を叩いた"],
      ["crime", "財布を盗まれた"],
      ["religion", "礼拝の時間"],
      ["family-minors", "保護者とトラブルになった"],
      ["english", "他の選手がsickだと言った"],
    ])("%s: %s", (cls, text) => {
      expect(verdict(text)).toBe("blocked");
      expect(codes(text)).toContain(cls);
    });

    it("keeps the katakana patterns working on hiragana spellings (folding)", () => {
      for (const text of [
        "かんにんぐの疑い",
        "ちーとを使った",
        "えんじんを使用した",
        "すまほで調べていた",
        "といれから戻らない",
      ])
        expect(verdict(text), text).toBe("blocked");
    });

    it("keeps the katakana patterns working on half-width katakana (NFKC)", () => {
      expect(verdict("ｶﾝﾆﾝｸﾞをしている")).toBe("blocked");
      expect(verdict("ｽﾏﾎで調べていた")).toBe("blocked");
    });

    it("plain けが is not folded (負けが / 見かけが stay clear)", () => {
      expect(verdict("負けが確定した")).toBe("clear");
      expect(verdict("ケガをした")).toBe("blocked");
    });
  });

  describe("L3: context-dependent expressions (each occurrence)", () => {
    it("a benign context must cover the occurrence", () => {
      expect(verdict("スマホが鳴った")).toBe("clear");
      // 2つ目の「スマホ」は安全な文脈に覆われない
      expect(verdict("スマホが鳴った。スマホを持っていた")).toBe("uncertain");
      expect(verdict("スマホが鳴ったのでスマホを見ていた")).toBe("blocked");
    });

    it("anything that is not covered is uncertain, never clear", () => {
      for (const text of [
        "白が離席した",
        "スマホを持っていた",
        "相手が抗議した",
        "手を叩いた",
        "倒れそうになった",
        "子どもが泣いている",
        "トイレに行った",
      ])
        expect(verdict(text), text).toBe("uncertain");
    });

    it("the report takes the most severe verdict", () => {
      expect(verdict("駒が倒れた。選手が倒れた")).toBe("blocked");
      expect(verdict("駒が倒れた。倒れそうになった")).toBe("uncertain");
    });

    it("every registry entry has triggers; terms without a benign context exist", () => {
      expect(CONTEXT_EXPRESSIONS.length).toBeGreaterThan(13);
      const toilet = CONTEXT_EXPRESSIONS.find((e) => e.id === "toilet");
      expect(toilet?.benign).toEqual([]);
    });

    it("deliberate non-triggers stay clear (押した, 可能性, 警告, ふたたび, 置いた)", () => {
      for (const text of [
        "手を指さずに時計を押した",
        "メイトの可能性がある",
        "2回目の違法手で警告",
        "ふたたび同じ局面",
        "駒を置いた",
      ])
        expect(verdict(text), text).toBe("clear");
    });
  });

  describe("L4: unanalyzable input", () => {
    it("mostly-Latin text is uncertain, even when it looks harmless", () => {
      expect(verdict("White made an illegal move")).toBe("uncertain");
      expect(codes("White made an illegal move")).toContain("mostly-latin");
    });

    it("Japanese with a few chess terms in Latin letters stays clear", () => {
      expect(verdict("白がe4の後にNf3と指して時計を押した")).toBe("clear");
    });

    it("too many characters outside Japanese, Latin, digits and punctuation", () => {
      expect(codes("違法手 ☺☺☺☺☺☺")).toContain("unanalyzable");
      expect(verdict("违法走子 對手 違法手")).not.toBe("blocked");
    });

    it("text over the route's limit (before truncation) is uncertain", () => {
      const text = "白が違法手を指した。".repeat(30);
      expect(verdict(text, { maxLength: 100 })).toBe("uncertain");
      expect(codes(text, { maxLength: 100 })).toContain("too-long");
      expect(verdict(text, { maxLength: 1_000 })).toBe("clear");
    });

    it("a failed residual check is uncertain", () => {
      expect(verdict("白が違法手", { residualFailed: true })).toBe("uncertain");
    });
  });

  describe("Appendix A.4 regression phrases", () => {
    it.each([
      "駒が倒れた",
      "時計を叩いた",
      "相手の時計を叩いた",
      "時計の具合が悪い",
      "違法手の疑いがある",
      "サイン漏れ",
      "熱戦の末に時間切れ",
      "薬指で駒を動かした",
      "スマホが鳴った",
      "手を指さずに時計を押した",
      "2回目の違法手で警告",
      "メイトの可能性がある",
      "ふたたび同じ局面",
      "離席中に時計が0になった",
      "裁定に抗議した",
    ])("clear: %s", (text) => expect(verdict(text)).toBe("clear"));

    it.each([
      "白が離席した",
      "スマホを持っていた",
      "相手が抗議した",
      "手を叩いた",
      "倒れそうになった",
      "子どもが泣いている",
    ])("uncertain: %s", (text) => expect(verdict(text)).toBe("uncertain"));
  });

  it("returns codes only, never the text", () => {
    const r = evaluateSensitivity({ text: "選手が倒れた。田中さん" });
    expect(JSON.stringify(r)).not.toContain("田中");
    expect(JSON.stringify(r)).not.toContain("倒れ");
  });
});
