import type {
  Game,
  Round,
  RoundStatus,
  Tournament,
} from "@/lib/domain/entities";

/**
 * ラウンド・ボードの作成と状態遷移（純粋関数）。
 *
 * ID は決定的（大会 × ラウンド × ボード）にする。同じボードを再作成しても重複せず、
 * 日付をまたぐ対局でも違法手回数の履歴が分割されない（ADR-004 の follow-up を解消）。
 */

/** 1ラウンドあたりのボード数の上限（入力ミスによる大量作成の防止） */
export const MAX_BOARDS_PER_ROUND = 500;

export function tournamentRoundId(tournamentId: string, roundNumber: number) {
  return `${tournamentId}:r${roundNumber}`;
}

export function tournamentGameId(
  tournamentId: string,
  roundNumber: number,
  boardNumber: number
) {
  return `${tournamentRoundId(tournamentId, roundNumber)}:b${boardNumber}`;
}

function isPositiveInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1;
}

export interface BoardRange {
  from: number;
  to: number;
}

/** "1-40" / "1–40" / "12" を解釈する。不正なら null */
export function parseBoardRange(text: string): BoardRange | null {
  const m = /^\s*(\d+)\s*(?:[-–〜~]\s*(\d+))?\s*$/.exec(text);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] !== undefined ? Number(m[2]) : from;
  return validateBoardRange({ from, to }).length === 0 ? { from, to } : null;
}

export function validateBoardRange(range: Partial<BoardRange>): string[] {
  const errors: string[] = [];
  if (!isPositiveInteger(range.from) || !isPositiveInteger(range.to)) {
    errors.push("ボード番号は1以上の整数で入力してください");
    return errors;
  }
  if (range.to < range.from)
    errors.push("終了ボードは開始ボード以上にしてください");
  else if (range.to - range.from + 1 > MAX_BOARDS_PER_ROUND)
    errors.push(`一度に作成できるボードは${MAX_BOARDS_PER_ROUND}までです`);
  return errors;
}

export interface RoundPlan {
  round: Round;
  games: Game[];
}

/**
 * 「Round N, boards a–b」を作成する計画。既存のラウンドがあればそれを使う
 * （状態は変更しない）。対局のプレーヤー名は空（後から登録できる）。
 */
export function planRoundWithBoards(params: {
  tournament: Pick<Tournament, "id">;
  roundNumber: number;
  boards: BoardRange;
  existingRound?: Round | null;
  now: Date;
}): RoundPlan {
  const { tournament, roundNumber, boards, existingRound, now } = params;
  if (!isPositiveInteger(roundNumber))
    throw new Error("ラウンドは1以上の整数で入力してください");
  const errors = validateBoardRange(boards);
  if (errors.length > 0) throw new Error(errors.join(" / "));

  const round: Round = existingRound ?? {
    id: tournamentRoundId(tournament.id, roundNumber),
    tournamentId: tournament.id,
    roundNumber,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  const games: Game[] = [];
  for (let b = boards.from; b <= boards.to; b++) {
    games.push({
      id: tournamentGameId(tournament.id, roundNumber, b),
      tournamentId: tournament.id,
      roundId: round.id,
      round: roundNumber,
      boardNumber: b,
      white: { name: "" },
      black: { name: "" },
      startTime: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { round, games };
}

const NEXT_STATUS: Record<RoundStatus, RoundStatus | null> = {
  pending: "active",
  active: "completed",
  completed: null,
};

export function nextRoundStatus(status: RoundStatus): RoundStatus | null {
  return NEXT_STATUS[status];
}

/** pending → active → completed のみ許可する */
export function transitionRound(
  round: Round,
  to: RoundStatus,
  now: Date
): Round {
  if (NEXT_STATUS[round.status] !== to)
    throw new Error(
      `ラウンドの状態を ${round.status} から ${to} に変更できません`
    );
  return {
    ...round,
    status: to,
    ...(to === "active" ? { actualStartTime: now } : {}),
    ...(to === "completed" ? { endTime: now } : {}),
    updatedAt: now,
  };
}

/**
 * 「今のラウンド」: 対局中（active）のうち番号が最大のもの。なければ未開始の最小、
 * それもなければ最後のラウンド。
 */
export function currentRound(rounds: readonly Round[]): Round | null {
  const sorted = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  const active = sorted.filter((r) => r.status === "active");
  if (active.length > 0) return active[active.length - 1];
  const pending = sorted.find((r) => r.status === "pending");
  if (pending) return pending;
  return sorted[sorted.length - 1] ?? null;
}

export const ROUND_STATUS_LABEL: Record<RoundStatus, string> = {
  pending: "開始前",
  active: "対局中",
  completed: "終了",
};
