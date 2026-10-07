import type { IncidentLogEntry } from "@/lib/domain/services/penalty-history";
import { decisionOf } from "@/lib/domain/services/penalty-history";
import {
  COLOR_LABELS,
  COMPETITION_TYPE_LABELS,
  DECISION_KIND_LABELS,
  REPORTED_BY_LABELS,
  STATUS_LABELS,
  categoryLabel,
  formatDate,
  formatDateTime,
  penaltyLabel,
} from "./incident-labels";

/** Excel が UTF-8 と認識するための BOM */
export const UTF8_BOM = "﻿";

/**
 * 数式として解釈されうる先頭文字（= + @ タブ CR、数値や単独の "-" 以外の "-"）
 */
const FORMULA_PREFIX = /^(?:[=+@\t\r]|-(?!$|\d+(?:\.\d+)?$))/;

/**
 * 1セルを RFC 4180 に従ってエスケープする。
 * ダブルクォートは "" に二重化し、セル全体を "..." で囲む。
 * 表計算ソフトで数式として解釈されうる先頭文字には ' を前置する。
 */
export function escapeCsvCell(value: string | number | boolean): string {
  let s = String(value);
  if (FORMULA_PREFIX.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** 行の配列を CSV 文字列にする（行区切りは CRLF、BOM なし） */
export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean>>
): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

export const INCIDENT_CSV_HEADERS = [
  "報告日時",
  "対局日",
  "競技区分",
  "規則バージョン",
  "ラウンド",
  "ボード",
  "対象プレーヤー",
  "カテゴリ",
  "種類",
  "ステータス",
  "アービター直接観察",
  "報告者",
  "判断種別",
  "生成元",
  "推奨（判断支援）",
  "推奨ペナルティ",
  "時間調整（秒）",
  "根拠条文",
  "CAへ相談",
  "メモ",
] as const;

function incidentRow(entry: IncidentLogEntry): string[] {
  const { incident, game, tournament } = entry;
  const decision = decisionOf(entry);
  const penalties = decision?.penalties ?? [];
  const subtype = incident.illegalMoveFacts?.subtype ?? incident.subtype ?? "";
  const escalated =
    incident.escalatedToCA ||
    incident.status === "escalated" ||
    decision?.escalationRecommended === true;
  return [
    formatDateTime(incident.reportedAt),
    game ? formatDate(game.startTime) : "",
    tournament ? COMPETITION_TYPE_LABELS[tournament.competitionType] : "",
    decision?.rulesVersion ?? tournament?.rulesVersion ?? "",
    game?.round !== undefined ? String(game.round) : "",
    game?.boardNumber !== undefined ? String(game.boardNumber) : "",
    incident.playerColor ? COLOR_LABELS[incident.playerColor] : "",
    categoryLabel(incident.category),
    subtype,
    STATUS_LABELS[incident.status] ?? incident.status,
    incident.arbiterObserved ? "はい" : "いいえ",
    REPORTED_BY_LABELS[incident.reportedBy] ?? incident.reportedBy,
    decision?.kind ? DECISION_KIND_LABELS[decision.kind] : "",
    decision
      ? decision.generatedBy === "llm"
        ? "AI参考（未確定）"
        : "Decision Tree"
      : "",
    decision?.conclusion ?? "",
    penalties
      .map((p) => `${penaltyLabel(p.type)}: ${p.description}`)
      .join("; "),
    penalties
      .filter((p) => p.timeAdjustmentSeconds !== undefined)
      .map(
        (p) =>
          `${p.playerColor ? COLOR_LABELS[p.playerColor] : ""} ${p.timeAdjustmentSeconds}`
      )
      .join("; "),
    (decision?.sources ?? [])
      .map((s) => (s.edition ? `${s.article} (${s.edition})` : s.article))
      .join("; "),
    escalated ? "はい" : "いいえ",
    incident.description,
  ];
}

/** Incident Log の CSV（UTF-8 BOM 付き） */
export function buildIncidentCsv(entries: readonly IncidentLogEntry[]): string {
  return (
    UTF8_BOM + toCsv([[...INCIDENT_CSV_HEADERS], ...entries.map(incidentRow)])
  );
}

export function incidentCsvFilename(now: Date): string {
  return `incidents_${formatDate(now)}.csv`;
}
