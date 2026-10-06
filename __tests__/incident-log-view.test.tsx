import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ArbiterDatabase } from "@/lib/infrastructure/db/schema";
import { IncidentLogView } from "@/components/log/IncidentLogView";
import { TIME_ADD_FOR, TOURNAMENT, entry, makeGame } from "./log-fixtures";

const G12 = makeGame("g-r3-b12", 3, 12);
const G7 = makeGame("g-r3-b7", 3, 7);

let n = 0;

async function seed(db: ArbiterDatabase) {
  const records = [
    entry({
      game: G12,
      color: "white",
      minute: 10,
      penalties: [TIME_ADD_FOR("black")],
    }),
    entry({
      game: G12,
      color: "black",
      minute: 20,
      penalties: [TIME_ADD_FOR("white")],
    }),
    entry({ game: G7, color: "white", minute: 30, category: "clock-time" }),
  ];
  await db.tournaments.put(TOURNAMENT);
  await db.games.bulkPut([G12, G7]);
  await db.incidents.bulkPut(records.map((r) => r.incident));
  await db.decisions.bulkPut(
    records.flatMap((r) => (r.decision ? [r.decision] : []))
  );
}

describe("IncidentLogView", () => {
  let db: ArbiterDatabase;

  beforeEach(async () => {
    db = new ArbiterDatabase(`log-view-${++n}`);
    await seed(db);
  });

  afterEach(async () => {
    cleanup();
    await db.delete();
  });

  async function renderLoaded() {
    render(<IncidentLogView db={db} />);
    return screen.findByRole("list", { name: "インシデント一覧" });
  }

  it("filters by game and updates the summary and penalty history", async () => {
    const list = await renderLoaded();
    expect(within(list).getAllByRole("button")).toHaveLength(3);

    fireEvent.change(screen.getByLabelText("対局（ラウンド / ボード）"), {
      target: { value: G7.id },
    });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    const summary = screen.getByRole("region", { name: /集計/ });
    expect(
      within(summary).getByText("絞り込み中", { exact: false })
    ).toBeTruthy();
    expect(
      within(summary).getByText("推奨ペナルティ").nextSibling?.textContent
    ).toBe("0");

    fireEvent.change(screen.getByLabelText("対局（ラウンド / ボード）"), {
      target: { value: G12.id },
    });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    const history = screen.getByRole("region", {
      name: "R3 / B12 のPenalty履歴",
    });
    expect(within(history).getAllByText("違法手 1回")).toHaveLength(2);
  });

  it("filters by player colour", async () => {
    const list = await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "黒" }));
    expect(within(list).getAllByRole("button")).toHaveLength(1);
  });

  it("opens an accessible dialog and closes it with Escape, restoring focus", async () => {
    const list = await renderLoaded();
    const row = within(list).getAllByRole("button")[0];
    row.focus();
    fireEvent.click(row);

    const dialog = await screen.findByRole("dialog", {
      name: "インシデント詳細",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const close = within(dialog).getByRole("button", { name: "閉じる" });
    expect(document.activeElement).toBe(close);
    expect(within(dialog).getByText("判断支援（推奨）")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(row);
  });
});
