import type {
  CompetitionType,
  RulesVersion,
  SupervisionRegime,
  TimeControl,
  TournamentOverrides,
} from "./tournament";

/**
 * 報告時点の規則セット（大会設定のスナップショット。ADR-006）。
 * 追加質問への回答で再評価するときも、報告時の規則セットで判断する
 * （報告後に大会設定を編集しても、既存の Incident の判断は変わらない）。
 */
export interface RulesetSnapshot {
  competitionType: CompetitionType;
  supervisionRegime?: SupervisionRegime;
  rulesVersion: RulesVersion;
  /** 大会規定による上書き（出典を含めて保存） */
  tournamentOverrides?: TournamentOverrides;
  /**
   * 報告時の持ち時間（ADR-014 §7）。最終ピリオドかどうか等を設定から求めるために使う。
   * J1b-7 より前のスナップショット・持ち時間のない暫定大会では省略（その場合は質問する）
   */
  timeControl?: TimeControl;
}

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
   * 7.5.5 ただし書き（相手がメイト不可能ならドロー）の判定に使う局面の入力方法。
   * メイト可能性は局面からコードが判定する（ADR-014 §5）。直接は質問しない。
   */
  matePosition?: MatePositionInput;
  /**
   * 違法手の直前に戻した局面（7.5.1〜7.5.4 で再開する局面。手番は違反者）の FEN。
   * 端末内だけで使い、外部へは送らない（ADR-012）。
   */
  positionFen?: string;
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

/**
 * メイト可能性（6.9 / 7.5.5 / A.5.3）の判定に使う局面の入力方法（ADR-014 §5）。
 * - fen:         局面の FEN を入力して判定する
 * - unknown: 局面を入力できない（CAへ確認。ツリー独自の unknown で、resolveUnknown では列挙しない）
 */
export type MatePositionInput = "fen" | "unknown";

/**
 * 端末内のヘルプメイト探索の結果（ADR-015）。判定のたびに ChessPositionPort で
 * 手順を再検証してから使う（記録自体は証拠の候補にすぎない）。
 */
export interface MateSearchRecord {
  /** 探索した局面 */
  fen: string;
  /** メイトする側 */
  attacker: PlayerColor;
  status: "found" | "not-found";
  /** found: 局面からメイトまでの手順（SAN） */
  moves?: string[];
  /** not-found の理由（limit / deadline / error など） */
  reason?: string;
  /** 探索エンジンの版（not-found を新しい版で探し直すため） */
  engine: string;
}

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
  /**
   * 6.9 / A.5.3 ただし書き（相手がメイト不可能ならドロー）の判定に使う局面の入力方法。
   * 駒数による判定・閉塞局面の質問は廃止（ADR-014 §5）。
   */
  matePosition?: MatePositionInput;
  /** フラッグ確定時の局面（正しい手番を含む）の FEN。端末内だけで使う */
  fen?: string;
}

// ---------------------------------------------------------------------------
// ドロー（draw）
// ---------------------------------------------------------------------------

/**
 * draw カテゴリの subtype（ADR-014 §1）。
 * - DT-005 Draw Claim: threefold-repetition-claim（9.2）/ fifty-move-claim（9.3）
 * - DT-006 Automatic Draw: fivefold-repetition（9.6.1）/ 75-move-rule（9.6.2）
 * - Decision Tree なし（fact plan）: agreement / stalemate / dead-position / other
 */
export type DrawSubtype =
  | "threefold-repetition-claim"
  | "fifty-move-claim"
  | "fivefold-repetition"
  | "75-move-rule"
  | "agreement"
  | "stalemate"
  | "dead-position"
  | "other";

/** DT-005 Draw Claim のクレームの根拠（FIDE 9.2 / 9.3） */
export type DrawClaimBasis = "threefold" | "fifty-move";

/** クレームの subtype の根拠。クレームでない subtype は undefined */
export function drawClaimBasisOf(
  subtype: string | undefined
): DrawClaimBasis | undefined {
  if (subtype === "threefold-repetition-claim") return "threefold";
  if (subtype === "fifty-move-claim") return "fifty-move";
  return undefined;
}

/**
 * 9.2.1 / 9.3.1（記入した次の手で成立する: 指し手を記入して宣言）/
 * 9.2.2 / 9.3.2（相手の直前の手で成立した）
 */
export type RepetitionClaimMode = "about-to-appear" | "just-appeared";

/**
 * アービターによる確認結果。
 * - met:     条件が成立していることを確認した
 * - not-met: 条件が成立していないことを確認した
 * - met-checkmate: 75手に達した手がチェックメイトだった（9.6.2: メイトが優先。75手の確認のみ）
 * - unknown: 確認できない
 * - auto:    入力した対局履歴（棋譜。game.history）から判定する
 */
export type ConditionCheck =
  "met" | "met-checkmate" | "not-met" | "unknown" | "auto";

/**
 * 再生した対局履歴の最終局面を、アービターが盤上と照合した結果（ADR-014 §4）。
 * - match:         局面も手数も一致した
 * - position-only: 局面は一致したが、手数は確認できない（途中からの履歴と同じ扱い）
 * - mismatch:      一致しない（自動判定は使わず、盤上で手順を再現する）
 * - unknown:       照合できない（mismatch と同じ扱い）
 */
export type HistoryConfirmation =
  "match" | "position-only" | "mismatch" | "unknown";

export interface DrawClaimFacts {
  subtype: DrawSubtype;
  /** 9.2 / 9.3: クレームしたプレーヤー */
  claimant?: PlayerColor;
  /**
   * クレームの直前に、盤上で最後に手を指したプレーヤー（dr.last-mover。ADR-014 §2）。
   * 手番はこれ、または照合済みの対局履歴から求める。時計の状態からは求めない。
   */
  lastMover?: PlayerColor;
  /**
   * 旧（J1b-5 より前）: 「手番（自分の時計が動いている）か」。時計に依存するため
   * 判定には使わない（保存済みの Incident との互換のためだけに残す）。
   * @deprecated lastMover を使う
   */
  claimantHasMove?: boolean;
  claimMode?: RepetitionClaimMode;
  /** 9.2.1 / 9.3.1: 指す手を棋譜に記入し、アービターに宣言したか */
  moveWritten?: boolean;
  /** 9.4: クレーム前に、その手番で動かす（取る）意思で駒に触れたか */
  touchedPiece?: boolean;
  /**
   * 盤上で手順を再現した確認結果（dr.manual-reconstruction）、または auto。
   * 同一局面の回数（9.2: 3回 / 9.6.1: 5回）、50手（9.3）、75手（9.6.2）。
   */
  conditionCheck?: ConditionCheck;
  /**
   * 9.6.2: 75手に達した手がチェックメイトだったか（手動確認のみ）。独立した質問は廃止し、
   * 75手の確認結果から記録する: "met"（チェックメイトではない）→ false、"met-checkmate" →
   * conditionCheck に記録。conditionCheck = met でこれが未設定なのは J1b-5 より前の回答で、
   * DT-006 は確認をやり直す（チェックメイトでないことが確認されていないため）。
   */
  lastMoveCheckmate?: boolean;
  /**
   * 任意: 対局履歴（game.history）のテキスト。PGN / 棋譜（SAN の指し手列）だけを受け付け、
   * 途中局面からの場合は [FEN "..."] ヘッダで開始局面を書く。FEN の列は受け付けない。
   * 端末内だけで使い、外部へは送らない（ADR-012 / ADR-014 §4）。
   */
  positionsText?: string;
  /**
   * 再生した最終局面の照合結果。positionsText を変更すると消える
   * （別の履歴に対する照合を引き継がない）。
   */
  historyConfirmed?: HistoryConfirmation;
  /** 任意（9.2.1 / 9.3.1）: 記入した指し手（SAN） */
  intendedMove?: string;
}

// ---------------------------------------------------------------------------
// 触れた駒の規則（Article 4。違法手カテゴリのサブタイプ touch-move。ADR-014 §6）
// ---------------------------------------------------------------------------

/**
 * 違法手カテゴリのサブタイプ。7.5 の違法手（IllegalMoveSubtype）ではなく DT-007 で扱い、
 * 違法手の回数には数えない。
 */
export const TOUCH_MOVE_SUBTYPE = "touch-move";

/** tch.how: どのように触れたか（brushed = 袖や手が当たった。4.2.2 の明らかな偶然の接触） */
export type TouchHow = "grasped" | "lifted" | "pushed" | "brushed";

/** tch.what-next: 触れた後に何をしたか */
export type TouchWhatNext = "moved-touched" | "moved-other" | "not-moved";

/**
 * tch.special のうち DT-007 が質問する昇格の値（4.4.4）。キャスリング（4.4.1〜4.4.3）は
 * 触れた順（tch.touched）から求めるため質問しない。
 */
export type TouchPromotion =
  "promotion-placed" | "promotion-not-placed" | "none";

/** DT-007 の構造化された事実（IllegalMoveFacts とは別。ADR-014 §6） */
export interface TouchMoveFacts {
  /** tch.how */
  how: TouchHow;
  /** tch.adjust-declared: 触れる前に「整えます（j'adoube）」等と言ったか（4.2.1） */
  adjustDeclared: boolean;
  /** tch.on-move: 触れたのは、そのプレーヤーの手番のときか（4.3） */
  onMove: boolean;
  /** tch.claimed-by-opponent: 相手からの申し立てで始まったか */
  claimedByOpponent: boolean;
  /** tch.claim-timing: 申し立ては、相手が動かす・取る意思で駒に触れる前だったか（4.8） */
  claimBeforeOwnTouch?: boolean;
  /** tch.what-next */
  whatNext: TouchWhatNext;
  /** tch.released: 動かした駒を、マスの上で手から離したか（4.7） */
  released?: boolean;
  /**
   * tch.changed-after: 手を離した後（昇格では、選んだ駒が昇格のマスに触れた後）に、
   * 別のマスへ動かし直した・別の駒に替えたか（4.7 / 4.4.4 の違反）
   */
  changedAfter?: boolean;
  /**
   * 🔒 tch.touched: 触れた駒とマス（触れた順）のテキスト。例: "Pe2 Qd1"（白は大文字・黒は小文字）、
   * 局面（fen）がある場合はマスだけでよい（"e2 d1"）。端末内だけで使う（ADR-012）。
   */
  touchedText?: string;
  /** 🔒 game.position: 触れた時点の局面（手番は触れたプレーヤー）。端末内だけで使う */
  fen?: string;
  /** tch.special（昇格のみ。4.4.4） */
  promotion?: TouchPromotion;
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
  /** ドロー（クレーム・自動ドロー）の構造化された回答 */
  drawClaimFacts?: Partial<DrawClaimFacts>;
  /** 触れた駒の規則（subtype touch-move。DT-007）の構造化された回答 */
  touchMoveFacts?: Partial<TouchMoveFacts>;
  /**
   * 「わからない・確認できない」と回答された追加質問の ID（fact-model §3.3）。
   * 該当する事実の値は未設定のまま。未回答（needs-input）とは区別され、
   * DecisionEngine が resolveUnknown で全分岐を評価する。
   */
  unknownAnswers?: string[];
  /** メイト可能性の局面に対するヘルプメイト探索の結果（ADR-015） */
  mateSearch?: MateSearchRecord;
  /** 報告時点の規則セット（v5 以前の Incident には存在しない） */
  rulesetSnapshot?: RulesetSnapshot;
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
