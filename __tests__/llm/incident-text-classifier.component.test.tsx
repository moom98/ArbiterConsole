import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/application/llm-classification", () => ({
  classifyIncidentText: vi.fn(async () => ({
    classification: {
      category: "player-behavior",
      missingInformation: [],
      followUpQuestions: ["電源は切れていましたか？"],
      needsTournamentRules: true,
      confidence: "medium",
      method: "llm",
    },
  })),
}));

import { IncidentTextClassifier } from "@/components/features/IncidentTextClassifier";

describe("IncidentTextClassifier", () => {
  it("shows the suggestion as a pre-fill only and applies it on confirmation", async () => {
    const onApply = vi.fn();
    render(<IncidentTextClassifier onApply={onApply} />);
    fireEvent.change(screen.getByLabelText("状況を入力して分類（任意）"), {
      target: { value: "黒がスマートウォッチを着けている" },
    });
    fireEvent.click(screen.getByRole("button", { name: "カテゴリを提案" }));

    expect(await screen.findByText("AI分類（提案）")).toBeTruthy();
    expect(screen.getByText("プレイヤー行動")).toBeTruthy();
    expect(screen.getByText("大会規定を確認")).toBeTruthy();
    expect(screen.getByText("電源は切れていましたか？")).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "このカテゴリで続ける" })
    );
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ category: "player-behavior" }),
      "黒がスマートウォッチを着けている"
    );
  });
});
