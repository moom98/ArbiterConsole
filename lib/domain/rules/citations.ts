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

  // ---- FIDE Arbiters' Manual guidance (解説) ----
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
} as const satisfies Record<string, RuleCitation>;

export type CitationKey = keyof typeof CITATIONS;

/** カタログから引用を取り出す（呼び出し側での変更が共有オブジェクトに波及しないようコピーを返す） */
export function cite(...keys: CitationKey[]): RuleCitation[] {
  return keys.map((k) => ({ ...CITATIONS[k] }));
}
