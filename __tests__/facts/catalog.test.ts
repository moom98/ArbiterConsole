import { describe, expect, it } from "vitest";
import {
  FACT_DEFINITIONS,
  FACT_USAGES,
  ILLEGAL_MOVE_75_SUBTYPES,
  TOUCH_MOVE_SUBTYPE,
  getFactDefinition,
  referencedFacts,
  type FactCondition,
  type FactUsage,
} from "@/lib/domain/facts";
import { QUESTIONS } from "@/lib/domain/follow-up";

/** カタログ自体の整合性（データの誤りを実装前に止める） */

const usage = (factId: string, category: string): FactUsage | undefined =>
  FACT_USAGES.find((u) => u.factId === factId && u.category === category);

describe("fact catalogue: structure", () => {
  it("has unique fact ids", () => {
    const ids = FACT_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every usage refers to a defined fact, and every fact is used", () => {
    for (const u of FACT_USAGES)
      expect(getFactDefinition(u.factId)).toBeDefined();
    const used = new Set(FACT_USAGES.map((u) => u.factId));
    for (const d of FACT_DEFINITIONS) expect(used.has(d.id)).toBe(true);
  });

  it("has at most one usage per fact, category and subtype group", () => {
    const keys = FACT_USAGES.map(
      (u) => `${u.factId}|${u.category}|${(u.subtypes ?? []).join(",")}`
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every fact cites at least one source", () => {
    for (const d of FACT_DEFINITIONS)
      expect(d.sources.length).toBeGreaterThan(0);
  });

  it("choice options are unique and never use the reserved value 'unknown'", () => {
    for (const d of FACT_DEFINITIONS) {
      if (d.answer.kind !== "choice") continue;
      const values = d.answer.options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
      expect(values).not.toContain("unknown");
    }
  });

  it("local-only and derived facts are never presence-checked by Jev", () => {
    for (const d of FACT_DEFINITIONS) {
      if (d.localOnly || d.derivedFrom) expect(d.presenceCheckable).toBe(false);
      if (d.answer.kind === "structured") expect(d.localOnly).toBe(true);
    }
  });

  it("conditions only refer to facts used in the same category", () => {
    for (const u of FACT_USAGES) {
      if (!u.appliesWhen) continue;
      for (const ref of referencedFacts(u.appliesWhen)) {
        expect(
          FACT_USAGES.some(
            (o) => o.factId === ref && o.category === u.category
          ),
          `${u.factId} (${u.category}) refers to ${ref}`
        ).toBe(true);
      }
    }
  });

  it("conditions on choice facts only use values the fact offers", () => {
    const check = (c: FactCondition, owner: string) => {
      if ("all" in c) return c.all.forEach((x) => check(x, owner));
      if ("any" in c) return c.any.forEach((x) => check(x, owner));
      if (!("fact" in c) || !("in" in c)) return;
      const def = getFactDefinition(c.fact);
      const allowed =
        def?.answer.kind === "choice"
          ? def.answer.options.map((o) => o.value)
          : def?.answer.kind === "yes-no"
            ? ["true", "false"]
            : null;
      if (allowed === null) return;
      for (const v of c.in)
        expect(allowed, `${owner}: ${c.fact} has no value ${v}`).toContain(v);
    };
    for (const u of FACT_USAGES)
      if (u.appliesWhen) check(u.appliesWhen, u.factId);
  });

  it("fair-play has no facts (never sent, decided on the device only)", () => {
    expect(FACT_USAGES.filter((u) => u.category === "fair-play")).toEqual([]);
  });
});

describe("fact catalogue: mapping to Decision Tree questions", () => {
  it("every mapped DT question exists", () => {
    for (const u of FACT_USAGES)
      for (const q of u.dtQuestionIds ?? []) expect(QUESTIONS[q]).toBeDefined();
  });

  it("maps each DT question to at most one fact within a category and subtype group", () => {
    const seen = new Map<string, string>();
    for (const u of FACT_USAGES) {
      for (const q of u.dtQuestionIds ?? []) {
        const key = `${u.category}|${(u.subtypes ?? []).join(",")}|${q}`;
        expect(seen.get(key), `${q} mapped twice`).toBeUndefined();
        seen.set(key, u.factId);
      }
    }
  });
});

describe("fact catalogue: values handed to Decision Tree questions", () => {
  it("every fact value converts to a valid option of each mapped DT question", () => {
    for (const u of FACT_USAGES) {
      if (!u.dtQuestionIds || u.dtValues === "computed") continue;
      const def = getFactDefinition(u.factId);
      const values =
        def?.answer.kind === "choice"
          ? def.answer.options.map((o) => o.value)
          : def?.answer.kind === "yes-no"
            ? ["true", "false"]
            : null;
      if (values === null) continue;
      for (const q of u.dtQuestionIds) {
        const allowed = QUESTIONS[q].options.map((o) => o.value);
        if (allowed.length === 0) continue;
        for (const value of values) {
          if (u.dtUnhandled?.includes(value)) continue;
          const converted = u.dtValues?.[value] ?? value;
          expect(allowed, `${u.factId}=${value} → ${q}=${converted}`).toContain(
            converted
          );
        }
      }
    }
  });

  it("game.record-state follows every end event except 'in progress'", () => {
    const end = getFactDefinition("game.end-event");
    const endValues =
      end?.answer.kind === "choice"
        ? end.answer.options.map((o) => o.value)
        : [];
    const c = usage("game.record-state", "illegal-move")?.appliesWhen;
    expect(c && "in" in c ? [...c.in].sort() : []).toEqual(
      endValues.filter((value) => value !== "in-progress").sort()
    );
  });

  it("facts that are only derived from settings or records are never asked", () => {
    for (const id of [
      "im.count",
      "ss.current-period",
      "pb.tournament-device-rule",
    ])
      for (const u of FACT_USAGES.filter((x) => x.factId === id))
        expect(u.level, id).toBe("optional");
  });
});

describe("fact catalogue: user review points (2026-10-08)", () => {
  it("R7: next-move-written only when the claim is established by the intended move", () => {
    expect(usage("dr.next-move-written", "draw")?.appliesWhen).toEqual({
      all: [
        {
          fact: "dr.kind",
          in: ["threefold-repetition-claim", "fifty-move-claim"],
        },
        { fact: "dr.claim-timing", in: ["about-to-appear"] },
      ],
    });
  });

  it("re-review 2: there is no im.after-result; the game end is an observed event", () => {
    expect(getFactDefinition("im.after-result")).toBeUndefined();
    const endEvent = getFactDefinition("game.end-event");
    expect(endEvent?.answer.kind).toBe("choice");
    const values =
      endEvent?.answer.kind === "choice"
        ? endEvent.answer.options.map((o) => o.value)
        : [];
    expect(values).toContain("in-progress");
    expect(values).not.toContain("handshake");
  });

  it("re-review 3: the side to move comes from the last mover, not the clock", () => {
    expect(usage("dr.last-mover", "draw")?.dtQuestionIds).toEqual([
      "claimantHasMove",
    ]);
    expect(usage("dr.clock-state", "draw")?.dtQuestionIds).toBeUndefined();
    expect(usage("dr.clock-state", "draw")?.level).toBe("optional");
  });

  it("re-review 1: no piece-count facts for mate possibility", () => {
    expect(getFactDefinition("im.opponent-material")).toBeUndefined();
    expect(getFactDefinition("ct.opponent-material")).toBeUndefined();
    expect(getFactDefinition("game.position")?.localOnly).toBe(true);
  });

  it("re-review 6: threefold and 50-move claims share the claim facts", () => {
    for (const id of [
      "dr.claimant",
      "dr.claim-timing",
      "dr.last-mover",
      "dr.piece-touched",
    ])
      expect(usage(id, "draw")?.appliesWhen).toEqual({
        fact: "dr.kind",
        in: ["threefold-repetition-claim", "fifty-move-claim"],
      });
  });

  it("re-review 7: game history is local-only", () => {
    expect(getFactDefinition("game.history")?.localOnly).toBe(true);
  });

  it("re-review 8: signatures are needed for mismatches and resignation disputes too", () => {
    const c = usage("gr.signatures", "game-result")?.appliesWhen;
    expect(c).toEqual({
      fact: "gr.issue",
      in: ["mismatch", "unsigned", "resignation-dispute"],
    });
    expect(getFactDefinition("gr.recorded-result")).toBeDefined();
  });

  it("re-review 10: pb.observed-by is conditional", () => {
    expect(usage("pb.observed-by", "player-behavior")?.level).toBe(
      "conditional"
    );
  });

  it("re-review 14: bp.record does not apply to a wrong initial position", () => {
    expect(usage("bp.record", "board-piece")?.appliesWhen).toEqual({
      fact: "bp.issue",
      in: ["displaced", "fell"],
    });
  });

  it("re-review 15: touch-move facts and 7.5 facts never mix", () => {
    for (const u of FACT_USAGES) {
      if (u.factId.startsWith("tch."))
        expect(u.subtypes).toEqual([TOUCH_MOVE_SUBTYPE]);
      if (u.factId.startsWith("im.") && u.factId !== "im.action")
        expect(u.subtypes).toEqual(ILLEGAL_MOVE_75_SUBTYPES);
    }
    expect(ILLEGAL_MOVE_75_SUBTYPES).not.toContain(TOUCH_MOVE_SUBTYPE);
  });
});
