import type { PlayerColor } from "./incident";

/**
 * - immediate: アービターが今すぐ介入する
 * - wait-for-claim: プレーヤーのクレームを待つ
 * - consult-ca: CAへ確認する / 判断不能
 * - wait-next-move: 次の手の完了を待ってから判断する（例: A.5.4 の不正な局面）
 * - no-intervention: 違法手等としての介入・訂正は行わない
 *   （例: 時計が押されておらず違法手が未成立 / 対局終了後で結果が確定している）
 */
export type InterventionType =
  | "immediate"
  | "wait-for-claim"
  | "wait-next-move"
  | "consult-ca"
  | "no-intervention";
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
  /** 登録規則（IndexedDB の Rule.id）から引用した場合の ID（AI参考情報の引用） */
  ruleId?: string;
  /**
   * AI の引用を含む原文の文全体（引用部分を強調表示するため before / match / after に分割）。
   * 引用の切り出しで意味が変わっていないかを、アービターが文全体で確認できるようにする。
   */
  quoteContext?: { before: string; match: string; after: string };
}

export interface Penalty {
  type: PenaltyType;
  /**
   * ペナルティ（またはその効果）の対象となるプレーヤー。
   * 対局結果（type: "draw" など特定のプレーヤーに作用しない結果）では省略する。
   */
  playerColor?: PlayerColor;
  timeAdjustmentSeconds?: number;
  description: string;
}

/** どの Decision Tree が判断を生成したか（履歴カウント等で使用） */
export type DecisionTreeId =
  | "DT-001-illegal-move-standard"
  /** Rapid / Blitz の違法手（Competition Rules: A.4 / B.2） */
  | "DT-002-illegal-move-fast-competition"
  /** Rapid / Blitz の違法手（それ以外: A.5 / B.3） */
  | "DT-003-illegal-move-fast-basic"
  | "DT-004-flag-fall"
  /**
   * Draw Claim: 三回同一局面（9.2）・50手（9.3）のクレーム（ADR-014 §1）。
   * ID は保存済みの判断との互換のため変えない。J1b-5 より前は 9.6.1 / 9.6.2 も含んでいた
   */
  | "DT-005-repetition"
  /** Automatic Draw: 五回同一局面（9.6.1）・75手（9.6.2） */
  | "DT-006-automatic-draw"
  /** Touch Move: 触れた駒の規則（Article 4。ADR-014 §6） */
  | "DT-007-touch-move";

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

/**
 * LLM（AI参考情報）の取得・検証状態（ADR-007）。
 * - passed:      LLM の出力が検証を通過した（AI参考として表示）
 * - rejected:    LLM の出力が検証に失敗した（CAへ確認）
 * - offline:     オフラインのため LLM を呼び出さなかった
 * - unavailable: LLM の呼び出しに失敗した（サーバー未設定・タイムアウト等）
 * - no-articles: 関連する登録規則が見つからなかった（LLM を呼び出さない）
 * - awaiting-confirmation: 外部AIへ送る内容をアービターが確認していない（まだ送っていない。D13）
 * - not-sent:    Sensitive Gate・残存チェックにより外部AIへ送らなかった（ADR-012）
 */
export type LlmAssistStatus =
  | "passed"
  | "rejected"
  | "offline"
  | "unavailable"
  | "no-articles"
  | "awaiting-confirmation"
  | "not-sent";

export interface LlmDecisionMeta {
  status: LlmAssistStatus;
  /** 使用したモデル ID（サーバーが返したもの） */
  model?: string;
  /** LLM に提示した候補条文（Rule.id） */
  candidateArticleIds?: string[];
  /** 失敗時の理由（利用者向けの短い説明） */
  message?: string;
  /** 失敗時のエラーコード（例: "unauthorized" はアクセストークンの入力が必要） */
  errorCode?: string;
  /** not-sent の理由（Sensitive Gate の理由コード。本文は含めない） */
  gateReasons?: string[];
  /**
   * AI の出力に、このリクエストの対応表にないプレースホルダー（〈選手C〉など）があった。
   * そのまま表示し、要確認とする（external-ai-data-protection.md §6.2）
   */
  needsReview?: boolean;
}

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
  /**
   * 「わからない」と回答され、確認されないまま判断に使われた事実（質問のラベル）。
   * どの値でも同じ判断になった場合、または判断を確定できなかった場合に設定する（fact-model §3.3）。
   */
  unconfirmedFacts?: string[];
  /**
   * DT-007 のみ: 触れた駒の規則（4.3 / 4.4）に従わずに別の駒を動かした（違反の記録）。
   * タッチムーブの回数として、7.5 の違法手とは別に数える（ADR-014 §6）。ペナルティではない。
   */
  touchMoveViolation?: boolean;
  generatedBy: "decision-tree" | "llm";
  /** 決定木の対象外で AI 参考情報を試みた場合の状態（ADR-007） */
  llm?: LlmDecisionMeta;
  /** 再評価で置き換えられた場合、置き換えた Decision の ID（監査用に残す） */
  supersededBy?: string;
  validatedAt?: Date;
  validationPassed: boolean;
  validationErrors?: string[];
  createdAt: Date;
}
