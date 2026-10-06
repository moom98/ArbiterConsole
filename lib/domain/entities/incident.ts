export type IncidentCategory =
  | "illegal-move"
  | "board-piece"
  | "clock-time"
  | "game-result"
  | "draw"
  | "scoresheet"
  | "player-behavior"
  | "team"
  | "fair-play"
  | "tournament-admin";

export type IncidentStatus = "pending" | "resolved" | "escalated";

export type PlayerColor = "white" | "black";

/**
 * 違法手の種類（FIDE Laws of Chess 2023 Article 7.5）
 * - illegal-move:            7.5.1 通常の違法手（キングをチェックに晒す、違法キャスリング等を含む）
 * - promotion-not-replaced:  7.5.2 ポーンを最終段に進めたが新しい駒に置き換えずに時計を押した
 * - clock-without-move:      7.5.3 手を指さずに時計を押した
 * - two-hands:               7.5.4 1つの手を両手で指して時計を押した
 */
export type IllegalMoveSubtype =
  | "illegal-move"
  | "promotion-not-replaced"
  | "clock-without-move"
  | "two-hands";

/**
 * 違法手の判断に必要な構造化された事実（追加質問への回答）。
 * 自由記述からは決定しない。
 */
export interface IllegalMoveFacts {
  subtype: IllegalMoveSubtype;
  /** 違反したプレーヤーが時計を押したか */
  clockPressed: boolean;
  /** 対局がすでに終了しているか（署名済み・結果確定など） */
  gameEnded: boolean;
  /**
   * 相手（違反していない側）が、あらゆる合法手の連続によって
   * 違反者のキングをチェックメイトできる局面か（7.5.5 ただし書き）
   */
  opponentCanCheckmate: boolean | "unknown";
}

export interface Incident {
  id: string;
  gameId: string;
  category: IncidentCategory;
  subtype?: string;
  /** 対象（違反した）プレーヤー */
  playerColor?: PlayerColor;
  /** 違法手カテゴリの構造化された回答 */
  illegalMoveFacts?: Partial<IllegalMoveFacts>;
  /** 自由記述（メモ）。判断には使用しない */
  description: string;
  arbiterObserved: boolean;
  reportedBy: "arbiter" | "player-white" | "player-black";
  reportedAt: Date;
  status: IncidentStatus;
  decisionId?: string;
  escalatedToCA: boolean;
  escalationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
