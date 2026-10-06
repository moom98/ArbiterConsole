import type {
  Decision,
  Game,
  IncidentCategory,
  Penalty,
  PlayerColor,
  Tournament,
} from "@/lib/domain/entities";
import {
  IncidentCounter,
  type IncidentRecord,
  type PriorIllegalMove,
} from "./incident-counter";

/**
 * Incident Log / Penalty 履歴（要件 §24, §25 / 実装計画 §3.1, §3.3）
 *
 * Incident Log 画面の絞り込み・集計・Penalty 履歴を計算する純粋関数群。
 * UI コンポーネントはこれらの結果を表示するだけにする。
 */

/** 対局・大会情報を伴う Incident 記録 */
export interface IncidentLogEntry extends IncidentRecord {
  game?: Game;
  tournament?: Tournament;
}

export const FILTER_ALL = "all" as const;
export type FilterAll = typeof FILTER_ALL;

export interface IncidentLogFilter {
  gameId: string | FilterAll;
  playerColor: PlayerColor | FilterAll;
  category: IncidentCategory | FilterAll;
}

export const EMPTY_FILTER: IncidentLogFilter = {
  gameId: FILTER_ALL,
  playerColor: FILTER_ALL,
  category: FILTER_ALL,
};

/** Incident に紐づく Decision（incidentId が一致するもののみ） */
export function decisionOf(record: IncidentRecord): Decision | undefined {
  const { incident, decision } = record;
  if (!decision || decision.incidentId !== incident.id) return undefined;
  return decision;
}

export function filterIncidentRecords<T extends IncidentRecord>(
  records: readonly T[],
  filter: IncidentLogFilter
): T[] {
  return records.filter(({ incident }) => {
    if (filter.gameId !== FILTER_ALL && incident.gameId !== filter.gameId)
      return false;
    if (
      filter.playerColor !== FILTER_ALL &&
      incident.playerColor !== filter.playerColor
    )
      return false;
    if (filter.category !== FILTER_ALL && incident.category !== filter.category)
      return false;
    return true;
  });
}

/** 新しい順（報告日時の降順） */
export function sortByReportedAtDesc<T extends IncidentRecord>(
  records: readonly T[]
): T[] {
  return [...records].sort(
    (a, b) => b.incident.reportedAt.getTime() - a.incident.reportedAt.getTime()
  );
}

export interface PenaltySummary {
  incidents: number;
  /** 推奨されたペナルティ・結果の総数 */
  penalties: number;
  warnings: number;
  timeAdjustments: number;
  gameLosses: number;
  draws: number;
  expulsions: number;
  /** CA への確認が推奨された / CA へ相談した Incident 数 */
  escalations: number;
}

/**
 * 推奨されたペナルティを種別ごとに集計する。
 * 渡された記録（＝現在のフィルタ結果）だけを対象にする。
 */
export function summarizePenalties(
  records: readonly IncidentRecord[]
): PenaltySummary {
  const summary: PenaltySummary = {
    incidents: records.length,
    penalties: 0,
    warnings: 0,
    timeAdjustments: 0,
    gameLosses: 0,
    draws: 0,
    expulsions: 0,
    escalations: 0,
  };
  for (const record of records) {
    const decision = decisionOf(record);
    if (
      record.incident.escalatedToCA ||
      record.incident.status === "escalated" ||
      decision?.escalationRecommended
    ) {
      summary.escalations++;
    }
    if (!decision) continue;
    for (const penalty of decision.penalties) {
      summary.penalties++;
      switch (penalty.type) {
        case "warning":
          summary.warnings++;
          break;
        case "time-addition-opponent":
        case "time-deduction-player":
          summary.timeAdjustments++;
          break;
        case "game-loss":
        case "both-lose":
          summary.gameLosses++;
          break;
        case "draw":
          summary.draws++;
          break;
        case "expulsion":
          summary.expulsions++;
          break;
      }
    }
  }
  return summary;
}

export interface GameOption {
  gameId: string;
  round?: number;
  boardNumber?: number;
  /** 対局の開始日（暫定対局では報告日） */
  date?: Date;
  competitionType?: Tournament["competitionType"];
  incidentCount: number;
}

/** 記録に現れる対局の一覧（新しい対局順 → ラウンド → ボード） */
export function listGames(entries: readonly IncidentLogEntry[]): GameOption[] {
  const byId = new Map<string, GameOption>();
  for (const { incident, game, tournament } of entries) {
    const existing = byId.get(incident.gameId);
    if (existing) {
      existing.incidentCount++;
      continue;
    }
    byId.set(incident.gameId, {
      gameId: incident.gameId,
      round: game?.round,
      boardNumber: game?.boardNumber,
      date: game?.startTime ?? incident.reportedAt,
      competitionType: tournament?.competitionType,
      incidentCount: 1,
    });
  }
  const dayKey = (d?: Date) =>
    d ? d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() : 0;
  return Array.from(byId.values()).sort((a, b) => {
    const dayDiff = dayKey(b.date) - dayKey(a.date);
    if (dayDiff !== 0) return dayDiff;
    const roundDiff = (a.round ?? 0) - (b.round ?? 0);
    if (roundDiff !== 0) return roundDiff;
    return (a.boardNumber ?? 0) - (b.boardNumber ?? 0);
  });
}

export interface PenaltyHistoryItem {
  incidentId: string;
  reportedAt: Date;
  penalty: Penalty;
}

export interface PlayerPenaltyHistory {
  color: PlayerColor;
  /** IncidentCounter による違法手回数（ペナルティが適用されたもののみ） */
  illegalMoveCount: number;
  illegalMoves: PriorIllegalMove[];
  /** この対局で、このプレーヤーの違反に対して推奨されたペナルティ（時刻順） */
  penalties: PenaltyHistoryItem[];
}

/**
 * 対局内の Penalty 履歴をプレーヤー（違反者）ごとに返す（要件 §25）。
 *
 * ペナルティは違反者（Incident.playerColor）に帰属させる。
 * 例えば「相手に2分追加」は Penalty.playerColor が相手でも、違反者の履歴に入る。
 */
export function penaltyHistoryForGame(
  records: readonly IncidentRecord[],
  gameId: string
): Record<PlayerColor, PlayerPenaltyHistory> {
  const illegal = IncidentCounter.illegalMoveHistory(records, gameId);
  const build = (color: PlayerColor): PlayerPenaltyHistory => {
    const penalties: PenaltyHistoryItem[] = [];
    for (const record of records) {
      const { incident } = record;
      if (incident.gameId !== gameId) continue;
      const decision = decisionOf(record);
      if (!decision) continue;
      for (const penalty of decision.penalties) {
        const offender = incident.playerColor ?? penalty.playerColor;
        if (offender !== color) continue;
        penalties.push({
          incidentId: incident.id,
          reportedAt: incident.reportedAt,
          penalty,
        });
      }
    }
    penalties.sort((a, b) => a.reportedAt.getTime() - b.reportedAt.getTime());
    return {
      color,
      illegalMoveCount: illegal[color].length,
      illegalMoves: illegal[color],
      penalties,
    };
  };
  return { white: build("white"), black: build("black") };
}
