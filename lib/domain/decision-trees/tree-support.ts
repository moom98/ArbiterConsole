import type {
  DecisionTreeId,
  PlayerColor,
  RuleCitation,
} from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import type { FollowUpQuestion } from "@/lib/domain/follow-up";
import { buildDecision, type DecisionFields } from "./build-decision";
import type { DecisionTreeResult } from "./dt-001-illegal-move-standard";

/**
 * DT-002 以降の Decision Tree が共有する小さな補助（DT-001 は変更しない）。
 */
export const COLOR_JA: Record<PlayerColor, string> = {
  white: "白",
  black: "黒",
};

export function opponentOf(color: PlayerColor): PlayerColor {
  return color === "white" ? "black" : "white";
}

export function isNonNegativeInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

export const DEFAULT_NEEDS_INPUT_CONCLUSION =
  "判断に必要な情報が不足しています。以下の質問に回答してください。";

export class TreeOutput {
  constructor(
    private readonly providers: DomainProviders,
    private readonly treeId: DecisionTreeId,
    private readonly rulesVersion: string
  ) {}

  base(): Pick<DecisionFields, "incidentId" | "treeId" | "rulesVersion"> {
    return {
      incidentId: "",
      treeId: this.treeId,
      rulesVersion: this.rulesVersion,
    };
  }

  decided(
    fields: Omit<DecisionFields, "incidentId" | "treeId" | "rulesVersion">
  ): DecisionTreeResult {
    return {
      status: "decided",
      decision: buildDecision(this.providers, { ...this.base(), ...fields }),
    };
  }

  needsInput(
    questions: FollowUpQuestion[],
    conclusion = DEFAULT_NEEDS_INPUT_CONCLUSION,
    sources: RuleCitation[] = []
  ): DecisionTreeResult {
    const labels = questions.filter((q) => !q.optional).map((q) => q.label);
    const decision = buildDecision(this.providers, {
      ...this.base(),
      kind: "follow-up-required",
      conclusion,
      actions: labels,
      intervention: "consult-ca",
      penalties: [],
      sources,
      confidence: "low",
      escalationRecommended: false,
      missingFields: labels,
    });
    return { status: "needs-input", decision, questions };
  }
}
