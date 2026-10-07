import { describe, it, expect } from "vitest";
import {
  addCustomItem,
  assessRoundTransition,
  buildChecklistView,
  checklistProgress,
  DEFAULT_CHECKLIST_ITEMS,
  defaultTemplateEntries,
  describeTransitionWarning,
  emptyRoundChecklist,
  MAX_NOTE_LENGTH,
  moveItem,
  removeItem,
  resolveChecklistItems,
  setItemDone,
  setItemNote,
  stageForRoundStatus,
  STAGE_PHASES,
  warningsAcknowledged,
} from "@/lib/domain/services/round-checklist";
import { CITATIONS } from "@/lib/domain/rules/citations";
import type { ChecklistTemplateEntry } from "@/lib/domain/entities";
import { FIXED_NOW } from "../helpers";

const ROUND = { id: "T1:r1", tournamentId: "T1" };
const LATER = new Date(FIXED_NOW.getTime() + 60_000);

function preIds(): string[] {
  return DEFAULT_CHECKLIST_ITEMS.filter((i) => i.phase === "pre").map(
    (i) => i.id
  );
}

describe("default template (§26)", () => {
  it("covers all four phases of §26 with unique, stable ids", () => {
    const ids = DEFAULT_CHECKLIST_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const phase of ["pre", "start", "during", "post"] as const)
      expect(DEFAULT_CHECKLIST_ITEMS.some((i) => i.phase === phase)).toBe(true);
    expect(ids).toEqual(
      expect.arrayContaining([
        "pre-clock-setting",
        "pre-scoresheets",
        "pre-devices",
        "start-clocks",
        "during-incidents",
        "post-result-signed",
        "post-results-recorded",
        "post-incidents-reviewed",
      ])
    );
  });

  it("cites only catalogued verbatim sources (no invented citations)", () => {
    const catalog = Object.values(CITATIONS);
    for (const item of DEFAULT_CHECKLIST_ITEMS) {
      for (const c of item.citations ?? []) {
        expect(
          catalog.some((x) => x.article === c.article && x.text === c.text),
          `${item.id}: ${c.article}`
        ).toBe(true);
      }
    }
    // 原典で確認できない項目には根拠を付けない
    const byId = new Map(DEFAULT_CHECKLIST_ITEMS.map((i) => [i.id, i]));
    expect(byId.get("pre-pairings")!.citations).toBeUndefined();
    expect(byId.get("during-incidents")!.citations).toBeUndefined();
    expect(
      byId.get("pre-clock-placement")!.citations!.map((c) => c.article)
    ).toContain("FIDE 6.5");
    expect(
      byId.get("start-clocks")!.citations!.map((c) => c.article)
    ).toContain("FIDE 6.6");
    expect(
      byId.get("post-result-signed")!.citations!.map((c) => c.article)
    ).toContain("FIDE 8.7");
  });

  it("adds the tournament time control to the clock-setting item", () => {
    const items = resolveChecklistItems(null, {
      timeControl: { initialMinutes: 90, incrementSeconds: 30 },
    });
    expect(items.find((i) => i.id === "pre-clock-setting")!.detail).toBe(
      "大会設定: 90分+30秒"
    );
    // 大会情報なしでは補足なし（既定値を仮定しない）
    expect(
      resolveChecklistItems(null).find((i) => i.id === "pre-clock-setting")!
        .detail
    ).toBeUndefined();
  });
});

describe("phase from round status", () => {
  it("pending → pre, active → during (開始直後+対局中), completed → post", () => {
    expect(stageForRoundStatus("pending")).toBe("pre");
    expect(stageForRoundStatus("active")).toBe("during");
    expect(stageForRoundStatus("completed")).toBe("post");
    expect(STAGE_PHASES.during).toEqual(["start", "during"]);
  });

  it("view switches its current stage with the round status", () => {
    const items = resolveChecklistItems(null);
    expect(buildChecklistView(items, null, "pending").currentStage).toBe("pre");
    const active = buildChecklistView(items, null, "active");
    expect(active.currentStage).toBe("during");
    expect(active.stages.during.sections.map((s) => s.label)).toEqual([
      "開始直後",
      "対局中",
    ]);
    expect(buildChecklistView(items, null, "completed").currentStage).toBe(
      "post"
    );
  });
});

describe("completion state and progress", () => {
  it("toggles items with doneAt, keeps notes, and computes progress per stage", () => {
    const items = resolveChecklistItems(null);
    let c = emptyRoundChecklist(ROUND, FIXED_NOW);
    c = setItemDone(c, "pre-board-pieces", true, FIXED_NOW);
    c = setItemNote(c, "pre-board-pieces", "  Board 5 の駒不足  ", LATER);
    c = setItemDone(c, "pre-battery", true, LATER);
    c = setItemDone(c, "pre-battery", false, LATER);
    const state = c.items.find((s) => s.itemId === "pre-board-pieces")!;
    expect(state).toMatchObject({
      done: true,
      doneAt: FIXED_NOW,
      note: "Board 5 の駒不足",
    });
    expect(c.items.find((s) => s.itemId === "pre-battery")).toMatchObject({
      done: false,
      doneAt: undefined,
    });
    expect(c.updatedAt).toEqual(LATER);

    const view = buildChecklistView(items, c, "pending");
    expect(view.stages.pre.progress).toEqual({
      done: 1,
      total: preIds().length,
    });
    expect(view.stages.during.progress.done).toBe(0);
  });

  it("clears an empty note and rejects an overly long one", () => {
    let c = emptyRoundChecklist(ROUND, FIXED_NOW);
    c = setItemNote(c, "pre-venue", "メモ", FIXED_NOW);
    c = setItemNote(c, "pre-venue", "   ", FIXED_NOW);
    expect(c.items[0].note).toBeUndefined();
    expect(() =>
      setItemNote(c, "pre-venue", "a".repeat(MAX_NOTE_LENGTH + 1), FIXED_NOW)
    ).toThrow();
  });

  it("ignores states of items that were removed from the template", () => {
    const entries = removeItem(defaultTemplateEntries(), "pre-fbo");
    let c = emptyRoundChecklist(ROUND, FIXED_NOW);
    c = setItemDone(c, "pre-fbo", true, FIXED_NOW);
    const view = buildChecklistView(
      resolveChecklistItems(entries),
      c,
      "pending"
    );
    expect(view.stages.pre.progress).toEqual({
      done: 0,
      total: preIds().length - 1,
    });
  });

  it("checklistProgress counts done items", () => {
    expect(
      checklistProgress([{ done: true }, { done: false }, { done: true }])
    ).toEqual({ done: 2, total: 3 });
  });
});

describe("per-tournament customisation", () => {
  it("adds a custom item at the end of its phase without citations", () => {
    const entries = addCustomItem(defaultTemplateEntries(), {
      id: "custom-1",
      phase: "pre",
      label: "  消毒液の配置  ",
    });
    const items = resolveChecklistItems(entries);
    const pre = items.filter((i) => i.phase === "pre");
    expect(pre[pre.length - 1]).toEqual({
      id: "custom-1",
      phase: "pre",
      label: "消毒液の配置",
      custom: true,
    });
    // フェーズの境界の直後（開始直後の項目より前）
    expect(items.indexOf(pre[pre.length - 1]) + 1).toBe(
      items.findIndex((i) => i.phase === "start")
    );
  });

  it("adds to an empty template and to a phase that has no items yet", () => {
    let entries: ChecklistTemplateEntry[] = [];
    entries = addCustomItem(entries, { id: "a", phase: "post", label: "A" });
    entries = addCustomItem(entries, { id: "b", phase: "pre", label: "B" });
    entries = addCustomItem(entries, { id: "c", phase: "during", label: "C" });
    expect(entries.map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("validates custom items", () => {
    const base = defaultTemplateEntries();
    expect(() =>
      addCustomItem(base, { id: "x", phase: "pre", label: " " })
    ).toThrow("項目名");
    expect(() =>
      addCustomItem(base, { id: "x", phase: "pre", label: "a".repeat(81) })
    ).toThrow();
    expect(() =>
      addCustomItem(base, { id: "pre-venue", phase: "pre", label: "x" })
    ).toThrow("重複");
  });

  it("removes and reorders items within a phase only", () => {
    const base = defaultTemplateEntries();
    const ids = preIds();
    const moved = moveItem(base, ids[1], -1);
    expect(
      resolveChecklistItems(moved)
        .filter((i) => i.phase === "pre")
        .map((i) => i.id)
        .slice(0, 2)
    ).toEqual([ids[1], ids[0]]);
    // 先頭を上へ・フェーズ最後を下へ（次のフェーズへ越えない）は変化なし
    expect(moveItem(base, ids[0], -1)).toEqual(base);
    expect(moveItem(base, ids[ids.length - 1], 1)).toEqual(base);
    expect(moveItem(base, "unknown", 1)).toEqual(base);
    expect(
      resolveChecklistItems(removeItem(base, "pre-fbo")).some(
        (i) => i.id === "pre-fbo"
      )
    ).toBe(false);
  });

  it("drops unknown built-in ids from stored templates", () => {
    expect(
      resolveChecklistItems([
        { kind: "builtin", id: "no-longer-exists" },
        { kind: "builtin", id: "pre-venue" },
      ]).map((i) => i.id)
    ).toEqual(["pre-venue"]);
  });
});

describe("round transition warnings", () => {
  const items = resolveChecklistItems(null);

  it("start with incomplete pre-round items → warning listing them", () => {
    let c = emptyRoundChecklist(ROUND, FIXED_NOW);
    for (const id of preIds().slice(1)) c = setItemDone(c, id, true, FIXED_NOW);
    const a = assessRoundTransition({
      status: "pending",
      to: "active",
      items,
      checklist: c,
      pendingIncidentCount: 3, // 開始時は Incident を確認しない
    });
    expect(a.warnings).toEqual([
      { kind: "incomplete-pre-round", items: [items[0].label] },
    ]);
    expect(describeTransitionWarning(a.warnings[0])).toBe(
      "開始前チェックが1件未完了です"
    );
  });

  it("start with all pre-round items done → no warning (during items do not matter)", () => {
    let c = emptyRoundChecklist(ROUND, FIXED_NOW);
    for (const id of preIds()) c = setItemDone(c, id, true, FIXED_NOW);
    expect(
      assessRoundTransition({
        status: "pending",
        to: "active",
        items,
        checklist: c,
        pendingIncidentCount: 0,
      }).warnings
    ).toEqual([]);
  });

  it("end with pending incidents → warning; none pending → no warning", () => {
    const a = assessRoundTransition({
      status: "active",
      to: "completed",
      items,
      checklist: null,
      pendingIncidentCount: 2,
    });
    expect(a.warnings).toEqual([{ kind: "pending-incidents", count: 2 }]);
    expect(describeTransitionWarning(a.warnings[0])).toContain("2件");
    expect(
      assessRoundTransition({
        status: "active",
        to: "completed",
        items,
        checklist: null,
        pendingIncidentCount: 0,
      }).warnings
    ).toEqual([]);
  });

  it("rejects invalid transitions", () => {
    for (const [status, to] of [
      ["pending", "completed"],
      ["completed", "active"],
      ["active", "pending"],
    ] as const)
      expect(() =>
        assessRoundTransition({
          status,
          to,
          items,
          checklist: null,
          pendingIncidentCount: 0,
        })
      ).toThrow();
  });
});

describe("warningsAcknowledged", () => {
  const pre = (items: string[]) =>
    ({ kind: "incomplete-pre-round", items }) as const;
  const pending = (count: number) =>
    ({ kind: "pending-incidents", count }) as const;

  it("accepts the same or fewer warnings", () => {
    expect(warningsAcknowledged([pre(["A"])], [pre(["A", "B"])])).toBe(true);
    expect(warningsAcknowledged([pending(1)], [pending(2)])).toBe(true);
    expect(warningsAcknowledged([], [pending(1)])).toBe(true);
  });

  it("re-asks for a new kind, a new incomplete item or more pending incidents", () => {
    expect(warningsAcknowledged([pending(1)], [])).toBe(false);
    expect(warningsAcknowledged([pending(1)], [pre(["A"])])).toBe(false);
    expect(warningsAcknowledged([pre(["A", "C"])], [pre(["A", "B"])])).toBe(
      false
    );
    expect(warningsAcknowledged([pending(3)], [pending(2)])).toBe(false);
  });
});
