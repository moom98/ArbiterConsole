import { describe, it, expect } from "vitest";
import sensitive from "../fixtures/privacy/sensitive.ja.json";
import context from "../fixtures/privacy/context-expressions.ja.json";
import benign from "../fixtures/privacy/benign.ja.json";
import review1 from "../fixtures/privacy/sensitive-review1.ja.json";
import review2 from "../fixtures/privacy/sensitive-review2.ja.json";
import review3 from "../fixtures/privacy/sensitive-review3.ja.json";
import benignReview from "../fixtures/privacy/benign-review.ja.json";
import {
  CONTEXT_EXPRESSIONS,
  NO_IDENTIFIERS,
  PlaceholderMap,
  evaluateSensitivity,
  protectIncidentText,
} from "@/lib/domain/privacy";

/** 送信までの全体（A〜E）を通した結果。true なら送られる */
const sentByPipeline = (text: string) =>
  protectIncidentText({
    route: "classify",
    text,
    identifiers: NO_IDENTIFIERS,
    map: new PlaceholderMap(),
  }).ok;

/**
 * Sensitive Gate の評価（external-ai-data-protection §8.1。リリースの条件）。
 * 合成データだけを使う。偽陰性は重大度1: 見逃した表現は修正とともにここへ加える。
 */
describe("Sensitive Gate evaluation (release gate)", () => {
  const CLASSES = [
    "fair-play",
    "health",
    "harassment",
    "crime",
    "religion",
    "family-minors",
  ];

  it("has at least 30 synthetic reports per sensitive class (>= 180)", () => {
    expect(sensitive.cases.length).toBeGreaterThanOrEqual(180);
    for (const cls of CLASSES)
      expect(
        sensitive.cases.filter((c) => c.class === cls).length,
        cls
      ).toBeGreaterThanOrEqual(30);
  });

  it("0 false negatives: no sensitive report reaches clear", () => {
    const falseNegatives = sensitive.cases.filter(
      (c) => evaluateSensitivity({ text: c.text }).verdict === "clear"
    );
    expect(falseNegatives).toEqual([]);
  });

  it("0 false negatives on the reviewer's independent set (now a regression set)", () => {
    expect(review1.cases.length).toBeGreaterThanOrEqual(100);
    const falseNegatives = review1.cases.filter(
      (c) => evaluateSensitivity({ text: c.text }).verdict === "clear"
    );
    expect(falseNegatives).toEqual([]);
  });

  it("0 false negatives on the second reviewer's set (now a regression set)", () => {
    expect(review2.cases.length).toBeGreaterThanOrEqual(100);
    const falseNegatives = review2.cases.filter(
      (c) => evaluateSensitivity({ text: c.text }).verdict === "clear"
    );
    expect(falseNegatives).toEqual([]);
  });

  it("0 false negatives on the third reviewer's set (now a regression set)", () => {
    expect(review3.cases.length).toBeGreaterThanOrEqual(200);
    const falseNegatives = review3.cases.filter(
      (c) => evaluateSensitivity({ text: c.text }).verdict === "clear"
    );
    expect(falseNegatives).toEqual([]);
  });

  it("0 sensitive reports are sent through the whole pipeline (every set)", () => {
    const all = [
      ...sensitive.cases,
      ...review1.cases,
      ...review2.cases,
      ...review3.cases,
    ];
    expect(all.filter((c) => sentByPipeline(c.text))).toEqual([]);
  });

  it("usefulness: at most 20% of the reviewers' realistic non-sensitive reports are held back (tracked)", () => {
    const held = benignReview.cases.filter((c) => !sentByPipeline(c.text));
    console.info(
      `Held back (local fallback): ${held.length}/${benignReview.cases.length}`
    );
    expect(held.length / benignReview.cases.length).toBeLessThanOrEqual(0.2);
  });

  // 登録簿（L3）の判定を確かめる。既知の語彙（L3v）は別に確かめる（sensitive-gate.test）
  it("every context-expression case gives its expected verdict (L3, without L3v)", () => {
    const wrong = context.cases
      .map((c) => ({
        ...c,
        actual: evaluateSensitivity({ text: c.text, vocabulary: false })
          .verdict,
      }))
      .filter((c) => c.actual !== c.expected);
    expect(wrong).toEqual([]);
  });

  it("every registry entry has its evaluation cases", () => {
    for (const e of CONTEXT_EXPRESSIONS) {
      const cases = context.cases.filter((c) => c.entry === e.id);
      const count = (v: string) => cases.filter((c) => c.expected === v).length;
      expect(count("blocked"), `${e.id} blocked`).toBeGreaterThanOrEqual(3);
      if (e.benign.length > 0)
        expect(count("clear"), `${e.id} clear`).toBeGreaterThanOrEqual(3);
      else expect(count("clear"), `${e.id} clear`).toBe(0);
      // A.1 が常に止める語（顔色・意識・警察 など）には uncertain の例がない
      const alwaysBlocked = cases.every((c) => c.expected === "blocked");
      if (!alwaysBlocked)
        expect(count("uncertain"), `${e.id} uncertain`).toBeGreaterThanOrEqual(
          3
        );
    }
  });

  it("false-positive rate on the non-sensitive set (secondary, tracked; FN come first)", () => {
    const byCategory = new Map<string, { total: number; fp: number }>();
    let fp = 0;
    for (const c of benign.cases) {
      const s = byCategory.get(c.category) ?? { total: 0, fp: 0 };
      s.total++;
      if (evaluateSensitivity({ text: c.text }).verdict !== "clear") {
        s.fp++;
        fp++;
      }
      byCategory.set(c.category, s);
    }
    // 件数の記録（カテゴリごとの目標 15% は追跡のみ。偽陰性を増やして下げてはならない）
    console.info(
      "Sensitive Gate FP by category:",
      Array.from(byCategory)
        .map(([k, s]) => `${k} ${s.fp}/${s.total}`)
        .join(", ")
    );
    expect(fp / benign.cases.length).toBeLessThanOrEqual(0.2);
  });
});
