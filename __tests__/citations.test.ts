import { describe, it, expect } from "vitest";
import { CITATIONS } from "@/lib/domain/rules/citations";

/**
 * 条文ID → 原典の逐語テキスト。
 * FIDE: docs/reference/rules/fide/Arbiters_Manual_2025.pdf（Laws of Chess 2023）
 * JCF:  docs/reference/rules/jcf/NAセミナー資料_第4回_修正版.pdf
 * PDF から pdfjs-dist で抽出し、改行を半角スペース（日本語は詰め）で結合したもの。
 */
const EXPECTED: Record<string, { text: string; page: number }> = {
  "FIDE 4.1": {
    page: 16,
    text: "Each move must be played with one hand only.",
  },
  "FIDE 4.7": {
    page: 18,
    text: "When, as a legal move or part of a legal move, a piece has been released on a square, it cannot be moved to another square on this move.",
  },
  "FIDE 7.5.1": {
    page: 27,
    text: "An illegal move is completed once the player has pressed his/her clock. If during a game it is found that an illegal move has been completed, the position immediately before the irregularity shall be reinstated. If the position immediately before the irregularity cannot be determined, the game shall continue from the last identifiable position prior to the irregularity. Articles 4.3 and 4.7 apply to the move replacing the illegal move. The game shall then continue from this reinstated position.",
  },
  "FIDE 7.5.2": {
    page: 27,
    text: "If the player has moved a pawn to the furthest distant rank, pressed the clock, but not replaced the pawn with a new piece, the move is illegal. The pawn shall be replaced by a queen of the same colour as the pawn.",
  },
  "FIDE 7.5.3": {
    page: 27,
    text: "If the player presses the clock without making a move, it shall be considered and penalised as if an illegal move.",
  },
  "FIDE 7.5.4": {
    page: 27,
    text: "If a player uses two hands to make a single move (for example in case of castling, capturing or promotion) and pressed the clock, it shall be considered and penalised as if an illegal move.",
  },
  "FIDE 7.5.5": {
    page: 28,
    text: "After the action taken under Article 7.5.1, 7.5.2, 7.5.3 or 7.5.4 for the first completed illegal move by a player, the arbiter shall give two minutes extra time to his/her opponent; for the second completed illegal move by the same player the arbiter shall declare the game lost by this player. However, the game is drawn if the position is such that the opponent cannot checkmate the player’s king by any possible series of legal moves.",
  },
  "FIDE 8.7": {
    page: 30,
    text: "At the conclusion of the game both players shall indicate the result of the game by signing both scoresheets or approve the result on their electronic scoresheets. Even if incorrect, this result shall stand, unless the arbiter decides otherwise.",
  },
  "FIDE A.3": {
    page: 40,
    text: "The penalties mentioned in Articles 7 and 9 of the Competitive Rules of Play shall be one minute instead of two minutes.",
  },
  "FIDE A.5.2": {
    page: 41,
    text: "If the arbiter observes an action taken under Article 7.5.1, 7.5.2, 7.5.3 or 7.5.4, he/she shall act according to Article 7.5.5, provided the opponent has not made his/her next move. If the arbiter does not intervene, the opponent is entitled to claim, provided the opponent has not made his/her next move. If the opponent does not claim and the arbiter does not intervene, the illegal move shall stand and the game shall continue. Once the opponent has made his/her next move, an illegal move cannot be corrected unless this is agreed by the players without intervention of the arbiter.",
  },
  "FIDE A.4": {
    page: 40,
    // 原典の印字どおり "A4.1one"
    text: "The Competitive Rules of Play shall apply if: A4.1one arbiter supervises at most three games and A4.2 each game is recorded by the arbiter or his/her assistant and, if possible, by electronic means",
  },
  "FIDE B.2": {
    page: 42,
    text: "The Competition Rules shall apply if: B.2.1 one arbiter supervises one game and B.2.2 each game is recorded by the arbiter or his/her assistant and, if possible, by electronic means.",
  },
  "FIDE B.3": {
    page: 42,
    text: "Otherwise, play shall be governed by the Rapid chess Laws as in Article A.2, A.3 and A.5.",
  },
  "FIDE 5.2.2": {
    page: 19,
    text: "The game is drawn when a position has arisen in which neither player can checkmate the opponent’s king with any series of legal moves. The game is said to end in a ‘dead position’. This immediately ends the game, provided that the move producing the position was in accordance with Article 3 and Articles 4.2 – 4.7.",
  },
  "FIDE 6.4": {
    page: 22,
    text: "Immediately after a flag falls, the requirements of Article 6.3.1 must be checked.",
  },
  "FIDE 6.8": {
    page: 24,
    text: "A flag is considered to have fallen when the arbiter observes the fact or when either player has made a valid claim to that effect.",
  },
  "FIDE 6.9": {
    page: 24,
    text: "Except where one of Articles 5.1.1, 5.1.2, 5.2.1, 5.2.2, 5.2.3 applies, if a player does not complete the prescribed number of moves in the allotted time, the game is lost by that player. However, the game is drawn if the position is such that the opponent cannot checkmate the player’s king by any possible series of legal moves.",
  },
  "FIDE 9.2": {
    page: 32,
    text: "The game is drawn, upon a correct claim by a player having the move, when the same position for at least the third time (not necessarily by a repetition of moves): 9.2.1 is about to appear, if he/she first indicates his/her move, which cannot be changed, by writing it on the paper scoresheet or entering it on the electronic scoresheet and declares to the arbiter his/her intention to make this move, or 9.2.2 has just appeared, and the player claiming the draw has the move.",
  },
  "FIDE 9.2.3": {
    page: 32,
    text: "Positions are considered the same if and only if the same player has the move, pieces of the same kind and colour occupy the same squares and the possible moves of all the pieces of both players are the same. Thus positions are not the same if: 9.2.3.1 at the start of the sequence a pawn could have been captured en passant 9.2.3.2 a king had castling rights with a rook that has not been moved, but forfeited these after moving. The castling rights are lost only after the king or rook is moved.",
  },
  "FIDE 9.4": {
    page: 33,
    text: "If the player touches a piece as in Article 4.3, he/she loses the right to claim a draw under Article 9.2 or 9.3 on that move.",
  },
  "FIDE 9.5.1": {
    page: 33,
    text: "If a player claims a draw under Article 9.2 or 9.3, he/she or the arbiter shall pause the chessclock. He/She is not allowed to withdraw his/her claim.",
  },
  "FIDE 9.5.2": {
    page: 33,
    text: "If the claim is found to be correct, the game is immediately drawn.",
  },
  "FIDE 9.5.3": {
    page: 33,
    text: "If the claim is found to be incorrect, the arbiter shall add two minutes to the opponent’s remaining thinking time. Then the game shall continue. If the claim was based on an intended move, this move must be made in accordance with Articles 3 and 4.",
  },
  "FIDE 9.6": {
    page: 33,
    text: "If one or both of the following occur(s) then the game is drawn: 9.6.1 the same position has appeared, as in 9.2.2 at least five times. 9.6.2 any series of at least 75 moves have been made by each player without the movement of any pawn and without any capture. If the last move resulted in checkmate, that shall take precedence.",
  },
  "FIDE A.2": {
    page: 40,
    text: "Players do not need to record the moves, but do not lose their rights to claims normally based on a scoresheet. The player can, at any time, ask the arbiter to provide him/her with a scoresheet, in order to write the moves.",
  },
  "FIDE A.5.3": {
    page: 41,
    text: "To claim a win on time, the claimant may pause the chessclock and notify the arbiter. However, the game is drawn if the position is such that the claimant cannot checkmate the player’s king by any possible series of legal moves.",
  },
  "FIDE A.5.4": {
    page: 41,
    text: "If the arbiter observes both kings are in check, or a pawn stands on the rank furthest from its starting position, he/she shall wait until the next move is completed. Then, if an illegal position is still on the board, he/she shall declare the game drawn.",
  },
  "FIDE A.5.5": {
    page: 41,
    text: "The arbiter shall also call a flag fall, if he/she observes it.",
  },
  "FIDE A.6": {
    page: 41,
    text: "The regulations of an event shall specify whether Article A.4 or Article A.5 shall apply for the entire event.",
  },
  "FIDE B.4": {
    page: 42,
    text: "The regulations of an event shall specify whether Article B.2 or Article B.3 shall apply for the entire event.",
  },
  "FIDE III.2.1": {
    page: 52,
    text: "The Guidelines below concerning the final period of the game including Quickplay Finishes, shall only be used at an event if their use has been announced beforehand.",
  },
  "FIDE III.2.2": {
    page: 52,
    text: "These Guidelines shall apply only to standard chess and rapid chess games without increment and not to blitz games.",
  },
  "FIDE III.3.1": {
    page: 52,
    text: "If both flags have fallen and it is impossible to establish which flag fell first then: III.3.1.1 the game shall continue if this occurs in any period of the game except the last period. III.3.1.2 the game is drawn if this occurs in the period of a game in which all remaining moves must be completed.",
  },
};

const EXPECTED_JCF_P48 = [
  "7.5.5 イリーガルムーブについて、アービターは相手の時計に2分加算。同プレーヤーによる2回目のイリーガルムーブについて、アービターはそのプレーヤーによる対局の敗北を宣言。",
  "※ただし、その局面が相手のあらゆる合法手の組み合わせでプレーヤーのキングをチェックメイトできない局面の場合引き分けとなる。",
];

/**
 * Milestone 4 で追加した解説（Arbiters' Manual）・JCF 資料の逐語引用。
 * pdfjs-dist で抽出したテキスト（FIDE は改行を半角スペース、JCF は改行を詰めて結合）と照合済み。
 */
const EXPECTED_M4_NON_LAWS: Record<string, { page: number; text: string }> = {
  MANUAL_A_BOTH_KINGS_IN_CHECK: {
    page: 41,
    text: "The arbiter arrives at a board where both kings are in check. If that situation continues after the next move is played the arbiter shall declare the game drawn. If that move removes his/her own king from check but the opponent is still in check then the game continues as it is no longer an illegal position. If the second player remains in check after completing his/her next move the arbiter should declare an illegal move by that player.",
  },
  MANUAL_3_10_FAST_INTERVENE: {
    page: 15,
    text: "In Rapid and Blitz chess the arbiter intervenes when an illegal position has occurred as a direct consequence of an illegal move which the arbiter has seen being completed. Otherwise, the arbiter intervenes according to Article A.5.4 of Appendix A, or when a player submits a claim.",
  },
  MANUAL_7_5_FAST_INCREMENT: {
    page: 28,
    text: "In Rapid and Blitz also the increment obtained by pressing the clock has to be reduced accordingly.",
  },
  MANUAL_A_ONE_MINUTE: {
    page: 41,
    text: "This means that the player does not lose the game with the first illegal move, but only with the second, as it is in standard chess. The penalty is the addition of one minute to the opponent, instead of two minutes.",
  },
  MANUAL_A_BOTH_ZERO: {
    page: 41,
    text: "If both clocks indicate 0.00, no claim for win on time can be submitted by the players, but the Arbiter shall decide the result of the game by the flag that is shown on one of the clocks. The player whose clock shows this indication loses the game.",
  },
  MANUAL_6_BOTH_ZERO_ELECTRONIC: {
    page: 22,
    text: "Where electronic clocks are used and both clocks show 0.00, the Arbiter can usually establish which flag fell first, with the help of the help of some indication or any other flag indication.",
  },
  MANUAL_6_8_NOTICED: {
    page: 24,
    text: "A flag is considered to have fallen when it is noticed or claimed, not when it physically happened. If a result is reached between a flag fall and the fall being noticed, the result is not changed. The arbiter should announce flag fall as soon as he notices it",
  },
  MANUAL_6_9_CHECK_POSITION: {
    page: 24,
    text: "This means that a simple flag fall might not lead the arbiter to declare the game lost for the player whose flag has fallen. The Arbiter has to check the final position on the chessboard and only if the opponent can checkmate the player’s king by any possible series of legal moves, can he/she declare the game won by the opponent. Where there are forced moves that lead to a checkmate or to a stalemate by the player, then the result of the game is declared as a draw.",
  },
  MANUAL_6_9_AND_9_6: {
    page: 24,
    text: "Also in the case of articles 9.6.1 and 9.6.2, even if a player does not complete the prescribed number of moves in the allotted time, the game is drawn.",
  },
  MANUAL_9_2_CHECK_PRESENCE: {
    page: 32,
    text: "The correctness of a claim must be checked in the presence of both players. It is also advisable to replay the game and not to decide by only using the score sheets. If electronic boards are used it is possible to check it on the computer.",
  },
  MANUAL_9_2_ONLY_PLAYER_TO_MOVE: {
    page: 32,
    text: "Only the player whose move it is, and whose clock is running, is allowed to claim a draw in this way.",
  },
  MANUAL_9_2_MAKE_CLAIM_LEGAL: {
    page: 32,
    text: "If the procedure of a draw claim is correct, but the player forgets or doesn’t know that he/she shall write his/her intended move, it is advisable that instead of rejecting the claim, the arbiter says “Make your claim legal”, if the player asks how he/she can make his/her claim legal, the arbiter can, according to article 11.2, explains conditions of a correct claim.",
  },
  MANUAL_9_5_INTENDED_MOVE: {
    page: 33,
    text: "It is mentioned that the intended move must be played, but if the intended move is illegal, another move with this piece must be made. All the other details of Article 4 are also valid.",
  },
  MANUAL_9_4_RIGHT_RETURNS: {
    page: 33,
    text: "The right to claim a draw is returned on the next move but cannot be made retrospectively.",
  },
  MANUAL_9_6_INTERVENE: {
    page: 33,
    text: "In 9.6.1 case, the five times need not be consecutive. In both 9.6.1 and 9.6.2 cases the arbiter must intervene and stop the game, declaring it as a draw.",
  },
  JCF_NA_P39_FLAG_NOTICED: {
    page: 39,
    text: "※フラッグが物理的に落ちた時ではなく、それが気付かれたり主張されたりした時にフラッグが落ちたとみなされる。フラッグが物理的に落ちた後、それに気づく前に結果が出た場合、その結果は覆らない",
  },
  JCF_NA_P39_ARBITER_INTERVENES: {
    page: 39,
    text: "※アービターはフラッグが落ちたことを気付いた時点で即座に介入しなければならない",
  },
  JCF_NA_P40_FLAG_RESULT: {
    page: 40,
    text: "時間が落ちた時点での局面が、相手がいかなる合法手の組み合わせでも プレーヤーのキングをチェックメイトできない場合はドローとなり、それ以外の場合は相手の勝利と宣言",
  },
  JCF_NA_P65_SAME_POSITION: {
    page: 65,
    text: "同じプレーヤーが指す手番で、同じ種類と色の駒が同じマスに置かれており、両プレーヤーのすべての駒の可能な指し手（動くことのできる範囲）が同じ場合※以下の要素が変わると同一局面とは言わない・アンパッサンの可否・キャスリングの可否",
  },
  JCF_NA_P69_INCORRECT_CLAIM: {
    page: 69,
    text: "相手の持ち時間に2分加算しゲームを再開※この時棋譜にあらかじめ書いた手で再開しなければならない。",
  },
  JCF_NA_P70_FIVEFOLD_75: {
    page: 70,
    text: "【重要】アービターはこれが発生し次第即座に介入してドローを宣言しなければならない。",
  },
  JCF_NA_P88_ONE_MINUTE: {
    page: 88,
    text: "A.3 競技ルール7~9条で言及される時間加算は2分ではなく 1分とする",
  },
  JCF_NA_P90_A_5_2: {
    page: 90,
    text: "(A.5.2) アービターが第7.5.1条、第7.5.2条、第7.5.3条または第7.5.4条(イリーガルムーブ)を観察した場合、相手が次の手を指していない場合は、第7.5.5条(1分加算、2度目で敗北)に従って対応。アービターが介入しない場合、相手が次の手を指していない限り、相手はこれを主張する権利がある。相手が指摘せず、かつ、アービターが介入しない場合はイリーガルムーブが合法手として成立、対局は続行。相手が次の手を指した後は、アービターの介入なくイリーガルムーブを修正することはできない。",
  },
};

describe("Rule citation catalog", () => {
  const all = Object.values(CITATIONS);

  it.each(Object.entries(EXPECTED))(
    "%s matches the verbatim 2023 Laws text",
    (article, exp) => {
      const c = all.find((x) => x.article === article);
      expect(c, `citation ${article} missing`).toBeDefined();
      expect(c!.text).toBe(exp.text);
      expect(c!.page).toBe(exp.page);
      expect(c!.edition).toBe("FIDE Laws of Chess 2023");
      expect(c!.source).toBe("FIDE");
    }
  );

  it("FIDE 4.3 quotes 4.3 including 4.3.1–4.3.3", () => {
    expect(CITATIONS.FIDE_4_3.text).toMatch(
      /^Except as provided in Article 4\.2\.1, if the player having the move touches on the chessboard, with the intention of moving or capturing: 4\.3\.1 one or more of his\/her own pieces, he\/she must move the first piece touched that can be moved\./
    );
  });

  it("FIDE page numbers are labelled as Arbiters' Manual 2025 pages", () => {
    for (const c of all.filter((x) => x.source !== "JCF")) {
      expect(c.pageDocument).toBe("FIDE Arbiters' Manual 2025");
    }
    expect(CITATIONS.JCF_NA_P48_PENALTY.pageDocument).toContain("JCF NA");
  });

  it("Manual note on 7.5.3 (clock started in error) is verbatim", () => {
    expect(CITATIONS.MANUAL_7_5_3_CLOCK_IN_ERROR.text).toBe(
      "Where an opponent’s clock may have been started in error the arbiter must decide if this action constitutes an illegal move or a distraction."
    );
    expect(CITATIONS.MANUAL_7_5_3_CLOCK_IN_ERROR.page).toBe(27);
  });

  it("JCF NA p.48 quotes the slide verbatim", () => {
    expect(CITATIONS.JCF_NA_P48_PENALTY.text).toBe(EXPECTED_JCF_P48[0]);
    expect(CITATIONS.JCF_NA_P48_DRAW_EXCEPTION.text).toBe(EXPECTED_JCF_P48[1]);
    expect(CITATIONS.JCF_NA_P48_PENALTY.article).toBe("JCF NA p.48");
  });

  it("does not contain the superseded pre-2023 'third illegal move' wording", () => {
    for (const c of all) {
      expect(c.text ?? "").not.toMatch(
        /third illegal move|first two illegal moves/
      );
    }
  });

  it.each(Object.entries(EXPECTED_M4_NON_LAWS))(
    "%s (commentary / JCF) is verbatim",
    (key, exp) => {
      const c = CITATIONS[key as keyof typeof CITATIONS];
      expect(c, `citation ${key} missing`).toBeDefined();
      expect(c.text).toBe(exp.text);
      expect(c.page).toBe(exp.page);
    }
  );

  it("Rapid/Blitz time penalties: A.3 says one minute; 9.5.3 says two minutes", () => {
    expect(CITATIONS.FIDE_A_3.text).toContain(
      "one minute instead of two minutes"
    );
    expect(CITATIONS.FIDE_9_5_3.text).toContain("add two minutes");
    expect(CITATIONS.JCF_NA_P88_ONE_MINUTE.text).toContain("1分");
  });

  it("every citation has an article, edition, page and text", () => {
    for (const c of all) {
      expect(c.article).toBeTruthy();
      expect(c.edition).toBeTruthy();
      expect(c.page).toBeGreaterThan(0);
      expect(c.text).toBeTruthy();
    }
  });
});

/**
 * Milestone 7（Round Checklist）で追加した引用。pdfjs-dist の抽出テキストと照合済み
 * （FIDE は改行を半角スペース、JCF は改行を詰めて結合。行頭の箇条書き記号は除く）。
 */
const EXPECTED_M7: Record<string, { page: number; text: string }> = {
  FIDE_6_5: {
    page: 23,
    text: "Before the start of the game the arbiter shall decide where the chessclock is placed.",
  },
  FIDE_6_6: {
    page: 23,
    text: "At the time determined for the start of the game White’s clock is started.",
  },
  FIDE_6_7_1: {
    page: 23,
    text: "The regulations of an event shall specify a default time in advance. If the default time is not specified, then it is zero. Any player who arrives at the chessboard after the default time shall lose the game unless the arbiter decides otherwise.",
  },
  FIDE_11_3_2: {
    page: 35,
    text: "During a game, a player is forbidden to have any electronic device not specifically approved by the arbiter in the playing venue.",
  },
  MANUAL_6_6_CHECK_CLOCKS_STARTED: {
    page: 23,
    text: "In general, in tournaments with many players the arbiter announces the start of the round and states that White’s clock is started. The arbiter then goes round the room checking that White’s clock has been started on all boards.",
  },
  MANUAL_DUTIES_A_B: {
    page: 3,
    text: "The whole playing venue (playing hall, toilets, smoking area, analysis room, bar) and the technical conditions (light, ventilation, air‐conditioning, enough space for the players, etc.) must be checked carefully before the arrival of players or spectators.",
  },
  MANUAL_DUTIES_A_C: {
    page: 3,
    text: "Checks of the equipment (chessboards, pieces, score sheets, pens) carried out.",
  },
  MANUAL_DUTIES_A_D: {
    page: 3,
    text: "Tables, chairs, ropes for the playing area, name plates for the players and flags of federations, if needed, or table numbers arranged.",
  },
  MANUAL_DUTIES_A_E: {
    page: 3,
    text: "The correct setting of the time control, condition of batteries and the correct placement of the clocks are checked.",
  },
  MANUAL_DUTIES_A_F: {
    page: 3,
    text: "For team competitions it is very important that, before the start of the games, team compositions follow the basic list of players and conditions on board order are confirmed.",
  },
  MANUAL_DUTIES_B_A: {
    page: 3,
    text: "Note the unplayed games (if players didn’t arrive on time for their games and have to be forfeited) and inform the Chief Arbiter.",
  },
  MANUAL_DUTIES_B_B: {
    page: 3,
    text: "Regularly check the electronic clocks by using the time control sheets (every thirty minutes, or as directed by the Chief Arbiter), the score sheets and the number of moves written.",
  },
  MANUAL_DUTIES_B_C: {
    page: 3,
    text: "Discrete control of the players, note if leaving the playing area for an unusual number of times, for their contact with other players, spectators and other persons,",
  },
  MANUAL_DUTIES_B_D: {
    page: 3,
    text: "Observe all the games, especially when there is time trouble, with the help of an assistant, if needed.",
  },
  MANUAL_DUTIES_B_F: {
    page: 3,
    text: "At the end of the game check the recorded result by both players and check if the score sheets have been signed by both players.",
  },
  MANUAL_DUTIES_B_G: {
    page: 3,
    text: "Update the results sheet by recording the result of every finished game.",
  },
  MANUAL_DUTIES_C_A: {
    page: 4,
    text: "Thorough check of the results of all the games, by counterchecking of the score sheets and the results sheet or the game protocols (in team events) and forward it to the Chief Arbiter.",
  },
  MANUAL_DUTIES_C_B: {
    page: 4,
    text: "Arrangement of all chess boards and the other equipment (pieces, score sheets, pens, clocks), to be ready for the next round.",
  },
  JCF_NA_P11_B_VENUE: {
    page: 11,
    text: "b: 対局会場全体の環境(対局エリア、検討室、喫煙エリア、照明、換気など)はプレーヤー・観戦者到着前に十全なチェック",
  },
  JCF_NA_P11_C_EQUIPMENT: {
    page: 11,
    text: "c: チェス盤/駒、棋譜用紙、時計などのチェック",
  },
  JCF_NA_P11_D_TABLES: {
    page: 11,
    text: "d: テーブル、椅子、プレーヤーの名札、テーブル番号などの配置チェック",
  },
  JCF_NA_P11_E_CLOCKS: {
    page: 11,
    text: "e: 正しいタイムコントロール設定、バッテリー状態、時計の正しい配置チェック",
  },
  JCF_NA_P11_F_FBO: {
    page: 11,
    text: "f: (チーム戦の場合)チームの構成がFBO(Fixed Board Order)に従い、ボードの順序に間違いがないかチェック",
  },
  JCF_NA_P11_G_UNPLAYED: {
    page: 11,
    text: "g: プレーされない対局(遅刻でDefaultなど)の記録及び報告",
  },
  JCF_NA_P11_H_CLOCK_CHECK: {
    page: 11,
    text: "h: チェスクロックと手数の進捗の定期的な確認（追加棋譜用紙手配や、時間が落ちそうになっているボードに張り付くなどの判断のため）",
  },
  JCF_NA_P12_I_LEAVING: {
    page: 12,
    text: "i: プレーヤーが対局エリアを高頻度で離れる場合や他のプレーヤー/観戦者との接触がある場合に注意を払う(不正リスクの観点)",
  },
  JCF_NA_P12_J_TIME_TROUBLE: {
    page: 12,
    text: "j: 時間切迫の場合にすべてのゲームの観察(必要に応じて人員を投入してでも)",
  },
  JCF_NA_P12_L_SIGNATURES: {
    page: 12,
    text: "l: 対局終了時に両者のサインがなされているか確認",
  },
  JCF_NA_P12_M_RESULTS: {
    page: 12,
    text: "m: 終了したゲームの結果確認/更新",
  },
  JCF_NA_P12_N_CROSSCHECK: {
    page: 12,
    text: "n: 棋譜用紙と結果の徹底的な確認→CAへ報告",
  },
  JCF_NA_P12_O_EQUIPMENT: {
    page: 12,
    text: "o: ラウンド前に機材(チェス盤/駒、時計、棋譜用紙など)の配置。",
  },
};

describe("Round checklist citations (Milestone 7)", () => {
  it.each(Object.entries(EXPECTED_M7))("%s is verbatim", (key, exp) => {
    const c = CITATIONS[key as keyof typeof CITATIONS];
    expect(c, `citation ${key} missing`).toBeDefined();
    expect(c.text).toBe(exp.text);
    expect(c.page).toBe(exp.page);
  });

  it("FIDE 6.5 / 6.6 / 6.7.1 / 11.3.2 are Laws 2023 articles", () => {
    for (const k of [
      "FIDE_6_5",
      "FIDE_6_6",
      "FIDE_6_7_1",
      "FIDE_11_3_2",
    ] as const) {
      expect(CITATIONS[k].source).toBe("FIDE");
      expect(CITATIONS[k].edition).toBe("FIDE Laws of Chess 2023");
    }
  });
});

/**
 * J1b-5（DT-005 Draw Claim / DT-006 Automatic Draw）で追加した引用。pdfjs-dist の抽出テキストと
 * 照合済み（FIDE は改行を半角スペース、JCF は行頭の箇条書き記号「・」を除く）。
 */
const EXPECTED_J1B5: Record<string, { page: number; text: string }> = {
  FIDE_9_3: {
    page: 33,
    text: "The game is drawn, upon a correct claim by a player having the move, if: 9.3.1 he/she indicates his/her move, which cannot be changed, by writing it on the paper scoresheet or entering it on the electronic scoresheet and declares to the arbiter his/her intention to make this move which will result in the last 50 moves by each player having been made without the movement of any pawn and without any capture, or 9.3.2 the last 50 moves by each player have been completed without the movement of any pawn and without any capture.",
  },
  FIDE_11_12: {
    page: 37,
    text: "Checking a ‘three times occurrence of the position’ or a ’50 moves’ claim is a duty of the players, under supervision of the arbiter.",
  },
  JCF_NA_P67_OWN_MOVE: {
    page: 67,
    text: "前提: 自分の手番であること",
  },
  JCF_NA_P67_CLAIM_LATER: {
    page: 67,
    text: "三回同一局面のケースは4回目でも主張可能。50手ルールは51手目以降でも主張可能",
  },
};

describe("Draw claim citations (J1b-5)", () => {
  it.each(Object.entries(EXPECTED_J1B5))("%s is verbatim", (key, exp) => {
    const c = CITATIONS[key as keyof typeof CITATIONS];
    expect(c, `citation ${key} missing`).toBeDefined();
    expect(c.text).toBe(exp.text);
    expect(c.page).toBe(exp.page);
  });

  it("FIDE 9.3 and 11.12 are Laws 2023 articles", () => {
    for (const k of ["FIDE_9_3", "FIDE_11_12"] as const) {
      expect(CITATIONS[k].source).toBe("FIDE");
      expect(CITATIONS[k].edition).toBe("FIDE Laws of Chess 2023");
    }
  });
});

/**
 * J1b-6（DT-007 Touch Move）で追加した引用。pdfjs-dist の抽出テキストと照合済み
 * （FIDE は改行を半角スペース、JCF は改行を詰めて結合）。FIDE 12.9 は印刷ページ 39。
 */
const EXPECTED_J1B6: Record<string, { page: number; text: string }> = {
  FIDE_4_2_1: {
    page: 16,
    text: "Only the player having the move may adjust one or more pieces on their squares, provided that he/she first expresses his/her intention (for example by saying “j’adoube” or “I adjust”).",
  },
  FIDE_4_2_2: {
    page: 16,
    text: "Any other physical contact with a piece, except for clearly accidental contact, shall be considered to be intent.",
  },
  FIDE_4_4: {
    page: 17,
    text: "If a player having the move: 4.4.1 touches his/her king and a rook he/she must castle on that side if it is legal to do so 4.4.2 deliberately touches a rook and then his/her king he/she is not allowed to castle on that side on that move and the situation shall be governed by Article 4.3.1. 4.4.3 intending to castle, touches the king and then a rook, but castling with this rook is illegal, the player must make another legal move with his/her king (which may include castling with the other rook). If the king has no legal move, the player is free to make any legal move. 4.4.4 promotes a pawn, the choice of the piece is finalised when the piece has touched the square of promotion.",
  },
  FIDE_4_5: {
    page: 17,
    text: "If none of the pieces touched in accordance with Article 4.3 or Article 4.4 can be moved or captured, the player may make any legal move.",
  },
  FIDE_4_8: {
    page: 18,
    text: "A player forfeits his/her right to claim against his/her opponent’s violation of Articles 4.1 – 4.7 once the player touches a piece with the intention of moving or capturing it.",
  },
  FIDE_12_9: {
    page: 39,
    text: "Options available to the arbiter concerning penalties: 12.9.1 warning, 12.9.2 increasing the remaining time of the opponent, 12.9.3 reducing the remaining time of the offending player, 12.9.4 increasing the points scored in the game by the opponent to the maximum available for that game, 12.9.5 reducing the points scored in the game by the offending person, 12.9.6 declaring the game to be lost by the offending player (the arbiter shall also decide the opponent’s score), 12.9.7 a fine announced in advance, 12.9.8 exclusion from one or more rounds, 12.9.9 expulsion from the competition.",
  },
  MANUAL_4_2_1_DISPLACED: {
    page: 16,
    text: "Article 4.2.1 may only be used to correct displaced pieces. If the opponent is not present then an arbiter, if present, should be informed before any adjustment takes place. The player should always announce his/her intention to adjust a piece. If he/she does not do this then the normal touch move rules apply (see 4.3).",
  },
  MANUAL_4_ACCIDENTAL: {
    page: 16,
    text: "The accidental touch doesn’t imply a psychological analysis of the player’s intentions.",
  },
  MANUAL_4_4_2_ROOK_FIRST: {
    page: 17,
    text: "In this case the player must move his/her rook, if possible. If no rook move is possible, he/she should move his/her king. (Article 4.3.1)",
  },
  JCF_NA_P20_RELEASED: {
    page: 20,
    text: "※2 e4でポーンを離したあと、時計を押す前にe3に変更することもタッチアンドムーブ違反(e4着手が成立)。",
  },
  JCF_NA_P20_WARNING: {
    page: 20,
    text: "①白が時計を押す前にアービターが上記状況に気付いた場合、または、相手が気付いてアービターを呼んだ場合。⇒白にタッチアンドムーブワーニング。e4で再開。（時間加算/減算なしが一般的）",
  },
  JCF_NA_P20_CLOCK_PRESSED: {
    page: 20,
    text: "②上記状況で白が時計を押していた場合⇒白にタッチアンドムーブワーニング。時計を押してしまっているため、相手に時間加算。e4で再開。",
  },
  JCF_NA_P20_THIRD: {
    page: 20,
    text: "※大会によって異なるが、タッチアンドムーブ違反は3回目で失格となる場合がある",
  },
};

describe("Touch move citations (J1b-6)", () => {
  it.each(Object.entries(EXPECTED_J1B6))("%s is verbatim", (key, exp) => {
    const c = CITATIONS[key as keyof typeof CITATIONS];
    expect(c, `citation ${key} missing`).toBeDefined();
    expect(c.text).toBe(exp.text);
    expect(c.page).toBe(exp.page);
  });
});
