import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FollowUpQuestions } from "@/components/features/FollowUpQuestions";
import { DecisionDisplay } from "@/components/features/DecisionDisplay";
import { DecisionEngine } from "@/lib/domain/decision-engine";
import { QUESTIONS, applyIncidentAnswers } from "@/lib/domain/follow-up";
import type { Incident } from "@/lib/domain/entities";
import { fixedProviders, FIXED_NOW } from "./helpers";

const INCIDENT: Incident = {
  id: "inc-1",
  gameId: "g1",
  category: "illegal-move",
  description: "",
  arbiterObserved: true,
  reportedBy: "arbiter",
  reportedAt: FIXED_NOW,
  status: "pending",
  escalatedToCA: false,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

describe("unknown answers in the UI (fact-model §3.3)", () => {
  it("offers 'わからない・確認できない' as a normal one-tap option and submits it", () => {
    const onSubmit = vi.fn();
    render(
      <FollowUpQuestions
        questions={[QUESTIONS.gameEnded]}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "わからない・確認できない" })
    );
    fireEvent.click(screen.getByRole("button", { name: "回答して再評価" }));
    expect(onSubmit).toHaveBeenCalledWith({ gameEnded: "unknown" });
  });

  it("shows the facts that could not be confirmed with the decision", () => {
    const incident = applyIncidentAnswers(INCIDENT, {
      playerColor: "white",
      subtype: "illegal-move",
      gameEnded: "false",
      clockPressed: "unknown",
    });
    const { decision } = new DecisionEngine(fixedProviders()).processIncident({
      incident,
      ruleset: { competitionType: "standard", rulesVersion: "FIDE-2023" },
      illegalMoveHistory: { white: [], black: [] },
    });
    render(<DecisionDisplay decision={decision} />);
    const box = screen.getByLabelText("確認できなかった事実");
    expect(box.textContent).toContain(QUESTIONS.clockPressed.label);
  });
});
