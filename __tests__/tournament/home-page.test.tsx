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
import HomePage from "@/app/(tabs)/home/page";
import { db } from "@/lib/infrastructure/db";
import { useTournamentStore } from "@/lib/stores/tournament-store";
import type { Incident } from "@/lib/domain/entities";
import { profileInput } from "./fixtures";

function incident(id: string, gameId: string, minute: number): Incident {
  const at = new Date(2026, 9, 10, 10, minute);
  return {
    id,
    gameId,
    category: "illegal-move",
    description: "",
    arbiterObserved: true,
    reportedBy: "arbiter",
    reportedAt: at,
    status: id === "esc" ? "escalated" : "resolved",
    escalatedToCA: id === "esc",
    createdAt: at,
    updatedAt: at,
  };
}

describe("Home page", () => {
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

  it("without a tournament: report first, create-tournament CTA, disclaimer", async () => {
    render(<HomePage />);
    expect(
      screen.getByRole("link", { name: "トラブルを報告" }).getAttribute("href")
    ).toBe("/report");
    expect(
      (await screen.findByRole("link", { name: "大会を作成" })).getAttribute(
        "href"
      )
    ).toBe("/tournament/new");
    expect(
      screen.getByText(/最終的な裁定はアービターが行います。/)
    ).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "クイックアクション" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href"))
    ).toEqual(["/report", "/search", "/log"]);
  });

  it("shows the active tournament, current round status and only its recent incidents; switches tournaments", async () => {
    const { service } = useTournamentStore.getState();
    const t = await service.saveTournamentProfile(
      profileInput({ name: "秋季大会", totalRounds: 9 })
    );
    const other = await service.saveTournamentProfile(
      profileInput({ name: "別大会" })
    );
    await service.createRoundWithBoards(t.id, 1, { from: 1, to: 10 });
    const { round } = await service.createRoundWithBoards(t.id, 2, {
      from: 1,
      to: 40,
    });
    await service.changeRoundStatus(round.id, "active");
    const g = await service.ensureGame(t.id, 2, 12);
    const og = await service.ensureGame(other.id, 1, 1);
    await db.incidents.bulkAdd([
      incident("a", g.id, 5),
      incident("esc", g.id, 20),
      incident("o", og.id, 30),
    ]);

    render(<HomePage />);
    expect(await screen.findByText("秋季大会", { selector: "p" })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("round-status").textContent).toBe(
        "Round 2 / 9 · 対局中 · 40ボード"
      )
    );
    expect(
      await screen.findByText("CA確認を推奨したIncident: 1件")
    ).toBeTruthy();

    const recent = screen.getByRole("region", { name: "最近のIncident" });
    await waitFor(() =>
      expect(within(recent).getAllByText(/R2 \/ B12/)).toHaveLength(2)
    );
    // 新しい順 / 他の大会の Incident は出ない
    expect(within(recent).getAllByText(/R2 \/ B12/)[0].textContent).toContain(
      "10:20"
    );
    expect(within(recent).queryByText(/R1 \/ B1 /)).toBeNull();

    fireEvent.change(screen.getByLabelText("大会を切り替え"), {
      target: { value: other.id },
    });
    expect(await screen.findByText("別大会", { selector: "p" })).toBeTruthy();
    expect(await service.getActiveTournament()).toMatchObject({
      id: other.id,
    });
  });

  it("shows a load error with retry", async () => {
    const { service } = useTournamentStore.getState();
    await service.saveTournamentProfile(profileInput({ name: "秋季大会" }));
    const spy = vi
      .spyOn(service, "listTournaments")
      .mockRejectedValueOnce(new Error("db closed"));
    render(<HomePage />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "db closed"
    );
    expect(screen.queryByRole("link", { name: "大会を作成" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByText("秋季大会", { selector: "p" })).toBeTruthy();
    spy.mockRestore();
  });
});
