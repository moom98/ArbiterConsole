import { describe, it, expect } from "vitest";
import {
  INCIDENT_CSV_HEADERS,
  UTF8_BOM,
  buildIncidentCsv,
  escapeCsvCell,
  incidentCsvFilename,
  toCsv,
} from "@/lib/application/csv-export";
import { TIME_ADD_FOR, entry, makeGame } from "./log-fixtures";

describe("escapeCsvCell / toCsv (RFC 4180)", () => {
  it("doubles embedded quotes", () => {
    expect(escapeCsvCell('He said "check"')).toBe('"He said ""check"""');
  });

  it("keeps commas and newlines inside a quoted cell", () => {
    const csv = toCsv([
      ["a,b", "line1\nline2"],
      ["x", "y"],
    ]);
    expect(csv).toBe('"a,b","line1\nline2"\r\n"x","y"');
  });

  it("neutralises spreadsheet formulas", () => {
    expect(escapeCsvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`);
    expect(escapeCsvCell("+1")).toBe(`"'+1"`);
    expect(escapeCsvCell("-")).toBe('"-"');
  });

  it("handles Japanese text unchanged", () => {
    expect(escapeCsvCell("白の違法手")).toBe('"白の違法手"');
  });
});

describe("buildIncidentCsv", () => {
  const game = makeGame("g-r3-b12", 3, 12);
  const record = entry({
    game,
    color: "white",
    minute: 23,
    penalties: [TIME_ADD_FOR("black")],
    description: 'メモ: "キャスリング"\n2行目, カンマ',
  });

  it("starts with a UTF-8 BOM and the header row", () => {
    const csv = buildIncidentCsv([record]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    const header = csv.slice(1).split("\r\n")[0];
    expect(header).toBe(INCIDENT_CSV_HEADERS.map((h) => `"${h}"`).join(","));
  });

  it("includes game, round, board, colour, recommendation, penalties and articles", () => {
    const csv = buildIncidentCsv([record]);
    const body = csv.slice(1).split("\r\n").slice(1).join("\r\n");
    expect(body).toContain('"2026-01-01 10:23:00"');
    expect(body).toContain('"2026-01-01"');
    expect(body).toContain('"Standard"');
    expect(body).toContain('"FIDE-2023"');
    expect(body).toContain('"3","12","白"');
    expect(body).toContain('"違法手"');
    expect(body).toContain('"推奨"');
    expect(body).toContain('"推奨される結論"');
    expect(body).toContain('"相手に時間追加: 黒に2分追加"');
    expect(body).toContain('"黒 120"');
    expect(body).toContain('"FIDE 7.5.5 (FIDE Laws of Chess 2023)"');
    expect(body).toContain('"メモ: ""キャスリング""\n2行目, カンマ"');
  });

  it("produces exactly one record per incident even with embedded newlines", () => {
    const csv = buildIncidentCsv([record, entry({ noDecision: true })]);
    // CRLF は行区切りのみ（セル内の改行は LF）
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("leaves decision columns empty when there is no decision", () => {
    const csv = buildIncidentCsv([entry({ noDecision: true })]);
    expect(csv).not.toContain("推奨される結論");
  });

  it("builds a dated filename", () => {
    expect(incidentCsvFilename(new Date(2026, 9, 6, 12))).toBe(
      "incidents_2026-10-06.csv"
    );
  });
});
