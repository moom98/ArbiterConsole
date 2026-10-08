import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FollowUpQuestions } from "@/components/features/FollowUpQuestions";
import { QUESTIONS, type FollowUpQuestion } from "@/lib/domain/follow-up";

/** count 入力の表示確認用（現在のドメインの質問には count はない） */
const COUNT: FollowUpQuestion = {
  id: "situationNote",
  scope: "incident",
  label: "ポーン",
  input: "count",
  min: 0,
  max: 8,
  defaultValue: "0",
  options: [],
};

/** フラッグ確定時の局面のラウンド（DT-004: 規定手数 → 入力方法 → FEN） */
const FLAG_ROUND: FollowUpQuestion[] = [
  QUESTIONS.movesNotCompleted,
  {
    ...QUESTIONS.matePosition,
    showWhen: { questionId: "movesNotCompleted", values: ["true"] },
  },
  QUESTIONS.positionFen,
];

describe("FollowUpQuestions (count / text inputs)", () => {
  it("sends count defaults and stepper changes", () => {
    const onSubmit = vi.fn();
    render(<FollowUpQuestions questions={[COUNT]} onSubmit={onSubmit} />);
    const minus = screen.getByRole("button", {
      name: "ポーンを減らす",
    }) as HTMLButtonElement;
    expect(minus.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "ポーンを増やす" }));
    fireEvent.click(screen.getByRole("button", { name: "回答して再評価" }));
    expect(onSubmit).toHaveBeenCalledWith({ situationNote: "1" });
  });

  it("asks the FEN only after 'enter the position' and requires it then", () => {
    const onSubmit = vi.fn();
    render(<FollowUpQuestions questions={FLAG_ROUND} onSubmit={onSubmit} />);
    const submit = screen.getByRole("button", {
      name: "回答して再評価",
    }) as HTMLButtonElement;
    expect(
      screen.queryByRole("button", { name: "局面（FEN）を入力して判定する" })
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "完了していない" }));
    fireEvent.click(
      screen.getByRole("button", { name: "局面（FEN）を入力して判定する" })
    );
    // FEN は必須（空欄では送信できない）
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(QUESTIONS.positionFen.label), {
      target: { value: "8/8/8/4k3/8/8/4K3/7R b - - 0 60" },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({
      movesNotCompleted: "true",
      matePosition: "fen",
      positionFen: "8/8/8/4k3/8/8/4K3/7R b - - 0 60",
    });
  });

  it("hides the FEN again when its parent question is hidden (no stale required field)", () => {
    const onSubmit = vi.fn();
    render(<FollowUpQuestions questions={FLAG_ROUND} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "完了していない" }));
    fireEvent.click(
      screen.getByRole("button", { name: "局面（FEN）を入力して判定する" })
    );
    expect(screen.getByLabelText(QUESTIONS.positionFen.label)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "規定手数は完了していた" })
    );
    expect(screen.queryByLabelText(QUESTIONS.positionFen.label)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "回答して再評価" }));
    expect(onSubmit).toHaveBeenCalledWith({ movesNotCompleted: "false" });
  });

  it("'position unavailable' is a one-tap answer", () => {
    const onSubmit = vi.fn();
    render(
      <FollowUpQuestions
        questions={[QUESTIONS.matePosition, QUESTIONS.reinstatedFen]}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "局面を入力できない（CAへ確認）" })
    );
    fireEvent.click(screen.getByRole("button", { name: "回答して再評価" }));
    expect(onSubmit).toHaveBeenCalledWith({ matePosition: "unknown" });
  });
});
