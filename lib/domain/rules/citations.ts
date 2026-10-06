import type { RuleCitation } from "@/lib/domain/entities";

/**
 * 判断で使用する条文引用のカタログ。
 *
 * すべての `text` は以下の原典から逐語的に引用している（改行は半角スペース1つ、
 * 日本語資料は改行を詰めて結合）。原典で確認できない文言は追加しないこと。
 *
 * - FIDE Laws of Chess（2023年1月施行版）/ 解説:
 *   docs/reference/rules/fide/Arbiters_Manual_2025.pdf（ページ番号は印刷ページ）
 * - JCF NAセミナー資料 第4回 修正版（2025-11-08）:
 *   docs/reference/rules/jcf/NAセミナー資料_第4回_修正版.pdf（ページ番号はスライド下部の番号）
 */

export const FIDE_LAWS_2023_EDITION = "FIDE Laws of Chess 2023";
export const FIDE_ARBITERS_MANUAL_2025_EDITION = "FIDE Arbiters' Manual 2025";
export const JCF_NA_SEMINAR_4_EDITION =
  "JCF NAセミナー資料 第4回 修正版 (2025-11-08)";

/** 優先度（小さいほど一般規則、大きいほど優先。要件 §6 の順序に対応） */
const PRIORITY_COMMENTARY = 5;
const PRIORITY_FIDE = 10;
const PRIORITY_JCF = 100;

function fide(article: string, page: number, text: string): RuleCitation {
  return {
    article: `FIDE ${article}`,
    text,
    source: "FIDE",
    priority: PRIORITY_FIDE,
    edition: FIDE_LAWS_2023_EDITION,
    page,
    // 条文自体は Laws 2023 だが、ページ番号は収録資料（Arbiters' Manual 2025）の印刷ページ
    pageDocument: FIDE_ARBITERS_MANUAL_2025_EDITION,
  };
}

function manual(topic: string, page: number, text: string): RuleCitation {
  return {
    article: `FIDE Arbiters' Manual: ${topic}`,
    text,
    source: "commentary",
    priority: PRIORITY_COMMENTARY,
    edition: FIDE_ARBITERS_MANUAL_2025_EDITION,
    page,
    pageDocument: FIDE_ARBITERS_MANUAL_2025_EDITION,
  };
}

function jcf(page: number, text: string): RuleCitation {
  return {
    article: `JCF NA p.${page}`,
    text,
    source: "JCF",
    priority: PRIORITY_JCF,
    edition: JCF_NA_SEMINAR_4_EDITION,
    page,
    pageDocument: JCF_NA_SEMINAR_4_EDITION,
  };
}

export const CITATIONS = {
  // ---- Article 4: The Act of Moving the Pieces ----
  FIDE_4_1: fide("4.1", 16, "Each move must be played with one hand only."),
  FIDE_4_3: fide(
    "4.3",
    16,
    "Except as provided in Article 4.2.1, if the player having the move touches on the chessboard, with the intention of moving or capturing: 4.3.1 one or more of his/her own pieces, he/she must move the first piece touched that can be moved. 4.3.2 one or more of his/her opponent’s pieces, he/she must capture the first piece touched that can be captured. 4.3.3 one or more pieces of each colour, he/she must capture the first touched opponent’s piece with his/her first touched piece or, if this is illegal, move or capture the first piece touched that can be moved or captured. If it is unclear whether the player’s own piece or his/her opponent’s was touched first, the player’s own piece shall be considered to have been touched before his/her opponent’s."
  ),
  FIDE_4_7: fide(
    "4.7",
    18,
    "When, as a legal move or part of a legal move, a piece has been released on a square, it cannot be moved to another square on this move."
  ),

  // ---- Article 7.5: Illegal moves ----
  FIDE_7_5_1: fide(
    "7.5.1",
    27,
    "An illegal move is completed once the player has pressed his/her clock. If during a game it is found that an illegal move has been completed, the position immediately before the irregularity shall be reinstated. If the position immediately before the irregularity cannot be determined, the game shall continue from the last identifiable position prior to the irregularity. Articles 4.3 and 4.7 apply to the move replacing the illegal move. The game shall then continue from this reinstated position."
  ),
  FIDE_7_5_2: fide(
    "7.5.2",
    27,
    "If the player has moved a pawn to the furthest distant rank, pressed the clock, but not replaced the pawn with a new piece, the move is illegal. The pawn shall be replaced by a queen of the same colour as the pawn."
  ),
  FIDE_7_5_3: fide(
    "7.5.3",
    27,
    "If the player presses the clock without making a move, it shall be considered and penalised as if an illegal move."
  ),
  FIDE_7_5_4: fide(
    "7.5.4",
    27,
    "If a player uses two hands to make a single move (for example in case of castling, capturing or promotion) and pressed the clock, it shall be considered and penalised as if an illegal move."
  ),
  FIDE_7_5_5: fide(
    "7.5.5",
    28,
    "After the action taken under Article 7.5.1, 7.5.2, 7.5.3 or 7.5.4 for the first completed illegal move by a player, the arbiter shall give two minutes extra time to his/her opponent; for the second completed illegal move by the same player the arbiter shall declare the game lost by this player. However, the game is drawn if the position is such that the opponent cannot checkmate the player’s king by any possible series of legal moves."
  ),

  // ---- Article 5: The Completion of the Game ----
  FIDE_5_2_2: fide(
    "5.2.2",
    19,
    "The game is drawn when a position has arisen in which neither player can checkmate the opponent’s king with any series of legal moves. The game is said to end in a ‘dead position’. This immediately ends the game, provided that the move producing the position was in accordance with Article 3 and Articles 4.2 – 4.7."
  ),

  // ---- Article 6: The Chessclock ----
  FIDE_6_4: fide(
    "6.4",
    22,
    "Immediately after a flag falls, the requirements of Article 6.3.1 must be checked."
  ),
  FIDE_6_8: fide(
    "6.8",
    24,
    "A flag is considered to have fallen when the arbiter observes the fact or when either player has made a valid claim to that effect."
  ),
  FIDE_6_9: fide(
    "6.9",
    24,
    "Except where one of Articles 5.1.1, 5.1.2, 5.2.1, 5.2.2, 5.2.3 applies, if a player does not complete the prescribed number of moves in the allotted time, the game is lost by that player. However, the game is drawn if the position is such that the opponent cannot checkmate the player’s king by any possible series of legal moves."
  ),

  // ---- Article 9: The Drawn Game ----
  FIDE_9_2: fide(
    "9.2",
    32,
    "The game is drawn, upon a correct claim by a player having the move, when the same position for at least the third time (not necessarily by a repetition of moves): 9.2.1 is about to appear, if he/she first indicates his/her move, which cannot be changed, by writing it on the paper scoresheet or entering it on the electronic scoresheet and declares to the arbiter his/her intention to make this move, or 9.2.2 has just appeared, and the player claiming the draw has the move."
  ),
  FIDE_9_2_3: fide(
    "9.2.3",
    32,
    "Positions are considered the same if and only if the same player has the move, pieces of the same kind and colour occupy the same squares and the possible moves of all the pieces of both players are the same. Thus positions are not the same if: 9.2.3.1 at the start of the sequence a pawn could have been captured en passant 9.2.3.2 a king had castling rights with a rook that has not been moved, but forfeited these after moving. The castling rights are lost only after the king or rook is moved."
  ),
  FIDE_9_4: fide(
    "9.4",
    33,
    "If the player touches a piece as in Article 4.3, he/she loses the right to claim a draw under Article 9.2 or 9.3 on that move."
  ),
  FIDE_9_5_1: fide(
    "9.5.1",
    33,
    "If a player claims a draw under Article 9.2 or 9.3, he/she or the arbiter shall pause the chessclock. He/She is not allowed to withdraw his/her claim."
  ),
  FIDE_9_5_2: fide(
    "9.5.2",
    33,
    "If the claim is found to be correct, the game is immediately drawn."
  ),
  FIDE_9_5_3: fide(
    "9.5.3",
    33,
    "If the claim is found to be incorrect, the arbiter shall add two minutes to the opponent’s remaining thinking time. Then the game shall continue. If the claim was based on an intended move, this move must be made in accordance with Articles 3 and 4."
  ),
  FIDE_9_6: fide(
    "9.6",
    33,
    "If one or both of the following occur(s) then the game is drawn: 9.6.1 the same position has appeared, as in 9.2.2 at least five times. 9.6.2 any series of at least 75 moves have been made by each player without the movement of any pawn and without any capture. If the last move resulted in checkmate, that shall take precedence."
  ),

  // ---- Article 8.7 ----
  FIDE_8_7: fide(
    "8.7",
    30,
    "At the conclusion of the game both players shall indicate the result of the game by signing both scoresheets or approve the result on their electronic scoresheets. Even if incorrect, this result shall stand, unless the arbiter decides otherwise."
  ),

  // ---- Appendix A / B (Rapid / Blitz) ----
  FIDE_A_3: fide(
    "A.3",
    40,
    "The penalties mentioned in Articles 7 and 9 of the Competitive Rules of Play shall be one minute instead of two minutes."
  ),
  // 原典の印字どおり "A4.1one" / "A4.2"（PDF のテキストそのもの。抽出時の欠落ではない）
  FIDE_A_4: fide(
    "A.4",
    40,
    "The Competitive Rules of Play shall apply if: A4.1one arbiter supervises at most three games and A4.2 each game is recorded by the arbiter or his/her assistant and, if possible, by electronic means"
  ),
  FIDE_A_5_2: fide(
    "A.5.2",
    41,
    "If the arbiter observes an action taken under Article 7.5.1, 7.5.2, 7.5.3 or 7.5.4, he/she shall act according to Article 7.5.5, provided the opponent has not made his/her next move. If the arbiter does not intervene, the opponent is entitled to claim, provided the opponent has not made his/her next move. If the opponent does not claim and the arbiter does not intervene, the illegal move shall stand and the game shall continue. Once the opponent has made his/her next move, an illegal move cannot be corrected unless this is agreed by the players without intervention of the arbiter."
  ),
  FIDE_A_2: fide(
    "A.2",
    40,
    "Players do not need to record the moves, but do not lose their rights to claims normally based on a scoresheet. The player can, at any time, ask the arbiter to provide him/her with a scoresheet, in order to write the moves."
  ),
  FIDE_A_5_3: fide(
    "A.5.3",
    41,
    "To claim a win on time, the claimant may pause the chessclock and notify the arbiter. However, the game is drawn if the position is such that the claimant cannot checkmate the player’s king by any possible series of legal moves."
  ),
  FIDE_A_5_4: fide(
    "A.5.4",
    41,
    "If the arbiter observes both kings are in check, or a pawn stands on the rank furthest from its starting position, he/she shall wait until the next move is completed. Then, if an illegal position is still on the board, he/she shall declare the game drawn."
  ),
  FIDE_A_5_5: fide(
    "A.5.5",
    41,
    "The arbiter shall also call a flag fall, if he/she observes it."
  ),
  FIDE_A_6: fide(
    "A.6",
    41,
    "The regulations of an event shall specify whether Article A.4 or Article A.5 shall apply for the entire event."
  ),
  FIDE_B_2: fide(
    "B.2",
    42,
    "The Competition Rules shall apply if: B.2.1 one arbiter supervises one game and B.2.2 each game is recorded by the arbiter or his/her assistant and, if possible, by electronic means."
  ),
  FIDE_B_3: fide(
    "B.3",
    42,
    "Otherwise, play shall be governed by the Rapid chess Laws as in Article A.2, A.3 and A.5."
  ),
  FIDE_B_4: fide(
    "B.4",
    42,
    "The regulations of an event shall specify whether Article B.2 or Article B.3 shall apply for the entire event."
  ),

  // ---- Guidelines III (games without increment) ----
  FIDE_III_2_1: fide(
    "III.2.1",
    52,
    "The Guidelines below concerning the final period of the game including Quickplay Finishes, shall only be used at an event if their use has been announced beforehand."
  ),
  FIDE_III_2_2: fide(
    "III.2.2",
    52,
    "These Guidelines shall apply only to standard chess and rapid chess games without increment and not to blitz games."
  ),
  FIDE_III_3_1: fide(
    "III.3.1",
    52,
    "If both flags have fallen and it is impossible to establish which flag fell first then: III.3.1.1 the game shall continue if this occurs in any period of the game except the last period. III.3.1.2 the game is drawn if this occurs in the period of a game in which all remaining moves must be completed."
  ),

  // ---- FIDE Arbiters' Manual guidance (解説) ----
  MANUAL_3_10_FAST_INTERVENE: manual(
    "Article 3.10 (Rapid and Blitz)",
    15,
    "In Rapid and Blitz chess the arbiter intervenes when an illegal position has occurred as a direct consequence of an illegal move which the arbiter has seen being completed. Otherwise, the arbiter intervenes according to Article A.5.4 of Appendix A, or when a player submits a claim."
  ),
  MANUAL_7_5_FAST_INCREMENT: manual(
    "Article 7.5 (increment in Rapid and Blitz)",
    28,
    "In Rapid and Blitz also the increment obtained by pressing the clock has to be reduced accordingly."
  ),
  MANUAL_A_ONE_MINUTE: manual(
    "Appendix A (illegal move penalty)",
    41,
    "This means that the player does not lose the game with the first illegal move, but only with the second, as it is in standard chess. The penalty is the addition of one minute to the opponent, instead of two minutes."
  ),
  MANUAL_A_BOTH_ZERO: manual(
    "Appendix A (both clocks show 0.00)",
    41,
    "If both clocks indicate 0.00, no claim for win on time can be submitted by the players, but the Arbiter shall decide the result of the game by the flag that is shown on one of the clocks. The player whose clock shows this indication loses the game."
  ),
  MANUAL_6_BOTH_ZERO_ELECTRONIC: manual(
    "Article 6 (both clocks show 0.00)",
    22,
    // 原典の印字どおり "with the help of the help of"
    "Where electronic clocks are used and both clocks show 0.00, the Arbiter can usually establish which flag fell first, with the help of the help of some indication or any other flag indication."
  ),
  MANUAL_6_8_NOTICED: manual(
    "Article 6.8 (flag noticed or claimed)",
    24,
    // 原典では末尾にピリオドがない
    "A flag is considered to have fallen when it is noticed or claimed, not when it physically happened. If a result is reached between a flag fall and the fall being noticed, the result is not changed. The arbiter should announce flag fall as soon as he notices it"
  ),
  MANUAL_6_9_CHECK_POSITION: manual(
    "Article 6.9 (checking the final position)",
    24,
    "This means that a simple flag fall might not lead the arbiter to declare the game lost for the player whose flag has fallen. The Arbiter has to check the final position on the chessboard and only if the opponent can checkmate the player’s king by any possible series of legal moves, can he/she declare the game won by the opponent. Where there are forced moves that lead to a checkmate or to a stalemate by the player, then the result of the game is declared as a draw."
  ),
  MANUAL_6_9_AND_9_6: manual(
    "Article 6.9 (9.6.1 / 9.6.2 precede flag fall)",
    24,
    "Also in the case of articles 9.6.1 and 9.6.2, even if a player does not complete the prescribed number of moves in the allotted time, the game is drawn."
  ),
  MANUAL_9_2_CHECK_PRESENCE: manual(
    "Article 9.2 (checking a claim)",
    32,
    "The correctness of a claim must be checked in the presence of both players. It is also advisable to replay the game and not to decide by only using the score sheets. If electronic boards are used it is possible to check it on the computer."
  ),
  MANUAL_9_2_ONLY_PLAYER_TO_MOVE: manual(
    "Article 9.2 (who may claim)",
    32,
    "Only the player whose move it is, and whose clock is running, is allowed to claim a draw in this way."
  ),
  MANUAL_9_2_MAKE_CLAIM_LEGAL: manual(
    "Article 9.2 (make your claim legal)",
    32,
    "If the procedure of a draw claim is correct, but the player forgets or doesn’t know that he/she shall write his/her intended move, it is advisable that instead of rejecting the claim, the arbiter says “Make your claim legal”, if the player asks how he/she can make his/her claim legal, the arbiter can, according to article 11.2, explains conditions of a correct claim."
  ),
  MANUAL_9_5_INTENDED_MOVE: manual(
    "Article 9.5 (intended move)",
    33,
    "It is mentioned that the intended move must be played, but if the intended move is illegal, another move with this piece must be made. All the other details of Article 4 are also valid."
  ),
  MANUAL_9_4_RIGHT_RETURNS: manual(
    "Article 9.4 (right to claim)",
    33,
    "The right to claim a draw is returned on the next move but cannot be made retrospectively."
  ),
  MANUAL_9_6_INTERVENE: manual(
    "Article 9.6 (arbiter intervention)",
    33,
    "In 9.6.1 case, the five times need not be consecutive. In both 9.6.1 and 9.6.2 cases the arbiter must intervene and stop the game, declaring it as a draw."
  ),
  MANUAL_7_5_GAME_OVER: manual(
    "Article 7.5 (discovered after the game)",
    27,
    "It is very important that the irregularity must be discovered during the game. After the players have signed the scoresheets or it is clear in another way that the game is over, corrections are not possible. The result stands."
  ),
  MANUAL_7_5_TOUCH_MOVE: manual(
    "Article 7.5 (touch move after restoration)",
    27,
    "When the irregularity is discovered during the game the game, the game restarts from the restored position. The ‘touch move’ rule applies so the piece to be played should be, if possible, the one first touched, either the piece illegally moved or the piece captured."
  ),
  MANUAL_7_5_NOT_COMPLETED: manual(
    "Article 7.5 (clock not pressed)",
    27,
    "A move cannot be declared illegal until the player has completed his/her move by pressing his/her clock. So, the player can correct his/her move without being penalized, even if he/she had already released the piece on the board, provided he/she hasn’t pressed the clock. Of course, he/she must comply with the relevant parts of article 4."
  ),
  MANUAL_7_5_3_CLOCK_IN_ERROR: manual(
    "Article 7.5.3 (clock started in error)",
    27,
    "Where an opponent’s clock may have been started in error the arbiter must decide if this action constitutes an illegal move or a distraction."
  ),
  MANUAL_7_5_INTERVENE: manual(
    "Article 7.5 (arbiter intervention)",
    27,
    "If an arbiter observes an illegal move he/she must always intervene immediately. He/She should not wait for a claim to be submitted by a player."
  ),
  MANUAL_7_5_COUNT_ONCE: manual(
    "Article 7.5 (two irregularities in one move)",
    28,
    "However when there are two (2) illegal moves in one move (for example illegal castling made by two hands, illegal promotion made by two hands and illegal capturing made by two hands), they count as one (1) illegal move and the player shall not be forfeited, unless it is the second such transgression."
  ),
  MANUAL_7_5_INCREMENT: manual(
    "Article 7.5 (increment)",
    28,
    "The arbiter’s have to follow the uniformity in reducing the increment (in general 30 seconds) for the player who completed the illegal move by pressing the clock and adding two minutes for his opponent."
  ),
  MANUAL_4_INTERVENE: manual(
    "Article 4 (arbiter intervention)",
    18,
    "If an arbiter observes a violation of Article 4, he/she must always intervene immediately."
  ),

  // ---- JCF NA Seminar ----
  JCF_NA_P47_TOUCH_MOVE: jcf(
    47,
    "※イリーガルムーブの代わりに手を指す際にはタッチアンドムーブが適用される"
  ),
  JCF_NA_P47_GAME_OVER: jcf(
    47,
    "プレーヤーが棋譜用紙に署名した後、または対局が終了したことが他の方法で明らかな場合、修正できず結果は有効になる。"
  ),
  JCF_NA_P48_PENALTY: jcf(
    48,
    "7.5.5 イリーガルムーブについて、アービターは相手の時計に2分加算。同プレーヤーによる2回目のイリーガルムーブについて、アービターはそのプレーヤーによる対局の敗北を宣言。"
  ),
  JCF_NA_P48_DRAW_EXCEPTION: jcf(
    48,
    "※ただし、その局面が相手のあらゆる合法手の組み合わせでプレーヤーのキングをチェックメイトできない局面の場合引き分けとなる。"
  ),
  JCF_NA_P39_FLAG_NOTICED: jcf(
    39,
    "※フラッグが物理的に落ちた時ではなく、それが気付かれたり主張されたりした時にフラッグが落ちたとみなされる。フラッグが物理的に落ちた後、それに気づく前に結果が出た場合、その結果は覆らない"
  ),
  JCF_NA_P39_ARBITER_INTERVENES: jcf(
    39,
    "※アービターはフラッグが落ちたことを気付いた時点で即座に介入しなければならない"
  ),
  JCF_NA_P40_FLAG_RESULT: jcf(
    40,
    "時間が落ちた時点での局面が、相手がいかなる合法手の組み合わせでも プレーヤーのキングをチェックメイトできない場合はドローとなり、それ以外の場合は相手の勝利と宣言"
  ),
  JCF_NA_P65_SAME_POSITION: jcf(
    65,
    "同じプレーヤーが指す手番で、同じ種類と色の駒が同じマスに置かれており、両プレーヤーのすべての駒の可能な指し手（動くことのできる範囲）が同じ場合※以下の要素が変わると同一局面とは言わない・アンパッサンの可否・キャスリングの可否"
  ),
  JCF_NA_P69_INCORRECT_CLAIM: jcf(
    69,
    "相手の持ち時間に2分加算しゲームを再開※この時棋譜にあらかじめ書いた手で再開しなければならない。"
  ),
  JCF_NA_P70_FIVEFOLD_75: jcf(
    70,
    "【重要】アービターはこれが発生し次第即座に介入してドローを宣言しなければならない。"
  ),
  JCF_NA_P88_ONE_MINUTE: jcf(
    88,
    "A.3 競技ルール7~9条で言及される時間加算は2分ではなく 1分とする"
  ),
  JCF_NA_P90_A_5_2: jcf(
    90,
    "(A.5.2) アービターが第7.5.1条、第7.5.2条、第7.5.3条または第7.5.4条(イリーガルムーブ)を観察した場合、相手が次の手を指していない場合は、第7.5.5条(1分加算、2度目で敗北)に従って対応。アービターが介入しない場合、相手が次の手を指していない限り、相手はこれを主張する権利がある。相手が指摘せず、かつ、アービターが介入しない場合はイリーガルムーブが合法手として成立、対局は続行。相手が次の手を指した後は、アービターの介入なくイリーガルムーブを修正することはできない。"
  ),
} as const satisfies Record<string, RuleCitation>;

export type CitationKey = keyof typeof CITATIONS;

/** カタログから引用を取り出す（呼び出し側での変更が共有オブジェクトに波及しないようコピーを返す） */
export function cite(...keys: CitationKey[]): RuleCitation[] {
  return keys.map((k) => ({ ...CITATIONS[k] }));
}
