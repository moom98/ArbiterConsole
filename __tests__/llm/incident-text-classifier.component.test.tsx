import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const LLM_RESULT = {
  classification: {
    category: "player-behavior",
    missingInformation: [],
    followUpQuestions: ["電源は切れていましたか？"],
    needsTournamentRules: true,
    confidence: "medium",
    method: "llm",
  },
};

const send = vi.fn(async () => LLM_RESULT);
const decline = vi.fn(() => ({
  classification: null,
  notice: "外部AIには送信していません。端末内のキーワード分類を表示しています",
}));
const prepare = vi.fn(async (_text: string, _options: unknown) => ({
  status: "needs-confirmation" as const,
  preview: {
    destination: "カテゴリの提案（Gemini（Google））",
    fields: [{ label: "送る記述", text: "〈選手A〉のスマホが鳴った" }],
    notes: [],
  },
  send,
  decline,
}));

vi.mock("@/lib/application/llm-classification", () => ({
  prepareIncidentClassification: (text: string, options: unknown) =>
    prepare(text, options),
}));

import { IncidentTextClassifier } from "@/components/features/IncidentTextClassifier";

describe("IncidentTextClassifier", () => {
  beforeEach(() => {
    send.mockClear();
    decline.mockClear();
    prepare.mockClear();
  });
  afterEach(cleanup);

  function renderClassifier(doNotSend = false) {
    const onApply = vi.fn();
    const onDoNotSendChange = vi.fn();
    render(
      <IncidentTextClassifier
        onApply={onApply}
        doNotSend={doNotSend}
        onDoNotSendChange={onDoNotSendChange}
      />
    );
    fireEvent.change(screen.getByLabelText("状況を入力して分類（任意）"), {
      target: { value: "田中太郎のスマホが鳴った" },
    });
    fireEvent.click(screen.getByRole("button", { name: "カテゴリを提案" }));
    return { onApply, onDoNotSendChange };
  }

  it("shows the de-identified payload and sends only after confirmation; the suggestion is a pre-fill only", async () => {
    const { onApply } = renderClassifier();

    expect(await screen.findByText("〈選手A〉のスマホが鳴った")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "確認してAIで分類" }));

    expect(await screen.findByText("AI分類（提案）")).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByText("プレイヤー行動")).toBeTruthy();
    expect(screen.getByText("大会規定を確認")).toBeTruthy();
    expect(screen.getByText("電源は切れていましたか？")).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "このカテゴリで続ける" })
    );
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ category: "player-behavior" }),
      "田中太郎のスマホが鳴った"
    );
  });

  it("drops a response that arrives after the text was edited (no stale suggestion for new text)", async () => {
    let release: () => void = () => {};
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(LLM_RESULT);
        })
    );
    const { onApply } = renderClassifier();
    fireEvent.click(
      await screen.findByRole("button", { name: "確認してAIで分類" })
    );
    fireEvent.change(screen.getByLabelText("状況を入力して分類（任意）"), {
      target: { value: "白のフラッグが落ちた" },
    });
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("AI分類（提案）")).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("declining sends nothing", async () => {
    renderClassifier();
    fireEvent.click(await screen.findByRole("button", { name: "送らない" }));
    expect(send).not.toHaveBeenCalled();
    expect(decline).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/外部AIには送信していません/)).toBeTruthy();
  });

  it("passes the opt-out switch to the guard", async () => {
    const { onDoNotSendChange } = renderClassifier(true);
    await screen.findByText("〈選手A〉のスマホが鳴った");
    expect(prepare).toHaveBeenCalledWith("田中太郎のスマホが鳴った", {
      doNotSend: true,
    });
    fireEvent.click(screen.getByRole("switch", { name: /外部AIに送らない/ }));
    expect(onDoNotSendChange).toHaveBeenCalledWith(false);
  });
});
