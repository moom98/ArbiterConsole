import type {
  CompetitionType,
  DecisionKind,
  IncidentCategory,
  IncidentStatus,
  PenaltyType,
  PlayerColor,
} from "@/lib/domain/entities";

/** Incident Log / CSV で共通に使う表示ラベル */

export const CATEGORY_LABELS: Record<IncidentCategory, string> = {
  "illegal-move": "違法手",
  "clock-time": "時計/時間",
  draw: "ドロー",
  "board-piece": "盤面/駒",
  scoresheet: "記録用紙",
  "player-behavior": "プレイヤー行動",
  "game-result": "ゲーム結果",
  team: "団体戦",
  "fair-play": "フェアプレー",
  "tournament-admin": "大会運営",
};

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  resolved: "対応済",
  escalated: "CA相談",
  pending: "保留中",
};

export const STATUS_CLASSNAMES: Record<IncidentStatus, string> = {
  resolved: "bg-green-100 text-green-800",
  escalated: "bg-yellow-100 text-yellow-800",
  pending: "bg-gray-100 text-gray-800",
};

export const COLOR_LABELS: Record<PlayerColor, string> = {
  white: "白",
  black: "黒",
};

export const PENALTY_LABELS: Record<PenaltyType, string> = {
  warning: "警告",
  "time-addition-opponent": "相手に時間追加",
  "time-deduction-player": "違反者の時間減少",
  "game-loss": "負け",
  "both-lose": "両者負け",
  expulsion: "除外・退場",
  draw: "ドロー",
};

export const DECISION_KIND_LABELS: Record<DecisionKind, string> = {
  recommendation: "推奨",
  "follow-up-required": "追加質問待ち",
  "context-required": "コンテキスト不足",
  "not-supported": "未対応（CAへ相談）",
  "manual-review": "手動確認（CAへ相談）",
};

export const COMPETITION_TYPE_LABELS: Record<CompetitionType, string> = {
  standard: "Standard",
  rapid: "Rapid",
  blitz: "Blitz",
};

export const REPORTED_BY_LABELS = {
  arbiter: "アービター",
  "player-white": "白プレーヤー",
  "player-black": "黒プレーヤー",
} as const;

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as IncidentCategory] ?? category;
}

export function penaltyLabel(type: string): string {
  return PENALTY_LABELS[type as PenaltyType] ?? type;
}

/** "R3 / B12" 形式の対局ラベル */
export function gameLabel(game: {
  round?: number;
  boardNumber?: number;
}): string {
  const parts: string[] = [];
  if (game.round !== undefined) parts.push(`R${game.round}`);
  if (game.boardNumber !== undefined) parts.push(`B${game.boardNumber}`);
  return parts.length > 0 ? parts.join(" / ") : "対局不明";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ローカル時刻で "YYYY-MM-DD HH:mm:ss" */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** ローカル時刻で "YYYY-MM-DD" */
export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** ローカル時刻で "HH:mm" */
export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
