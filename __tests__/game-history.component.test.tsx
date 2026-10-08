import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FollowUpQuestions } from "@/components/features/FollowUpQuestions";
import { DecisionDisplay } from "@/components/features/DecisionDisplay";
import { DecisionEngine } from "@/lib/domain/decision-engine";
import { QUESTIONS, applyIncidentAnswers } from "@/lib/domain/follow-up";
import type { Incident } from "@/lib/domain/entities";
import { chessJsPositionPort } from "@/lib/infrastructure/chess/chess-js-position-port";
import { fixedProviders, FIXED_NOW } from "./helpers";

const INCIDENT: Incident = {
  id: "inc-1",
  gameId: "g1",
  category: "draw",
  description: "",
  arbiterObserved: true,
  reportedBy: "arbiter",
  reportedAt: FIXED_NOW,
  status: "pending",
  escalatedToCA: false,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

describe("game.history confirmation in the UI (ADR-014 §4)", () => {
  it("shows the four confirmation options (no extra generic unknown) and submits one tap", () => {
    const onSubmit = vi.fn();
    render(
      <FollowUpQuestions
        questions={[QUESTIONS.historyConfirmed]}
        onSubmit={onSubmit}
      />
    );
    for (const label of [
      "局面も手数も一致した",
      "局面は一致・手数は確認できない",
      "一致しない",
      "照合できない（盤上で再現する）",
    ])
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "わからない・確認できない" })
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "一致しない" }));
    fireEvent.click(screen.getByRole("button", { name: "回答して再評価" }));
    expect(onSubmit).toHaveBeenCalledWith({ historyConfirmed: "mismatch" });
  });

  it("shows the final position to compare, wrapping the long FEN", () => {
    const incident = applyIncidentAnswers(INCIDENT, {
      drawSubtype: "threefold-repetition-claim",
      claimant: "white",
      claimantHasMove: "true",
      claimMode: "just-appeared",
      touchedPiece: "false",
      repetitionCheck: "auto",
      positionsText: "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8",
    });
    const { decision } = new DecisionEngine(fixedProviders(), {
      positions: chessJsPositionPort,
    }).processIncident({
      incident,
      ruleset: { competitionType: "standard", rulesVersion: "FIDE-2023" },
    });
    render(<DecisionDisplay decision={decision} />);
    const conclusion = screen.getByText(/棋譜を再生しました/);
    expect(conclusion.textContent).toContain("4... Ng8 まで");
    expect(conclusion.textContent).toContain("FEN: ");
    expect(conclusion.className).toContain("break-words");
  });
});
