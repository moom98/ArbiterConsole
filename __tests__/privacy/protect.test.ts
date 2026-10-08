import { describe, it, expect } from "vitest";
import {
  MINIMIZATION_LIMITS,
  NO_IDENTIFIERS,
  PlaceholderMap,
  isPlaceholderOnly,
  minimizeNarrative,
  protectIncidentText,
  redactPii,
  reidentify,
  residualCheck,
  truncate,
  type KnownIdentifiers,
} from "@/lib/domain/privacy";

const IDS: KnownIdentifiers = {
  players: [{ name: "田中 太郎", fideId: "12345678" }, { name: "佐藤花子" }],
  tournaments: ["東京春季オープン"],
  venues: [],
  officials: [],
};

describe("residual check (§5.4, independent detectors)", () => {
  it.each([
    [
      "registered-identifier",
      "たなかが違法手",
      { players: [{ name: "タナカ" }] },
    ],
    ["registered-identifier", "佐藤が指摘", IDS],
    ["digits", "選手 123 が違法手", IDS],
    ["date", "10月8日の対局", IDS],
    ["time", "15:40に違法手", IDS],
    ["time", "3時に違法手", IDS],
    ["board-round", "3回戦で違法手", IDS],
    ["labelled-id", "FIDE 99 の選手", IDS],
    ["latin-title-name", "GM Kasparov", IDS],
    ["contact", "a@example.com", IDS],
  ])("%s: %s", (finding, text, ids) => {
    const full: KnownIdentifiers = { ...NO_IDENTIFIERS, ...ids };
    const r = residualCheck(text, full);
    expect(r.ok).toBe(false);
    expect(r.findings).toContain(finding);
  });

  it("passes counts, durations and clock readings", () => {
    for (const text of [
      "150手の対局",
      "120分の持ち時間",
      "2回目の違法手",
      "残り1:05で時間切れ",
      "時計の表示 0:00",
      "100手目でクレーム",
    ])
      expect(residualCheck(text, IDS).ok, text).toBe(true);
  });

  it("ignores text inside placeholders", () => {
    expect(residualCheck("〈選手A〉が〈日時1〉に違法手", IDS).ok).toBe(true);
  });

  it("needs 8 characters outside placeholders for classify / facts", () => {
    const r = residualCheck("〈選手A〉が違法手", IDS, { minNarrativeChars: 8 });
    expect(r.findings).toEqual(["too-short"]);
  });
});

describe("minimization (§5.3)", () => {
  it("drops sentences made only of placeholders and connectives", () => {
    expect(isPlaceholderOnly("〈選手A〉と〈選手B〉。")).toBe(true);
    expect(isPlaceholderOnly("〈ラウンド1〉、〈盤1〉")).toBe(true);
    expect(isPlaceholderOnly("〈選手A〉が違法手。")).toBe(false);
    expect(
      minimizeNarrative("〈選手A〉と〈選手B〉。〈選手A〉が違法手を指した。")
    ).toBe("〈選手A〉が違法手を指した。");
  });

  it("truncates to the limit without cutting a placeholder", () => {
    expect(truncate("あいう〈選手A〉", 5)).toBe("あいう");
    expect(minimizeNarrative("違".repeat(600)).length).toBe(
      MINIMIZATION_LIMITS.narrative
    );
  });
});

describe("re-identification (§6.2)", () => {
  it("restores the originals for display", () => {
    const map = new PlaceholderMap();
    const sent = redactPii("田中太郎が10月8日に違法手", IDS, map).text;
    expect(sent).toBe("〈選手A〉が〈日時1〉に違法手");
    const back = reidentify(`${sent}。〈選手A〉に警告`, map);
    expect(back).toEqual({
      // 登録済みの名前は登録された表記に戻す（姓だけの言及も同じプレースホルダー）
      text: "田中 太郎が10月8日に違法手。田中 太郎に警告",
      unknownPlaceholders: [],
    });
  });

  it("leaves an unknown placeholder as it is and reports it", () => {
    const map = new PlaceholderMap();
    redactPii("田中太郎が違法手", IDS, map);
    expect(reidentify("〈選手A〉と〈選手Z〉", map)).toEqual({
      text: "田中 太郎と〈選手Z〉",
      unknownPlaceholders: ["〈選手Z〉"],
    });
  });
});

describe("protectIncidentText (§3 steps A–E)", () => {
  const run = (text: string, extra: object = {}) =>
    protectIncidentText({
      route: "classify",
      text,
      identifiers: IDS,
      map: new PlaceholderMap(),
      ...extra,
    });

  it("returns the de-identified, minimized narrative when everything is clear", () => {
    expect(run("田中太郎が違法手を指して時計を押した。")).toEqual({
      ok: true,
      text: "〈選手A〉が違法手を指して時計を押した。",
    });
  });

  it("A: stops on the raw text (sensitive) before redaction", () => {
    const r = run("田中太郎が体調不良を訴えた");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("gate-raw");
      expect(r.gate.verdict).toBe("blocked");
    }
  });

  it("A: fair-play category is blocked whatever the text", () => {
    const r = run("時計を押した", { category: "fair-play" });
    expect(!r.ok && r.stage).toBe("gate-raw");
  });

  it("D: a failed residual check goes to the local fallback (uncertain)", () => {
    const r = run("佐藤が違法手を指して時計を押した。");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("residual");
      expect(r.gate.verdict).toBe("uncertain");
      expect(r.residual).toContain("registered-identifier");
    }
  });

  it("D: too short after redaction for classify", () => {
    const r = run("田中太郎。");
    expect(!r.ok && r.stage).toBe("residual");
  });

  it("the reason description has no minimum length", () => {
    const r = protectIncidentText({
      route: "reason-description",
      text: "",
      identifiers: IDS,
      map: new PlaceholderMap(),
    });
    expect(r).toEqual({ ok: true, text: "" });
  });

  it("over the raw input limit is uncertain (not silently truncated)", () => {
    const r = run("白が違法手を指した。".repeat(250));
    expect(!r.ok && r.gate.reasons.map((x) => x.code)).toContain("too-long");
  });

  it("never returns the original text when it stops", () => {
    const r = run("田中太郎が救急車で運ばれた");
    expect(JSON.stringify(r)).not.toContain("田中");
  });
});
