import { describe, it, expect } from "vitest";
import dataset from "../fixtures/classification-eval.ja.json";
import type { IncidentCategory } from "@/lib/domain/entities";
import { INCIDENT_CATEGORIES } from "@/lib/domain/llm/classification";
import {
  CLOCK_TIME_SUBTYPE_LABELS,
  DRAW_SUBTYPE_LABELS,
  isKnownSubtype,
} from "@/lib/domain/follow-up";
import {
  NO_IDENTIFIERS,
  PlaceholderMap,
  protectIncidentText,
} from "@/lib/domain/privacy";

/**
 * J3: 分類の評価データセット（jev-classifier-design §9.1）の検証。
 *
 * - 合成の報告だけ（実際の大会の報告は使わない）。不正（fair-play）は外部 AI へ送らないため含めない
 * - カテゴリごとに 45 件。v2: v1 の 30 件はすべて tuning（01〜30）、held-out は v2 で
 *   新しく独立に書いた 15 件（31〜45）。subtype は clock-time と draw だけ
 * - すべての報告が protectIncidentText を通る（評価が Jev に実際に届く本文を測るため）
 */

interface EvalItem {
  id: string;
  category: string;
  subtype?: string;
  split: string;
  text: string;
  note?: string;
}

const items: EvalItem[] = dataset.items;
const PER_CATEGORY = 45;
const TUNING_PER_CATEGORY = 30;
const HELDOUT_PER_CATEGORY = 15;
const SUBTYPED: readonly IncidentCategory[] = ["clock-time", "draw"];
const EVALUATED = INCIDENT_CATEGORIES.filter((c) => c !== "fair-play");

const isCategory = (c: string): c is IncidentCategory =>
  (INCIDENT_CATEGORIES as readonly string[]).includes(c);

const byCategory = (category: IncidentCategory) =>
  items.filter((i) => i.category === category);

describe("classification evaluation dataset (jev-classifier-design §9.1)", () => {
  it("has the expected shape and unique ids", () => {
    expect(dataset.id).toBe("classification-eval-ja");
    expect(dataset.version).toBe("2");
    expect(dataset.description).toMatch(/synthetic/i);
    const ids = new Set<string>();
    for (const item of items) {
      expect(item.id, JSON.stringify(item)).toMatch(/^[a-z]{2}-\d{2}$/);
      expect(ids.has(item.id), item.id).toBe(false);
      ids.add(item.id);
      expect(["tuning", "heldout"], item.id).toContain(item.split);
      expect(item.text.trim().length, item.id).toBeGreaterThan(0);
      if (item.note !== undefined) expect(typeof item.note).toBe("string");
    }
    // 同じ本文が二度あると、tuning と heldout が重なりうる
    expect(new Set(items.map((i) => i.text)).size).toBe(items.length);
  });

  it("uses only known categories and never fair-play", () => {
    for (const item of items) {
      expect(isCategory(item.category), item.id).toBe(true);
      expect(item.category, item.id).not.toBe("fair-play");
    }
  });

  it.each(EVALUATED)("%s: 45 items, 30 tuning and 15 held-out", (category) => {
    const list = byCategory(category);
    expect(list).toHaveLength(PER_CATEGORY);
    expect(list.filter((i) => i.split === "tuning")).toHaveLength(
      TUNING_PER_CATEGORY
    );
    expect(list.filter((i) => i.split === "heldout")).toHaveLength(
      HELDOUT_PER_CATEGORY
    );
    // 1 つのカテゴリの id は同じ接頭辞
    expect(new Set(list.map((i) => i.id.slice(0, 2))).size).toBe(1);
  });

  // v2: v1 の項目（01〜30）はすべて tuning、held-out は v2 で追加した 31〜45 だけ
  it("uses the v1 items as tuning and only the new v2 items as held-out", () => {
    for (const item of items) {
      const n = Number(item.id.slice(3));
      expect(item.split, item.id).toBe(
        n <= TUNING_PER_CATEGORY ? "tuning" : "heldout"
      );
      expect(n, item.id).toBeGreaterThanOrEqual(1);
      expect(n, item.id).toBeLessThanOrEqual(PER_CATEGORY);
    }
  });

  it("has a subtype exactly on clock-time and draw items, and it is known", () => {
    for (const item of items) {
      if (!isCategory(item.category)) continue;
      if (SUBTYPED.includes(item.category)) {
        expect(item.subtype, item.id).toBeDefined();
        expect(isKnownSubtype(item.category, item.subtype!), item.id).toBe(
          true
        );
      } else {
        expect(item.subtype, item.id).toBeUndefined();
      }
    }
  });

  it("covers every clock-time and draw subtype", () => {
    const count = (category: IncidentCategory, subtype: string) =>
      byCategory(category).filter((i) => i.subtype === subtype).length;
    // flag-fall と other はおよそ半々
    for (const subtype of Object.keys(CLOCK_TIME_SUBTYPE_LABELS))
      expect(count("clock-time", subtype), subtype).toBeGreaterThanOrEqual(10);
    // draw はすべての subtype を 2 件以上
    for (const subtype of Object.keys(DRAW_SUBTYPE_LABELS))
      expect(count("draw", subtype), subtype).toBeGreaterThanOrEqual(2);
  });

  it("covers every clock-time and draw subtype in the held-out split", () => {
    const count = (category: IncidentCategory, subtype: string) =>
      byCategory(category).filter(
        (i) => i.split === "heldout" && i.subtype === subtype
      ).length;
    // flag-fall と other はおよそ半々（15 件のうち各 6 件以上）
    for (const subtype of Object.keys(CLOCK_TIME_SUBTYPE_LABELS))
      expect(count("clock-time", subtype), subtype).toBeGreaterThanOrEqual(6);
    // draw はすべての subtype を 1 件以上、other は 1 件まで
    for (const subtype of Object.keys(DRAW_SUBTYPE_LABELS))
      expect(count("draw", subtype), subtype).toBeGreaterThanOrEqual(1);
    expect(count("draw", "other")).toBeLessThanOrEqual(1);
  });

  // 評価は Jev に実際に届く本文で行う（§9.1: Every report goes through external-ai-guard）。
  // 通らない報告はガードを弱めずに書き直す
  it.each(items.map((i) => [i.id, i.text] as const))(
    "%s passes protectIncidentText (classify)",
    (_id, text) => {
      const r = protectIncidentText({
        route: "classify",
        text,
        identifiers: NO_IDENTIFIERS,
        map: new PlaceholderMap(),
      });
      expect(r.ok).toBe(true);
    }
  );
});
