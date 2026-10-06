export type InterventionType = "immediate" | "wait-for-claim" | "consult-ca";
export type ConfidenceLevel = "high" | "medium" | "low";
export type PenaltyType =
  | "warning"
  | "time-addition-opponent"
  | "time-deduction-player"
  | "game-loss"
  | "both-lose"
  | "expulsion";

export interface RuleCitation {
  article: string;
  text?: string;
  source: "FIDE" | "JCF" | "tournament";
  priority: number;
}

export interface Penalty {
  type: PenaltyType;
  playerColor: "white" | "black";
  timeAdjustmentSeconds?: number;
  description: string;
}

export interface Decision {
  id: string;
  incidentId: string;
  conclusion: string;
  actions: string[];
  intervention: InterventionType;
  penalties: Penalty[];
  sources: RuleCitation[];
  confidence: ConfidenceLevel;
  escalationRecommended: boolean;
  escalationReason?: string;
  generatedBy: "decision-tree" | "llm";
  validatedAt?: Date;
  validationPassed: boolean;
  validationErrors?: string[];
  createdAt: Date;
}
