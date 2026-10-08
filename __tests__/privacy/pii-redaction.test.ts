import { describe, it, expect } from "vitest";
import pii from "../fixtures/privacy/pii.ja.json";
import {
  NO_IDENTIFIERS,
  PlaceholderMap,
  protectIncidentText,
  redactPii,
  residualCheck,
  type KnownIdentifiers,
} from "@/lib/domain/privacy";

const IDS: KnownIdentifiers = pii.identifiers;
const redact = (text: string, ids: KnownIdentifiers = IDS) =>
  redactPii(text, ids, new PlaceholderMap()).text;

describe("PII redaction (external-ai-data-protection §5.2)", () => {
  describe("each rule", () => {
    it.each([
      ["1 contact", "電話090-1234-5678まで", "〈連絡先1〉"],
      ["1 email", "a.b@example.com に送る", "〈連絡先1〉"],
      ["2 ISO date", "2026-10-08 の対局", "〈日時1〉"],
      ["2 kanji date", "十月八日の対局", "〈日時1〉"],
      ["2 weekday", "土曜日の対局", "〈日時1〉"],
      ["3 time", "14時30分頃に違法手", "〈日時1〉"],
      ["3 H:MM", "15:40に違法手", "〈日時1〉"],
      ["4 registered", "田中太郎が違法手", "〈選手A〉"],
      ["4 FIDE id", "12345678の選手", "〈ID1〉"],
      ["5 labelled id", "会員番号: A12345", "〈ID1〉"],
      ["6 tournament", "第12回市民選手権で", "〈大会1〉"],
      ["7 school", "北高校の選手", "〈団体1〉"],
      ["8 board", "5番ボードで", "〈盤1〉"],
      ["8 round", "第3ラウンドで", "〈ラウンド1〉"],
      ["9 long number", "選手 77821 が", "〈ID1〉"],
      ["10 four digits", "レーティング1850", "〈数値1〉"],
      ["11 age", "12歳の選手", "〈属性1〉"],
      ["12 honorific", "中村さんが違法手", "〈人物1〉"],
      ["13 Latin name", "John Smith claimed", "〈人物1〉"],
    ])("%s", (_rule, text, placeholder) => {
      expect(redact(text)).toContain(placeholder);
    });
  });

  it("applies the rules in order (a phone number or an ISO date is never split)", () => {
    expect(redact("090-1234-5678")).toBe("〈連絡先1〉");
    expect(redact("2026-10-08")).toBe("〈日時1〉");
    expect(redact("2026年10月8日")).toBe("〈日時1〉");
  });

  it("is idempotent and never changes text inside placeholders", () => {
    for (const c of pii.cases) {
      const map = new PlaceholderMap();
      const once = redactPii(c.text, IDS, map).text;
      expect(redactPii(once, IDS, map).text, c.text).toBe(once);
    }
    expect(redact("〈選手A〉と〈日時1〉の 2026-10-08")).toBe(
      "〈選手A〉と〈日時1〉の 〈日時2〉"
    );
  });

  it("indexes placeholders per request: same original, same placeholder", () => {
    const map = new PlaceholderMap();
    const a = redactPii("田中太郎が違法手", IDS, map).text;
    const b = redactPii("相手は田中 太郎。佐藤花子が指摘", IDS, map).text;
    expect(a).toBe("〈選手A〉が違法手");
    expect(b).toBe("相手は〈選手A〉。〈選手B〉が指摘");
    // 姓だけでも同じ人のプレースホルダー
    expect(redactPii("田中が抗議", IDS, map).text).toBe("〈選手A〉が抗議");
  });

  it("names from ad-hoc games and katakana / hiragana / half-width variants", () => {
    expect(redact("渡辺さくらが投了")).toBe("〈選手A〉が投了");
    expect(redact("やまだはなが違法手")).toBe("〈選手A〉が違法手");
    expect(redact("ﾔﾏﾀﾞ ﾊﾅのフラッグ")).toBe("〈選手A〉のフラッグ");
  });

  it("keeps clock readings, durations, counts, colours and chess notation (§5.2.1)", () => {
    for (const k of pii.keep) expect(redact(k.text), k.text).toContain(k.kept);
  });

  it("does not treat role nouns before an honorific as names", () => {
    for (const text of [
      "相手選手が抗議",
      "両選手が署名",
      "当該選手のフラッグ",
      "違反選手に警告",
      "白番選手が投了",
    ])
      expect(redact(text), text).toBe(text);
  });

  it("does not take 様子 / 氏名 / 選手権 as honorifics", () => {
    expect(redact("白の様子がおかしい")).toBe("白の様子がおかしい");
    expect(redact("氏名を記入")).toBe("氏名を記入");
  });

  it("a title followed by a Latin name replaces both", () => {
    expect(redact("IM Smithが遅刻")).toBe("〈属性1〉 〈人物1〉が遅刻");
  });

  describe("regulation mode (§5.5): only rules 1, 4, 5 and 12", () => {
    const text =
      "1600以下、12歳以下。第3ラウンドは10月8日14時開始。田中太郎(会員番号 A12345)、中村さん、問合せ 03-1111-2222";
    const out = redactPii(text, IDS, new PlaceholderMap(), "regulation").text;

    it("keeps ratings, ages, rounds, dates and times", () => {
      for (const kept of [
        "1600以下",
        "12歳以下",
        "第3ラウンド",
        "10月8日",
        "14時",
      ])
        expect(out).toContain(kept);
    });

    it("replaces contacts, registered names, labelled ids and honorific names", () => {
      for (const gone of ["田中", "A12345", "中村", "03-1111-2222"])
        expect(out).not.toContain(gone);
    });
  });

  describe("review fixes (J1a-1 review 1)", () => {
    it("text inside a non-placeholder 〈…〉 is redacted and checked (M3)", () => {
      expect(redact("〈田中太郎〉が違法手を指した")).toBe(
        "「〈選手A〉」が違法手を指した"
      );
      expect(redact("相手の〈中村健司〉さん")).toBe("相手の「〈人物1〉」さん");
      // U+2329 は NFKC で〈になる
      expect(redact("\u2329田中太郎\u232a")).toBe("「〈選手A〉」");
      expect(residualCheck("〈中村〉が違法手", IDS).ok).toBe(true);
      expect(residualCheck("〈佐藤〉が違法手", IDS).ok).toBe(false);
    });

    it("a single-kanji surname of a registered player, outside longer kanji words", () => {
      expect(redact("林が違法手を指した")).toBe("〈選手A〉が違法手を指した");
      expect(redact("白の林、黒の高橋で対局中")).toBe(
        // 番号は一致した順（長い名前から）。位置の順ではない
        "白の〈選手B〉、黒の〈選手A〉で対局中"
      );
      expect(redact("林檎を持っていた")).toBe("林檎を持っていた");
      expect(residualCheck("白の林が投了", IDS).ok).toBe(false);
    });

    it("round written noun first, kanji-numeral times, partial dates, eras", () => {
      expect(redact("ボード12で違法手、ラウンド5")).toBe(
        "〈盤1〉で違法手、〈ラウンド1〉"
      );
      expect(redact("十四時ごろ違法手")).toBe("〈日時1〉ごろ違法手");
      expect(redact("午後三時に違法手")).toBe("〈日時1〉に違法手");
      expect(redact("一時停止した")).toBe("一時停止した");
      expect(redact("8日の対局")).toBe("〈日時1〉の対局");
      expect(redact("3日目の対局")).toBe("3日目の対局");
      expect(redact("2026年10月の大会")).toBe("〈日時1〉の大会");
      expect(redact("令和8年")).toBe("〈日時1〉");
      expect(residualCheck("ラウンド5で違法手", IDS).ok).toBe(false);
      expect(residualCheck("午後三時に違法手", IDS).ok).toBe(false);
    });

    it("school years, LINE ID", () => {
      expect(redact("小6の選手")).toBe("〈属性1〉の選手");
      expect(redact("中2の生徒")).toBe("〈属性1〉の生徒");
      expect(redact("LINE ID: tanaka_t")).not.toContain("tanaka_t");
    });

    it("a wall-clock time next to 白 / 黒 / フラッグ is redacted (only up to 2:59 is a clock reading)", () => {
      for (const text of [
        "黒は13:05に到着した",
        "白は14:30に会場に来たので遅刻ではない",
        "白番 14:30 開始で黒が遅刻した",
        "フラッグ 18:45 で白が時間切れ",
      ]) {
        const out = redact(text);
        expect(out, text).toContain("〈日時1〉");
        expect(residualCheck(text, IDS).ok, text).toBe(false);
      }
    });

    it("a wall-clock time after 時計 followed by に/から/頃 is redacted (review 3, M2)", () => {
      for (const text of ["時計を14:20に止めた", "時計は13:05に交換した"]) {
        expect(redact(text), text).toContain("〈日時1〉");
        expect(residualCheck(text, IDS).ok, text).toBe(false);
      }
      expect(redact("表示は1:05のまま")).toBe("表示は1:05のまま");
      expect(redact("残り13:05")).toBe("残り13:05");
    });

    it("a kanji numeral inside a word is not a round or board number (同一局面)", () => {
      expect(redact("同一局面が3回目")).toBe("同一局面が3回目");
      expect(redact("第一局で違法手")).toBe("〈ラウンド1〉で違法手");
      expect(redact("十番盤で違法手")).toBe("〈盤1〉で違法手");
    });

    it("a registered one-character name", () => {
      const ids: KnownIdentifiers = {
        ...NO_IDENTIFIERS,
        players: [{ name: "林" }],
      };
      expect(redactPii("林が違法手", ids, new PlaceholderMap()).text).toBe(
        "〈選手A〉が違法手"
      );
      expect(residualCheck("林が違法手", ids).ok).toBe(false);
    });

    it("text shaped like a placeholder but not one is processed as text", () => {
      expect(redact("〈選手TANAKA〉が違法手")).not.toContain("〈選手TANAKA〉");
      expect(redact("〈人物090〉が違法手")).not.toContain("〈人物090〉");
    });

    it("single-kanji given names are not matched; a surname not before a verb ending", () => {
      const ids: KnownIdentifiers = {
        ...NO_IDENTIFIERS,
        players: [{ name: "田中 勝" }, { name: "王 偉" }],
      };
      expect(redactPii("1-0で白の勝ち", ids, new PlaceholderMap()).text).toBe(
        "1-0で白の勝ち"
      );
      expect(redactPii("王が違法手", ids, new PlaceholderMap()).text).toBe(
        "〈選手A〉が違法手"
      );
    });

    it("keeps clock readings next to 白 / 黒 / フラッグ", () => {
      expect(redact("白の時計は0:45、黒は1:20のときにフラッグ")).toBe(
        "白の時計は0:45、黒は1:20のときにフラッグ"
      );
      expect(redact("白 0:00 黒 0:12 でフラッグ")).toBe(
        "白 0:00 黒 0:12 でフラッグ"
      );
      expect(residualCheck("白 0:00 黒 0:12 でフラッグ", IDS).ok).toBe(true);
    });

    it("keeps a leading role noun, 1局目, and rule terms in English", () => {
      expect(redact("黒番中村さんが違法手")).toBe("黒番〈人物1〉さんが違法手");
      expect(redact("1局目と2局目")).toBe("1局目と2局目");
      expect(redact("Threefold Repetition claimed")).toBe(
        "Threefold Repetition claimed"
      );
    });
  });

  it("the map is never serialized (JSON gives an empty object)", () => {
    const map = new PlaceholderMap();
    redactPii("田中太郎が違法手", IDS, map);
    expect(map.size).toBe(1);
    expect(JSON.stringify({ map })).toBe('{"map":{}}');
  });

  it("works with no registered identifiers", () => {
    expect(redact("田中太郎が違法手", NO_IDENTIFIERS)).toBe("田中太郎が違法手");
    expect(residualCheck("田中太郎が違法手", NO_IDENTIFIERS).ok).toBe(true);
  });
});

/**
 * PII の評価（§8.2。リリースの条件）: 置き換え + 残存チェックを通って送られる本文に、
 * 対象の識別子が残っていないこと。既知の残存リスク（敬称なしの未登録の名前・ローマ字・
 * 漢字で登録した名前の読み）は別に数える。
 */
describe("PII evaluation (release gate)", () => {
  const results = pii.cases.map((c) => {
    const redacted = redactPii(c.text, IDS, new PlaceholderMap()).text;
    const sent = residualCheck(redacted, IDS).ok;
    const norm = (s: string) => s.normalize("NFKC").toLowerCase();
    const left = c.mustNotContain.filter((m) =>
      norm(redacted).includes(norm(m))
    );
    return {
      text: c.text,
      risk: (c as { residualRisk?: string }).residualRisk,
      sent,
      left,
    };
  });

  it("has at least 100 synthetic reports", () => {
    expect(pii.cases.length).toBeGreaterThanOrEqual(100);
  });

  it("0 identifiers left in a payload that would be sent (covered types)", () => {
    const leaks = results.filter((r) => !r.risk && r.sent && r.left.length > 0);
    expect(leaks).toEqual([]);
  });

  it("covered identifiers are already removed by the redaction (the residual check is only a backstop)", () => {
    const missed = results.filter((r) => !r.risk && r.left.length > 0);
    expect(missed).toEqual([]);
  });

  it("the known residual risks are stopped by the known-vocabulary layer (never sent)", () => {
    for (const c of pii.cases.filter(
      (x) => (x as { residualRisk?: string }).residualRisk
    )) {
      const r = protectIncidentText({
        route: "classify",
        text: c.text,
        identifiers: IDS,
        map: new PlaceholderMap(),
      });
      expect(r.ok, c.text).toBe(false);
    }
  });

  it("reports the known residual risks separately", () => {
    const risky = results.filter((r) => r.risk);
    expect(risky.length).toBeGreaterThan(0);
    // 既知の残存リスク: ここで件数を記録する（減らすのは改善、増えるのは要確認）
    const leaked = risky.filter((r) => r.sent && r.left.length > 0);
    expect(leaked.map((r) => r.risk).sort()).toEqual([
      "reading",
      "reading",
      "unregistered-no-honorific",
      "unregistered-no-honorific",
      "unregistered-no-honorific",
    ]);
  });
});
