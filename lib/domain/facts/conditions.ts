import type {
  FactAnswer,
  FactAnswers,
  FactCondition,
  FactContext,
} from "./types";

/** 回答が「わからない」か */
export function isUnknownAnswer(answer: FactAnswer | undefined): boolean {
  return answer !== undefined && "unknown" in answer;
}

/** 回答済み（unknown を含む）か */
export function isAnswered(answer: FactAnswer | undefined): boolean {
  return answer !== undefined;
}

/** 回答の値を文字列の配列にする（unknown・未回答は空） */
function answerValues(answer: FactAnswer | undefined): readonly string[] {
  if (answer === undefined || "unknown" in answer) return [];
  const v = answer.value;
  if (Array.isArray(v)) return v;
  return [String(v)];
}

/** 設定・記録から値を求められたか（unknown は求められなかったものとして扱う） */
export function hasDerivedValue(id: string, context: FactContext): boolean {
  const derived = context.derivedValues?.[id];
  return derived !== undefined && !("unknown" in derived);
}

/** 設定・記録から求めた値を回答より優先する */
function valueOf(
  id: string,
  answers: FactAnswers,
  context: FactContext
): FactAnswer | undefined {
  return hasDerivedValue(id, context)
    ? context.derivedValues?.[id]
    : answers[id];
}

/**
 * 適用条件を評価する（純粋関数）。
 * fact 条件は、回答の値（複数選択ならいずれか）が in に含まれる場合のみ真。
 * unknown・未回答は決して条件を満たさない（fact-model §3.2）。
 */
export function evaluateCondition(
  condition: FactCondition,
  answers: FactAnswers,
  context: FactContext
): boolean {
  if ("all" in condition)
    return condition.all.every((c) => evaluateCondition(c, answers, context));
  if ("any" in condition)
    return condition.any.some((c) => evaluateCondition(c, answers, context));
  if ("fact" in condition) {
    if ("range" in condition) {
      const answer = valueOf(condition.fact, answers, context);
      if (answer === undefined || "unknown" in answer) return false;
      const n = answer.value;
      if (typeof n !== "number" || !Number.isFinite(n)) return false;
      const { gte, lt } = condition.range;
      return (gte === undefined || n >= gte) && (lt === undefined || n < lt);
    }
    const values = answerValues(valueOf(condition.fact, answers, context));
    return values.some((v) => condition.in.includes(v));
  }
  if ("notDerived" in condition)
    return !hasDerivedValue(condition.notDerived, context);
  if ("context" in condition) {
    const ct = context.competitionType;
    return ct !== undefined && condition.in.includes(ct);
  }
  // incident: arbiterObserved（is: false は「false または未記録」）
  return condition.is
    ? context.arbiterObserved === true
    : context.arbiterObserved !== true;
}

/** 条件が参照する fact の ID（カタログの検証用） */
export function referencedFacts(condition: FactCondition): string[] {
  if ("all" in condition) return condition.all.flatMap(referencedFacts);
  if ("any" in condition) return condition.any.flatMap(referencedFacts);
  if ("fact" in condition) return [condition.fact];
  return [];
}
