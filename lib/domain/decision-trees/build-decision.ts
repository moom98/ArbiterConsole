import type { Decision } from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import { validateDecision } from "./validation";

export type DecisionFields = Omit<
  Decision,
  | "id"
  | "createdAt"
  | "validatedAt"
  | "validationPassed"
  | "validationErrors"
  | "generatedBy"
>;

/**
 * Decision Tree の出力を組み立て、validateDecision を実行して結果を反映する。
 * 検証に失敗した場合は CA への確認を推奨する。
 */
export function buildDecision(
  providers: DomainProviders,
  fields: DecisionFields
): Decision {
  const now = providers.now();
  const validation = validateDecision(fields);
  const decision: Decision = {
    ...fields,
    id: providers.generateId(),
    generatedBy: "decision-tree",
    validatedAt: now,
    validationPassed: validation.passed,
    createdAt: now,
  };
  if (!validation.passed) {
    decision.validationErrors = validation.errors;
    decision.escalationRecommended = true;
    decision.escalationReason =
      decision.escalationReason ??
      "根拠の検証に失敗しました。CAへ確認してください。";
  }
  return decision;
}
