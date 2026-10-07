import type {
  Decision,
  IncidentCategory,
  Penalty,
  RuleCitation,
  RuleSourceType,
} from "@/lib/domain/entities";
import { validateDecision } from "@/lib/domain/decision-trees/validation";
import type { DomainProviders } from "@/lib/domain/providers";
import { validateLlmDecisionDraft } from "./output-validator";
import type { LlmArticle } from "./types";

const SOURCE_LABELS: Record<RuleSourceType, string> = {
  FIDE: "FIDE",
  JCF: "JCF",
  tournament: "大会規定",
  commentary: "解説",
};

export const LLM_REJECTED_CONCLUSION = "裁定を確定できません。";

/** LLM に提示した条文を、表示用の引用（RuleSource の資料名・版・ページ付き）に変換する */
export function citationFromArticle(
  article: LlmArticle,
  quote: string
): RuleCitation {
  const edition = article.sourceName
    ? [article.sourceName, article.sourceVersion].filter(Boolean).join(" ")
    : undefined;
  return {
    article: `${SOURCE_LABELS[article.source]} ${article.article}`.trim(),
    text: quote,
    source: article.source,
    priority: article.priority,
    edition,
    page: article.page,
    pageDocument: article.page !== undefined ? edition : undefined,
    ruleId: article.id,
  };
}

export interface BuildLlmDecisionInput {
  incidentId: string;
  category: IncidentCategory;
  rulesVersion: string;
  raw: unknown;
  model?: string;
  articles: readonly LlmArticle[];
  storedArticleIds?: readonly string[];
}

/**
 * LLM の下書きを検証し、Decision を組み立てる（純粋関数。LLM は呼び出さない）。
 * - 合格: generatedBy "llm"、信頼度は最大 medium、引用は登録規則の原文と一致したもののみ
 * - 不合格: 「裁定を確定できません」+ CA への確認。validationErrors に理由を列挙する
 */
export function buildLlmDecision(
  providers: DomainProviders,
  input: BuildLlmDecisionInput
): Decision {
  const now = providers.now();
  const candidateArticleIds = input.articles.map((a) => a.id);
  const base = {
    id: providers.generateId(),
    incidentId: input.incidentId,
    rulesVersion: input.rulesVersion,
    generatedBy: "llm" as const,
    validatedAt: now,
    createdAt: now,
  };

  const result = validateLlmDecisionDraft({
    raw: input.raw,
    articles: input.articles,
    storedArticleIds: input.storedArticleIds,
    category: input.category,
  });

  if (!result.valid) {
    return rejected(base, result.errors, input.model, candidateArticleIds);
  }

  const { draft } = result;
  const articleById = new Map(input.articles.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const sources: RuleCitation[] = [];
  for (const c of draft.citations) {
    if (seen.has(c.articleId)) continue;
    seen.add(c.articleId);
    sources.push(
      citationFromArticle(articleById.get(c.articleId) as LlmArticle, c.quote)
    );
  }

  const penalties: Penalty[] = draft.penalties.map((p) => ({
    type: p.type,
    playerColor: p.playerColor,
    timeAdjustmentSeconds: p.timeAdjustmentSeconds,
    description: p.description,
  }));

  const actions = [...draft.actions];
  if (draft.missingInformation.length > 0) {
    actions.push(`確認が必要な情報: ${draft.missingInformation.join("、")}`);
  }

  // 決定木と同じ最小限の検証も通す（防御的）
  const generic = validateDecision({
    penalties,
    sources,
    kind: "recommendation",
  });
  if (!generic.passed) {
    return rejected(base, generic.errors, input.model, candidateArticleIds);
  }

  return {
    ...base,
    kind: "recommendation",
    conclusion: draft.conclusion,
    actions,
    intervention: draft.intervention,
    penalties,
    sources,
    confidence: draft.confidence,
    escalationRecommended: draft.escalationRecommended,
    escalationReason: draft.escalationRecommended
      ? (draft.escalationReason ?? "CAへ確認してください")
      : undefined,
    validationPassed: true,
    llm: {
      status: "passed",
      model: input.model,
      candidateArticleIds,
      message:
        result.adjustments.length > 0
          ? result.adjustments.join(" / ")
          : undefined,
    },
  };
}

function rejected(
  base: Pick<
    Decision,
    | "id"
    | "incidentId"
    | "rulesVersion"
    | "generatedBy"
    | "validatedAt"
    | "createdAt"
  >,
  errors: string[],
  model: string | undefined,
  candidateArticleIds: string[]
): Decision {
  return {
    ...base,
    kind: "manual-review",
    conclusion: LLM_REJECTED_CONCLUSION,
    actions: [
      "CAへ確認してください。",
      "ルール検索で関連規則の原文を確認してください。",
    ],
    intervention: "consult-ca",
    penalties: [],
    sources: [],
    confidence: "low",
    escalationRecommended: true,
    escalationReason:
      "AI参考情報が根拠の検証に失敗したため、裁定を確定できません。",
    validationPassed: false,
    validationErrors: errors,
    llm: { status: "rejected", model, candidateArticleIds },
  };
}
