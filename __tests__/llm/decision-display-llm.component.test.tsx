import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecisionDisplay } from "@/components/features/DecisionDisplay";
import { buildLlmDecision } from "@/lib/domain/llm/llm-decision";
import { DecisionEngine } from "@/lib/domain/decision-engine";
import type { Incident } from "@/lib/domain/entities";
import { fixedProviders, FIXED_NOW } from "../helpers";
import { ARTICLES, validDraft } from "./fixtures";

function llmDecision(raw: unknown) {
  return buildLlmDecision(fixedProviders(), {
    incidentId: "inc-1",
    category: "player-behavior",
    rulesVersion: "FIDE-2023",
    model: "gemini-test",
    articles: ARTICLES,
    raw,
  });
}

const INCIDENT: Incident = {
  id: "inc-1",
  gameId: "g1",
  category: "player-behavior",
  description: "スマートウォッチ",
  arbiterObserved: true,
  reportedBy: "arbiter",
  reportedAt: FIXED_NOW,
  status: "pending",
  escalatedToCA: false,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
};

describe("DecisionDisplay – AI-assisted decisions", () => {
  it("shows the AI badge, stronger disclaimer, validation status and cited sources", () => {
    render(<DecisionDisplay decision={llmDecision(validDraft())} />);
    expect(screen.getByText("AI参考")).toBeTruthy();
    expect(
      screen.getByText("AI参考情報です（裁定ではありません）")
    ).toBeTruthy();
    expect(screen.getByText("根拠検証: 合格")).toBeTruthy();
    // 引用は最初から展開し、資料名・版・ページを表示する
    expect(
      screen.getByText("根拠の原文（登録規則と照合済み） (2件)")
    ).toBeTruthy();
    expect(
      screen.getAllByText("第1回テスト大会 大会規定 2026").length
    ).toBeGreaterThan(0);
    expect(screen.getByText("第1回テスト大会 大会規定 2026 p.2")).toBeTruthy();
    expect(screen.queryByText("Decision Tree")).toBeNull();
  });

  it("shows a rejected AI output as CA escalation with the validation errors", () => {
    render(
      <DecisionDisplay
        decision={llmDecision(validDraft({ conclusion: "おそらく負け" }))}
      />
    );
    expect(screen.getByText("根拠検証: 不合格")).toBeTruthy();
    expect(screen.getByText("裁定を確定できません。")).toBeTruthy();
    expect(
      screen.getByText(/conclusion: 推測的な表現「おそらく」/)
    ).toBeTruthy();
    expect(screen.getByText("CAへ確認してください")).toBeTruthy();
  });

  it("offers a retry when the AI reference could not be fetched offline", async () => {
    const offline = await new DecisionEngine(fixedProviders(), {
      llm: { assist: async () => ({ status: "offline" }) },
    }).evaluate({
      incident: INCIDENT,
      ruleset: { competitionType: "standard", rulesVersion: "FIDE-2023" },
    });
    const onRetry = vi.fn();
    render(<DecisionDisplay decision={offline.decision} onRetry={onRetry} />);
    expect(
      screen.getByText(
        "オフラインのためAI参考情報を取得していません（オンライン必須）"
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "AI参考情報を再取得" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
