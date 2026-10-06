/**
 * 全文検索用トークナイザ（日本語・英語混在対応）
 *
 * インデックス作成時とクエリ時で同一の処理を行うこと。
 *
 * - NFKC正規化（全角英数字 → 半角）と小文字化
 * - 条文番号（"7.5.4", "A.4.2"）は1トークンとして保持
 * - 英数字の単語はそのまま1トークン
 * - 日本語（漢字・ひらがな・カタカナ）の連続部分は文字bi-gramに分割
 *   （1文字のみの場合はその1文字をトークンとする）
 *
 * 形態素解析辞書を持たずオフラインで動作し、辞書サイズの増加がないため
 * bi-gram方式を採用（ADR-003）。
 */

export type TokenKind = "article" | "word" | "cjk";

export interface SearchToken {
  text: string;
  kind: TokenKind;
}

// 条文番号: "7.5.4", "12.9", "A.4.2", "III.4"（英字1文字/ローマ数字 + 数字の階層）,
// "3-2"（第3条の2。normalizeText で変換）
const ARTICLE_NUMBER = String.raw`\b(?:[ivx]+|[a-z])\.\d+(?:\.\d+)*|\d+(?:\.\d+)+|\d+-\d+`;
// 項目記号: "(a)", "(ii)"。"a" は機能語として除外されるため別トークンにする
const SUB_PARAGRAPH = String.raw`\((?:[a-z]|[ivx]+)\)`;
const WORD = String.raw`[a-z0-9]+(?:'[a-z]+)?`;
const CJK = String.raw`[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶ]+`;

const TOKEN_PATTERN = new RegExp(
  `(${ARTICLE_NUMBER})|(${SUB_PARAGRAPH})|(${CJK})|(${WORD})`,
  "gu"
);

/**
 * 英語の機能語（ほぼ全条文に出現しスコアのノイズになる）。
 * インデックス時・クエリ時の両方で除外する。
 */
const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "if",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "which",
  "with",
]);

export function normalizeText(text: string): string {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      // "第3条の2" → "3-2", "第7条" → "7"（PDF抽出時の条文番号表記と揃える）
      .replace(/第\s*(\d+)\s*条(?:\s*の\s*(\d+))?/g, (_, n, sub) =>
        sub ? ` ${n}-${sub} ` : ` ${n} `
      )
  );
}

function cjkBigrams(run: string): string[] {
  const chars = Array.from(run);
  if (chars.length === 1) {
    return chars;
  }
  const grams: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) {
    grams.push(chars[i] + chars[i + 1]);
  }
  return grams;
}

export function tokenizeDetailed(text: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  const normalized = normalizeText(text);

  for (const match of Array.from(normalized.matchAll(TOKEN_PATTERN))) {
    const [, article, subParagraph, cjk, word] = match;
    if (article) {
      tokens.push({ text: article, kind: "article" });
    } else if (subParagraph) {
      tokens.push({ text: subParagraph, kind: "word" });
    } else if (cjk) {
      for (const gram of cjkBigrams(cjk)) {
        tokens.push({ text: gram, kind: "cjk" });
      }
    } else if (word && !ENGLISH_STOP_WORDS.has(word)) {
      tokens.push({ text: word, kind: "word" });
    }
  }

  return tokens;
}

export function tokenize(text: string): string[] {
  return tokenizeDetailed(text).map((t) => t.text);
}
