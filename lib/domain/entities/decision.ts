import type { PlayerColor } from "./incident";

/**
 * - immediate: アービターが今すぐ介入する
 * - wait-for-claim: プレーヤーのクレームを待つ
 * - consult-ca: CAへ確認する / 判断不能
 * - no-intervention: 違法手等としての介入・訂正は行わない
 *   （例: 時計が押されておらず違法手が未成立 / 対局終了後で結果が確定している）
 */
export type InterventionType =
  "immediate" | "wait-for-claim" | "consult-ca" | "no-intervention";
export type ConfidenceLevel = "high" | "medium" | "low";
export type PenaltyType =
  | "warning"
  | "time-addition-opponent"
  | "time-deduction-player"
  | "game-loss"
  | "both-lose"
  | "expulsion"
  /** 対局結果をドローとする（例: FIDE 7.5.5 ただし書き） */
  | "draw";

export interface RuleCitation {
  /** 表示用の条文ID（例: "FIDE 7.5.5"） */
  article: string;
  /** 条文の逐語引用。原典で確認できない場合は省略する（推測で書かない） */
  text?: string;
  source: "FIDE" | "JCF" | "tournament" | "commentary";
  priority: number;
  /** 規則・資料の版（例: "FIDE Laws of Chess 2023"） */
  edition?: string;
  /** 印刷ページ番号（pageDocument のページ） */
  page?: number;
  /** page が指す資料（例: 条文は Laws 2023 だがページは Arbiters' Manual 2025） */
  pageDocument?: string;
}

export interface Penalty {
  type: PenaltyType;
  /** ペナルティ（またはその効果）の対象となるプレーヤー */
  playerColor: PlayerColor;
  timeAdjustmentSeconds?: number;
  description: string;
}

/** どの Decision Tree が判断を生成したか（履歴カウント等で使用） */
export type DecisionTreeId = "DT-001-illegal-move-standard";

/** 判断の種類 */
export type DecisionKind =
  /** 規則に基づく推奨が出力された */
  | "recommendation"
  /** 判断に必要な情報が不足している（追加質問が必要） */
  | "follow-up-required"
  /** 規則セット等のコンテキストが不足している */
  | "context-required"
  /** 現バージョンでは未対応（CAへ相談） */
  | "not-supported"
  /** 手動確認が必要 */
  | "manual-review";

export interface Decision {
  id: string;
  incidentId: string;
  kind?: DecisionKind;
  treeId?: DecisionTreeId;
  /** 判断に使用した規則セット（例: "FIDE-2023"） */
  rulesVersion?: string;
  conclusion: string;
  actions: string[];
  intervention: InterventionType;
  penalties: Penalty[];
  sources: RuleCitation[];
  confidence: ConfidenceLevel;
  escalationRecommended: boolean;
  escalationReason?: string;
  /** 不足している情報のラベル一覧（kind が follow-up-required / context-required の場合） */
  missingFields?: string[];
  generatedBy: "decision-tree" | "llm";
  validatedAt?: Date;
  validationPassed: boolean;
  validationErrors?: string[];
  createdAt: Date;
}
