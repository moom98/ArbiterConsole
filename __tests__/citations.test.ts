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
  "FIDE B.3": {
    page: 42,
    text: "Otherwise, play shall be governed by the Rapid chess Laws as in Article A.2, A.3 and A.5.",
  },
};

const EXPECTED_JCF_P48 = [
  "7.5.5 イリーガルムーブについて、アービターは相手の時計に2分加算。同プレーヤーによる2回目のイリーガルムーブについて、アービターはそのプレーヤーによる対局の敗北を宣言。",
  "※ただし、その局面が相手のあらゆる合法手の組み合わせでプレーヤーのキングをチェックメイトできない局面の場合引き分けとなる。",
];

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

  it("every citation has an article, edition, page and text", () => {
    for (const c of all) {
      expect(c.article).toBeTruthy();
      expect(c.edition).toBeTruthy();
      expect(c.page).toBeGreaterThan(0);
      expect(c.text).toBeTruthy();
    }
  });
});
