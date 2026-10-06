import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTER,
  filterIncidentRecords,
  illegalMoveCountsByGame,
  listGames,
  penaltyHistoryForGame,
  sortByReportedAtDesc,
  summarizePenalties,
} from "@/lib/domain/services/penalty-history";
import { TIME_ADD_FOR, entry, makeGame } from "./log-fixtures";

const G12 = makeGame("g-r3-b12", 3, 12);
const G7 = makeGame("g-r3-b7", 3, 7);

describe("filterIncidentRecords", () => {
  const records = [
    entry({ game: G12, color: "white", penalties: [TIME_ADD_FOR("black")] }),
    entry({ game: G12, color: "black", category: "clock-time" }),
    entry({ game: G7, color: "white" }),
    entry({ game: G7, category: "tournament-admin" }),
  ];

  it("returns everything with the empty filter", () => {
    expect(filterIncidentRecords(records, EMPTY_FILTER)).toHaveLength(4);
  });

  it("filters by game (Board 12 → only Board 12 incidents)", () => {
    const r = filterIncidentRecords(records, {
      ...EMPTY_FILTER,
      gameId: G12.id,
    });
    expect(r).toHaveLength(2);
    expect(r.every((e) => e.incident.gameId === G12.id)).toBe(true);
  });

  it("filters by player colour, excluding incidents without a player", () => {
    const r = filterIncidentRecords(records, {
      ...EMPTY_FILTER,
      playerColor: "white",
    });
    expect(r).toHaveLength(2);
  });

  it("combines game, colour and category", () => {
    expect(
      filterIncidentRecords(records, {
        gameId: G12.id,
        playerColor: "black",
        category: "clock-time",
      })
    ).toHaveLength(1);
    expect(
      filterIncidentRecords(records, {
        gameId: G7.id,
        playerColor: "black",
        category: "clock-time",
      })
    ).toHaveLength(0);
  });
});

describe("summarizePenalties", () => {
  it("counts penalty types including warnings, draws and expulsions", () => {
    const s = summarizePenalties([
      entry({ color: "white", penalties: [TIME_ADD_FOR("black")] }),
      entry({
        color: "white",
        penalties: [
          { type: "game-loss", playerColor: "white", description: "白の負け" },
        ],
      }),
      entry({
        category: "player-behavior",
        treeId: null,
        penalties: [
          { type: "warning", playerColor: "black", description: "警告" },
          { type: "expulsion", playerColor: "black", description: "退場" },
        ],
      }),
      entry({
        color: "black",
        penalties: [
          { type: "draw", playerColor: "black", description: "ドロー" },
        ],
      }),
      entry({ noDecision: true, escalated: true }),
    ]);
    expect(s).toEqual({
      incidents: 5,
      penalties: 5,
      warnings: 1,
      timeAdjustments: 1,
      gameLosses: 1,
      draws: 1,
      expulsions: 1,
      escalations: 1,
    });
  });

  it("reflects only the records passed (i.e. the active filter)", () => {
    const records = [
      entry({ game: G12, color: "white", penalties: [TIME_ADD_FOR("black")] }),
      entry({ game: G7, color: "white", penalties: [TIME_ADD_FOR("black")] }),
    ];
    const filtered = filterIncidentRecords(records, {
      ...EMPTY_FILTER,
      gameId: G12.id,
    });
    expect(summarizePenalties(filtered).timeAdjustments).toBe(1);
    expect(summarizePenalties(records).timeAdjustments).toBe(2);
  });

  it("ignores a decision that belongs to another incident", () => {
    const a = entry({ color: "white", penalties: [TIME_ADD_FOR("black")] });
    const b = entry({ color: "white" });
    const mismatched = { ...b, decision: a.decision };
    expect(summarizePenalties([mismatched]).penalties).toBe(0);
  });
});

describe("penaltyHistoryForGame", () => {
  it("attributes penalties to the offender and counts illegal moves via IncidentCounter", () => {
    const records = [
      entry({ game: G12, color: "white", penalties: [TIME_ADD_FOR("black")] }),
      // 時計未押下（ペナルティなし）→ 違法手回数に数えない
      entry({ game: G12, color: "white", penalties: [] }),
      entry({ game: G12, color: "black", penalties: [TIME_ADD_FOR("white")] }),
      // 別の対局は含めない
      entry({ game: G7, color: "white", penalties: [TIME_ADD_FOR("black")] }),
    ];
    const h = penaltyHistoryForGame(records, G12.id);
    expect(h.white.illegalMoveCount).toBe(1);
    expect(h.black.illegalMoveCount).toBe(1);
    // 「黒に2分追加」は白の違反に対するペナルティ
    expect(h.white.penalties).toHaveLength(1);
    expect(h.white.penalties[0].penalty.playerColor).toBe("black");
    expect(h.black.penalties).toHaveLength(1);
  });

  it("does not count non-DT-001 or non-illegal-move penalties as illegal moves", () => {
    const records = [
      entry({
        game: G12,
        color: "white",
        category: "player-behavior",
        treeId: null,
        penalties: [
          { type: "warning", playerColor: "white", description: "警告" },
        ],
      }),
    ];
    const h = penaltyHistoryForGame(records, G12.id);
    expect(h.white.illegalMoveCount).toBe(0);
    expect(h.white.penalties).toHaveLength(1);
  });

  it("orders penalties chronologically", () => {
    const later = entry({
      game: G12,
      color: "white",
      minute: 50,
      penalties: [
        { type: "game-loss", playerColor: "white", description: "白の負け" },
      ],
    });
    const earlier = entry({
      game: G12,
      color: "white",
      minute: 5,
      penalties: [TIME_ADD_FOR("black")],
    });
    const h = penaltyHistoryForGame([later, earlier], G12.id);
    expect(h.white.penalties.map((p) => p.penalty.type)).toEqual([
      "time-addition-opponent",
      "game-loss",
    ]);
    expect(h.white.illegalMoveCount).toBe(2);
  });
});

describe("listGames / sortByReportedAtDesc", () => {
  it("lists distinct games ordered by round then board, with counts", () => {
    const records = [
      entry({ game: G12 }),
      entry({ game: G7 }),
      entry({ game: G12 }),
    ];
    const games = listGames(records);
    expect(games.map((g) => [g.boardNumber, g.incidentCount])).toEqual([
      [7, 1],
      [12, 2],
    ]);
  });

  it("sorts newest first without mutating the input", () => {
    const a = entry({ minute: 1 });
    const b = entry({ minute: 30 });
    const input = [a, b];
    expect(sortByReportedAtDesc(input)).toEqual([b, a]);
    expect(input).toEqual([a, b]);
  });
});

describe("illegalMoveCountsByGame", () => {
  it("returns penalised-only counts per game and colour", () => {
    const records = [
      entry({ game: G12, color: "white", penalties: [TIME_ADD_FOR("black")] }),
      entry({ game: G12, color: "white", penalties: [] }),
      entry({ game: G7, color: "black", penalties: [TIME_ADD_FOR("white")] }),
    ];
    const counts = illegalMoveCountsByGame(records);
    expect(counts.get(G12.id)).toEqual({ white: 1, black: 0 });
    expect(counts.get(G7.id)).toEqual({ white: 0, black: 1 });
  });
});
