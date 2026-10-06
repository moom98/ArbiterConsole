import * as pdfjsLib from "pdfjs-dist";
import type { RuleSource } from "@/lib/domain/entities";

// PDF.js workerの設定
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
}

export interface ExtractedRule {
  article: string;
  title: string;
  content: string;
  pageNumber: number;
}

export interface PDFExtractionResult {
  rules: ExtractedRule[];
  totalPages: number;
  extractedAt: Date;
}

/**
 * PDFファイルからテキストを抽出
 */
export async function extractTextFromPDF(
  file: File
): Promise<{ text: string; totalPages: number }> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const totalPages = pdf.numPages;
  const textPages: string[] = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(" ");
    textPages.push(pageText);
  }

  return {
    text: textPages.join("\n\n"),
    totalPages,
  };
}

/**
 * 抽出したテキストをルール単位に分割
 * FIDE Laws of Chessの構造を想定（Article番号で分割）
 */
export function parseRulesFromText(
  text: string,
  source: RuleSource
): ExtractedRule[] {
  const rules: ExtractedRule[] = [];

  // Article番号のパターン（例: "Article 1.1", "第1条", "1.1"）
  const articlePattern = /(?:Article\s+)?(\d+(?:\.\d+)?)\s*[:\.]?\s*([^\n]+)/gi;

  let match;
  const matches: Array<{
    article: string;
    title: string;
    index: number;
  }> = [];

  while ((match = articlePattern.exec(text)) !== null) {
    matches.push({
      article: match[1],
      title: match[2].trim(),
      index: match.index,
    });
  }

  // 各Articleの本文を抽出（次のArticleまで）
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const startIndex = current.index;
    const endIndex = next ? next.index : text.length;

    const content = text
      .substring(startIndex, endIndex)
      .replace(/\s+/g, " ")
      .trim();

    rules.push({
      article: `${source} ${current.article}`,
      title: current.title,
      content,
      pageNumber: 0, // TODO: ページ番号の計算
    });
  }

  return rules;
}

/**
 * PDFファイルからルールを抽出（メイン関数）
 */
export async function extractRulesFromPDF(
  file: File,
  source: RuleSource
): Promise<PDFExtractionResult> {
  const { text, totalPages } = await extractTextFromPDF(file);
  const rules = parseRulesFromText(text, source);

  return {
    rules,
    totalPages,
    extractedAt: new Date(),
  };
}
