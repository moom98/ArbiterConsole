import { describe, it, expect, vi } from "vitest";
import { prepareFactPresence } from "@/lib/application/external-ai-guard";
import {
  UNCALIBRATED_NOTICE,
  canOfferFactPresenceCheck,
  prepareFactPresenceCheck,
  type FactPresenceInput,
} from "@/lib/application/fact-presence";
import { QUESTIONS } from "@/lib/domain/follow-up";
import { NO_IDENTIFIERS } from "@/lib/domain/privacy";
import type { JevCalibration } from "@/lib/domain/llm/calibration";
import { answeringProviders } from "../helpers";

/**
 * J2-2: 報告文での記載の有無（fact-model.md §4, D13）。
 * 送るのは置き換え済みの記述と fact のコードだけ。確認してから送り、結果は並べ方にだけ使う
 */

const TEXT = "白のフラッグが落ちたと黒が申し立てた";
const JEV = { classify: "jev" as const, facts: true };

const INPUT: FactPresenceInput = {
  category: "clock-time",
  description: TEXT,
  questions: [
    QUESTIONS.clockTimeSubtype,
    QUESTIONS.flagFallen,
    QUESTIONS.lastPeriod,
    QUESTIONS.positionFen,
  ],
};

const CALIBRATION: JevCalibration = {
  model: "jev-1.13.0",
  dataset: { id: "synthetic", version: "0", tuningSize: 0, heldOutSize: 0 },
  createdAt: "2026-10-09",
  category: { medium: 0.5, prefill: 0.8 },
  presence: { "ct.event": 0.7, "ct.zero-side": 0.7 },
  metrics: {},
};

function deps(call: (kind: string, body: unknown) => unknown, info = JEV) {
  return {
    identifiers: async () => NO_IDENTIFIERS,
    isOnline: () => true,
    call: answeringProviders(
      vi.fn(async (kind: string, body: unknown) => call(kind, body)),
      info
    ) as never,
  };
}

describe("prepareFactPresence (guard)", () => {
  it("previews before sending; sends only the protected text and fact codes", async () => {
    const call = vi.fn(async () => ({ ok: true, result: {}, model: "m" }));
    const r = await prepareFactPresence(
      "田中太郎のフラッグが落ちた",
      ["ct.event", "ct.event", "ct.zero-side"],
      { category: "clock-time" },
      {
        identifiers: async () => ({
          ...NO_IDENTIFIERS,
          players: [{ name: "田中太郎" }],
        }),
        call: answeringProviders(call, JEV) as never,
      }
    );
    if (r.status !== "needs-confirmation") throw new Error(r.status);
    expect(call).not.toHaveBeenCalled();
    expect(r.preview.destination).toBe("報告文の記載の確認（Jev（TypeSafe））");
    // 送る fact のコードと質問文をプレビューに示す（D13）
    expect(r.preview.fields[1].label).toMatch(/確認する事実（2件/);
    expect(r.preview.fields[1].text).toContain("ct.event: ");
    expect(r.factIds).toEqual(["ct.event", "ct.zero-side"]);
    await r.send();
    const [kind, body] = call.mock.calls[0] as unknown as [
      string,
      { narrative: string; factIds: string[] },
    ];
    expect(kind).toBe("facts");
    expect(body.factIds).toEqual(["ct.event", "ct.zero-side"]);
    expect(body.narrative).not.toContain("田中太郎");
  });

  it("is unavailable when the server cannot judge facts (no upstream call)", async () => {
    const call = vi.fn();
    const r = await prepareFactPresence(
      TEXT,
      ["ct.event"],
      {},
      {
        identifiers: async () => NO_IDENTIFIERS,
        call: answeringProviders(call, {
          classify: "gemini",
          facts: false,
        }) as never,
      }
    );
    expect(r.status).toBe("unavailable");
    expect(call).not.toHaveBeenCalled();
  });

  it("the gate stops fair-play text before the providers call", async () => {
    const call = vi.fn();
    const r = await prepareFactPresence(
      "相手がトイレでスマホを見ていた。不正の疑い",
      ["ct.event"],
      {},
      { identifiers: async () => NO_IDENTIFIERS, call: call as never }
    );
    expect(r.status).toBe("local");
    expect(call).not.toHaveBeenCalled();
  });
});

describe("prepareFactPresenceCheck (application)", () => {
  it("offers the check only when a question maps to a presence-checkable fact", () => {
    const cal = [CALIBRATION];
    expect(canOfferFactPresenceCheck(INPUT, cal)).toBe(true);
    expect(
      canOfferFactPresenceCheck(
        {
          ...INPUT,
          questions: [QUESTIONS.lastPeriod, QUESTIONS.positionFen],
        },
        cal
      )
    ).toBe(false);
    expect(
      canOfferFactPresenceCheck({ ...INPUT, description: "  " }, cal)
    ).toBe(false);
    expect(
      canOfferFactPresenceCheck({ ...INPUT, category: "fair-play" }, cal)
    ).toBe(false);
  });

  it("is not offered while no calibration is registered (no send without effect)", () => {
    expect(canOfferFactPresenceCheck(INPUT)).toBe(false);
    expect(canOfferFactPresenceCheck(INPUT, [])).toBe(false);
  });

  it("is not offered when no calibration has a threshold for a target fact (J3: category-only calibration)", () => {
    expect(
      canOfferFactPresenceCheck(INPUT, [{ ...CALIBRATION, presence: {} }])
    ).toBe(false);
    // 対象外の fact のしきい値だけでは提案しない
    expect(
      canOfferFactPresenceCheck(INPUT, [
        { ...CALIBRATION, presence: { "im.clock-pressed": 0.9 } },
      ])
    ).toBe(false);
    expect(
      canOfferFactPresenceCheck(INPUT, [
        { ...CALIBRATION, presence: { "ct.event": 0.9 } },
      ])
    ).toBe(true);
  });

  it("calibrated: present facts map to their questions; the rest are missing", async () => {
    const step = await prepareFactPresenceCheck(INPUT, {
      ...deps(async () => ({
        ok: true,
        result: {
          provider: "jev",
          presence: { "ct.event": 0.9, "ct.zero-side": 0.2 },
        },
        model: "jev-1.13.0",
      })),
      calibrations: [CALIBRATION],
    });
    if (step.status !== "needs-confirmation") throw new Error(step.status);
    const out = await step.send();
    expect(out.byQuestion).toEqual({
      clockTimeSubtype: "present",
      flagFallen: "missing",
    });
    expect(out.notice).toBeUndefined();
  });

  it("uncalibrated model: nothing is ordered (not even 'missing'), with a notice", async () => {
    const step = await prepareFactPresenceCheck(
      INPUT,
      deps(async () => ({
        ok: true,
        result: { provider: "jev", presence: { "ct.event": 0.99 } },
        model: "jev-1.13.0",
      }))
    );
    if (step.status !== "needs-confirmation") throw new Error(step.status);
    const out = await step.send();
    expect(out).toEqual({ notice: UNCALIBRATED_NOTICE });
  });

  it("a failed or malformed answer orders nothing and says so", async () => {
    const failed = await prepareFactPresenceCheck(
      INPUT,
      deps(async () => ({
        ok: false,
        error: { code: "upstream-error", message: "失敗" },
      }))
    );
    if (failed.status !== "needs-confirmation") throw new Error("expected");
    expect(await failed.send()).toEqual({
      notice: expect.stringMatching(/記載の確認に失敗しました/),
    });

    const malformed = await prepareFactPresenceCheck(INPUT, {
      ...deps(async () => ({
        ok: true,
        result: { x: 1 },
        model: "jev-1.13.0",
      })),
      calibrations: [CALIBRATION],
    });
    if (malformed.status !== "needs-confirmation") throw new Error("expected");
    const out = await malformed.send();
    expect(out.byQuestion).toBeUndefined();
    expect(out.notice).toMatch(/解釈できない/);
  });

  it("offline, unavailable, opt-out: nothing is sent and a reason is given", async () => {
    const call = vi.fn();
    const offline = await prepareFactPresenceCheck(INPUT, {
      ...deps(call),
      isOnline: () => false,
    });
    expect(offline).toEqual({
      status: "none",
      notice: expect.stringMatching(/オフライン/),
    });
    const unavailable = await prepareFactPresenceCheck(
      INPUT,
      deps(call, { classify: "gemini", facts: false } as never)
    );
    expect(unavailable).toEqual({
      status: "none",
      notice: expect.stringMatching(/利用できません/),
    });
    const optOut = await prepareFactPresenceCheck(
      { ...INPUT, doNotSend: true },
      deps(call)
    );
    expect(optOut).toEqual({
      status: "none",
      notice: expect.stringMatching(/外部AIには送信していません/),
    });
    expect(call).not.toHaveBeenCalled();
  });
});
