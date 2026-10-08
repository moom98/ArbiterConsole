import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { TournamentProfileForm } from "@/components/tournament/TournamentProfileForm";
import type { TournamentProfileInput } from "@/lib/domain/services/tournament-profile";

function type(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("TournamentProfileForm", () => {
  afterEach(cleanup);

  it("shows validation errors and does not submit an incomplete profile", async () => {
    const onSubmit = vi.fn();
    render(<TournamentProfileForm submitLabel="作成" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "作成" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("競技区分を選択してください")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a Blitz B.2 profile with a sourced penalty override", async () => {
    const onSubmit = vi.fn<(i: TournamentProfileInput) => Promise<void>>(
      async () => {}
    );
    render(<TournamentProfileForm submitLabel="作成" onSubmit={onSubmit} />);
    type("大会名", "秋季ブリッツ");
    type("開始日", "2026-10-10");
    fireEvent.click(screen.getByRole("button", { name: "Blitz" }));
    // B.2 の入力欄は Blitz・B.2 を選ぶまで表示しない
    expect(screen.queryByText(/B.2 の加算時間（任意）/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /B\.2/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "FIDE Laws of Chess 2023" })
    );
    type("持ち時間（分）", "3");
    type("加算（秒/手）", "2");
    type("加算時間（分）", "1");
    type("出典: 資料名（必須）", "秋季ブリッツ要項");
    type("出典: 条項（任意）", "第7条");
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0][0];
    expect(input).toMatchObject({
      name: "秋季ブリッツ",
      competitionType: "blitz",
      supervisionRegime: "competition-rules",
      rulesVersion: "FIDE-2023",
      timeControl: { periods: [{ minutes: 3, incrementSeconds: 2 }] },
      blitzCompetitionTimePenalty: {
        seconds: 60,
        source: { document: "秋季ブリッツ要項", article: "第7条" },
      },
    });
    expect(input.startDate?.getDate()).toBe(10);
  });
});
