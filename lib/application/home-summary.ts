import type { Round } from "@/lib/domain/entities";
import {
  sortByReportedAtDesc,
  type IncidentLogEntry,
} from "@/lib/domain/services/penalty-history";
import { currentRound } from "@/lib/domain/services/round-planning";
import { db as defaultDb, type ArbiterDatabase } from "@/lib/infrastructure/db";
import { loadIncidentLog } from "@/lib/infrastructure/db/incident-repository";

export interface HomeSummary {
  currentRound: Round | null;
  /** 今のラウンドのボード数 */
  currentRoundBoards: number;
  /** 選択中の大会の直近の Incident（新しい順） */
  recent: IncidentLogEntry[];
  /** CA確認を推奨した Incident の件数（選択中の大会） */
  escalatedCount: number;
}

/** ホーム画面の表示内容（選択中の大会のもののみ） */
export async function loadHomeSummary(
  tournamentId: string,
  rounds: readonly Round[],
  options: { db?: ArbiterDatabase; limit?: number } = {}
): Promise<HomeSummary> {
  const { db = defaultDb, limit = 5 } = options;
  const round = currentRound(rounds);
  const [log, boards] = await Promise.all([
    loadIncidentLog(db),
    round
      ? db.games
          .where("[tournamentId+round]")
          .equals([tournamentId, round.roundNumber])
          .count()
      : Promise.resolve(0),
  ]);
  const mine = log.filter((e) => e.game?.tournamentId === tournamentId);
  return {
    currentRound: round,
    currentRoundBoards: boards,
    recent: sortByReportedAtDesc(mine).slice(0, limit),
    escalatedCount: mine.filter((e) => e.incident.status === "escalated")
      .length,
  };
}
