import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FollowUpQuestions } from "@/components/features/FollowUpQuestions";
import { QUESTIONS } from "@/lib/domain/follow-up";

/** 対局を終わらせた出来事と、任意の「結果の記入・署名の状態」（ADR-014 §3） */
describe("game end questions in the UI", () => {
  const renderRound = () => {
    const onSubmit = vi.fn();
    render(
      <FollowUpQuestions
        questions={[QUESTIONS.gameEndEvent, QUESTIONS.gameRecordState]}
        onSubmit={onSubmit}
      />
    );
    return onSubmit;
  };
  const submit = () =>
    fireEvent.click(screen.getByRole("button", { name: "回答して再評価" }));

  it("shows the record state only after an end event, and does not require it", () => {
    const onSubmit = renderRound();
    expect(screen.queryByText(QUESTIONS.gameRecordState.label)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "投了の発言や動作" }));
    expect(screen.getByText(QUESTIONS.gameRecordState.label)).toBeTruthy();
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ gameEndEvent: "resignation" });
  });

  it("does not send a record state hidden by switching back to in-progress", () => {
    const onSubmit = renderRound();
    fireEvent.click(screen.getByRole("button", { name: "投了の発言や動作" }));
    fireEvent.click(screen.getByRole("button", { name: "両プレーヤーが署名" }));
    fireEvent.click(screen.getByRole("button", { name: "まだ対局中" }));
    expect(screen.queryByText(QUESTIONS.gameRecordState.label)).toBeNull();
    submit();
    expect(onSubmit).toHaveBeenCalledWith({ gameEndEvent: "in-progress" });
  });

  it("sends the record state with the end event", () => {
    const onSubmit = renderRound();
    fireEvent.click(screen.getByRole("button", { name: "チェックメイト" }));
    fireEvent.click(
      screen.getByRole("button", { name: "片方のプレーヤーが署名" })
    );
    submit();
    expect(onSubmit).toHaveBeenCalledWith({
      gameEndEvent: "checkmate",
      gameRecordState: "one-signed",
    });
  });
});
