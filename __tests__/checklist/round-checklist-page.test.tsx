import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const params: { id: string; round: string } = { id: "", round: "1" };
vi.mock("next/navigation", () => ({
  useParams: () => params,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

import RoundChecklistPage from "@/app/(tabs)/tournament/[id]/rounds/[round]/page";
import TournamentDetailPage from "@/app/(tabs)/tournament/[id]/page";
import HomePage from "@/app/(tabs)/home/page";
import { db } from "@/lib/infrastructure/db";
import { useTournamentStore } from "@/lib/stores/tournament-store";
import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/domain/services/round-checklist";
import type { Incident } from "@/lib/domain/entities";
import { FIXED_NOW } from "../helpers";
import { profileInput } from "../tournament/fixtures";

const PRE = DEFAULT_CHECKLIST_ITEMS.filter((i) => i.phase === "pre");

function pendingIncident(gameId: string): Incident {
  return {
    id: "i-pending",
    gameId,
    category: "illegal-move",
    description: "",
    arbiterObserved: true,
    reportedBy: "arbiter",
    reportedAt: FIXED_NOW,
    status: "pending",
    escalatedToCA: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

async function seed() {
  const { service } = useTournamentStore.getState();
  const t = await service.saveTournamentProfile(profileInput());
  const { round } = await service.createRoundWithBoards(t.id, 1, {
    from: 1,
    to: 4,
  });
  params.id = encodeURIComponent(t.id);
  params.round = "1";
  return { t, round };
}

function progress() {
  return screen.getByTestId("checklist-progress").textContent;
}

describe("Round Checklist page", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    useTournamentStore.setState({
      active: null,
      tournaments: [],
      rounds: [],
      loaded: false,
    });
  });
  afterEach(cleanup);

  it("shows pre-round items for a pending round; checking an item updates progress and persists", async () => {
    const { round } = await seed();
    render(<RoundChecklistPage />);
    expect(
      await screen.findByRole("heading", { name: "Round 1 チェックリスト" })
    ).toBeTruthy();
    expect(screen.getByTestId("round-status").textContent).toBe("開始前");
    expect(progress()).toBe(`0 / ${PRE.length}`);
    expect(screen.getByText("大会設定: 90分+30秒")).toBeTruthy();

    const box = screen.getByRole("checkbox", {
      name: new RegExp(PRE[0].label),
    });
    fireEvent.click(box);
    await waitFor(() => expect(progress()).toBe(`1 / ${PRE.length}`));
    expect((box as HTMLInputElement).checked).toBe(true);
    const stored = await db.roundChecklists.get(round.id);
    expect(stored?.items).toEqual([
      expect.objectContaining({ itemId: PRE[0].id, done: true }),
    ]);

    fireEvent.click(box);
    await waitFor(() => expect(progress()).toBe(`0 / ${PRE.length}`));
  });

  it("saves a per-item note on blur", async () => {
    const { round } = await seed();
    render(<RoundChecklistPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: `${PRE[1].label}のメモ` })
    );
    const input = screen.getByRole("textbox", {
      name: `${PRE[1].label}のメモを入力`,
    });
    fireEvent.change(input, { target: { value: "Board 7 の駒が不足" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Board 7 の駒が不足")).toBeTruthy();
    const stored = await db.roundChecklists.get(round.id);
    expect(stored?.items[0]).toMatchObject({
      itemId: PRE[1].id,
      done: false,
      note: "Board 7 の駒が不足",
    });
  });

  it("shows verbatim sources on demand for rule-derived items", async () => {
    await seed();
    render(<RoundChecklistPage />);
    await screen.findByRole("heading", { name: "Round 1 チェックリスト" });
    expect(screen.getAllByText(/FIDE 6\.5/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "「Before the start of the game the arbiter shall decide where the chessclock is placed.」"
      )
    ).toBeTruthy();
  });

  it("start with incomplete pre-round items warns in-page; confirming starts the round and switches to the during phase", async () => {
    const { round } = await seed();
    render(<RoundChecklistPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "ラウンド開始" })
    );
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(`開始前チェックが${PRE.length}件未完了です`)
    ).toBeTruthy();
    expect((await db.rounds.get(round.id))?.status).toBe("pending");

    // キャンセルでは変更しない
    fireEvent.click(within(alert).getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "ラウンド開始" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "確認して開始する" })
    );
    await waitFor(() =>
      expect(screen.getByTestId("round-status").textContent).toBe("対局中")
    );
    expect((await db.rounds.get(round.id))?.status).toBe("active");
    expect(
      screen.getByRole("heading", { name: "対局中チェック" })
    ).toBeTruthy();
    expect(screen.getByText("開始直後")).toBeTruthy();
    expect(
      screen.getByRole("checkbox", {
        name: /全ボードで白の時計が開始されている/,
      })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "ラウンド終了" })).toBeTruthy();
  });

  it("start without warnings when every pre-round item is checked", async () => {
    const { round } = await seed();
    const { checklist } = useTournamentStore.getState();
    for (const item of PRE) await checklist.setDone(round.id, item.id, true);
    render(<RoundChecklistPage />);
    await waitFor(() =>
      expect(progress()).toBe(`${PRE.length} / ${PRE.length} 完了`)
    );
    fireEvent.click(screen.getByRole("button", { name: "ラウンド開始" }));
    await waitFor(() =>
      expect(screen.getByTestId("round-status").textContent).toBe("対局中")
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("end with a pending incident requires explicit confirmation, then shows the post-round phase", async () => {
    const { t, round } = await seed();
    const { service } = useTournamentStore.getState();
    await service.changeRoundStatus(round.id, "active");
    await db.incidents.add(pendingIncident(`${t.id}:r1:b2`));
    render(<RoundChecklistPage />);
    expect(
      await screen.findByText("このラウンドで保留中のIncident: 1件")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "ラウンド終了" }));
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(/保留中.*Incidentが1件あります/)
    ).toBeTruthy();
    expect(
      within(alert).getByRole("link", { name: "ログで保留中のIncidentを確認" })
    ).toBeTruthy();
    expect((await db.rounds.get(round.id))?.status).toBe("active");

    fireEvent.click(
      within(alert).getByRole("button", { name: "確認して終了する" })
    );
    await waitFor(() =>
      expect(screen.getByTestId("round-status").textContent).toBe("終了")
    );
    expect((await db.rounds.get(round.id))?.status).toBe("completed");
    expect(
      screen.getByRole("heading", { name: "終了時チェック" })
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: /棋譜用紙の回収/ })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /ラウンド(開始|終了)/ })
    ).toBeNull();
  });

  it("can view another phase without changing the round", async () => {
    await seed();
    render(<RoundChecklistPage />);
    fireEvent.click(await screen.findByRole("button", { name: /終了時/ }));
    expect(
      screen.getByRole("heading", { name: "終了時チェック" })
    ).toBeTruthy();
    expect(screen.getByText(/現在のラウンドの状態は「開始前」/)).toBeTruthy();
  });

  it("adds a custom item for the tournament", async () => {
    await seed();
    render(<RoundChecklistPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "項目を編集（この大会）" })
    );
    fireEvent.change(screen.getByRole("textbox", { name: "追加する項目名" }), {
      target: { value: "消毒液の配置" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加" }));
    expect(await screen.findByText("消毒液の配置")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "編集を終了" }));
    expect(
      await screen.findByRole("checkbox", { name: /消毒液の配置/ })
    ).toBeTruthy();
    expect(progress()).toBe(`0 / ${PRE.length + 1}`);
  });

  it("shows not found for a missing round", async () => {
    await seed();
    params.round = "9";
    render(<RoundChecklistPage />);
    expect(await screen.findByText("ラウンドが見つかりません。")).toBeTruthy();
  });
});

describe("Checklist entry points", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    useTournamentStore.setState({
      active: null,
      tournaments: [],
      rounds: [],
      loaded: false,
    });
  });
  afterEach(cleanup);

  it("home: the current round card links to the round checklist", async () => {
    const { t } = await seed();
    render(<HomePage />);
    const link = await screen.findByRole("link", {
      name: "ラウンドチェックリスト",
    });
    expect(link.getAttribute("href")).toBe(
      `/tournament/${encodeURIComponent(t.id)}/rounds/1`
    );
  });

  it("tournament detail: links each round's checklist; start round goes through the same warning", async () => {
    const { t, round } = await seed();
    render(<TournamentDetailPage />);
    expect(
      (
        await screen.findByRole("link", { name: "Round 1 チェックリスト" })
      ).getAttribute("href")
    ).toBe(`/tournament/${encodeURIComponent(t.id)}/rounds/1`);
    fireEvent.click(screen.getByRole("button", { name: "ラウンド開始" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/開始前チェックが/)).toBeTruthy();
    expect((await db.rounds.get(round.id))?.status).toBe("pending");
    fireEvent.click(
      within(alert).getByRole("button", { name: "確認して開始する" })
    );
    await waitFor(async () =>
      expect((await db.rounds.get(round.id))?.status).toBe("active")
    );
    expect(
      await screen.findByRole("button", { name: "ラウンド終了" })
    ).toBeTruthy();
  });
});
