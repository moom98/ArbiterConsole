import { describe, it, expect } from "vitest";
import type { Incident, MateSearchRecord } from "@/lib/domain/entities";
import {
  HELPMATE_ENGINE_VERSION,
  assessMatePossibility,
  matePositionRequest,
  mateSearchNeeded,
  verifyHelpmateLine,
} from "@/lib/domain/services/mate-possibility";
import { chessJsPositionPort as port } from "@/lib/infrastructure/chess/chess-js-position-port";
import { runHelpmateSearch } from "@/lib/infrastructure/chess/helpmate/run";

const KQK_WHITE_TO_MOVE = "7k/Q7/6K1/8/8/8/8/8 w - - 0 1";
const KQK_BLACK_TO_MOVE = "7k/8/6K1/8/8/8/8/5Q2 b - - 0 60";

function found(
  fen: string,
  moves: string[],
  attacker: "white" | "black" = "white"
): MateSearchRecord {
  return {
    fen,
    attacker,
    status: "found",
    moves,
    engine: HELPMATE_ENGINE_VERSION,
  };
}

describe("assessMatePossibility (ADR-014 §5)", () => {
  it("no position → unknown", () => {
    expect(assessMatePossibility(port, undefined)).toMatchObject({
      verdict: "unknown",
      cause: "no-position",
    });
  });

  it("unreadable FEN → invalid-position", () => {
    expect(
      assessMatePossibility(port, { fen: "nonsense", attacker: "white" })
    ).toMatchObject({ verdict: "unknown", cause: "invalid-position" });
  });

  it("the side not to move in check → invalid-position (impossible position)", () => {
    const r = assessMatePossibility(port, {
      fen: "4k3/4R3/8/8/8/8/8/4K3 w - - 0 1",
      attacker: "white",
    });
    expect(r).toMatchObject({ verdict: "unknown", cause: "invalid-position" });
    expect(r.reason).toContain("手番");
  });

  it("7.5.5: the reinstated position must have the offender to move", () => {
    const r = assessMatePossibility(port, {
      fen: KQK_WHITE_TO_MOVE,
      attacker: "white",
      requiredSideToMove: "black",
    });
    expect(r).toMatchObject({
      verdict: "unknown",
      cause: "wrong-side-to-move",
    });
  });

  it("material-only cannot-mate needs no search", () => {
    expect(
      assessMatePossibility(port, {
        fen: "8/8/8/4k3/8/8/4K3/7N b - - 0 1",
        attacker: "white",
      })
    ).toMatchObject({ verdict: "cannot-mate" });
  });

  it("K+Q vs K without a found line is NOT can-mate (counts never decide it)", () => {
    expect(
      assessMatePossibility(port, {
        fen: KQK_WHITE_TO_MOVE,
        attacker: "white",
      })
    ).toMatchObject({ verdict: "unknown", cause: "not-searched" });
  });

  it("a verified line → can-mate with the line as evidence", () => {
    const r = assessMatePossibility(
      port,
      { fen: KQK_WHITE_TO_MOVE, attacker: "white" },
      found(KQK_WHITE_TO_MOVE, ["Qg7#"])
    );
    expect(r).toMatchObject({ verdict: "can-mate", line: "1. Qg7#" });
  });

  it("a line found by the search from a black-to-move position is verified and numbered", () => {
    const request = { fen: KQK_BLACK_TO_MOVE, attacker: "white" as const };
    const record = runHelpmateSearch(request);
    expect(record.status).toBe("found");
    const r = assessMatePossibility(port, request, record);
    expect(r.verdict).toBe("can-mate");
    expect(r.line).toMatch(/^60\.\.\. K/);
    expect(r.line).toMatch(/#$/);
  });

  it("a record for another position or attacker is ignored", () => {
    const record = found(KQK_WHITE_TO_MOVE, ["Qg7#"]);
    expect(
      assessMatePossibility(
        port,
        { fen: KQK_BLACK_TO_MOVE, attacker: "white" },
        record
      ).cause
    ).toBe("not-searched");
    expect(
      assessMatePossibility(
        port,
        { fen: KQK_WHITE_TO_MOVE, attacker: "black" },
        { ...record, attacker: "black" }
      ).verdict
    ).toBe("cannot-mate"); // 黒はキングのみ
  });

  it("an illegal or non-mating line is rejected (evidence-invalid)", () => {
    const req = { fen: KQK_WHITE_TO_MOVE, attacker: "white" as const };
    expect(
      assessMatePossibility(port, req, found(req.fen, ["Qa1"])).cause
    ).toBe("evidence-invalid");
    expect(
      assessMatePossibility(port, req, found(req.fen, ["Qxh8"])).cause
    ).toBe("evidence-invalid");
    // 曖昧・非標準の表記も不合格（strict）
    expect(
      assessMatePossibility(port, req, found(req.fen, ["g1g7"])).cause
    ).toBe("evidence-invalid");
  });

  it("9.6.2: a line that passes 150 plies before the mate is rejected", () => {
    const fen149 = "7k/8/6K1/8/8/8/8/5Q2 b - - 149 80";
    const record = runHelpmateSearch({ fen: fen149, attacker: "white" });
    expect(record.status).toBe("found");
    expect(record.moves!.length).toBeGreaterThanOrEqual(2);
    const r = verifyHelpmateLine(port, fen149, "white", record.moves!);
    expect(r).toMatchObject({ ok: false });
    // 最後の手でちょうど 150 に達するメイトは有効（メイトが優先）
    expect(
      verifyHelpmateLine(port, "7k/Q7/6K1/8/8/8/8/8 w - - 149 80", "white", [
        "Qg7#",
      ]).ok
    ).toBe(true);
  });

  it("not-found from the current engine → unknown; from an older engine → search again", () => {
    const req = { fen: KQK_WHITE_TO_MOVE, attacker: "white" as const };
    const notFound: MateSearchRecord = {
      fen: req.fen,
      attacker: "white",
      status: "not-found",
      reason: "limit",
      engine: HELPMATE_ENGINE_VERSION,
    };
    expect(assessMatePossibility(port, req, notFound).cause).toBe("not-found");
    expect(
      assessMatePossibility(port, req, { ...notFound, engine: "old" }).cause
    ).toBe("not-searched");
  });
});

function incident(over: Partial<Incident>): Incident {
  return {
    id: "i1",
    gameId: "g1",
    category: "illegal-move",
    description: "",
    arbiterObserved: true,
    reportedBy: "arbiter",
    reportedAt: new Date(0),
    status: "pending",
    escalatedToCA: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

describe("matePositionRequest / mateSearchNeeded", () => {
  it("illegal move: the offender's opponent mates, the offender is to move", () => {
    const inc = incident({
      playerColor: "black",
      illegalMoveFacts: { matePosition: "fen", positionFen: KQK_BLACK_TO_MOVE },
    });
    expect(matePositionRequest(inc)).toEqual({
      fen: KQK_BLACK_TO_MOVE,
      attacker: "white",
      requiredSideToMove: "black",
    });
    expect(mateSearchNeeded(port, inc)).toBeDefined();
    // 探索済みなら不要
    const searched = {
      ...inc,
      mateSearch: runHelpmateSearch(matePositionRequest(inc)!),
    };
    expect(mateSearchNeeded(port, searched)).toBeUndefined();
  });

  it("flag fall: the non-flagged side mates (both flags: the first one flagged)", () => {
    const flag = (f: Incident["flagFallFacts"]) =>
      matePositionRequest(
        incident({
          category: "clock-time",
          subtype: "flag-fall",
          flagFallFacts: f,
        })
      );
    expect(
      flag({ flagFallen: "black", matePosition: "fen", fen: "x" })?.attacker
    ).toBe("white");
    expect(
      flag({
        flagFallen: "both",
        bothFlagsOrder: "black-first",
        matePosition: "fen",
        fen: "x",
      })?.attacker
    ).toBe("white");
    expect(
      flag({ flagFallen: "both", bothFlagsOrder: "unknown", fen: "x" })
    ).toBeUndefined();
    expect(
      flag({ flagFallen: "white", matePosition: "unknown", fen: "x" })
    ).toBeUndefined();
  });

  it("a deadline miss is used (unknown) but searched again on the next evaluation", () => {
    const inc = incident({
      playerColor: "black",
      illegalMoveFacts: { matePosition: "fen", positionFen: KQK_BLACK_TO_MOVE },
    });
    const request = matePositionRequest(inc)!;
    const timedOut: MateSearchRecord = {
      fen: request.fen,
      attacker: request.attacker,
      status: "not-found",
      reason: "deadline",
      engine: HELPMATE_ENGINE_VERSION,
    };
    const r = assessMatePossibility(port, request, timedOut);
    expect(r).toMatchObject({ verdict: "unknown", cause: "not-found" });
    expect(r.reason).toContain("時間内");
    expect(mateSearchNeeded(port, { ...inc, mateSearch: timedOut })).toEqual(
      request
    );
    // 上限（展開数）で見つからなかった結果は探し直さない
    expect(
      mateSearchNeeded(port, {
        ...inc,
        mateSearch: { ...timedOut, reason: "limit" },
      })
    ).toBeUndefined();
  });

  it("no search is needed for invalid positions or material-only draws", () => {
    const inc = (fen: string) =>
      incident({
        playerColor: "white",
        illegalMoveFacts: { matePosition: "fen", positionFen: fen },
      });
    expect(mateSearchNeeded(port, inc("nonsense"))).toBeUndefined();
    expect(
      mateSearchNeeded(port, inc("8/8/8/4k3/8/8/4K3/8 w - - 0 1"))
    ).toBeUndefined();
  });
});
