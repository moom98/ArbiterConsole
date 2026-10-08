import type { CompetitionType, IncidentCategory } from "@/lib/domain/entities";
import type { IncidentQuestionId } from "@/lib/domain/follow-up";

/**
 * Fact モデル（ADR-013, docs/design/fact-model.md）。
 * 裁定に必要な「観測事実」の定義。カタログの内容は docs/design/jev-missing-info-catalog.md が正本。
 *
 * - 質問は観測事実のみを尋ねる（「明確だったか」「故意か」等の判断は尋ねない）
 * - すべての回答に「わからない（unknown）」がある
 * - 必要かどうかは Decision Tree（DT のないカテゴリでは fact plan）が決める
 */

export type FactId = string;

/** blocking: 必須 / conditional: 条件を満たし、分岐が必要としたときのみ必須 / optional: 任意 */
export type FactLevel = "blocking" | "conditional" | "optional";

export interface FactOption {
  value: string;
  label: string;
}

/**
 * 回答の形式。どの形式でも「わからない」を選べる（FactAnswer の unknown）。
 * - yes-no: はい / いいえ。値は文字列 "true" / "false"（既存の follow-up 質問と同じ）
 * - choice: 選択肢（multiple は複数選択可）
 * - duration: 秒数（UI は m:ss で入力）
 * - count: 整数
 * - structured: 構造化データ（端末内のみ。例: 対局の手順、FEN、触れたマスの列）
 */
export type FactAnswerSpec =
  | { kind: "yes-no" }
  | {
      kind: "choice";
      options: readonly FactOption[];
      multiple?: boolean;
    }
  | { kind: "duration" }
  | { kind: "count"; min: number; max: number }
  | {
      kind: "structured";
      format: "game-history" | "fen" | "square-list" | "san";
    };

/**
 * 回答。unknown は「わからない・確認できない」。
 * value は yes-no では "true" / "false"、choice では選択肢の value（multiple は配列）、
 * duration では秒数、count では整数。
 */
export type FactAnswer =
  { unknown: true } | { value: string | number | readonly string[] };

export type FactAnswers = Readonly<Record<FactId, FactAnswer | undefined>>;

/** アプリの設定・記録から求める fact の取得元（求められた場合は質問しない） */
export type FactDerivation =
  | "tournament.timeControl"
  | "tournament.profile"
  | "incidentLog"
  | "game.history";

export interface SourceRef {
  /** requirement: 要件の節 / fide: FIDE Laws の条 / dt: 決定木の質問 / design: 設計書の節 */
  kind: "requirement" | "fide" | "dt" | "design";
  ref: string;
  note?: string;
}

/** 質問そのもの（共通 fact は定義が1つ） */
export interface FactDefinition {
  id: FactId;
  /** 観測事実の質問（固定文言） */
  question: string;
  answer: FactAnswerSpec;
  /** 端末内だけで使う fact。外部へは一切送らない（ADR-012, ADR-014） */
  localOnly: boolean;
  /** 報告文に明示されているかを Jev で判定してよいか（ADR-013） */
  presenceCheckable: boolean;
  /** 設定・記録から求める場合の取得元 */
  derivedFrom?: FactDerivation;
  sources: readonly SourceRef[];
}

/**
 * 適用条件（データ）。evaluateCondition で評価する。
 * 回答が unknown・未回答の場合、fact 条件は決して満たされない。
 */
export type FactCondition =
  | { fact: FactId; in: readonly string[] }
  /** 数値の回答（duration は秒）が範囲内か。gte 以上・lt 未満 */
  | { fact: FactId; range: { gte?: number; lt?: number } }
  | { context: "competitionType"; in: readonly CompetitionType[] }
  /** is: false は「false または未記録」に一致する */
  | { incident: "arbiterObserved"; is: boolean }
  /** その fact の値を設定・記録から求められなかった（質問で尋ねる必要がある） */
  | { notDerived: FactId }
  | { all: readonly FactCondition[] }
  | { any: readonly FactCondition[] };

/** カテゴリ（またはサブタイプ）ごとの fact の使い方。共通 fact は複数の usage を持つ */
export interface FactUsage {
  factId: FactId;
  category: IncidentCategory;
  /** 指定した場合、インシデントのサブタイプがいずれかのときだけ使う（例: ["touch-move"]） */
  subtypes?: readonly string[];
  level: FactLevel;
  appliesWhen?: FactCondition;
  /** DT のあるカテゴリで、この fact に対応する既存の質問 */
  dtQuestionIds?: readonly IncidentQuestionId[];
  /**
   * fact の値 → DT の質問の値。省略時は同じ値を使う。
   * "computed" は他の回答から計算して変換する（例: 最後に指した側と申立人から手番を求める）。
   */
  dtValues?: Readonly<Record<string, string>> | "computed";
  /**
   * 対応する DT では扱わない fact の値（別の DT へ振り分ける）。
   * 例: im.action の "touch-move" は DT-001〜003 ではなく DT-007 で扱う（ADR-014 §6）。
   */
  dtUnhandled?: readonly string[];
}

/** 条件の評価に使う文脈 */
export interface FactContext {
  competitionType?: CompetitionType;
  arbiterObserved?: boolean;
  /**
   * 設定・記録から求めた fact の値（質問しない）。
   * 条件の評価では回答より優先して使う。
   */
  derivedValues?: Readonly<Record<FactId, FactAnswer>>;
}
