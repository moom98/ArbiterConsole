import { describe, it, expect } from "vitest";
import {
  buildTournament,
  formatRulesetSummary,
  toProfileInput,
  TournamentProfileError,
  validateTournamentProfile,
} from "@/lib/domain/services/tournament-profile";
import { deriveRulesetFromTournament } from "@/lib/domain/services/game-context";
import { fixedProviders } from "../helpers";
import { B2_OVERRIDE, profileInput, tournament } from "./fixtures";

describe("Tournament profile validation (§7)", () => {
  it("accepts a complete Standard profile", () => {
    expect(validateTournamentProfile(profileInput())).toEqual([]);
  });

  it("requires every ruleset field explicitly (no defaults)", () => {
    const errors = validateTournamentProfile({ name: "" });
    expect(errors).toEqual(
      expect.arrayContaining([
        "大会名を入力してください",
        "開始日を入力してください",
        "競技区分を選択してください",
        "規則バージョンを選択してください",
        "持ち時間（分）は1以上の整数で入力してください",
        "加算（秒/手）は0以上の整数で入力してください",
      ])
    );
  });

  it.each(["rapid", "blitz"] as const)(
    "%s requires the supervision regime",
    (competitionType) => {
      expect(
        validateTournamentProfile(profileInput({ competitionType }))
      ).toContain("適用規則（A.4/A.5・B.2/B.3）を選択してください");
      expect(
        validateTournamentProfile(
          profileInput({ competitionType, supervisionRegime: "basic-rules" })
        )
      ).toEqual([]);
    }
  );

  it("rejects an end date before the start date", () => {
    expect(
      validateTournamentProfile(
        profileInput({
          startDate: new Date(2026, 9, 10),
          endDate: new Date(2026, 9, 9),
        })
      )
    ).toContain("終了日は開始日以降にしてください");
  });

  it("B.2 override is only allowed for Blitz B.2 and requires amount + source", () => {
    const rapid = profileInput({
      competitionType: "rapid",
      supervisionRegime: "competition-rules",
      blitzCompetitionTimePenalty: {
        seconds: 60,
        source: { document: "要項" },
      },
    });
    expect(validateTournamentProfile(rapid)).toContain(
      "B.2 の加算時間は Blitz・B.2（Competition Rules）の大会でのみ設定できます"
    );

    const blitz = profileInput({
      competitionType: "blitz",
      supervisionRegime: "competition-rules",
      timeControl: { initialMinutes: 3, incrementSeconds: 2 },
    });
    expect(
      validateTournamentProfile({
        ...blitz,
        blitzCompetitionTimePenalty: { seconds: 60 },
      })
    ).toContain("大会規定の加算時間の出典（資料名）を入力してください");
    expect(
      validateTournamentProfile({
        ...blitz,
        blitzCompetitionTimePenalty: { source: { document: "要項" } },
      })
    ).toContain("大会規定の加算時間は1秒以上の整数で入力してください");
    expect(
      validateTournamentProfile({
        ...blitz,
        blitzCompetitionTimePenalty: {
          seconds: 60,
          source: { document: "要項" },
        },
      })
    ).toEqual([]);
  });
});

describe("buildTournament", () => {
  it("creates a tournament with a new id and stores the sourced override", () => {
    const t = buildTournament(
      profileInput({
        name: "  ブリッツ  ",
        competitionType: "blitz",
        supervisionRegime: "competition-rules",
        timeControl: { initialMinutes: 3, incrementSeconds: 2 },
        venue: " ",
        blitzCompetitionTimePenalty: {
          seconds: 120,
          source: { document: " 要項 ", article: "第5条", quote: "" },
        },
      }),
      fixedProviders("t")
    );
    expect(t.id).toBe("t-1");
    expect(t.name).toBe("ブリッツ");
    expect(t.venue).toBeUndefined();
    expect(t.overrides).toEqual({
      blitzCompetitionTimePenaltySeconds: {
        value: 120,
        source: { document: "要項", article: "第5条", quote: undefined },
      },
    });
  });

  it("drops the regime for Standard and keeps id/createdAt on edit", () => {
    const existing = tournament({ id: "keep", regulations: [] });
    const t = buildTournament(
      profileInput({ supervisionRegime: "basic-rules" }),
      fixedProviders(),
      existing
    );
    expect(t.id).toBe("keep");
    expect(t.supervisionRegime).toBeUndefined();
    expect(t.createdAt).toBe(existing.createdAt);
  });

  it("throws TournamentProfileError on invalid input", () => {
    expect(() => buildTournament({ name: "" }, fixedProviders())).toThrow(
      TournamentProfileError
    );
  });

  it("round-trips through toProfileInput", () => {
    const t = tournament({
      competitionType: "blitz",
      supervisionRegime: "competition-rules",
      overrides: { blitzCompetitionTimePenaltySeconds: B2_OVERRIDE },
    });
    const again = buildTournament(toProfileInput(t), fixedProviders(), t);
    expect(again.overrides).toEqual(t.overrides);
    expect(formatRulesetSummary(again)).toBe(
      "Blitz · B.2 · 90分+30秒 · FIDE-2023"
    );
  });
});

describe("deriveRulesetFromTournament (explicit ruleset)", () => {
  it("derives competition type, regime, rules version and overrides from the tournament", () => {
    const r = deriveRulesetFromTournament(
      tournament({
        competitionType: "blitz",
        supervisionRegime: "competition-rules",
        overrides: { blitzCompetitionTimePenaltySeconds: B2_OVERRIDE },
      })
    );
    expect(r).toEqual({
      ok: true,
      ruleset: {
        competitionType: "blitz",
        supervisionRegime: "competition-rules",
        rulesVersion: "FIDE-2023",
        tournamentOverrides: {
          blitzCompetitionTimePenaltySeconds: B2_OVERRIDE,
        },
      },
    });
  });

  it("never fills a missing regime or rules version", () => {
    const r = deriveRulesetFromTournament(
      tournament({
        competitionType: "rapid",
        supervisionRegime: undefined,
        rulesVersion: undefined as never,
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toEqual([
        "大会の適用規則（A.4/A.5・B.2/B.3）が設定されていません",
        "大会の規則バージョンが設定されていません",
      ]);
  });

  it("rejects unsupported rules versions", () => {
    const r = deriveRulesetFromTournament(
      tournament({ rulesVersion: "FIDE-2018" as never })
    );
    expect(r.ok).toBe(false);
  });
});
