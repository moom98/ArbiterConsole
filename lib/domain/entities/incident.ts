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
  /**
   * Rapid / Blitz（A.5 / B.3）のみ: 違反者の相手がすでに次の手を指したか（A.5.2）
   */
  opponentMadeNextMove?: boolean;
  /** Rapid / Blitz（A.5 / B.3）のみ: 違法手を誰が指摘したか（A.5.2） */
  detectedBy?: IllegalMoveDetection;
}

/**
 * A.5.2 における違法手の発見経路
 * - arbiter:        アービターが観察した
 * - opponent-claim: 相手がクレームした
 * - other:          それ以外（観戦者からの報告など）
 */
export type IllegalMoveDetection = "arbiter" | "opponent-claim" | "other";

// ---------------------------------------------------------------------------
// 時計・時間（clock-time）
// ---------------------------------------------------------------------------

/** clock-time カテゴリのうち Decision Tree で扱う subtype（incident-classification.md §6） */
export type ClockTimeSubtype = "flag-fall" | "other";

/** フラッグが落ちた側。"both" は両方の時計が 0.00 を示している */
export type FlagFallen = PlayerColor | "both";

/** 両フラッグが落ちている場合、どちらが先に落ちたか */
export type BothFlagsOrder = "white-first" | "black-first" | "unknown";

/**
 * 一方のプレーヤーの盤上の駒数（キングを除く）。
 * ビショップはマスの色で区別する（同色ビショップのみではメイトできない場合がある）。
 */
export interface SideMaterial {
  queens: number;
  rooks: number;
  knights: number;
  /** 白マスのビショップ */
  lightBishops: number;
  /** 黒マスのビショップ */
  darkBishops: number;
  pawns: number;
}

export interface BoardMaterial {
  white: SideMaterial;
  black: SideMaterial;
}

/** フラッグフォール（6.8 / 6.9 / A.5.3 / A.5.5）の構造化された事実 */
export interface FlagFallFacts {
  flagFallen: FlagFallen;
  /** flagFallen = "both" の場合のみ */
  bothFlagsOrder?: BothFlagsOrder;
  /** 両フラッグの順序が不明な場合: Guidelines III（増加時間なし・事前告知）が適用される大会か */
  quickplayGuidelinesApply?: boolean;
  /** 両フラッグの順序が不明な場合: 全手数を指し切る最終ピリオドか */
  lastPeriod?: boolean;
  /**
   * フラッグに気付く（主張される）前に、チェックメイト・ステイルメイト・投了・合意・
   * デッドポジション等で対局が終了していたか
   */
  gameEndedBeforeFlag: boolean;
  /** 時間切れのプレーヤーは、そのピリオドの規定手数を完了していなかったか（6.4 / 6.9） */
  movesNotCompleted: boolean | "unknown";
  /** 盤上の駒数（キングを除く） */
  material?: { white: Partial<SideMaterial>; black: Partial<SideMaterial> };
  /** 駒数を確認したか（既定値 0 のまま送信されることを防ぐ） */
  materialConfirmed?: boolean;
  /** 任意: 局面の FEN。指定されて有効な場合は駒数をこちらから求める */
  fen?: string;
  /** 駒が固定され到達できない閉塞局面か（ポーンがある場合の確認） */
  positionBlocked?: boolean | "unknown";
}

// ---------------------------------------------------------------------------
// ドロー（draw）
// ---------------------------------------------------------------------------

/** draw カテゴリのうち Decision Tree で扱う subtype（incident-classification.md §8） */
export type DrawSubtype =
  | "threefold-repetition-claim"
  | "fivefold-repetition"
  | "75-move-rule"
  | "other";

/** 9.2.1（これから出現する: 指し手を記入して宣言）/ 9.2.2（出現したばかり） */
export type RepetitionClaimMode = "about-to-appear" | "just-appeared";

/**
 * アービターによる確認結果。
 * - met:     条件が成立していることを確認した
 * - not-met: 条件が成立していないことを確認した
 * - unknown: 確認できない
 * - auto:    入力した手順（棋譜 / FEN）から判定する
 */
export type ConditionCheck = "met" | "not-met" | "unknown" | "auto";

export interface DrawClaimFacts {
  subtype: DrawSubtype;
  /** 9.2: クレームしたプレーヤー */
  claimant?: PlayerColor;
  /** 9.2: クレームしたプレーヤーの手番（自分の時計が動いている）か */
  claimantHasMove?: boolean;
  claimMode?: RepetitionClaimMode;
  /** 9.2.1: 指す手を棋譜に記入し、アービターに宣言したか */
  moveWritten?: boolean;
  /** 9.4: クレーム前に、動かす（取る）意図で駒に触れたか */
  touchedPiece?: boolean;
  /** 同一局面の回数（9.2: 3回 / 9.6.1: 5回）または 75手（9.6.2）の確認結果 */
  conditionCheck?: ConditionCheck;
  /** 9.6.2: 最後の手がチェックメイトだったか */
  lastMoveCheckmate?: boolean;
  /** 任意: 棋譜（SAN の指し手列）または FEN（1行に1局面） */
  positionsText?: string;
  /** 任意（9.2.1）: 記入した指し手（SAN） */
  intendedMove?: string;
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
  /** フラッグフォールの構造化された回答 */
  flagFallFacts?: Partial<FlagFallFacts>;
  /** ドロー（同一局面・75手）の構造化された回答 */
  drawClaimFacts?: Partial<DrawClaimFacts>;
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
