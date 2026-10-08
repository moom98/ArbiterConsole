import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import { createIncidentStore } from "@/lib/stores/incident-store";
import type {
  LlmAssistOptions,
  LlmAssistOutcome,
  LlmAssistPort,
} from "@/lib/domain/llm/ports";
import type { ReportContext } from "@/lib/domain/services/game-context";
import { fixedProviders } from "./helpers";

const CTX: ReportContext = {
  competitionType: "standard",
  rulesVersion: "FIDE-2023",
  round: 2,
  boardNumber: 4,
};

const PREVIEW_TEXT = "[黒]のスマホが鳴った（送信内容）";

let n = 0;

describe("IncidentLogView: AI reference from the incident log (D13)", () => {
  let db: ArbiterDatabase;
  let assist: ReturnType<typeof vi.fn>;

  function makePort(): LlmAssistPort {
    return { assist: assist as LlmAssistPort["assist"] };
  }

  beforeEach(async () => {
    db = new ArbiterDatabase(`log-ai-${++n}`);
    assist = vi.fn(
      async (_req: unknown, options?: LlmAssistOptions) =>
        (options?.approvalKey === "key-1"
          ? {
              status: "error",
              code: "unauthorized",
              message: "トークンが必要です",
            }
          : {
              status: "needs-confirmation",
              preview: {
                destination: "AI参考情報（Gemini）",
                fields: [{ label: "事象", text: PREVIEW_TEXT }],
                notes: [],
              },
              approvalKey: "key-1",
            }) satisfies LlmAssistOutcome
    );
    // 報告画面で報告し、送信内容を確認しないまま閉じた（awaiting-confirmation）
    const reporting = createIncidentStore({
      db,
      providers: fixedProviders(`report${n}`),
      llm: makePort(),
    });
    const res = await reporting.getState().submitIncident({
      context: CTX,
      category: "player-behavior",
      description: "黒のスマホが鳴った",
      arbiterObserved: true,
    });
    expect(res.ok).toBe(true);
    expect(reporting.getState().currentDecision?.llm?.status).toBe(
      "awaiting-confirmation"
    );
    assist.mockClear();
  });

  afterEach(async () => {
    cleanup();
    await db.delete();
  });

  async function openDetail() {
    const store = createIncidentStore({
      db,
      providers: fixedProviders(`log${n}`),
      llm: makePort(),
    });
    render(<IncidentLogView db={db} incidentStore={store} />);
    const list = await screen.findByRole("list", { name: "インシデント一覧" });
    fireEvent.click(within(list).getAllByRole("button")[0]);
    return screen.getByRole("dialog");
  }

  it("shows the payload first, sends only after the arbiter confirms, then shows the new result", async () => {
    const dialog = await openDetail();
    expect(
      within(dialog).getByText("外部AIへ送る内容の確認が必要です", {
        exact: false,
      })
    ).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "外部AIへ送る内容を確認する" })
    );
    const confirmation = await within(dialog).findByRole("region", {
      name: "外部AIへ送る内容の確認",
    });
    expect(within(confirmation).getByText(PREVIEW_TEXT)).toBeTruthy();
    // まだ確認していないので、送信（approvalKey 付き）はしていない
    expect(assist).toHaveBeenCalledTimes(1);
    expect(assist.mock.calls[0][1]?.approvalKey).toBeUndefined();

    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "確認してAI参考情報を取得",
      })
    );
    // 送信に失敗（未認証）→ 履歴を読み込み直し、新しい判断とトークン入力を示す
    await within(dialog).findByLabelText("AI機能のアクセストークン");
    expect(assist).toHaveBeenCalledTimes(2);
    expect(assist.mock.calls[1][1]?.approvalKey).toBe("key-1");
    expect(
      within(dialog).getByText("AI参考情報を取得できませんでした")
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole("region", { name: "外部AIへ送る内容の確認" })
    ).toBeNull();

    // 確認済みの同じ内容は、再取得で確認なしに送る（報告画面と同じ）
    fireEvent.click(
      within(dialog).getByRole("button", { name: "AI参考情報を再取得" })
    );
    await waitFor(() => expect(assist).toHaveBeenCalledTimes(3));
    expect(assist.mock.calls[2][1]?.approvalKey).toBe("key-1");
  });

  it("closing the dialog discards the pending payload; reopening asks again", async () => {
    let dialog = await openDetail();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "外部AIへ送る内容を確認する" })
    );
    await within(dialog).findByRole("region", {
      name: "外部AIへ送る内容の確認",
    });

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const list = screen.getByRole("list", { name: "インシデント一覧" });
    fireEvent.click(within(list).getAllByRole("button")[0]);
    dialog = screen.getByRole("dialog");
    expect(
      within(dialog).queryByRole("region", { name: "外部AIへ送る内容の確認" })
    ).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "外部AIへ送る内容を確認する" })
    ).toBeTruthy();
    // 何も送っていない
    expect(
      assist.mock.calls.every(
        ([, options]) => options?.approvalKey === undefined
      )
    ).toBe(true);
  });
});
