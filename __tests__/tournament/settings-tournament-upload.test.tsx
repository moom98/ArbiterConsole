import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const ingest = vi.fn(async () => ({ ruleCount: 3 }));
const scope = vi.fn(async () => ({ activeSources: [], legacyRuleCount: 0 }));

vi.mock("@/lib/application/rule-ingestion", () => ({
  ingestRulesFromPDF: ingest,
}));
vi.mock("@/lib/application/rule-library", () => ({
  getRuleStatistics: async () => ({
    total: 0,
    bySource: { FIDE: 0, JCF: 0, tournament: 0, commentary: 0 },
    sources: [],
  }),
  getImportScopeInfo: scope,
  deleteRuleSource: async () => {},
}));

import SettingsPage from "@/app/(tabs)/settings/page";
import { db } from "@/lib/infrastructure/db";
import { useTournamentStore } from "@/lib/stores/tournament-store";
import { tournament } from "./fixtures";

describe("Settings — tournament regulations upload", () => {
  beforeEach(async () => {
    ingest.mockClear();
    scope.mockClear();
    await Promise.all(db.tables.map((t) => t.clear()));
    useTournamentStore.setState({ active: null, tournaments: [], rounds: [] });
  });
  afterEach(cleanup);

  it("is disabled without an active tournament", async () => {
    render(<SettingsPage />);
    const button = await screen.findByRole("button", {
      name: /大会特別規定 をアップロード/,
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("先に大会を作成・選択してください")).toBeTruthy();
  });

  it("imports the PDF linked to the active tournament", async () => {
    await db.tournaments.put(tournament({ id: "T-ACTIVE", name: "秋季大会" }));
    await db.appState.put({
      key: "activeTournamentId",
      value: "T-ACTIVE",
      updatedAt: new Date(),
    });
    render(<SettingsPage />);
    const button = await screen.findByRole("button", {
      name: /対象: 秋季大会/,
    });
    fireEvent.click(button);
    expect(await screen.findByText("対象大会: 秋季大会")).toBeTruthy();
    expect(scope).toHaveBeenCalledWith("tournament", "T-ACTIVE");

    fireEvent.change(screen.getByLabelText("版（Version）"), {
      target: { value: "2026" },
    });
    const file = new File(["%PDF"], "regs.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/PDFファイル/), {
      target: { files: [file] },
    });
    const submit = screen.getByRole("button", { name: "インポート" });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    // jsdom は required の file input を検証で弾くため、submit イベントを直接送る
    fireEvent.submit(submit.closest("form")!);

    await waitFor(() => expect(ingest).toHaveBeenCalledTimes(1));
    const [, meta] = ingest.mock.calls[0] as unknown as [
      File,
      { sourceType: string; tournamentId?: string; name: string },
    ];
    expect(meta).toMatchObject({
      sourceType: "tournament",
      tournamentId: "T-ACTIVE",
      name: "秋季大会 大会規定",
    });
  });
});
