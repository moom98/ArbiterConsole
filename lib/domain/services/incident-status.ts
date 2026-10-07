import type { Decision, IncidentStatus } from "@/lib/domain/entities";

/**
 * 判断（Decision）を記録した後の Incident のステータス。
 *
 * - AI 参考情報（generatedBy "llm"）は裁定ではないため、アービターが確認するまで
 *   "pending" のままにする（自動で対応済み・CA相談済みにしない。ADR-007）
 * - 決定木: CA への確認推奨なら "escalated"、それ以外は "resolved"
 */
export function incidentStatusAfterDecision(
  decision: Pick<Decision, "generatedBy" | "escalationRecommended">
): IncidentStatus {
  if (decision.generatedBy === "llm") return "pending";
  return decision.escalationRecommended ? "escalated" : "resolved";
}

/** AI 参考情報（未確定）の判断か */
export function isUnconfirmedAiDecision(
  decision: Pick<Decision, "generatedBy"> | undefined
): boolean {
  return decision?.generatedBy === "llm";
}
