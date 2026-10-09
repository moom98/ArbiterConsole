import type { RuleSourceType } from "@/lib/domain/entities";
import { ensureReadableStreamAsyncIterator } from "./readable-stream-polyfill";

/**
 * PDF.js worker の配置先（scripts/copy-runtime-assets.mjs が
 * pdfjs-dist/legacy/build/pdf.worker.min.mjs を public/pdfjs/ にコピーする）。
 * 同一オリジンから読み込むためオフラインでも動作する。
 */
export const PDF_WORKER_SRC = "/pdfjs/pdf.worker.min.mjs";

export const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024;

export interface ExtractedPage {
  pageNumber: number;
  lines: string[];
}

export interface ExtractedRule {
  article: string;
  title: string;
  content: string;
  /** 条文見出しが現れたページ（1始まり） */
  pageNumber: number;
}

export interface PDFExtractionResult {
  rules: ExtractedRule[];
  totalPages: number;
  extractedAt: Date;
}

export class PdfValidationError extends Error {}

/**
 * アップロードされたファイルがPDFか検証する（サイズ上限・拡張子/MIME・マジックバイト）
 */
export async function validatePdfFile(
  file: Pick<File, "name" | "type" | "size" | "slice">
): Promise<void> {
  if (file.size === 0) {
    throw new PdfValidationError("ファイルが空です");
  }
  if (file.size > MAX_PDF_SIZE_BYTES) {
    throw new PdfValidationError(
      `ファイルサイズが上限（${MAX_PDF_SIZE_BYTES / 1024 / 1024}MB）を超えています`
    );
  }
  const looksLikePdf =
    file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!looksLikePdf) {
    throw new PdfValidationError("PDFファイルを選択してください");
  }
  // PDF仕様上、ヘッダ "%PDF-" は先頭1024バイト以内にあればよい
  const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const headText = Array.from(header, (b) => String.fromCharCode(b)).join("");
  if (!headText.includes("%PDF-")) {
    throw new PdfValidationError("PDFファイルとして認識できません");
  }
}

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
}

/**
 * pdfjs の text item 列を行に組み立てる（純粋関数）
 * hasEOL と y座標の変化で改行を判定する。
 */
export function buildLines(items: readonly unknown[]): string[] {
  const lines: string[] = [];
  let current = "";
  let currentY: number | null = null;

  const flush = () => {
    const line = current.replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
    current = "";
    currentY = null;
  };

  for (const raw of items) {
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as PdfTextItem;
    const y = item.transform?.[5];

    if (
      y !== undefined &&
      currentY !== null &&
      Math.abs(y - currentY) > 2 &&
      current.trim()
    ) {
      flush();
    }
    if (y !== undefined && currentY === null) {
      currentY = y;
    }

    current += item.str;
    if (item.hasEOL) {
      flush();
    }
  }
  flush();

  return lines;
}

/**
 * PDFファイルからページ単位で行を抽出（ブラウザ専用）
 */
export async function extractPagesFromPDF(
  file: File,
  onPage?: (pageNumber: number, totalPages: number) => void
): Promise<ExtractedPage[]> {
  // SSR時に pdfjs を評価しないよう動的import。legacy build は対応ブラウザが広い
  // Safari は ReadableStream の for await に未対応（getTextContent が失敗する）
  ensureReadableStreamAsyncIterator();
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

  const data = new Uint8Array(await file.arrayBuffer());
  // pdfjs-dist v5以降は eval を使用しないため isEvalSupported オプションは存在しない
  const loadingTask = pdfjsLib.getDocument({ data });

  try {
    // 読み込み失敗（破損・暗号化PDF）時も finally で worker を解放する
    const pdf = await loadingTask.promise;
    const pages: ExtractedPage[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const textContent = await page.getTextContent();
        pages.push({ pageNumber: i, lines: buildLines(textContent.items) });
      } finally {
        page.cleanup();
      }
      onPage?.(i, pdf.numPages);
    }
    return pages;
  } finally {
    // loadingTask.destroy() でドキュメントとworkerのリソースを解放する
    await loadingTask.destroy();
  }
}

/**
 * 条文見出しの判定ルール（資料種別ごとに切り替え可能）
 */
export interface HeadingPattern {
  /** 1番目のグループが条文番号、2番目がタイトル */
  regex: RegExp;
  /**
   * true の場合、直前の行が文の途中で折り返している（段落の続き）なら見出しとみなさない。
   * 本文中の条文参照（"... under" + 改行 + "7.5.4 ..."）の誤検出を防ぐ。
   */
  requiresBlockBoundary?: boolean;
  /** 既定（グループ1=条文番号, 2=タイトル）以外の取り出し方をする場合 */
  extract?: (match: RegExpExecArray) => { article: string; title: string };
}

export interface ArticleParseOptions {
  headingPatterns: HeadingPattern[];
}

// 数量の後に続く単位（"2 minutes", "10 秒" など）は見出しではない
const UNIT_AFTER_NUMBER =
  /^(?:minutes?|mins?|seconds?|secs?|moves?|hours?|points?|games?|rounds?|%|分|秒|手|時間|点|局|回|年|月|日)/i;

/** 条文番号の接頭辞: 付録 "A." やガイドライン "III." */
const PREFIX = String.raw`(?:(?:[IVX]+|[A-Z])\.)`;

/** "Article 7: Illegal moves" / "Article 7.5 ..." */
const ARTICLE_KEYWORD: HeadingPattern = {
  regex: new RegExp(
    String.raw`^Article\s+(${PREFIX}?\d{1,2}(?:\.\d{1,2})*)\b[.:]?\s*(.*)$`,
    "i"
  ),
  requiresBlockBoundary: true,
};
/** "第7条 違法な手" */
/**
 * "第7条 違法な手" / "第3条の2 ..."（枝番号は "3-2" として別条文に扱う）
 */
const JA_ARTICLE: HeadingPattern = {
  regex: /^第\s*(\d{1,3})\s*条(?:\s*の\s*(\d{1,3}))?\s*(.*)$/,
  requiresBlockBoundary: true,
  extract: (m) => ({
    article: m[2] ? `${m[1]}-${m[2]}` : m[1],
    title: m[3] ?? "",
  }),
};
/**
 * "7.5.4 If ..." / "A.4.2 ..." / "III.4 ..."
 * ドット区切りの階層番号のみ（単独の整数・年は対象外）
 */
const DOTTED_NUMBER: HeadingPattern = {
  regex: new RegExp(
    String.raw`^(${PREFIX}\d{1,2}(?:\.\d{1,2})*|\d{1,2}(?:\.\d{1,2})+)\.?(?:\s+|(?=[^\d\s.]))(.*)$`
  ),
  requiresBlockBoundary: true,
};

export const DEFAULT_PARSE_OPTIONS: ArticleParseOptions = {
  headingPatterns: [ARTICLE_KEYWORD, JA_ARTICLE, DOTTED_NUMBER],
};

export function getParseOptionsForSource(
  source: RuleSourceType
): ArticleParseOptions {
  switch (source) {
    case "FIDE":
      // FIDE Laws は "Article N" と "N.N.N" 形式
      return { headingPatterns: [ARTICLE_KEYWORD, DOTTED_NUMBER] };
    default:
      return DEFAULT_PARSE_OPTIONS;
  }
}

const SENTENCE_END = /[.。:：;；!?！？)）]$/;
const MIN_PARAGRAPH_LINE = 40;

/** 直前の行が段落の途中（長い行で文末記号なし）か */
function continuesParagraph(previousLine: string | undefined): boolean {
  if (!previousLine) return false;
  return (
    previousLine.length >= MIN_PARAGRAPH_LINE &&
    !SENTENCE_END.test(previousLine)
  );
}

function matchHeading(
  line: string,
  previousLine: string | undefined,
  options: ArticleParseOptions
): { article: string; title: string } | null {
  for (const pattern of options.headingPatterns) {
    const m = pattern.regex.exec(line);
    if (!m) continue;
    if (pattern.requiresBlockBoundary && continuesParagraph(previousLine)) {
      continue;
    }
    const { article, title } = pattern.extract
      ? pattern.extract(m)
      : { article: m[1], title: m[2] ?? "" };
    const rest = title.trim();
    if (UNIT_AFTER_NUMBER.test(rest)) continue;
    return { article: article.toUpperCase(), title: rest };
  }
  return null;
}

const CJK_CHAR = new RegExp(
  "[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー、。]",
  "u"
);

function joinLines(lines: readonly string[]): string {
  let text = "";
  for (const line of lines) {
    if (!text) {
      text = line;
      continue;
    }
    const prev = text[text.length - 1];
    const next = line[0];
    // 日本語同士の改行では空白を入れない
    text += CJK_CHAR.test(prev) && CJK_CHAR.test(next) ? line : ` ${line}`;
  }
  return text;
}

const MAX_TITLE_LENGTH = 80;

/**
 * ページ単位の行から条文を抽出する（純粋関数）
 *
 * - 行頭の条文番号のみを見出しとみなす
 * - 本文は次の見出しまで。ページ番号は見出しのあるページ
 * - 同じ条文番号が複数回出現した場合（目次など）は本文の長い方を採用
 */
export function parseArticlesFromPages(
  pages: readonly ExtractedPage[],
  options: ArticleParseOptions = DEFAULT_PARSE_OPTIONS
): ExtractedRule[] {
  interface Draft {
    article: string;
    title: string;
    pageNumber: number;
    lines: string[];
  }
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let previousLine: string | undefined;

  for (const page of pages) {
    for (const line of page.lines) {
      const heading = matchHeading(line, previousLine, options);
      previousLine = line;
      if (heading) {
        current = {
          article: heading.article,
          title: heading.title.slice(0, MAX_TITLE_LENGTH),
          pageNumber: page.pageNumber,
          lines: [line],
        };
        drafts.push(current);
      } else if (current) {
        current.lines.push(line);
      }
    }
  }

  const byArticle = new Map<string, ExtractedRule>();
  for (const draft of drafts) {
    const rule: ExtractedRule = {
      article: draft.article,
      title: draft.title,
      content: joinLines(draft.lines),
      pageNumber: draft.pageNumber,
    };
    const existing = byArticle.get(rule.article);
    if (!existing || rule.content.length > existing.content.length) {
      byArticle.set(rule.article, rule);
    }
  }

  return Array.from(byArticle.values());
}

/**
 * PDFファイルからルールを抽出（メイン関数・ブラウザ専用）
 */
export async function extractRulesFromPDF(
  file: File,
  source: RuleSourceType,
  onPage?: (pageNumber: number, totalPages: number) => void
): Promise<PDFExtractionResult> {
  await validatePdfFile(file);
  const pages = await extractPagesFromPDF(file, onPage);
  const rules = parseArticlesFromPages(pages, getParseOptionsForSource(source));

  return {
    rules,
    totalPages: pages.length,
    extractedAt: new Date(),
  };
}
