import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FollowUpQuestions } from "@/components/features/FollowUpQuestions";
import { QUESTIONS } from "@/lib/domain/follow-up";

describe("FollowUpQuestions (count / text inputs)", () => {
  it("sends count defaults, stepper changes and leaves optional text out", () => {
    const onSubmit = vi.fn();
    render(
      <FollowUpQuestions
        questions={[
          QUESTIONS.whiteRooks,
          QUESTIONS.blackKnights,
          QUESTIONS.positionFen,
          QUESTIONS.materialConfirmed,
        ]}
        onSubmit={onSubmit}
      />
    );
    const submit = screen.getByRole("button", { name: "回答して再評価" });
    // 確認ボタンを押すまで送信できない（既定値 0 のままの誤送信を防ぐ）
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "ルークを増やす" }));
    fireEvent.click(screen.getByRole("button", { name: "確認した" }));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledWith({
      whiteRooks: "1",
      blackKnights: "0",
      materialConfirmed: "true",
    });
  });

  it("does not go below the minimum", () => {
    render(
      <FollowUpQuestions
        questions={[QUESTIONS.whitePawns]}
        onSubmit={vi.fn()}
      />
    );
    const minus = screen.getByRole("button", {
      name: "ポーンを減らす",
    }) as HTMLButtonElement;
    expect(minus.disabled).toBe(true);
  });
});
