/**
 * 外部AIガード（ADR-012, external-ai-data-protection.md §3）。
 *
 * /api/llm/* への送信はすべてここを通る。callLlmApi を import するのはこのモジュールだけ
 * （__tests__/privacy/external-ai-guard.test.ts で確かめる）。
 *
 * - 事故由来のテキスト（分類の記述・推論の記述・検索語）は protectIncidentText（A〜E）を通す。
 *   止まった場合は理由コードだけを返し（本文は返さない）、呼び出し側はローカルで処理する
 * - 通ったものは送信内容のプレビューを返し、アービターが確認してから send() で送る（F, D13）
 * - 大会規定の本文は狭い規則（§5.5）で置き換える。FIDE・JCF の本文はそのまま
 * - 対応表（PlaceholderMap）はリクエストごとに作り、メモリ内だけで使う（送信・保存しない）
 */
import type { IncidentCategory, RuleSourceType } from "@/lib/domain/entities";
import type {
  ExternalAiPreview,
  LlmArticle,
  LlmIncidentSummary,
  LlmReasoningContext,
  LlmReasoningRequest,
} from "@/lib/domain/llm/types";
import {
  PlaceholderMap,
  protectIncidentText,
  redactPii,
  reidentify,
  truncate,
  type GateReasonCode,
  type KnownIdentifiers,
  type ProtectResult,
  type ReidentifyResult,
} from "@/lib/domain/privacy";
import { db } from "@/lib/infrastructure/db";
import {
  generateEmbeddings,
  generateQueryEmbedding,
  type GenerateEmbeddingsOptions,
} from "@/lib/infrastructure/embeddings/generator";
import {
  LLM_LIMITS,
  type LlmApiResponse,
} from "@/lib/infrastructure/llm/contract";
import {
  callLlmApi,
  type LlmApiClientDeps,
} from "@/lib/infrastructure/llm/llm-api-client";
import { loadKnownIdentifiers } from "@/lib/infrastructure/privacy/known-identifiers";

export interface ExternalAiGuardDeps extends LlmApiClientDeps {
  /** テスト用。既定は callLlmApi */
  call?: typeof callLlmApi;
  /** 端末に登録済みの識別子（既定: IndexedDB から読み込む） */
  identifiers?: () => Promise<KnownIdentifiers>;
}

/** ガードが止めた（外部へ送らない）。理由はコードだけ */
export interface NotSent {
  status: "local";
  reasons: GateReasonCode[];
}

/** 送信できる状態。アービターが preview を確認してから send() を呼ぶ */
export interface PendingSend<T> {
  status: "needs-confirmation";
  preview: ExternalAiPreview;
  send(): Promise<T>;
}

const GEMINI = "Gemini（Google）";

async function knownIdentifiers(
  deps: ExternalAiGuardDeps
): Promise<KnownIdentifiers> {
  return deps.identifiers ? deps.identifiers() : loadKnownIdentifiers(db);
}

/** 識別子を読み込めない場合は置き換えを保証できないため送らない（fail closed） */
async function identifiersOrNull(
  deps: ExternalAiGuardDeps
): Promise<KnownIdentifiers | null> {
  try {
    return await knownIdentifiers(deps);
  } catch (error) {
    console.error(
      "Failed to load known identifiers:",
      error instanceof Error ? error.name : "unknown"
    );
    return null;
  }
}

const IDENTIFIERS_UNAVAILABLE: NotSent = {
  status: "local",
  reasons: ["residual"],
};

function notSent(result: Extract<ProtectResult, { ok: false }>): NotSent {
  const reasons = result.gate.reasons.map((r) => r.code);
  return {
    status: "local",
    reasons: reasons.length > 0 ? Array.from(new Set(reasons)) : ["residual"],
  };
}

function callOf(deps: ExternalAiGuardDeps): typeof callLlmApi {
  return deps.call ?? callLlmApi;
}

// ---------------------------------------------------------------------------
// 分類（/api/llm/classify）
// ---------------------------------------------------------------------------

export interface IncidentTextOptions {
  /** アービターが選んだカテゴリ（L0: fair-play なら送らない） */
  category?: IncidentCategory;
  /** 「外部AIに送らない」（L1） */
  doNotSend?: boolean;
}

/** 自由記述の分類。送るのは置き換え・最小化した narrative だけ（§5.3） */
export async function prepareClassification(
  text: string,
  options: IncidentTextOptions = {},
  deps: ExternalAiGuardDeps = {}
): Promise<
  | NotSent
  | (PendingSend<LlmApiResponse> & {
      /** 応答のプレースホルダーを元の表記へ戻す（このリクエストの対応表） */
      reidentify(text: string): ReidentifyResult;
    })
> {
  const ids = await identifiersOrNull(deps);
  if (!ids) return IDENTIFIERS_UNAVAILABLE;
  const map = new PlaceholderMap();
  const protectedText = protectIncidentText({
    route: "classify",
    text,
    category: options.category,
    doNotSend: options.doNotSend,
    identifiers: ids,
    map,
  });
  if (!protectedText.ok) return notSent(protectedText);
  const narrative = protectedText.text;
  return {
    status: "needs-confirmation",
    preview: {
      destination: `カテゴリの提案（${GEMINI}）`,
      fields: [
        { label: "送る記述（名前・日時などは置き換え済み）", text: narrative },
      ],
      notes: [],
    },
    send: () => callOf(deps)("classify", { narrative }, deps),
    reidentify: (text) => reidentify(text, map),
  };
}

// ---------------------------------------------------------------------------
// 検索語の埋め込み（/api/llm/embed, query）
// ---------------------------------------------------------------------------

/** 検索語。send() は検索語のベクトルを返す（失敗は EmbeddingUnavailableError） */
export async function prepareEmbeddingQuery(
  query: string,
  options: IncidentTextOptions = {},
  deps: ExternalAiGuardDeps = {}
): Promise<NotSent | (PendingSend<number[]> & { query: string })> {
  const ids = await identifiersOrNull(deps);
  if (!ids) return IDENTIFIERS_UNAVAILABLE;
  const protectedQuery = protectIncidentText({
    route: "embed-query",
    text: query,
    category: options.category,
    doNotSend: options.doNotSend,
    identifiers: ids,
    map: new PlaceholderMap(),
  });
  if (!protectedQuery.ok) return notSent(protectedQuery);
  const text = protectedQuery.text;
  return {
    status: "needs-confirmation",
    query: text,
    preview: {
      destination: `意味検索（${GEMINI}）`,
      fields: [{ label: "送る検索語（名前・日時などは置き換え済み）", text }],
      notes: [],
    },
    send: () => generateQueryEmbedding(text, { ...deps, call: callOf(deps) }),
  };
}

// ---------------------------------------------------------------------------
// 条文の埋め込み（/api/llm/embed, document）
// ---------------------------------------------------------------------------

export interface EmbeddingDocument {
  text: string;
  sourceType: RuleSourceType;
}

/**
 * 条文の埋め込み。大会規定は狭い規則（§5.5）で置き換えてから送る。FIDE・JCF・解説はそのまま。
 * 規則の本文は事故由来のテキストではないため、Sensitive Gate と確認は行わない（§2）
 */
export type EmbedDocumentsOptions = Omit<GenerateEmbeddingsOptions, "deps"> & {
  deps?: ExternalAiGuardDeps;
};

export async function embedRuleDocuments(
  documents: readonly EmbeddingDocument[],
  options: EmbedDocumentsOptions = {}
): Promise<number[][]> {
  const { deps = {}, ...rest } = options;
  const needsRedaction = documents.some((d) => d.sourceType === "tournament");
  const ids = needsRedaction ? await knownIdentifiers(deps) : null;
  const texts = documents.map((d) =>
    d.sourceType === "tournament" && ids
      ? redactPii(d.text, ids, new PlaceholderMap(), "regulation").text
      : d.text
  );
  return generateEmbeddings(texts, {
    ...rest,
    deps: { ...deps, call: callOf(deps) },
  });
}

// ---------------------------------------------------------------------------
// AI 参考情報（/api/llm/reason）
// ---------------------------------------------------------------------------

/** 検索で見つけた条文（端末内のデータ。送る前にガードが整える） */
export interface CandidateArticle {
  id: string;
  article: string;
  title: string;
  content: string;
  source: RuleSourceType;
  sourceName?: string;
  sourceVersion?: string;
  page?: number;
  priority: number;
}

export interface ReasoningInput {
  incident: LlmIncidentSummary;
  context: LlmReasoningContext;
  /** 「外部AIに送らない」（L1） */
  doNotSend?: boolean;
}

export interface PreparedReasoning {
  status: "needs-confirmation";
  preview: ExternalAiPreview;
  /**
   * 送信内容（事故由来の部分とコード）から作る値。アービターが確認したプレビューと
   * 送る直前の内容が同じかを比べるために使う（端末のメモリ内だけ）
   */
  approvalKey: string;
  /** 意味検索に送る検索語の埋め込み。検索語が送れない場合は undefined（キーワード検索のみ） */
  queryEmbedding?: () => Promise<number[]>;
  /** 送る形の条文（大会 ID なし。大会規定は置き換え後で、資料名は「大会規定」） */
  toSentArticles(articles: readonly CandidateArticle[]): LlmArticle[];
  send(articles: readonly LlmArticle[]): Promise<LlmApiResponse>;
  /** 応答のプレースホルダーを元の表記へ戻す（このリクエストの対応表） */
  reidentify(text: string): ReidentifyResult;
}

const PLAYER_COLOR_LABELS = { white: "白", black: "黒" } as const;

/**
 * AI 参考情報の送信準備。記述は reason-description、意味検索の検索語は embed-query として
 * 同じ対応表で A〜E を通す。記述が止まれば送らない。検索語だけ止まればキーワード検索のみ
 */
export async function prepareReasoning(
  input: ReasoningInput,
  deps: ExternalAiGuardDeps = {}
): Promise<NotSent | PreparedReasoning> {
  const ids = await identifiersOrNull(deps);
  if (!ids) return IDENTIFIERS_UNAVAILABLE;
  const map = new PlaceholderMap();
  const common = {
    category: input.incident.category,
    doNotSend: input.doNotSend,
    identifiers: ids,
    map,
  };
  const description = protectIncidentText({
    ...common,
    route: "reason-description",
    text: input.incident.description,
  });
  if (!description.ok) return notSent(description);
  const query = protectIncidentText({
    ...common,
    route: "embed-query",
    text: input.incident.description,
  });
  const queryText = query.ok ? query.text : undefined;

  const incident: LlmIncidentSummary = {
    category: input.incident.category,
    subtype: input.incident.subtype,
    playerColor: input.incident.playerColor,
    description: description.text,
    arbiterObserved: input.incident.arbiterObserved,
  };
  const context: LlmReasoningContext = {
    competitionType: input.context.competitionType,
    supervisionRegime: input.context.supervisionRegime,
    rulesVersion: input.context.rulesVersion,
  };

  const codes = [
    `カテゴリ: ${incident.category}`,
    incident.subtype ? `種別: ${incident.subtype}` : null,
    incident.playerColor
      ? `対象: ${PLAYER_COLOR_LABELS[incident.playerColor]}`
      : null,
    `アービターの目撃: ${incident.arbiterObserved ? "あり" : "なし"}`,
    `競技: ${context.competitionType}`,
    context.supervisionRegime ? `監督: ${context.supervisionRegime}` : null,
    `規則: ${context.rulesVersion}`,
  ].filter((v): v is string => v !== null);

  const fields = [
    {
      label: "送る記述（名前・日時などは置き換え済み）",
      text: incident.description,
    },
  ];
  const notes: string[] = [];
  if (queryText === undefined) {
    notes.push(
      "意味検索の検索語は送りません（キーワード検索のみで条文を探します）。"
    );
  } else if (incident.description.startsWith(queryText)) {
    notes.push(
      `記述の先頭${queryText.length}文字を、条文を探す意味検索の検索語として送ります。`
    );
  } else {
    fields.push({ label: "送る検索語（意味検索）", text: queryText });
  }
  fields.push({ label: "送るコード", text: codes.join(" / ") });
  notes.push(
    `端末に登録済みの規則から関連する条文を最大${LLM_LIMITS.maxArticles}件添えます。FIDE・JCFは原文のまま送ります。大会規定は、登録済みの名前・連絡先・会員番号・敬称付きの名前を置き換えて送りますが、本文はこの画面に表示されません（規定に登録されていない名前を書かないでください）。大会名・大会IDは送りません。`
  );

  const call = callOf(deps);
  return {
    status: "needs-confirmation",
    preview: { destination: `AI参考情報（${GEMINI}）`, fields, notes },
    approvalKey: JSON.stringify({
      incident,
      context,
      query: queryText ?? null,
    }),
    queryEmbedding:
      queryText === undefined
        ? undefined
        : () => generateQueryEmbedding(queryText, { ...deps, call }),
    toSentArticles: (articles) =>
      articles.map((a) => toSentArticle(a, ids, map)),
    send: (articles) => {
      const body: LlmReasoningRequest = {
        incident,
        context,
        articles: articles.map((a) => ({ ...a })),
      };
      return call("reason", body, deps);
    },
    reidentify: (text) => reidentify(text, map),
  };
}

/**
 * 送る形の条文（§5.3）。大会 ID は含めない。大会規定の本文・題名は狭い規則で置き換え、
 * 資料名は「大会規定」に固定し、版は送らない。FIDE・JCF・解説はそのまま
 */
function toSentArticle(
  a: CandidateArticle,
  ids: KnownIdentifiers,
  map: PlaceholderMap
): LlmArticle {
  const tournament = a.source === "tournament";
  const redact = (text: string) =>
    tournament ? redactPii(text, ids, map, "regulation").text : text;
  return {
    id: a.id,
    article: truncate(redact(a.article), LLM_LIMITS.maxArticleNumberChars),
    title: truncate(redact(a.title), LLM_LIMITS.maxArticleTitleChars),
    // 長い条文は先頭のみ送る（検証も送った本文で行うため、引用は送った範囲に限られる）
    // プレースホルダーを途中で切らない（minimization の truncate）
    content: truncate(redact(a.content), LLM_LIMITS.maxArticleContentChars),
    source: a.source,
    sourceName: tournament
      ? "大会規定"
      : a.sourceName?.slice(0, LLM_LIMITS.maxSourceNameChars),
    ...(tournament || a.sourceVersion === undefined
      ? {}
      : { sourceVersion: a.sourceVersion.slice(0, LLM_LIMITS.maxShortChars) }),
    page: a.page,
    priority: a.priority,
  };
}
