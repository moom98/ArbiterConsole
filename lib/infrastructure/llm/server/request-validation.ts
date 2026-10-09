import {
  SUPPORTED_RULES_VERSIONS,
  type CompetitionType,
  type IncidentCategory,
  type RuleSourceType,
  type SupervisionRegime,
} from "@/lib/domain/entities";
import { isReportableSubtype } from "@/lib/domain/follow-up";
import { INCIDENT_CATEGORIES } from "@/lib/domain/llm/classification";
import {
  recheckIncidentText,
  recheckRegulationText,
  type ProtectedTextRoute,
} from "@/lib/domain/privacy";
import type {
  ClassifierProvider,
  LlmArticle,
  LlmClassificationRequest,
  LlmFactPresenceRequest,
  LlmReasoningRequest,
} from "@/lib/domain/llm/types";
import { mentionsFairPlay } from "@/lib/domain/llm/keyword-classifier";
import { isPresenceCheckableFact } from "./jev-presence";
import {
  ARTICLE_ID,
  LLM_LIMITS,
  TOURNAMENT_SOURCE_NAME,
  type EmbedRequest,
} from "../contract";

/** フェアプレーは外部に送らない（§23, ADR-007）。クライアント側の防御が破られた場合の多重防御 */
const FAIR_PLAY_NOT_SENT = "フェアプレー関連の内容はAIへ送信できません";

/**
 * /api/llm/* の入力検証（手書き。外部依存なし）。
 * 不正な場合はエラーメッセージ（入力値そのものは含めない）を返す。
 *
 * - 受け付けるのは最小化した形（external-ai-data-protection.md §5.3）だけ。未知の項目は 400
 *   （旧クライアントの classify の { text } を含む）
 * - 事故由来のテキストと大会規定の本文は、送る前の再確認（L5, §7）を通す。止まった場合は
 *   code "not-sendable"（400）で、何も上流へ送らない。本文は書き換えない
 */

export type Validated<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      errors: string[];
      /** L5 の再確認で止めた（形は正しい）。未指定なら invalid-request */
      code?: "not-sendable";
    };

/** L5 で止めた場合のメッセージ（理由のコードも本文も含めない） */
export const NOT_SENDABLE_MESSAGE =
  "送信前の確認（サーバー）で止めました。外部AIには送っていません。端末内の判断を使ってください";

const OLD_CLASSIFY_SHAPE =
  "古い形式の送信（text）は受け付けません。アプリを再読み込みしてください";

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
  /** L5 で止めた欄（パス）。本文は含めない */
  readonly notSendable: string[] = [];

  /** 決まった項目以外を拒否する（最小化した形だけを受け付ける。§7） */
  only(obj: Obj, path: string, keys: readonly string[]): void {
    const unknown = Object.keys(obj).filter((k) => !keys.includes(k));
    if (unknown.length > 0)
      this.errors.push(
        `${path} に受け付けない項目があります（${unknown.length}件）`
      );
  }

  /** 事故由来のテキストの再確認（L5） */
  incidentText(
    value: string | undefined,
    route: ProtectedTextRoute,
    path: string
  ): void {
    if (typeof value === "string" && !recheckIncidentText(value, route).ok)
      this.notSendable.push(path);
  }

  /** 大会規定の本文の再確認（L5, 規則 1・5・12） */
  regulationText(value: string | undefined, path: string): void {
    if (typeof value === "string" && !recheckRegulationText(value).ok)
      this.notSendable.push(path);
  }

  result<T>(value: () => T): Validated<T> {
    if (this.errors.length > 0) return { ok: false, errors: this.errors };
    if (this.notSendable.length > 0)
      return {
        ok: false,
        errors: [NOT_SENDABLE_MESSAGE],
        code: "not-sendable",
      };
    return { ok: true, value: value() };
  }

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

const CLASSIFIER_PROVIDERS: readonly ClassifierProvider[] = ["gemini", "jev"];

export function validateClassificationRequest(
  body: unknown
): Validated<LlmClassificationRequest> {
  if (!isObject(body))
    return {
      ok: false,
      errors: ["本文はJSONオブジェクトである必要があります"],
    };
  // 外部AIガードで置き換え・最小化した narrative のみ（ADR-012 §5.3）
  if ("text" in body && !("narrative" in body))
    return { ok: false, errors: [OLD_CLASSIFY_SHAPE] };
  const c = new Checker();
  c.only(body, "本文", ["narrative", "provider"]);
  const narrative = c.str(
    body,
    "narrative",
    "narrative",
    LLM_LIMITS.maxClassifyNarrativeChars
  );
  // プレビューで示した送り先（D13）。サーバーの設定との一致はハンドラーが確かめる
  const provider = c.oneOf<ClassifierProvider>(
    body,
    "provider",
    "provider",
    CLASSIFIER_PROVIDERS
  );
  if (typeof narrative === "string" && mentionsFairPlay(narrative))
    c.errors.push(FAIR_PLAY_NOT_SENT);
  c.incidentText(narrative, "classify", "narrative");
  return c.result(() => ({
    narrative: narrative as string,
    provider: provider as ClassifierProvider,
  }));
}

/** /api/llm/providers の入力検証: 本文は {} のみ */
export function validateProvidersRequest(body: unknown): Validated<object> {
  if (!isObject(body))
    return {
      ok: false,
      errors: ["本文はJSONオブジェクトである必要があります"],
    };
  const c = new Checker();
  c.only(body, "本文", []);
  return c.result(() => ({}));
}

/**
 * fact の判定（/api/llm/facts, fact-model.md §4.2）の入力検証。
 * - 本文は { narrative, factIds } のみ
 * - narrative は分類と同じ（最大 500 文字・フェアプレーは送らない・L5 の再確認 "facts"）
 * - factIds はカタログの fact id で、判定してよいもの（presenceCheckable・端末内専用でない）だけ。
 *   重複・未知の id は 400。質問文はサーバーがカタログから作る（クライアントは文言を送れない）
 */
export function validateFactPresenceRequest(
  body: unknown
): Validated<LlmFactPresenceRequest> {
  if (!isObject(body))
    return {
      ok: false,
      errors: ["本文はJSONオブジェクトである必要があります"],
    };
  const c = new Checker();
  c.only(body, "本文", ["narrative", "factIds"]);
  const narrative = c.str(
    body,
    "narrative",
    "narrative",
    LLM_LIMITS.maxClassifyNarrativeChars
  );
  if (typeof narrative === "string" && mentionsFairPlay(narrative))
    c.errors.push(FAIR_PLAY_NOT_SENT);

  const ids = body.factIds;
  let factIds: string[] = [];
  if (!Array.isArray(ids) || ids.length === 0) {
    c.errors.push("factIds は1件以上の配列である必要があります");
  } else if (ids.length > LLM_LIMITS.maxFactIds) {
    c.errors.push(`factIds は${LLM_LIMITS.maxFactIds}件以内にしてください`);
  } else {
    const bad = ids.filter(
      (id) =>
        typeof id !== "string" ||
        id.length > LLM_LIMITS.maxIdChars ||
        !isPresenceCheckableFact(id)
    ).length;
    if (bad > 0)
      c.errors.push(`factIds に判定できない項目があります（${bad}件）`);
    else if (new Set(ids).size !== ids.length)
      c.errors.push("factIds に重複があります");
    else factIds = ids as string[];
  }
  // 形が正しい場合だけ再確認する（L5。止めた場合は not-sendable）
  if (c.errors.length === 0) c.incidentText(narrative, "facts", "narrative");
  return c.result(() => ({ narrative: narrative as string, factIds }));
}

/**
 * 埋め込みの入力検証（ADR-010）。
 * - 文書（document）は登録したルール資料の条文。公開された規則のため送信してよい
 * - 検索語（query）は事象の記述を含みうるため、フェアプレーに触れるものは送らない（§23, ADR-007）
 */
export function validateEmbedRequest(body: unknown): Validated<EmbedRequest> {
  if (!isObject(body))
    return {
      ok: false,
      errors: ["本文はJSONオブジェクトである必要があります"],
    };
  const c = new Checker();
  c.only(body, "本文", ["taskType", "texts"]);
  const errors = c.errors;
  const taskType = body.taskType;
  if (taskType !== "document" && taskType !== "query")
    errors.push("taskType は document または query です");
  const texts = body.texts;
  if (!Array.isArray(texts) || texts.length === 0) {
    errors.push("texts は空でない配列である必要があります");
  } else {
    if (texts.length > LLM_LIMITS.maxEmbedTexts)
      errors.push(`texts は${LLM_LIMITS.maxEmbedTexts}件以内にしてください`);
    if (taskType === "query" && texts.length !== 1)
      errors.push("検索語は1件ずつ送ってください");
    texts.forEach((t, i) => {
      const max =
        taskType === "query"
          ? LLM_LIMITS.maxEmbedQueryChars
          : LLM_LIMITS.maxEmbedTextChars;
      if (typeof t !== "string" || t.trim() === "")
        errors.push(`texts[${i}] は空でない文字列である必要があります`);
      else if (t.length > max)
        errors.push(`texts[${i}] は${max}文字以内にしてください`);
      else if (taskType === "query" && mentionsFairPlay(t))
        errors.push(FAIR_PLAY_NOT_SENT);
      // 検索語は事故由来のテキスト（L5）。条文（document）は規則の本文のため確認しない（§2）
      else if (taskType === "query")
        c.incidentText(t, "embed-query", `texts[${i}]`);
    });
  }
  return c.result(() => ({
    taskType: taskType as EmbedRequest["taskType"],
    texts: texts as string[],
  }));
}

const ARTICLE_KEYS = [
  "id",
  "article",
  "title",
  "content",
  "source",
  "sourceName",
  "sourceVersion",
  "page",
  "priority",
] as const;

export function validateReasoningRequest(
  body: unknown
): Validated<LlmReasoningRequest> {
  if (!isObject(body))
    return {
      ok: false,
      errors: ["本文はJSONオブジェクトである必要があります"],
    };
  const c = new Checker();
  c.only(body, "本文", ["incident", "context", "articles"]);

  const incidentRaw = body.incident;
  const contextRaw = body.context;
  const articlesRaw = body.articles;
  if (!isObject(incidentRaw)) c.errors.push("incident は必須です");
  if (!isObject(contextRaw)) c.errors.push("context は必須です");
  if (!Array.isArray(articlesRaw))
    c.errors.push("articles は配列である必要があります");
  if (c.errors.length > 0) return { ok: false, errors: c.errors };

  const inc = incidentRaw as Obj;
  c.only(inc, "incident", [
    "category",
    "subtype",
    "playerColor",
    "description",
    "arbiterObserved",
  ]);
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
  // 種別は構造化されたコード。カテゴリごとの既知の値だけ（自由記述を紛れ込ませない。§2）
  if (
    typeof subtype === "string" &&
    category &&
    !isReportableSubtype(category, subtype)
  )
    c.errors.push("incident.subtype の値が不正です");
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
    LLM_LIMITS.maxReasonDescriptionChars
  );
  if (typeof description === "string" && mentionsFairPlay(description))
    c.errors.push(FAIR_PLAY_NOT_SENT);
  c.incidentText(description, "reason-description", "incident.description");
  if (typeof inc.arbiterObserved !== "boolean") {
    c.errors.push("incident.arbiterObserved は真偽値である必要があります");
  }

  const ctx = contextRaw as Obj;
  // tournamentId は送らない（§5.3）。受け付けない項目として 400
  c.only(ctx, "context", [
    "competitionType",
    "supervisionRegime",
    "rulesVersion",
  ]);
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
  const rulesVersion = c.oneOf(
    ctx,
    "rulesVersion",
    "context.rulesVersion",
    SUPPORTED_RULES_VERSIONS
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
      c.only(a, p, ARTICLE_KEYS);
      const id = c.str(a, "id", `${p}.id`, LLM_LIMITS.maxIdChars);
      // 条文の ID は端末内の識別子（UUID など）。自由記述を紛れ込ませない（§2）
      if (typeof id === "string" && !ARTICLE_ID.test(id))
        c.errors.push(`${p}.id の形式が不正です`);
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
      // 大会規定: 資料名は固定の「大会規定」で版は送らない（§5.3）。本文は狭い規則で再確認（§5.5）
      if (source === "tournament") {
        if (sourceName !== TOURNAMENT_SOURCE_NAME)
          c.errors.push(`${p}.sourceName は「${TOURNAMENT_SOURCE_NAME}」です`);
        if (a.sourceVersion !== undefined)
          c.errors.push(`${p}.sourceVersion は大会規定では送りません`);
        c.regulationText(article, `${p}.article`);
        c.regulationText(title, `${p}.title`);
        c.regulationText(content, `${p}.content`);
      } else {
        // FIDE・JCF・解説の資料名と版は登録時の自由記述。本文と同じ狭い規則で確かめる
        // （本文は公開された規則のため確認しない。§2）
        c.regulationText(sourceName, `${p}.sourceName`);
        c.regulationText(sourceVersion, `${p}.sourceVersion`);
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
        });
      }
    });
  }

  return c.result(() => ({
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
    },
    articles,
  }));
}
