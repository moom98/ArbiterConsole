import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QUESTIONS } from "@/lib/domain/follow-up";

type Outcome = {
  byQuestion?: Record<string, "present" | "missing">;
  notice?: string;
};
const send = vi.fn(async (): Promise<Outcome> => ({
  byQuestion: { clockTimeSubtype: "present", flagFallen: "missing" },
}));
const prepare = vi.fn(async (_input: unknown) => ({
  status: "needs-confirmation" as const,
  preview: {
    destination: "報告文の記載の確認（Jev（TypeSafe））",
    fields: [{ label: "送る記述", text: "〈選手A〉のフラッグが落ちた" }],
    notes: [],
  },
  send,
}));

vi.mock("@/lib/application/fact-presence", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("@/lib/application/fact-presence")>();
  return {
    ...orig,
    // 対象の fact のしきい値を持つ較正が登録された状態として扱う
    canOfferFactPresenceCheck: (
      input: Parameters<typeof orig.canOfferFactPresenceCheck>[0]
    ) =>
      orig.canOfferFactPresenceCheck(input, [
        {
          model: "jev-1.13.0",
          dataset: { id: "t", version: "0", tuningSize: 0, heldOutSize: 0 },
          createdAt: "2026-10-10",
          category: { medium: 0.9, prefill: 0.8 },
          presence: { "ct.event": 0.9, "ct.zero-side": 0.9 },
          metrics: {},
        },
      ]),
    prepareFactPresenceCheck: (input: unknown) => prepare(input),
  };
});

import { FactPresenceCheck } from "@/components/features/FactPresenceCheck";
import {
  FollowUpQuestions,
  PRESENCE_MISSING_HEADING,
  PRESENCE_PRESENT_HEADING,
} from "@/components/features/FollowUpQuestions";

const QS = [QUESTIONS.clockTimeSubtype, QUESTIONS.flagFallen];
const INPUT = {
  category: "clock-time" as const,
  description: "田中太郎のフラッグが落ちた",
  questions: QS,
};

describe("FactPresenceCheck", () => {
  beforeEach(() => {
    send.mockClear();
    prepare.mockClear();
  });
  afterEach(cleanup);

  it("nothing is prepared or sent until tapped; sends only after confirmation", async () => {
    const onResult = vi.fn();
    render(<FactPresenceCheck input={INPUT} onResult={onResult} />);
    expect(prepare).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "AIで報告文の記載を確認（任意）" })
    );
    expect(await screen.findByText("〈選手A〉のフラッグが落ちた")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "確認して記載を確認" }));
    expect(await screen.findByText(/質問を並べ替えました/)).toBeTruthy();
    expect(onResult).toHaveBeenCalledWith({
      clockTimeSubtype: "present",
      flagFallen: "missing",
    });
  });

  it("uncalibrated or failed: shows the notice only; nothing is reordered", async () => {
    send.mockImplementationOnce(async () => ({
      notice: "このAIの判定はまだ較正されていないため、並べ替えていません",
    }));
    const onResult = vi.fn();
    render(<FactPresenceCheck input={INPUT} onResult={onResult} />);
    fireEvent.click(
      screen.getByRole("button", { name: "AIで報告文の記載を確認（任意）" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "確認して記載を確認" })
    );
    expect(await screen.findByText(/較正されていない/)).toBeTruthy();
    expect(onResult).not.toHaveBeenCalled();
    expect(screen.queryByText(/質問を並べ替えました/)).toBeNull();
  });

  it("a thrown error is shown as a failure, not swallowed", async () => {
    send.mockImplementationOnce(async () => {
      throw new Error("network");
    });
    const onResult = vi.fn();
    render(<FactPresenceCheck input={INPUT} onResult={onResult} />);
    fireEvent.click(
      screen.getByRole("button", { name: "AIで報告文の記載を確認（任意）" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "確認して記載を確認" })
    );
    expect(await screen.findByText(/記載の確認に失敗しました/)).toBeTruthy();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("a result arriving after unmount is dropped", async () => {
    let release: () => void = () => {};
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ byQuestion: { flagFallen: "present" } });
        })
    );
    const onResult = vi.fn();
    const { unmount } = render(
      <FactPresenceCheck input={INPUT} onResult={onResult} />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "AIで報告文の記載を確認（任意）" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "確認して記載を確認" })
    );
    unmount();
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(onResult).not.toHaveBeenCalled();
  });

  it("declining sends nothing and changes nothing", async () => {
    const onResult = vi.fn();
    render(<FactPresenceCheck input={INPUT} onResult={onResult} />);
    fireEvent.click(
      screen.getByRole("button", { name: "AIで報告文の記載を確認（任意）" })
    );
    fireEvent.click(await screen.findByRole("button", { name: "送らない" }));
    expect(send).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    expect(screen.getByText(/外部AIには送信していません/)).toBeTruthy();
  });

  it("is not shown when no question can be checked", () => {
    const { container } = render(
      <FactPresenceCheck
        input={{ ...INPUT, questions: [QUESTIONS.positionFen] }}
        onResult={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("FollowUpQuestions with presence", () => {
  afterEach(cleanup);

  it("missing questions come first under their heading; all questions stay", () => {
    render(
      <FollowUpQuestions
        questions={QS}
        onSubmit={vi.fn()}
        presence={{ clockTimeSubtype: "present", flagFallen: "missing" }}
      />
    );
    const missing = screen.getByRole("region", {
      name: PRESENCE_MISSING_HEADING,
    });
    const present = screen.getByRole("region", {
      name: PRESENCE_PRESENT_HEADING,
    });
    expect(missing.textContent).toContain(QUESTIONS.flagFallen.label);
    expect(present.textContent).toContain(QUESTIONS.clockTimeSubtype.label);
    expect(
      missing.compareDocumentPosition(present) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // 値は埋めない: どの選択肢も選ばれていない
    expect(screen.queryAllByRole("button", { pressed: true })).toEqual([]);
  });

  it("without presence, no headings", () => {
    render(<FollowUpQuestions questions={QS} onSubmit={vi.fn()} />);
    expect(screen.queryByText(PRESENCE_MISSING_HEADING)).toBeNull();
  });
});
