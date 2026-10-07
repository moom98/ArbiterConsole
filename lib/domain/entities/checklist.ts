import type { RuleCitation } from "./decision";

/**
 * Round Checklist（要件 §26 / Milestone 7）。
 *
 * 要件 §26 の4フェーズ（ラウンド開始前・開始直後・対局中・終了時）を項目のフェーズとし、
 * 画面ではラウンドの状態に対応する「段階（stage）」ごとにまとめて表示する:
 * - pending   → pre（開始前）
 * - active    → during（開始直後 + 対局中）
 * - completed → post（終了時）
 */
export type ChecklistPhase = "pre" | "start" | "during" | "post";

/** 画面上の段階（ラウンドの状態に対応） */
export type ChecklistStage = "pre" | "during" | "post";

/** チェックリスト項目の定義（既定テンプレートの項目、または大会ごとの追加項目） */
export interface ChecklistItemDefinition {
  /** 既定項目は固定 ID（例: "pre-clock-setting"）、追加項目は生成 ID */
  id: string;
  phase: ChecklistPhase;
  label: string;
  /** 補足（例: 大会のタイムコントロール） */
  detail?: string;
  /**
   * 根拠（docs/reference/rules の PDF から逐語引用したもののみ）。
   * 原典で確認できない項目・大会ごとの追加項目には付けない。
   */
  citations?: RuleCitation[];
  /** 大会ごとに追加した項目 */
  custom?: boolean;
}

/**
 * 大会ごとのチェックリスト構成（並び順・削除・追加）。
 * 既定項目は ID のみを保存し、文言と根拠は常にコード上のテンプレートから引く
 * （テンプレートの更新が既存の大会にも反映され、引用が DB に複製されない）。
 */
export type ChecklistTemplateEntry =
  | { kind: "builtin"; id: string }
  | { kind: "custom"; id: string; phase: ChecklistPhase; label: string };

export interface TournamentChecklistTemplate {
  tournamentId: string;
  /** 表示順 */
  entries: ChecklistTemplateEntry[];
  updatedAt: Date;
}

/** ラウンドごとの項目の完了状態 */
export interface ChecklistItemState {
  itemId: string;
  done: boolean;
  doneAt?: Date;
  note?: string;
}

/** ラウンドのチェックリスト完了状態（Round.id に紐づける。id = roundId） */
export interface RoundChecklist {
  /** = roundId */
  id: string;
  roundId: string;
  tournamentId: string;
  items: ChecklistItemState[];
  updatedAt: Date;
}
