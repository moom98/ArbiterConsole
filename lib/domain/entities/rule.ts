/**
 * ルール情報源の種別（§5.1, §6）
 */
export type RuleSourceType = "FIDE" | "JCF" | "tournament" | "commentary";

export type RuleSourceStatus = "active" | "superseded" | "draft";

export type RuleLanguage = "ja" | "en";

/**
 * ルール資料（§29 情報源表示, §30 Source Version管理）
 *
 * 1つのPDF等の取り込み単位。各Ruleは sourceId でこれを参照する。
 */
export interface RuleSource {
  id: string;
  /** 資料名（例: "FIDE Laws of Chess"） */
  name: string;
  /** 取り込み元ファイル名 */
  fileName: string;
  sourceType: RuleSourceType;
  /** 版（例: "2023"） */
  version: string;
  publishedDate?: Date;
  effectiveDate?: Date;
  status: RuleSourceStatus;
  language: RuleLanguage;
  /** sourceType が 'tournament' の場合は必須 */
  tournamentId?: string;
  totalPages: number;
  importedAt: Date;
}

export interface Rule {
  id: string;
  source: RuleSourceType;
  /** RuleSource.id（v3以前に取り込まれたデータには存在しない） */
  sourceId?: string;
  tournamentId?: string;
  /** 条文番号（例: "7.5.4"） */
  article: string;
  title: string;
  content: string;
  /** 原文PDF上のページ番号（1始まり） */
  page?: number;
  priority: number;
  embeddingId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Embedding {
  id: string;
  ruleId: string;
  vector: number[];
  /** 生成に使用したモデルID。異なるモデルのembeddingは検索で使用しない */
  model: string;
  createdAt: Date;
}
