import type { IncidentCategory } from "@/lib/domain/entities";
import type { IncidentQuestionId } from "@/lib/domain/follow-up";
import { FACT_USAGES, getFactDefinition } from "./catalog";
import { evaluateCondition, hasDerivedValue } from "./conditions";
import type {
  FactAnswers,
  FactContext,
  FactDefinition,
  FactId,
  FactLevel,
  FactUsage,
} from "./types";

/**
 * 今の分岐で必要な fact を求める（純粋関数。fact-model §3.1 / §3.2）。
 *
 * - blocking は常に必要
 * - DT の質問に対応する conditional（dtQuestionIds あり）は、**DT が要求したときだけ**必要
 *   （DT が権威。appliesWhen は記述のためで、ここでは使わない）
 * - それ以外の conditional は appliesWhen を満たすときだけ必要（fact plan）
 *   appliesWhen がない conditional は、requestedFactIds で明示的に要求されたときだけ必要
 * - optional は必要としない
 * - 設定・記録から値を求めた fact（context.derivedValues）は質問しない
 * - illegal-move でサブタイプが未指定の場合は、im.action の回答をサブタイプとして使う
 * 順序はカタログの順。
 */

export interface RequiredFactsInput {
  category: IncidentCategory;
  subtype?: string;
  answers: FactAnswers;
  context: FactContext;
  /** DT の needs-input が返した質問 ID */
  dtRequestedQuestionIds?: readonly IncidentQuestionId[];
  /** DT が fact を直接要求する場合（fact plan の条件のない conditional fact） */
  requestedFactIds?: readonly FactId[];
}

export interface RequiredFact {
  definition: FactDefinition;
  usage: FactUsage;
  level: FactLevel;
}

/** カテゴリ・サブタイプに当てはまる usage（カタログの順） */
export function usagesFor(
  category: IncidentCategory,
  subtype: string | undefined
): FactUsage[] {
  return FACT_USAGES.filter(
    (u) =>
      u.category === category &&
      (u.subtypes === undefined ||
        (subtype !== undefined && u.subtypes.includes(subtype)))
  );
}

function isRequired(usage: FactUsage, input: RequiredFactsInput): boolean {
  if (usage.level === "optional") return false;
  if (hasDerivedValue(usage.factId, input.context)) return false;
  if (usage.level === "blocking") return true;
  if (usage.dtQuestionIds !== undefined) {
    const requested = input.dtRequestedQuestionIds ?? [];
    return usage.dtQuestionIds.some((q) => requested.includes(q));
  }
  if (input.requestedFactIds?.includes(usage.factId)) return true;
  if (usage.appliesWhen === undefined) return false;
  return evaluateCondition(usage.appliesWhen, input.answers, input.context);
}

/** サブタイプを決める fact（回答をそのままサブタイプとして使う） */
const SUBTYPE_FACT: Partial<Record<IncidentCategory, FactId>> = {
  "illegal-move": "im.action",
};

function effectiveSubtype(input: RequiredFactsInput): string | undefined {
  if (input.subtype !== undefined) return input.subtype;
  const factId = SUBTYPE_FACT[input.category];
  const answer = factId ? input.answers[factId] : undefined;
  if (answer === undefined || "unknown" in answer) return undefined;
  return typeof answer.value === "string" ? answer.value : undefined;
}

export function requiredFacts(input: RequiredFactsInput): RequiredFact[] {
  const result: RequiredFact[] = [];
  const seen = new Set<FactId>();
  for (const usage of usagesFor(input.category, effectiveSubtype(input))) {
    if (seen.has(usage.factId) || !isRequired(usage, input)) continue;
    const definition = getFactDefinition(usage.factId);
    if (!definition) continue;
    seen.add(usage.factId);
    result.push({ definition, usage, level: usage.level });
  }
  return result;
}

/** 必要な fact のうち、まだ回答されていないもの（unknown は回答済み） */
export function unansweredFacts(
  required: readonly RequiredFact[],
  answers: FactAnswers
): RequiredFact[] {
  return required.filter((r) => answers[r.definition.id] === undefined);
}

/**
 * Jev で「報告文に明示されているか」を判定してよい fact（ADR-013）。
 * 端末内だけの fact・設定から求める fact は対象外。
 */
export function presenceCheckableFacts(
  required: readonly RequiredFact[]
): RequiredFact[] {
  return required.filter(
    (r) => r.definition.presenceCheckable && !r.definition.localOnly
  );
}

/** DT の質問と、その報告文での記載の有無を判定できる fact（fact-model.md §4.1） */
export interface PresenceTarget {
  questionId: IncidentQuestionId;
  factId: FactId;
}

/**
 * DT が求めた質問のうち、Jev で「報告文に明示されているか」を判定できるものと、その fact。
 * 対応する fact がない質問・端末内だけの fact・設定から求める fact・値を計算で渡す fact
 * （dtValues: "computed"）は含めない。
 * 同じ fact に複数の質問が対応する場合は、fact を1回だけ尋ねる（全質問に結果を使う）
 */
export function presenceTargets(
  category: IncidentCategory,
  subtype: string | undefined,
  questionIds: readonly IncidentQuestionId[]
): PresenceTarget[] {
  const out: PresenceTarget[] = [];
  for (const questionId of questionIds) {
    const usage = usagesFor(category, subtype).find((u) =>
      u.dtQuestionIds?.includes(questionId)
    );
    // 値を計算で質問へ渡す fact（例: tch.special → 昇格の質問）は、記載の有無が質問と一致しない
    if (!usage || usage.dtValues === "computed") continue;
    const definition = getFactDefinition(usage.factId);
    if (
      !definition?.presenceCheckable ||
      definition.localOnly ||
      definition.derivedFrom !== undefined
    )
      continue;
    out.push({ questionId, factId: usage.factId });
  }
  return out;
}
