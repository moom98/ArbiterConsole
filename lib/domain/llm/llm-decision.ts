import type {
  Decision,
  IncidentCategory,
  Penalty,
  RuleCitation,
  RuleSourceType,
} from "@/lib/domain/entities";
import { validateDecision } from "@/lib/domain/decision-trees/validation";
import type { ReidentifyResult } from "@/lib/domain/privacy";
import type { DomainProviders } from "@/lib/domain/providers";
import { validateLlmDecisionDraft } from "./output-validator";
import { extractQuoteContext } from "./quote-match";
import type { LlmArticle } from "./types";

const SOURCE_LABELS: Record<RuleSourceType, string> = {
  FIDE: "FIDE",
  JCF: "JCF",
  tournament: "大会規定",
  commentary: "解説",
};

export const LLM_REJECTED_CONCLUSION = "裁定を確定できません。";

/** 端末での表示に使う資料名・版（外部へは送っていないもの。例: 大会規定の資料名） */
export interface LocalSourceLabel {
  sourceName?: string;
  sourceVersion?: string;
}

/**
 * LLM に提示した条文を、表示用の引用（RuleSource の資料名・版・ページ付き）に変換する。
 * 引用の前後の文脈は送った本文で切り出す（§6.1）。local があれば資料名・版はそれを使う
 */
export function citationFromArticle(
  article: LlmArticle,
  quote: string,
  local?: LocalSourceLabel
): RuleCitation {
  const names = local ?? article;
  const edition = names.sourceName
    ? [names.sourceName, names.sourceVersion].filter(Boolean).join(" ")
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
    quoteContext: extractQuoteContext(quote, article.content) ?? undefined,
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
  /**
   * プレースホルダーを元の表記へ戻す（このリクエストの対応表。端末のメモリ内だけ）。
   * 検証・引用の照合・前後の文脈の切り出しは送った本文で行い、その後に適用する（§6.1）
   */
  reidentify?: (text: string) => ReidentifyResult;
  /** 条文 ID → 端末での表示用の資料名・版（送った条文では大会規定の資料名を伏せている） */
  localSourceLabels?: Readonly<Record<string, LocalSourceLabel>>;
}

/** 元の表記への復元。対応表にないプレースホルダーを集める */
class Reidentifier {
  readonly unknown = new Set<string>();
  constructor(private readonly fn?: (text: string) => ReidentifyResult) {}

  text(value: string): string {
    if (!this.fn) return value;
    const r = this.fn(value);
    for (const ph of r.unknownPlaceholders) this.unknown.add(ph);
    return r.text;
  }

  optional(value: string | undefined): string | undefined {
    return value === undefined ? undefined : this.text(value);
  }

  citation(c: RuleCitation): RuleCitation {
    return {
      ...c,
      article: this.text(c.article),
      text: this.optional(c.text),
      quoteContext: c.quoteContext && {
        before: this.text(c.quoteContext.before),
        match: this.text(c.quoteContext.match),
        after: this.text(c.quoteContext.after),
      },
    };
  }
}

const NEEDS_REVIEW_REASON =
  "AIの出力に、送信内容にない置き換え記号（〈…〉）が含まれています。記号はそのまま表示しています。原文と報告内容を確認し、CAへ確認してください。";

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
      citationFromArticle(
        articleById.get(c.articleId) as LlmArticle,
        c.quote,
        input.localSourceLabels?.[c.articleId]
      )
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

  // 検証・照合の後に、表示する欄だけを元の表記へ戻す（§6.1, §6.2）
  const re = new Reidentifier(input.reidentify);
  const shown = {
    conclusion: re.text(draft.conclusion),
    actions: actions.map((a) => re.text(a)),
    penalties: penalties.map((p) => ({
      ...p,
      description: re.text(p.description),
    })),
    sources: sources.map((c) => re.citation(c)),
    escalationReason: draft.escalationRecommended
      ? re.text(draft.escalationReason ?? "CAへ確認してください")
      : undefined,
  };
  const needsReview = re.unknown.size > 0;
  const messages = [
    ...result.adjustments,
    ...(needsReview
      ? [`対応のない置き換え記号: ${Array.from(re.unknown).join("、")}`]
      : []),
  ];

  return {
    ...base,
    kind: "recommendation",
    ...shown,
    intervention: draft.intervention,
    confidence: draft.confidence,
    escalationRecommended: draft.escalationRecommended || needsReview,
    escalationReason: needsReview
      ? [shown.escalationReason, NEEDS_REVIEW_REASON].filter(Boolean).join(" ")
      : shown.escalationReason,
    validationPassed: true,
    llm: {
      status: "passed",
      model: input.model,
      candidateArticleIds,
      message: messages.length > 0 ? messages.join(" / ") : undefined,
      ...(needsReview ? { needsReview: true } : {}),
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
