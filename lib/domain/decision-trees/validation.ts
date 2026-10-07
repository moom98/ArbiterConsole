import type { Decision } from "@/lib/domain/entities";

export interface DecisionValidationResult {
  passed: boolean;
  errors: string[];
}

/**
 * Decision の最小限の検証（要件 §14: 根拠のない裁定を生成しない）。
 * - すべての出典に条文IDがあること
 * - ペナルティ（または結果の変更）を含む場合、引用文付きの出典が1件以上あること
 * - 推奨（recommendation）の場合、出典が1件以上あること
 */
export function validateDecision(
  decision: Pick<Decision, "penalties" | "sources" | "kind">
): DecisionValidationResult {
  const errors: string[] = [];

  decision.sources.forEach((s, i) => {
    if (!s.article.trim()) errors.push(`sources[${i}] に条文IDがありません`);
  });

  const quotedSources = decision.sources.filter(
    (s) => s.text !== undefined && s.text.trim() !== ""
  );
  if (decision.penalties.length > 0 && quotedSources.length === 0) {
    errors.push("ペナルティに対する引用付きの根拠がありません");
  }

  if (decision.kind === "recommendation" && decision.sources.length === 0) {
    errors.push("推奨に根拠がありません");
  }

  return { passed: errors.length === 0, errors };
}
