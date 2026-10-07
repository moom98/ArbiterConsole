import type { Rule, RuleSourceType } from "@/lib/domain/entities";

/**
 * ルールの優先順位（要件 §6）
 *
 *   大会固有規定 → JCF規則・運用 → FIDE Laws of Chess → 補足資料・解説
 *
 * 数値が小さいほど優先。スコアの微調整ではなく、明示的な順位として扱う。
 */
const SOURCE_RANK: Record<RuleSourceType, number> = {
  tournament: 0,
  JCF: 1,
  FIDE: 2,
  commentary: 3,
};

/** 保存用の priority 値（大きいほど優先）。表示・インデックス用途のみ */
export function getPriorityBySource(source: RuleSourceType): number {
  switch (source) {
    case "tournament":
      return 1000;
    case "JCF":
      return 100;
    case "FIDE":
      return 10;
    case "commentary":
      return 1;
  }
}

export function getSourceRank(source: RuleSourceType): number {
  return SOURCE_RANK[source];
}

/**
 * 指定大会の検索対象となるルールか判定する。
 *
 * 大会固有規定は tournamentId が明示的に一致する場合のみ対象とする。
 * tournamentId が未指定の場合、大会固有規定はどの大会のものも対象にしない
 * （別大会の規定を誤って適用しないため）。
 */
export function isRuleApplicableToTournament(
  rule: Pick<Rule, "source" | "tournamentId">,
  tournamentId: string | undefined
): boolean {
  if (rule.source !== "tournament") {
    return true;
  }
  return tournamentId !== undefined && rule.tournamentId === tournamentId;
}

/**
 * 優先順位（大会 > JCF > FIDE > 解説）でグループ化し、
 * 各グループ内では元の順序（通常は関連度順）を維持する安定ソート。
 */
export function orderByRulePriority<T extends { rule: Pick<Rule, "source"> }>(
  items: readonly T[]
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const diff =
        getSourceRank(a.item.rule.source) - getSourceRank(b.item.rule.source);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ item }) => item);
}
