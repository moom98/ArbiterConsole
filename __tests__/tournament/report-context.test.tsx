import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import ReportPage from "@/app/(tabs)/report/page";
import { db } from "@/lib/infrastructure/db";
import { useTournamentStore } from "@/lib/stores/tournament-store";
import { profileInput } from "./fixtures";

async function clearDb() {
  await Promise.all(db.tables.map((t) => t.clear()));
  useTournamentStore.setState({
    active: null,
    tournaments: [],
    rounds: [],
    loaded: false,
  });
}

async function seedTournament() {
  const { service } = useTournamentStore.getState();
  const t = await service.saveTournamentProfile(
    profileInput({
      name: "秋季ブリッツ",
      competitionType: "blitz",
      supervisionRegime: "competition-rules",
      timeControl: { initialMinutes: 3, incrementSeconds: 2 },
      blitzCompetitionTimePenalty: {
        seconds: 60,
        source: { document: "秋季ブリッツ要項", article: "第7条" },
      },
    })
  );
  await service.createRoundWithBoards(t.id, 1, { from: 1, to: 3 });
  const { round } = await service.createRoundWithBoards(t.id, 2, {
    from: 1,
    to: 5,
  });
  await service.changeRoundStatus(round.id, "active");
  await service.assignPlayers(`${t.id}:r2:b4`, {
    white: "山田",
    black: "佐藤",
  });
  return t;
}

describe("Report page — game context from the active tournament", () => {
  beforeEach(clearDb);
  afterEach(cleanup);

  it("picks the current round's board in one tap and reports against the tournament game", async () => {
    const t = await seedTournament();
    render(<ReportPage />);

    // 大会の規則セット（明示）と今のラウンドが表示される
    expect(await screen.findByText("秋季ブリッツ")).toBeTruthy();
    expect(screen.getByText(/Blitz · B.2 · 3分\+2秒 · FIDE-2023/)).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /R2/ }).getAttribute("aria-pressed")
      ).toBe("true")
    );

    // 1タップ: ボード4
    fireEvent.click(await screen.findByRole("button", { name: /ボード4/ }));
    expect(await screen.findByText("よく使う判断")).toBeTruthy();
    expect(
      screen.getByText("秋季ブリッツ · R2 · Board 4 · 山田 – 佐藤")
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "三回同一局面のクレーム" })
    );
    await waitFor(async () => expect(await db.incidents.count()).toBe(1));
    const [incident] = await db.incidents.toArray();
    expect(incident.gameId).toBe(`${t.id}:r2:b4`);
    // 暫定大会は作られない
    expect(
      (await db.tournaments.toArray()).filter((x) => x.id.startsWith("adhoc:"))
    ).toEqual([]);
  });

  it("a tournament without rounds selects no round and shows no boards", async () => {
    const { service } = useTournamentStore.getState();
    await service.saveTournamentProfile(
      profileInput({ name: "ラウンド未作成" })
    );
    render(<ReportPage />);
    expect(await screen.findByText("ラウンド未作成")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ボード\d/ })).toBeNull();
  });

  it("changing the round is the second tap", async () => {
    const t = await seedTournament();
    render(<ReportPage />);
    // 今のラウンド（R2）が選ばれた後に R1 へ切り替える
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /R2/ }).getAttribute("aria-pressed")
      ).toBe("true")
    );
    fireEvent.click(screen.getByRole("button", { name: /R1/ }));
    fireEvent.click(await screen.findByRole("button", { name: /ボード3/ }));
    expect(await screen.findByText(/R1 · Board 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "75手ルール" }));
    await waitFor(async () => expect(await db.incidents.count()).toBe(1));
    expect((await db.incidents.toArray())[0].gameId).toBe(`${t.id}:r1:b3`);
  });

  it("creates a missing board from the 'other board' input", async () => {
    const t = await seedTournament();
    render(<ReportPage />);
    // 今のラウンド（R2）が選択されるまで待つ
    await screen.findByRole("button", { name: /ボード4/ });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "その他のボード（番号を入力）",
      })
    );
    const [, board] = screen.getAllByRole("spinbutton");
    fireEvent.change(board, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "この対局で報告" }));
    expect(await screen.findByText(/R2 · Board 12/)).toBeTruthy();
    expect(await db.games.get(`${t.id}:r2:b12`)).toBeDefined();
  });

  it("falls back to the ad-hoc context when no tournament exists", async () => {
    render(<ReportPage />);
    expect(await screen.findByText("対局を指定してください")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "この対局で報告",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("blocks board selection when the tournament ruleset is incomplete (no defaults)", async () => {
    const t = await seedTournament();
    await db.tournaments.update(t.id, { supervisionRegime: undefined });
    render(<ReportPage />);
    expect(
      await screen.findByText(
        "大会の適用規則（A.4/A.5・B.2/B.3）が設定されていません"
      )
    ).toBeTruthy();
    expect(
      (
        (await screen.findByRole("button", {
          name: /ボード4/,
        })) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("ad-hoc while a tournament is active requires a confirm and shows the history warning", async () => {
    await seedTournament();
    render(<ReportPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "大会を使わずに報告（暫定の対局）",
      })
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "違法手回数・ペナルティ履歴は大会の対局とは別に数えられます"
    );
    fireEvent.click(
      screen.getByRole("button", { name: "暫定の対局で報告する" })
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "暫定の対局で報告します"
    );
    expect(screen.getByText("対局を指定してください")).toBeTruthy();
  });

  it("other board: an empty round is a validation error, not a fallback", async () => {
    await seedTournament();
    render(<ReportPage />);
    await screen.findByRole("button", { name: /ボード4/ });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "その他のボード（番号を入力）",
      })
    );
    const [round, board] = screen.getAllByRole("spinbutton");
    expect((round as HTMLInputElement).value).toBe("2");
    fireEvent.change(round, { target: { value: "" } });
    fireEvent.change(board, { target: { value: "7" } });
    expect(
      screen.getByText("ラウンドは1以上の整数で入力してください")
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "この対局で報告",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("shows a tournament load error with retry instead of silently using ad-hoc", async () => {
    await seedTournament();
    const { service } = useTournamentStore.getState();
    const spy = vi
      .spyOn(service, "listTournaments")
      .mockRejectedValueOnce(new Error("db closed"));
    render(<ReportPage />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "db closed"
    );
    expect(screen.queryByText("対局を指定してください")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByRole("button", { name: /ボード4/ })).toBeTruthy();
    spy.mockRestore();
  });
});
