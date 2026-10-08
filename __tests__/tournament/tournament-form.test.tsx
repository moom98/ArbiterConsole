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

  function fillStandardBasics() {
    type("大会名", "秋季クラシカル");
    type("開始日", "2026-10-10");
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    fireEvent.click(
      screen.getByRole("button", { name: "FIDE Laws of Chess 2023" })
    );
  }

  it("submits a two-period time control (ADR-014 §7)", async () => {
    const onSubmit = vi.fn<(i: TournamentProfileInput) => Promise<void>>(
      async () => {}
    );
    render(<TournamentProfileForm submitLabel="作成" onSubmit={onSubmit} />);
    fillStandardBasics();
    fireEvent.click(screen.getByRole("button", { name: /ピリオドを追加/ }));
    type("第1ピリオド 手数", "40");
    type("第1ピリオド 持ち時間（分）", "90");
    type("第1ピリオド 加算（秒/手）", "30");
    // 最後のピリオドには手数の欄がない
    expect(screen.queryByLabelText("第2ピリオド 手数")).toBeNull();
    type("第2ピリオド 持ち時間（分）", "30");
    type("第2ピリオド 加算（秒/手）", "30");
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].timeControl).toMatchObject({
      periods: [
        { moves: 40, minutes: 90, incrementSeconds: 30 },
        { minutes: 30, incrementSeconds: 30 },
      ],
    });
  });

  it("requires the move count of a non-final period", async () => {
    const onSubmit = vi.fn();
    render(<TournamentProfileForm submitLabel="作成" onSubmit={onSubmit} />);
    fillStandardBasics();
    fireEvent.click(screen.getByRole("button", { name: /ピリオドを追加/ }));
    type("第1ピリオド 持ち時間（分）", "90");
    type("第1ピリオド 加算（秒/手）", "30");
    type("第2ピリオド 持ち時間（分）", "30");
    type("第2ピリオド 加算（秒/手）", "30");
    fireEvent.click(screen.getByRole("button", { name: "作成" }));
    expect(
      await screen.findByText(
        "第1ピリオドの手数は1以上の整数で入力してください"
      )
    ).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps a legacy incomplete time control until the arbiter confirms it", async () => {
    const onSubmit = vi.fn<(i: TournamentProfileInput) => Promise<void>>(
      async () => {}
    );
    const initial: TournamentProfileInput = {
      name: "旧大会",
      startDate: new Date(2026, 9, 10),
      competitionType: "standard",
      rulesVersion: "FIDE-2023",
      timeControl: {
        periods: [{ minutes: 90, incrementSeconds: 30 }],
        periodsIncomplete: true,
        additionalTimeAfterMove: 30,
      },
    };
    const { unmount } = render(
      <TournamentProfileForm
        initial={initial}
        submitLabel="保存"
        onSubmit={onSubmit}
      />
    );
    expect(screen.getByText(/2つ目以降のピリオド/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].timeControl).toMatchObject({
      periodsIncomplete: true,
      additionalTimeAfterMove: 30,
    });
    unmount();

    render(
      <TournamentProfileForm
        initial={initial}
        submitLabel="保存"
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(
      screen.getByLabelText(/大会要項でピリオドを確認して入力した/)
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const tc = onSubmit.mock.calls[1][0].timeControl;
    expect(tc?.periodsIncomplete).toBeUndefined();
    expect(tc?.additionalTimeAfterMove).toBeUndefined();
  });
});
