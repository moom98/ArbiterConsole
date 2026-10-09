import { describe, it, expect } from "vitest";
import { presenceTargets } from "@/lib/domain/facts";
import {
  QUESTIONS,
  groupQuestionsByPresence,
  type FollowUpQuestion,
} from "@/lib/domain/follow-up";

/** J2-2: 記載の有無で質問を並べ替える（fact-model.md §4.3）。省略しない・値を埋めない */

describe("presenceTargets", () => {
  it("maps DT questions to presence-checkable facts only", () => {
    expect(
      presenceTargets("clock-time", undefined, [
        "clockTimeSubtype",
        "flagFallen",
        "lastPeriod", // 設定から求める fact（derivedFrom）は対象外
        "positionFen", // 端末内だけの fact（localOnly）は対象外
        "situationNote", // 対応する fact がない
      ])
    ).toEqual([
      { questionId: "clockTimeSubtype", factId: "ct.event" },
      { questionId: "flagFallen", factId: "ct.zero-side" },
    ]);
  });

  it("touch move: maps the observed facts; skips computed values and local-only facts", () => {
    const ids = presenceTargets("illegal-move", "touch-move", [
      "touchHow",
      "touchPromotion", // tch.special は値を計算で渡す（キャスリングの記載で「昇格あり」にしない）
      "touchedPieces",
      "touchFen",
    ]).map((t) => t.questionId);
    expect(ids).toContain("touchHow");
    expect(ids).not.toContain("touchPromotion");
    expect(ids).not.toContain("touchFen");
  });

  it("illegal move: the subtype question maps to im.action", () => {
    expect(
      presenceTargets("illegal-move", undefined, ["subtype"]).map(
        (t) => t.factId
      )
    ).toEqual(["im.action"]);
  });

  it("returns nothing for a category without usages", () => {
    expect(presenceTargets("fair-play", undefined, ["situationNote"])).toEqual(
      []
    );
  });
});

describe("groupQuestionsByPresence", () => {
  const a = QUESTIONS.clockTimeSubtype;
  const b = QUESTIONS.flagFallen;
  const child: FollowUpQuestion = {
    ...QUESTIONS.bothFlagsOrder,
    showWhen: { questionId: "flagFallen", values: ["both"] },
  };
  const c = QUESTIONS.endedBeforeFlag;
  const all = [a, b, child, c];

  it("missing first, present after; nothing is dropped", () => {
    const g = groupQuestionsByPresence(all, {
      clockTimeSubtype: "present",
      flagFallen: "missing",
      endedBeforeFlag: "present",
    });
    expect(g.missing.map((q) => q.id)).toEqual([
      "flagFallen",
      "bothFlagsOrder",
    ]);
    expect(g.present.map((q) => q.id)).toEqual([
      "clockTimeSubtype",
      "endedBeforeFlag",
    ]);
    expect(g.missing.length + g.present.length).toBe(all.length);
  });

  it("a showWhen child follows its root question, whatever its own result", () => {
    const g = groupQuestionsByPresence(all, {
      flagFallen: "present",
      bothFlagsOrder: "missing",
    });
    expect(g.present.map((q) => q.id)).toEqual([
      "flagFallen",
      "bothFlagsOrder",
    ]);
  });

  it("questions without a result are treated as missing", () => {
    const g = groupQuestionsByPresence(all, {});
    expect(g.missing).toEqual(all);
    expect(g.present).toEqual([]);
  });
});
