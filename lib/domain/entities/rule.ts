export type RuleSource = "FIDE" | "JCF" | "tournament" | "commentary";

export interface Rule {
  id: string;
  source: RuleSource;
  tournamentId?: string;
  article: string;
  title: string;
  content: string;
  priority: number;
  embeddingId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Embedding {
  id: string;
  ruleId: string;
  vector: number[];
  model: string;
  createdAt: Date;
}
