import type {
  ConfidenceLevel,
  Decision,
  DecisionTreeId,
  PlayerColor,
  RuleCitation,
} from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import {
  enumerableValues,
  type FollowUpQuestion,
} from "@/lib/domain/follow-up";
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

// ---------------------------------------------------------------------------
// unknown（「わからない・確認できない」）の扱い（fact-model §3.3）
// ---------------------------------------------------------------------------

/** 1つの評価結果（DecisionEngine の結果を写したもの） */
export type BranchResult =
  | { status: "decided"; decision: Decision }
  | {
      status: "needs-input";
      decision: Decision;
      questions: FollowUpQuestion[];
    }
  /** 決定木の対象外（AI参考・手動確認など） */
  | { status: "other" };

export interface UnknownBranch {
  /** unknown の事実に仮に与えた値（質問 ID → 値） */
  assignment: Readonly<Record<string, string>>;
  result: BranchResult;
}

export type UnknownResolution =
  /** 現在の分岐は unknown の事実を必要としない（通常の評価結果を使う） */
  | { kind: "not-needed" }
  /**
   * 未回答の質問が他にある。unknown の質問を除いて先に質問する
   * （unknown の事実は、それが必要になった時点で列挙する）
   */
  | {
      kind: "ask-others";
      questions: FollowUpQuestion[];
      /**
       * 全分岐が同じ質問を求め、結論文（質問の前提となる案内）も同じ場合のその文。
       * 例: 対局履歴の照合では、照合する最終局面を結論文で示す（ADR-014 §4）
       */
      conclusion?: string;
    }
  /** すべての分岐が同じ判断（§3.3 2） */
  | { kind: "agreed"; facts: FollowUpQuestion[]; branches: UnknownBranch[] }
  /** 判断が分かれる・列挙できない・多すぎる（§3.3 3） */
  | {
      kind: "disagreed";
      facts: FollowUpQuestion[];
      branches: UnknownBranch[];
      reason: "branches-differ" | "not-enumerable" | "too-many";
    };

/** 同時に列挙する unknown の事実の上限（fact-model §3.3 d） */
export const MAX_ENUMERATED_UNKNOWN_FACTS = 2;

/**
 * unknown と回答された事実を、可能な値すべてで評価して比較する（fact-model §3.3）。
 *
 * - unknown は needs-input にしない。未回答（undefined）だけが needs-input になる。
 * - 必要な事実は遅延して見つける: まず unknown の事実を未設定にして評価し、DT がそれを
 *   質問した場合だけ列挙する。列挙中の分岐が「unknown の別の事実」だけを質問した場合は、
 *   その事実を加えて列挙し直す（上限 MAX_ENUMERATED_UNKNOWN_FACTS）。
 * - それ以外の needs-input（未回答の質問）を返す分岐は「判断が分かれる」とみなす（§3.3 a）。
 * - 「同じ判断」は kind・intervention・ペナルティ（種類・対象・時間）が同じこと（§3.3 b）。
 * - 列挙できない事実（onUnknown: manual-review）は手動確認（§3.3 c）。
 *
 * evaluate は純粋であること（同じ assignment に同じ結果）。
 */
export function resolveUnknown(params: {
  unknownIds: readonly string[];
  evaluate: (assignment: Readonly<Record<string, string>>) => BranchResult;
  /** evaluate({}) の結果（呼び出し側で計算済みなら渡す） */
  base?: BranchResult;
}): UnknownResolution {
  const unknown = new Set(params.unknownIds);
  if (unknown.size === 0) return { kind: "not-needed" };

  /** 回答が必要な質問（任意の質問、unknown の回答で非表示になる質問を除く） */
  const required = (questions: FollowUpQuestion[]) =>
    questions.filter(
      (q) => !q.optional && !(q.showWhen && unknown.has(q.showWhen.questionId))
    );

  const base = params.base ?? params.evaluate({});
  if (base.status !== "needs-input") return { kind: "not-needed" };
  const baseRequired = required(base.questions);
  const asked = baseRequired.filter((q) => unknown.has(q.id));
  if (asked.length === 0) return { kind: "not-needed" };
  // 列挙できない事実は、他の質問より先に手動確認にする（他の質問だけを繰り返し尋ねないため）
  const notEnumerableAsked = asked.filter((q) => q.onUnknown !== "enumerate");
  if (notEnumerableAsked.length > 0)
    return {
      kind: "disagreed",
      facts: notEnumerableAsked,
      branches: [],
      reason: "not-enumerable",
    };
  if (baseRequired.some((q) => !unknown.has(q.id))) {
    return {
      kind: "ask-others",
      questions: base.questions.filter((q) => !unknown.has(q.id)),
    };
  }

  const needed: FollowUpQuestion[] = [...asked];
  for (;;) {
    const notEnumerable = needed.filter((q) => q.onUnknown !== "enumerate");
    if (notEnumerable.length > 0)
      return {
        kind: "disagreed",
        facts: notEnumerable,
        branches: [],
        reason: "not-enumerable",
      };
    if (needed.length > MAX_ENUMERATED_UNKNOWN_FACTS)
      return {
        kind: "disagreed",
        facts: needed,
        branches: [],
        reason: "too-many",
      };

    const neededIds = new Set(needed.map((q) => q.id));
    const branches: UnknownBranch[] = [];
    let discovered: FollowUpQuestion[] = [];
    for (const assignment of assignments(needed)) {
      const result = params.evaluate(assignment);
      if (result.status === "needs-input") {
        const req = required(result.questions);
        if (
          req.length > 0 &&
          req.every((q) => unknown.has(q.id) && !neededIds.has(q.id))
        ) {
          discovered = req;
          break;
        }
      }
      branches.push({ assignment, result });
    }
    if (discovered.length > 0) {
      for (const q of discovered)
        if (!needed.some((n) => n.id === q.id)) needed.push(q);
      continue;
    }

    // すべての分岐が、unknown でない同じ質問だけを求めている → その質問をアービターに尋ねる
    // （どの値でも同じ情報が必要なため。列挙の再帰ではない）
    const asks = branches.map((b) =>
      b.result.status === "needs-input"
        ? required(b.result.questions)
            .map((x) => x.id as string)
            .sort()
            .join(",")
        : null
    );
    if (
      asks.length > 0 &&
      asks[0] &&
      asks.every((a) => a === asks[0]) &&
      asks[0].split(",").every((id) => !unknown.has(id))
    ) {
      const firstNeeds = branches[0].result as Extract<
        BranchResult,
        { status: "needs-input" }
      >;
      const conclusion = firstNeeds.decision.conclusion;
      const sameConclusion = branches.every(
        (b) =>
          b.result.status === "needs-input" &&
          b.result.decision.conclusion === conclusion
      );
      return {
        kind: "ask-others",
        questions: firstNeeds.questions.filter((x) => !unknown.has(x.id)),
        ...(sameConclusion ? { conclusion } : {}),
      };
    }

    const first = branches[0]?.result;
    const agreed =
      first?.status === "decided" &&
      branches.every(
        (b) =>
          b.result.status === "decided" &&
          decisionSignature(b.result.decision) ===
            decisionSignature(first.decision)
      );
    return agreed
      ? { kind: "agreed", facts: needed, branches }
      : {
          kind: "disagreed",
          facts: needed,
          branches,
          reason: "branches-differ",
        };
  }
}

/** 質問の値の全組み合わせ */
function assignments(questions: FollowUpQuestion[]): Record<string, string>[] {
  let out: Record<string, string>[] = [{}];
  for (const q of questions) {
    const values = enumerableValues(q);
    out = out.flatMap((a) => values.map((v) => ({ ...a, [q.id]: v })));
  }
  return out;
}

/** 「同じ判断」の比較キー（結論文・ID・時刻は含めない: §3.3 b） */
export function decisionSignature(d: Decision): string {
  return JSON.stringify([
    d.kind ?? null,
    d.intervention,
    d.penalties.map((p) => [
      p.type,
      p.playerColor ?? null,
      p.timeAdjustmentSeconds ?? null,
    ]),
  ]);
}

const CONFIDENCE_ORDER: readonly ConfidenceLevel[] = ["low", "medium", "high"];

function minConfidence(levels: ConfidenceLevel[]): ConfidenceLevel {
  return levels.reduce(
    (min, c) =>
      CONFIDENCE_ORDER.indexOf(c) < CONFIDENCE_ORDER.indexOf(min) ? c : min,
    "high" as ConfidenceLevel
  );
}

function uniqueSources(decisions: Decision[]): RuleCitation[] {
  const seen = new Set<string>();
  const out: RuleCitation[] = [];
  for (const d of decisions)
    for (const s of d.sources) {
      const key = JSON.stringify([s.source, s.article, s.ruleId, s.text]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  return out;
}

/**
 * すべての分岐に共通する対応（最初の分岐の順序）。
 * 判断に至らない分岐（needs-input・対象外）は対応を持たないため、共通の対応はなくなる。
 */
function sharedActions(branches: UnknownBranch[]): string[] {
  const lists = branches.map((b) =>
    b.result.status === "decided" ? b.result.decision.actions : []
  );
  if (lists.length === 0) return [];
  return lists[0].filter((a) => lists.every((l) => l.includes(a)));
}

/** 同じ文の項目をまとめ、条件を並べる（最初に現れた順） */
function groupByText(
  items: { condition: string; text: string }[]
): { conditions: string[]; text: string }[] {
  const out: { conditions: string[]; text: string }[] = [];
  for (const item of items) {
    const g = out.find((x) => x.text === item.text);
    if (g) g.conditions.push(item.condition);
    else out.push({ conditions: [item.condition], text: item.text });
  }
  return out;
}

function factNames(facts: FollowUpQuestion[]): string {
  return facts.map((q) => `「${q.label}」`).join("");
}

/** 分岐の条件の表示（例: 違反したプレーヤーは時計を押しましたか？ →「はい」） */
export function describeAssignment(
  facts: FollowUpQuestion[],
  assignment: Readonly<Record<string, string>>
): string {
  return facts
    .map((q) => {
      const v = assignment[q.id];
      const label = q.options.find((o) => o.value === v)?.label ?? v;
      return `${q.label} →「${label}」`;
    })
    .join("、");
}

/**
 * resolveUnknown の結果（agreed / disagreed）を1つの判断にまとめる。
 * incidentId・rulesVersion は呼び出し側が設定する。
 */
export function unknownResolutionFields(
  resolution: Extract<UnknownResolution, { kind: "agreed" | "disagreed" }>
): Omit<DecisionFields, "incidentId" | "rulesVersion"> {
  const { facts, branches } = resolution;
  const decided = branches.flatMap((b) =>
    b.result.status === "decided" ? [b.result.decision] : []
  );
  const treeIds = new Set(decided.map((d) => d.treeId));
  const treeId = treeIds.size === 1 ? decided[0]?.treeId : undefined;
  const unconfirmedFacts = facts.map((q) => q.label);
  const shared = sharedActions(branches);

  if (resolution.kind === "agreed") {
    const first = decided[0];
    const conclusions = Array.from(new Set(decided.map((d) => d.conclusion)));
    const note = `${factNames(facts)}は確認できませんでしたが、どの場合でも同じ判断になります。`;
    // 分岐ごとに異なる対応は、条件を付けて残す（共通の対応だけでは手順が欠けるため）
    // 1行に1つの手順のまとまり（同じ手順の分岐は条件をまとめる）。長い一覧にしない
    const conditional = groupByText(
      branches.flatMap((b) => {
        if (b.result.status !== "decided") return [];
        const own = b.result.decision.actions.filter(
          (a) => !shared.includes(a)
        );
        return own.length > 0
          ? [
              {
                condition: describeAssignment(facts, b.assignment),
                text: own.join("／"),
              },
            ]
          : [];
      })
    ).map((g) => `［${g.conditions.join(" または ")} の場合］${g.text}`);
    const reasons = groupByText(
      branches.flatMap((b) =>
        b.result.status === "decided" && b.result.decision.escalationReason
          ? [
              {
                condition: describeAssignment(facts, b.assignment),
                text: b.result.decision.escalationReason,
              },
            ]
          : []
      )
    );
    const perBranch = branches
      .flatMap((b) =>
        b.result.status === "decided"
          ? [
              `・${describeAssignment(facts, b.assignment)}: ${b.result.decision.conclusion}`,
            ]
          : []
      )
      .join("\n");
    return {
      treeId,
      kind: first.kind,
      conclusion:
        conclusions.length === 1
          ? `${conclusions[0]}\n${note}`
          : `${note}\n${perBranch}`,
      actions: [...shared, ...conditional],
      intervention: first.intervention,
      penalties: first.penalties,
      sources: uniqueSources(decided),
      // unknown の事実がある以上、high とはしない
      confidence: minConfidence([
        "medium",
        ...decided.map((d) => d.confidence),
      ]),
      escalationRecommended: decided.some((d) => d.escalationRecommended),
      // DT-007: すべての分岐が違反の場合だけ、タッチムーブ違反として記録する（ADR-014 §6）
      touchMoveViolation:
        decided.length > 0 && decided.every((d) => d.touchMoveViolation)
          ? true
          : undefined,
      // 理由が分岐で異なる場合は、どの分岐の理由かを付ける
      escalationReason:
        reasons.length === 0
          ? undefined
          : reasons.length === 1 &&
              reasons[0].conditions.length === branches.length
            ? reasons[0].text
            : reasons
                .map(
                  (g) => `［${g.conditions.join(" または ")} の場合］${g.text}`
                )
                .join(" "),
      unconfirmedFacts,
    };
  }

  const reason =
    resolution.reason === "too-many"
      ? `確認できない事実が多いため（${facts.length}件）、場合分けで判断できません`
      : resolution.reason === "not-enumerable"
        ? "確認できない事実があり、場合分けで判断できません"
        : "確認できない事実によって判断が分かれます";
  return {
    treeId,
    kind: "manual-review",
    conclusion: `${factNames(facts)}が確認できないため裁定を確定できません。CAへ確認してください。`,
    actions: [
      // すべての分岐に共通する、今すぐ行う対応（例: 時計を止める）は残す
      ...shared,
      ...facts.map((q) => `確認する: ${q.label}`),
      "CAへ確認する",
    ],
    intervention: "consult-ca",
    // 分岐が一致しないため、ペナルティは適用しない（§3.3 4）
    penalties: [],
    sources: uniqueSources(decided),
    confidence: "low",
    escalationRecommended: true,
    escalationReason: reason,
    unconfirmedFacts,
  };
}
