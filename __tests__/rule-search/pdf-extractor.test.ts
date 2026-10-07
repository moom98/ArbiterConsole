import { describe, expect, it } from "vitest";
import {
  buildLines,
  getParseOptionsForSource,
  parseArticlesFromPages,
  validatePdfFile,
  MAX_PDF_SIZE_BYTES,
} from "@/lib/infrastructure/pdf/extractor";

describe("buildLines", () => {
  it("rebuilds lines from hasEOL and y-position changes", () => {
    const items = [
      { str: "Article 7: ", transform: [1, 0, 0, 1, 50, 700] },
      { str: "Irregularities", hasEOL: true, transform: [1, 0, 0, 1, 90, 700] },
      { str: "7.5.4 If the arbiter", transform: [1, 0, 0, 1, 50, 680] },
      { str: "observes...", transform: [1, 0, 0, 1, 50, 660] },
      { type: "beginMarkedContent" },
    ];
    expect(buildLines(items)).toEqual([
      "Article 7: Irregularities",
      "7.5.4 If the arbiter",
      "observes...",
    ]);
  });
});

describe("parseArticlesFromPages", () => {
  const pages = [
    {
      pageNumber: 1,
      lines: [
        "FIDE Laws of Chess",
        "Approved 2023 by the General Assembly",
        "2025.11.8 revised",
      ],
    },
    {
      pageNumber: 3,
      lines: [
        "Article 7: Irregularities",
        "7.5.4 If the player has completed an illegal move,",
        "the arbiter shall add 2 minutes to the opponent's time.",
        "2 minutes shall be added for the first illegal move.",
      ],
    },
    {
      pageNumber: 4,
      lines: [
        "1.5 points are awarded in some events.",
        "7.5.5 After the action taken under 7.5.4, for the second",
        "illegal move the game is lost.",
      ],
    },
  ];

  const rules = parseArticlesFromPages(pages, getParseOptionsForSource("FIDE"));

  it("splits on line-start article headings including multi-level numbers", () => {
    expect(rules.map((r) => r.article)).toEqual(["7", "7.5.4", "7.5.5"]);
  });

  it("does not treat years, dates or quantities as headings", () => {
    const articles = rules.map((r) => r.article);
    expect(articles).not.toContain("2023");
    expect(articles).not.toContain("2");
    expect(articles).not.toContain("1.5");
  });

  it("records the page where each article starts", () => {
    expect(rules.find((r) => r.article === "7.5.4")?.pageNumber).toBe(3);
    expect(rules.find((r) => r.article === "7.5.5")?.pageNumber).toBe(4);
  });

  it("keeps the title to the heading line and the body until the next heading", () => {
    const r754 = rules.find((r) => r.article === "7.5.4")!;
    expect(r754.title).toBe("If the player has completed an illegal move,");
    expect(r754.content).toContain("2 minutes shall be added");
    // body continues across the page break until the next heading
    expect(r754.content).toContain("1.5 points are awarded");
    expect(r754.content).not.toContain("7.5.5");
  });

  it("parses Japanese 第N条 headings and joins Japanese lines without spaces", () => {
    const ja = parseArticlesFromPages([
      {
        pageNumber: 2,
        lines: ["第3条 時計", "プレーヤーは着手と同じ手で", "時計を押す。"],
      },
    ]);
    expect(ja).toEqual([
      {
        article: "3",
        title: "時計",
        content: "第3条 時計プレーヤーは着手と同じ手で時計を押す。",
        pageNumber: 2,
      },
    ]);
  });

  it("prefers the longer body when an article number repeats (table of contents)", () => {
    const toc = parseArticlesFromPages([
      { pageNumber: 1, lines: ["7.5 Illegal moves"] },
      {
        pageNumber: 5,
        lines: ["7.5 Illegal moves", "Full text of the article body."],
      },
    ]);
    expect(toc).toHaveLength(1);
    expect(toc[0].pageNumber).toBe(5);
  });
});

describe("validatePdfFile", () => {
  const fakeFile = (bytes: string, name = "laws.pdf", size?: number) => {
    const blob = new Blob([bytes]);
    return {
      name,
      type: name.endsWith(".pdf") ? "application/pdf" : "text/plain",
      size: size ?? blob.size,
      slice: blob.slice.bind(blob),
    };
  };

  it("accepts a file with the PDF magic header", async () => {
    await expect(
      validatePdfFile(fakeFile("%PDF-1.7 ..."))
    ).resolves.toBeUndefined();
  });

  it("rejects non-PDF content, wrong type, empty and oversized files", async () => {
    await expect(validatePdfFile(fakeFile("<html>"))).rejects.toThrow();
    await expect(
      validatePdfFile(fakeFile("%PDF-1.7", "notes.txt"))
    ).rejects.toThrow();
    await expect(validatePdfFile(fakeFile(""))).rejects.toThrow();
    await expect(
      validatePdfFile(fakeFile("%PDF-1.7", "big.pdf", MAX_PDF_SIZE_BYTES + 1))
    ).rejects.toThrow();
  });
});
