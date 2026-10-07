import type {
  IncidentCategory,
  PenaltyType,
  PlayerColor,
} from "@/lib/domain/entities";
import {
  LLM_INTERVENTIONS,
  LLM_PENALTY_TYPES,
  type LlmArticle,
  type LlmCitationDraft,
  type LlmDecisionDraft,
  type LlmPenaltyDraft,
} from "./types";
import { normalizeForQuote, quoteMatchesArticle } from "./quote-match";

/**
 * LLM 出力の検証（ADR-002 / ADR-007）。
 *
 * 純粋・決定的な関数のみで構成し、LLM や I/O は一切呼び出さない。
 * 以下のいずれかに該当する下書きは不合格とし、呼び出し側で CA への確認に置き換える。
 * - スキーマ不正（必須項目・列挙値・型・長さ）
 * - 根拠のないペナルティ（sourceArticleIds が空、または引用に含まれない条文）
 * - 提示していない条文 ID・登録されていない条文 ID の引用（捏造）
 * - 条文本文と一致しない引用
 * - 推測的な表現（「おそらく」「と思われる」「可能性がある」, "probably", "might" 等）
 * - フェアプレー事象でのペナルティ提案（要件 §23: 不正を自動認定しない）
 * - CA への確認を推奨しないのに根拠が1件もない
 *
 * 自動修正（不合格にはしない）:
 * - confidence "high" → "medium"（LLM の判断を高信頼として扱わない）
 * - confidence "low" → escalationRecommended = true
 * - escalationRecommended → intervention = "consult-ca"
 * - フェアプレー事象 → escalationRecommended = true
 */

export interface ValidateLlmDraftInput {
  raw: unknown;
  /** LLM に提示した候補条文 */
  articles: readonly LlmArticle[];
  /** 応答後に登録規則（IndexedDB）で存在を確認できた条文 ID。未指定なら articles と同じ */
  storedArticleIds?: readonly string[];
  category: IncidentCategory;
}

export type LlmValidationResult =
  | {
      valid: true;
      draft: LlmDecisionDraft;
      /** 適用した自動修正 */
      adjustments: string[];
    }
  | { valid: false; errors: string[] };

// 長さの上限（過大な出力を表示しない）
const MAX_CONCLUSION = 500;
const MAX_ACTIONS = 10;
const MAX_ACTION = 300;
const MAX_PENALTIES = 5;
const MAX_CITATIONS = 10;
const MAX_QUOTE = 3000;
const MAX_SHORT = 500;
const MAX_MISSING = 10;
const MAX_TIME_ADJUSTMENT_SECONDS = 3600;

const COLORS: readonly PlayerColor[] = ["white", "black"];

/** AI 参考情報のみで確定させない重大な結果（必ず CA への確認を推奨する） */
export const SEVERE_PENALTIES: readonly PenaltyType[] = [
  "game-loss",
  "both-lose",
  "expulsion",
];

/** 推測的な表現（日本語） */
const SPECULATIVE_JA =
  /たぶん|多分|おそらく|恐らく|と思われ|と思い|と思う|かもしれ|可能性があ|可能性もあ|恐れがあ|おそれがあ|でしょう|だろう|と推測|と考えられ|と見られ|とみられ|ようだ|ようです|一般的に|ではないか|と推定/;
/** 推測的な表現（英語） */
const SPECULATIVE_EN =
  /\b(probably|likely|unlikely|might|may|could|maybe|perhaps|possibly|presumably|apparently|appears?|seems?|seemingly|generally|usually|i think|i believe|i guess)\b/i;

/** 推測的な表現を検出する（一致した語を返す） */
export function findSpeculativeLanguage(text: string): string | null {
  const ja = SPECULATIVE_JA.exec(text);
  if (ja) return ja[0];
  const en = SPECULATIVE_EN.exec(text);
  return en ? en[0] : null;
}

// 引用の照合は quote-match.ts（表示用の文脈抽出と共通）
export { normalizeForQuote, quoteMatchesArticle };

// ---------------------------------------------------------------------------
// スキーマ検証
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function isObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isOneOf<T extends string>(v: unknown, values: readonly T[]): v is T {
  return typeof v === "string" && (values as readonly string[]).includes(v);
}

class SchemaReader {
  readonly errors: string[] = [];

  string(
    obj: Obj,
    key: string,
    path: string,
    max: number,
    opts: { optional?: boolean } = {}
  ): string | undefined {
    const v = obj[key];
    if (v === undefined || v === null) {
      if (!opts.optional) this.errors.push(`${path} がありません`);
      return undefined;
    }
    if (typeof v !== "string") {
      this.errors.push(`${path} は文字列である必要があります`);
      return undefined;
    }
    const trimmed = v.trim();
    if (!trimmed) {
      if (!opts.optional) this.errors.push(`${path} が空です`);
      return undefined;
    }
    if (trimmed.length > max) {
      this.errors.push(`${path} が長すぎます（最大${max}文字）`);
      return undefined;
    }
    return trimmed;
  }

  stringArray(
    obj: Obj,
    key: string,
    path: string,
    maxItems: number,
    maxLength: number,
    opts: { optional?: boolean } = {}
  ): string[] {
    const v = obj[key];
    if (v === undefined || v === null) {
      if (!opts.optional) this.errors.push(`${path} がありません`);
      return [];
    }
    if (!Array.isArray(v)) {
      this.errors.push(`${path} は配列である必要があります`);
      return [];
    }
    if (v.length > maxItems) {
      this.errors.push(`${path} の件数が多すぎます（最大${maxItems}件）`);
      return [];
    }
    const out: string[] = [];
    v.forEach((item, i) => {
      if (typeof item !== "string" || !item.trim()) {
        this.errors.push(`${path}[${i}] は空でない文字列である必要があります`);
      } else if (item.trim().length > maxLength) {
        this.errors.push(`${path}[${i}] が長すぎます（最大${maxLength}文字）`);
      } else {
        out.push(item.trim());
      }
    });
    return out;
  }
}

interface ParsedDraft {
  draft: LlmDecisionDraft;
  confidenceWasHigh: boolean;
}

function parseDraft(
  raw: unknown
): { ok: true; value: ParsedDraft } | { ok: false; errors: string[] } {
  if (!isObject(raw)) {
    return { ok: false, errors: ["出力がJSONオブジェクトではありません"] };
  }
  const r = new SchemaReader();

  const conclusion = r.string(raw, "conclusion", "conclusion", MAX_CONCLUSION);
  const actions = r.stringArray(
    raw,
    "actions",
    "actions",
    MAX_ACTIONS,
    MAX_ACTION
  );

  const intervention = raw.intervention;
  if (!isOneOf(intervention, LLM_INTERVENTIONS)) {
    r.errors.push(
      `intervention が不正です（${LLM_INTERVENTIONS.join(" / ")} のいずれか）`
    );
  }

  let confidence: "medium" | "low" | undefined;
  let confidenceWasHigh = false;
  if (raw.confidence === "high") {
    confidence = "medium";
    confidenceWasHigh = true;
  } else if (raw.confidence === "medium" || raw.confidence === "low") {
    confidence = raw.confidence;
  } else {
    r.errors.push("confidence が不正です（medium / low のいずれか）");
  }

  if (typeof raw.escalationRecommended !== "boolean") {
    r.errors.push("escalationRecommended は真偽値である必要があります");
  }
  const escalationReason = r.string(
    raw,
    "escalationReason",
    "escalationReason",
    MAX_SHORT,
    { optional: true }
  );
  const missingInformation = r.stringArray(
    raw,
    "missingInformation",
    "missingInformation",
    MAX_MISSING,
    MAX_SHORT,
    { optional: true }
  );

  const penalties: LlmPenaltyDraft[] = [];
  if (!Array.isArray(raw.penalties)) {
    r.errors.push("penalties は配列である必要があります");
  } else if (raw.penalties.length > MAX_PENALTIES) {
    r.errors.push(`penalties の件数が多すぎます（最大${MAX_PENALTIES}件）`);
  } else {
    raw.penalties.forEach((p, i) => {
      const path = `penalties[${i}]`;
      if (!isObject(p)) {
        r.errors.push(`${path} はオブジェクトである必要があります`);
        return;
      }
      if (!isOneOf(p.type, LLM_PENALTY_TYPES)) {
        r.errors.push(`${path}.type が不正です`);
      }
      if (
        p.playerColor !== undefined &&
        p.playerColor !== null &&
        !isOneOf(p.playerColor, COLORS)
      ) {
        r.errors.push(`${path}.playerColor が不正です`);
      }
      const seconds = p.timeAdjustmentSeconds;
      if (
        seconds !== undefined &&
        seconds !== null &&
        (typeof seconds !== "number" ||
          !Number.isInteger(seconds) ||
          Math.abs(seconds) > MAX_TIME_ADJUSTMENT_SECONDS)
      ) {
        r.errors.push(`${path}.timeAdjustmentSeconds が不正です`);
      }
      const description = r.string(
        p,
        "description",
        `${path}.description`,
        MAX_SHORT
      );
      const sourceArticleIds = r.stringArray(
        p,
        "sourceArticleIds",
        `${path}.sourceArticleIds`,
        MAX_CITATIONS,
        200,
        { optional: true }
      );
      if (isOneOf(p.type, LLM_PENALTY_TYPES) && description !== undefined) {
        penalties.push({
          type: p.type as PenaltyType,
          playerColor: isOneOf(p.playerColor, COLORS)
            ? p.playerColor
            : undefined,
          timeAdjustmentSeconds:
            typeof seconds === "number" && Number.isInteger(seconds)
              ? seconds
              : undefined,
          description,
          sourceArticleIds,
        });
      }
    });
  }

  const citations: LlmCitationDraft[] = [];
  if (!Array.isArray(raw.citations)) {
    r.errors.push("citations は配列である必要があります");
  } else if (raw.citations.length > MAX_CITATIONS) {
    r.errors.push(`citations の件数が多すぎます（最大${MAX_CITATIONS}件）`);
  } else {
    raw.citations.forEach((c, i) => {
      const path = `citations[${i}]`;
      if (!isObject(c)) {
        r.errors.push(`${path} はオブジェクトである必要があります`);
        return;
      }
      const articleId = r.string(c, "articleId", `${path}.articleId`, 200);
      const quote = r.string(c, "quote", `${path}.quote`, MAX_QUOTE);
      const relevance = r.string(
        c,
        "relevance",
        `${path}.relevance`,
        MAX_SHORT,
        { optional: true }
      );
      if (articleId !== undefined && quote !== undefined) {
        citations.push({ articleId, quote, relevance: relevance ?? "" });
      }
    });
  }

  if (r.errors.length > 0) return { ok: false, errors: r.errors };

  return {
    ok: true,
    value: {
      confidenceWasHigh,
      draft: {
        conclusion: conclusion as string,
        actions,
        intervention: intervention as LlmDecisionDraft["intervention"],
        penalties,
        citations,
        confidence: confidence as "medium" | "low",
        escalationRecommended: raw.escalationRecommended as boolean,
        escalationReason,
        missingInformation,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 意味の検証
// ---------------------------------------------------------------------------

export function validateLlmDecisionDraft(
  input: ValidateLlmDraftInput
): LlmValidationResult {
  const parsed = parseDraft(input.raw);
  if (!parsed.ok) return { valid: false, errors: parsed.errors };

  const draft = { ...parsed.value.draft };
  const errors: string[] = [];
  const adjustments: string[] = [];

  const articleById = new Map(input.articles.map((a) => [a.id, a]));
  const stored = new Set(
    input.storedArticleIds ?? input.articles.map((a) => a.id)
  );

  // 1. 引用: 提示した条文・登録規則に存在し、引用文が本文と一致すること
  const citedIds = new Set<string>();
  draft.citations.forEach((c, i) => {
    const article = articleById.get(c.articleId);
    if (!article) {
      errors.push(
        `citations[${i}]: 条文ID「${c.articleId}」は提示した条文に含まれていません（存在しない条文の引用）`
      );
      return;
    }
    if (!stored.has(c.articleId)) {
      errors.push(
        `citations[${i}]: 条文ID「${c.articleId}」は登録規則に存在しません`
      );
      return;
    }
    if (!quoteMatchesArticle(c.quote, article.content)) {
      errors.push(
        `citations[${i}]: 引用文が条文「${article.article}」の本文と一致しません`
      );
      return;
    }
    citedIds.add(c.articleId);
  });

  // 2. ペナルティには根拠（引用済みの条文）が必要
  draft.penalties.forEach((p, i) => {
    if (p.sourceArticleIds.length === 0) {
      errors.push(`penalties[${i}]: ペナルティに根拠条文がありません`);
      return;
    }
    for (const id of p.sourceArticleIds) {
      if (!draft.citations.some((c) => c.articleId === id)) {
        errors.push(
          `penalties[${i}]: 根拠条文「${id}」が citations に含まれていません`
        );
      }
    }
  });

  // 3. フェアプレーは不正を自動認定しない（§23）
  if (input.category === "fair-play" && draft.penalties.length > 0) {
    errors.push(
      "フェアプレー事象ではペナルティを提案できません（不正の自動認定は禁止）"
    );
  }

  // 4. 推測的な表現の禁止（§14）
  // 不確実性は confidence / escalationRecommended / missingInformation（事実の列挙）で表し、
  // 文章中のぼかし表現は使わせない（ADR-007）。自由記述欄はすべて検査する
  const texts: Array<[string, string]> = [
    ["conclusion", draft.conclusion],
    ...draft.actions.map((a, i) => [`actions[${i}]`, a] as [string, string]),
    ...draft.penalties.map(
      (p, i) =>
        [`penalties[${i}].description`, p.description] as [string, string]
    ),
    ...draft.citations.map(
      (c, i) => [`citations[${i}].relevance`, c.relevance] as [string, string]
    ),
    ...draft.missingInformation.map(
      (m, i) => [`missingInformation[${i}]`, m] as [string, string]
    ),
    ...(draft.escalationReason
      ? [["escalationReason", draft.escalationReason] as [string, string]]
      : []),
  ];
  for (const [path, text] of texts) {
    const hit = findSpeculativeLanguage(text);
    if (hit) errors.push(`${path}: 推測的な表現「${hit}」が含まれています`);
  }

  // 5. CA への確認を推奨しない場合は根拠が必要
  if (!draft.escalationRecommended && draft.citations.length === 0) {
    errors.push("根拠条文のない推奨です（CAへの確認が必要）");
  }

  if (errors.length > 0) return { valid: false, errors };

  // 自動修正
  if (parsed.value.confidenceWasHigh) {
    adjustments.push("信頼度をmediumに制限しました（AI参考情報のため）");
  }
  if (input.category === "fair-play" && !draft.escalationRecommended) {
    draft.escalationRecommended = true;
    draft.escalationReason =
      draft.escalationReason ?? "フェアプレー事象はCAの判断が必要です";
    adjustments.push("フェアプレー事象のためCAへの確認を推奨にしました");
  }
  // 重大な結果（負け・両者負け・除外）は AI 参考情報のみで確定させない
  if (
    draft.penalties.some((p) => SEVERE_PENALTIES.includes(p.type)) &&
    !draft.escalationRecommended
  ) {
    draft.escalationRecommended = true;
    draft.escalationReason =
      draft.escalationReason ??
      "負け・除外などの重大な結果はCAの確認が必要です";
    adjustments.push(
      "重大な結果（負け・除外）を含むためCAへの確認を推奨にしました"
    );
  }
  if (draft.confidence === "low" && !draft.escalationRecommended) {
    draft.escalationRecommended = true;
    draft.escalationReason =
      draft.escalationReason ?? "AIの信頼度が低いためCAへ確認してください";
    adjustments.push("信頼度が低いためCAへの確認を推奨にしました");
  }
  if (draft.escalationRecommended && draft.intervention !== "consult-ca") {
    draft.intervention = "consult-ca";
    adjustments.push("CAへの確認を推奨するため介入を「CAへ確認」にしました");
  }

  return { valid: true, draft, adjustments };
}
