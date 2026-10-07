import type {
  CompetitionType,
  IncidentCategory,
  RuleSourceType,
  SupervisionRegime,
} from "@/lib/domain/entities";
import { INCIDENT_CATEGORIES } from "@/lib/domain/llm/classification";
import type {
  LlmArticle,
  LlmClassificationRequest,
  LlmReasoningRequest,
} from "@/lib/domain/llm/types";
import { mentionsFairPlay } from "@/lib/domain/llm/keyword-classifier";
import { LLM_LIMITS } from "../contract";

/** フェアプレーは外部に送らない（§23, ADR-007）。クライアント側の防御が破られた場合の多重防御 */
const FAIR_PLAY_NOT_SENT = "フェアプレー関連の内容はAIへ送信できません";

/**
 * /api/llm/* の入力検証（手書き。外部依存なし）。
 * 不正な場合はエラーメッセージ（入力値そのものは含めない）を返す。
 */

export type Validated<T> =
  { ok: true; value: T } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;

const COMPETITION_TYPES: readonly CompetitionType[] = [
  "standard",
  "rapid",
  "blitz",
];
const REGIMES: readonly SupervisionRegime[] = [
  "competition-rules",
  "basic-rules",
];
const SOURCE_TYPES: readonly RuleSourceType[] = [
  "FIDE",
  "JCF",
  "tournament",
  "commentary",
];

function isObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

class Checker {
  readonly errors: string[] = [];

  str(
    obj: Obj,
    key: string,
    path: string,
    max: number,
    optional = false
  ): string | undefined {
    const v = obj[key];
    if (v === undefined || v === null) {
      if (!optional) this.errors.push(`${path} は必須です`);
      return undefined;
    }
    if (typeof v !== "string") {
      this.errors.push(`${path} は文字列である必要があります`);
      return undefined;
    }
    if (v.length > max) {
      this.errors.push(`${path} は${max}文字以内にしてください`);
      return undefined;
    }
    if (!optional && !v.trim()) {
      this.errors.push(`${path} が空です`);
      return undefined;
    }
    return v;
  }

  oneOf<T extends string>(
    obj: Obj,
    key: string,
    path: string,
    values: readonly T[],
    optional = false
  ): T | undefined {
    const v = obj[key];
    if (v === undefined || v === null) {
      if (!optional) this.errors.push(`${path} は必須です`);
      return undefined;
    }
    if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
      this.errors.push(`${path} の値が不正です`);
      return undefined;
    }
    return v as T;
  }
}

export function validateClassificationRequest(
  body: unknown
): Validated<LlmClassificationRequest> {
  if (!isObject(body))
    return {
      ok: false,
      errors: ["本文はJSONオブジェクトである必要があります"],
    };
  const c = new Checker();
  const text = c.str(body, "text", "text", LLM_LIMITS.maxClassifyTextChars);
  if (typeof text === "string" && mentionsFairPlay(text))
    c.errors.push(FAIR_PLAY_NOT_SENT);
  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  return { ok: true, value: { text: text as string } };
}

export function validateReasoningRequest(
  body: unknown
): Validated<LlmReasoningRequest> {
  if (!isObject(body))
    return {
      ok: false,
      errors: ["本文はJSONオブジェクトである必要があります"],
    };
  const c = new Checker();

  const incidentRaw = body.incident;
  const contextRaw = body.context;
  const articlesRaw = body.articles;
  if (!isObject(incidentRaw)) c.errors.push("incident は必須です");
  if (!isObject(contextRaw)) c.errors.push("context は必須です");
  if (!Array.isArray(articlesRaw))
    c.errors.push("articles は配列である必要があります");
  if (c.errors.length > 0) return { ok: false, errors: c.errors };

  const inc = incidentRaw as Obj;
  const category = c.oneOf<IncidentCategory>(
    inc,
    "category",
    "incident.category",
    INCIDENT_CATEGORIES
  );
  // フェアプレーは外部に送らない（§23, ADR-007）。クライアント側の防御が破られた場合の多重防御
  if (category === "fair-play") c.errors.push(FAIR_PLAY_NOT_SENT);
  const subtype = c.str(
    inc,
    "subtype",
    "incident.subtype",
    LLM_LIMITS.maxShortChars,
    true
  );
  const playerColor = c.oneOf(
    inc,
    "playerColor",
    "incident.playerColor",
    ["white", "black"] as const,
    true
  );
  const description = c.str(
    inc,
    "description",
    "incident.description",
    LLM_LIMITS.maxDescriptionChars
  );
  if (typeof description === "string" && mentionsFairPlay(description))
    c.errors.push(FAIR_PLAY_NOT_SENT);
  if (typeof inc.arbiterObserved !== "boolean") {
    c.errors.push("incident.arbiterObserved は真偽値である必要があります");
  }

  const ctx = contextRaw as Obj;
  const competitionType = c.oneOf(
    ctx,
    "competitionType",
    "context.competitionType",
    COMPETITION_TYPES
  );
  const supervisionRegime = c.oneOf(
    ctx,
    "supervisionRegime",
    "context.supervisionRegime",
    REGIMES,
    true
  );
  const rulesVersion = c.str(
    ctx,
    "rulesVersion",
    "context.rulesVersion",
    LLM_LIMITS.maxShortChars
  );
  const tournamentId = c.str(
    ctx,
    "tournamentId",
    "context.tournamentId",
    LLM_LIMITS.maxIdChars,
    true
  );
  if (competitionType && competitionType !== "standard" && !supervisionRegime) {
    c.errors.push("Rapid / Blitz では context.supervisionRegime が必須です");
  }

  const list = articlesRaw as unknown[];
  if (list.length === 0) c.errors.push("articles が空です");
  if (list.length > LLM_LIMITS.maxArticles) {
    c.errors.push(`articles は${LLM_LIMITS.maxArticles}件以内にしてください`);
  }
  const articles: LlmArticle[] = [];
  const ids = new Set<string>();
  if (list.length <= LLM_LIMITS.maxArticles) {
    list.forEach((a, i) => {
      const p = `articles[${i}]`;
      if (!isObject(a)) {
        c.errors.push(`${p} はオブジェクトである必要があります`);
        return;
      }
      const id = c.str(a, "id", `${p}.id`, LLM_LIMITS.maxIdChars);
      const article = c.str(
        a,
        "article",
        `${p}.article`,
        LLM_LIMITS.maxArticleNumberChars
      );
      const title = c.str(
        a,
        "title",
        `${p}.title`,
        LLM_LIMITS.maxArticleTitleChars,
        true
      );
      const content = c.str(
        a,
        "content",
        `${p}.content`,
        LLM_LIMITS.maxArticleContentChars
      );
      const source = c.oneOf(a, "source", `${p}.source`, SOURCE_TYPES);
      const sourceName = c.str(
        a,
        "sourceName",
        `${p}.sourceName`,
        LLM_LIMITS.maxSourceNameChars,
        true
      );
      const sourceVersion = c.str(
        a,
        "sourceVersion",
        `${p}.sourceVersion`,
        LLM_LIMITS.maxShortChars,
        true
      );
      const tId = c.str(
        a,
        "tournamentId",
        `${p}.tournamentId`,
        LLM_LIMITS.maxIdChars,
        true
      );
      const page = a.page;
      if (
        page !== undefined &&
        page !== null &&
        (typeof page !== "number" || !Number.isInteger(page) || page < 0)
      ) {
        c.errors.push(`${p}.page が不正です`);
      }
      const priority = a.priority;
      if (typeof priority !== "number" || !Number.isFinite(priority)) {
        c.errors.push(`${p}.priority が不正です`);
      }
      if (id !== undefined) {
        if (ids.has(id)) c.errors.push(`${p}.id が重複しています`);
        ids.add(id);
      }
      if (id && article && content && source && typeof priority === "number") {
        articles.push({
          id,
          article,
          title: title ?? "",
          content,
          source,
          sourceName,
          sourceVersion,
          page: typeof page === "number" ? page : undefined,
          priority,
          tournamentId: tId,
        });
      }
    });
  }

  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  return {
    ok: true,
    value: {
      incident: {
        category: category as IncidentCategory,
        subtype,
        playerColor,
        description: description as string,
        arbiterObserved: inc.arbiterObserved as boolean,
      },
      context: {
        competitionType: competitionType as CompetitionType,
        supervisionRegime,
        rulesVersion: rulesVersion as string,
        tournamentId,
      },
      articles,
    },
  };
}
