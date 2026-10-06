import type { Rule, RuleSource, RuleSourceType } from "@/lib/domain/entities";

let seq = 0;

export function makeRule(
  partial: Partial<Rule> & { source?: RuleSourceType } = {}
): Rule {
  seq++;
  return {
    id: `rule-${seq}`,
    source: "FIDE",
    article: `${seq}.1`,
    title: "",
    content: "",
    priority: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  };
}

export function makeSource(partial: Partial<RuleSource> = {}): RuleSource {
  seq++;
  return {
    id: `source-${seq}`,
    name: "FIDE Laws of Chess",
    fileName: "laws.pdf",
    sourceType: "FIDE",
    version: "2023",
    status: "active",
    language: "en",
    totalPages: 10,
    importedAt: new Date(0),
    ...partial,
  };
}
