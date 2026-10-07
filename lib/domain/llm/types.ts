import type {
  CompetitionType,
  IncidentCategory,
  InterventionType,
  PenaltyType,
  PlayerColor,
  RuleSourceType,
  SupervisionRegime,
} from "@/lib/domain/entities";

/**
 * LLM 連携の契約（ADR-006）。
 * ドメインはこの型のみを知り、SDK・HTTP・IndexedDB には依存しない。
 */

/** LLM に提示する候補条文（クライアントの IndexedDB から取得したもの） */
export interface LlmArticle {
  /** Rule.id。LLM はこの ID で引用する */
  id: string;
  /** 条文番号（例: "11.3.1"） */
  article: string;
  title: string;
  /** 条文本文（引用の照合に使う） */
  content: string;
  source: RuleSourceType;
  /** RuleSource.name（例: "FIDE Laws of Chess"） */
  sourceName?: string;
  /** RuleSource.version（例: "2023"） */
  sourceVersion?: string;
  page?: number;
  priority: number;
  tournamentId?: string;
}

/** 推論に渡す構造化コンテキスト（規則セットは明示的な入力: domain.md rule 5） */
export interface LlmReasoningContext {
  competitionType: CompetitionType;
  supervisionRegime?: SupervisionRegime;
  rulesVersion: string;
  tournamentId?: string;
}

export interface LlmIncidentSummary {
  category: IncidentCategory;
  subtype?: string;
  playerColor?: PlayerColor;
  description: string;
  arbiterObserved: boolean;
}

/** /api/llm/reason へのリクエスト本文 */
export interface LlmReasoningRequest {
  incident: LlmIncidentSummary;
  context: LlmReasoningContext;
  articles: LlmArticle[];
}

/** LLM に許可する介入種別（決定木専用の wait-next-move は除く） */
export const LLM_INTERVENTIONS = [
  "immediate",
  "wait-for-claim",
  "consult-ca",
  "no-intervention",
] as const satisfies readonly InterventionType[];

export const LLM_PENALTY_TYPES = [
  "warning",
  "time-addition-opponent",
  "time-deduction-player",
  "game-loss",
  "both-lose",
  "expulsion",
  "draw",
] as const satisfies readonly PenaltyType[];

/** LLM が返してよい信頼度（"high" は返させない。返された場合も medium に制限する） */
export const LLM_CONFIDENCES = ["medium", "low"] as const;

/** LLM の構造化出力（検証前の下書き） */
export interface LlmDecisionDraft {
  conclusion: string;
  actions: string[];
  intervention: (typeof LLM_INTERVENTIONS)[number];
  penalties: LlmPenaltyDraft[];
  citations: LlmCitationDraft[];
  confidence: "medium" | "low";
  escalationRecommended: boolean;
  escalationReason?: string;
  /** 裁定に不足している情報 */
  missingInformation: string[];
}

export interface LlmPenaltyDraft {
  type: PenaltyType;
  playerColor?: PlayerColor;
  timeAdjustmentSeconds?: number;
  description: string;
  /** 根拠となる条文の ID（citations[].articleId のいずれか） */
  sourceArticleIds: string[];
}

export interface LlmCitationDraft {
  articleId: string;
  /** 条文本文からの逐語引用 */
  quote: string;
  /** この条文が適用される理由 */
  relevance: string;
}

// ---------------------------------------------------------------------------
// 分類（§11）
// ---------------------------------------------------------------------------

/** /api/llm/classify へのリクエスト本文 */
export interface LlmClassificationRequest {
  text: string;
}

/**
 * 自由記述の分類結果。**提案（プレフィル）のみ**に使い、判断には使用しない。
 * 決定木の対象となる事象は、決定木の質問と判断が優先される（ADR-002）。
 */
export interface IncidentClassification {
  category: IncidentCategory;
  /** 既知の subtype の場合のみ（isKnownSubtype） */
  subtype?: string;
  playerColor?: PlayerColor;
  /** 裁定に不足している情報 */
  missingInformation: string[];
  /** 確認すべき質問（表示のみ。回答は決定木の質問で行う） */
  followUpQuestions: string[];
  /** 大会固有規則の確認が必要か（§11） */
  needsTournamentRules: boolean;
  confidence: "medium" | "low";
  /** llm: Gemini による分類 / keyword: 端末内のキーワード分類 */
  method: "llm" | "keyword";
}
