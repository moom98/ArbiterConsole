import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const params = { id: "" };
vi.mock("next/navigation", () => ({
  useParams: () => params,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

import TournamentDetailPage from "@/app/(tabs)/tournament/[id]/page";
import { db } from "@/lib/infrastructure/db";
import { useTournamentStore } from "@/lib/stores/tournament-store";
import { FIXED_NOW } from "../helpers";
import { profileInput } from "./fixtures";

describe("Tournament detail — editing after incidents", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    useTournamentStore.setState({ active: null, tournaments: [], rounds: [] });
  });
  afterEach(cleanup);

  async function seed(withIncident: boolean) {
    const { service } = useTournamentStore.getState();
    const t = await service.saveTournamentProfile(profileInput());
    const g = await service.ensureGame(t.id, 1, 1);
    if (withIncident)
      await db.incidents.add({
        id: "i1",
        gameId: g.id,
        category: "illegal-move",
        description: "",
        arbiterObserved: true,
        reportedBy: "arbiter",
        reportedAt: FIXED_NOW,
        status: "resolved",
        escalatedToCA: false,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      });
    params.id = encodeURIComponent(t.id);
  }

  it("warns that changes apply only to new incidents when incidents exist", async () => {
    await seed(true);
    render(<TournamentDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "編集" }));
    expect((await screen.findByRole("note")).textContent).toContain(
      "今後の報告にのみ適用"
    );
  });

  it("shows no warning without incidents", async () => {
    await seed(false);
    render(<TournamentDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "編集" }));
    await screen.findByRole("button", { name: "保存" });
    expect(screen.queryByRole("note")).toBeNull();
  });
});
