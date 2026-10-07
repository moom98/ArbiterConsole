/**
 * AI の引用（quote）と登録規則の本文との照合（純粋関数）。ADR-007。
 *
 * 引用の一部だけを切り出すと意味が反転することがある（例: 「所持」←「所持してはならない」,
 * "shall be allowed" ← "No player shall be allowed"）。そのため:
 * - 引用の前後の文脈に否定・限定語がないことを確認する（quoteMatchesArticle）
 * - 表示では引用を含む文全体を示す（extractQuoteContext）。これが最終的な安全策
 */

/** 引用の最小文字数（正規化後）。日本語を含む断片は短めにする */
const MIN_CONTIGUOUS_CHARS = 20;
const MIN_CONTIGUOUS_CHARS_JA = 10;
const MIN_FRAGMENT_CHARS = 15;
const MIN_FRAGMENT_CHARS_JA = 8;
/** 省略できる本文の最大文字数（正規化後） */
const MAX_ELLIPSIS_GAP = 200;
/** 引用の前後を確認する文字数（空白を1つに詰めた文字列で数える） */
const CONTEXT_CHARS = 30;

const CJK = /[぀-ヿ㐀-鿿]/;

/** 1文字単位の正規化（NFKC・引用符/ダッシュの統一・小文字化） */
function normalizeChars(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .toLowerCase();
}

/**
 * 引用照合用の正規化: normalizeChars → 空白（改行を含む）の除去。
 * PDF 抽出では日本語の文字間に空白・改行が入ることがあるため、空白はすべて除去して比較する。
 */
export function normalizeForQuote(text: string): string {
  return normalizeChars(text).replace(/\s+/g, "");
}

/** 省略記号の表記揺れを "…" に統一する（NFKC 後の "..." / "⋯" / "．．．" 等） */
function unifyEllipsis(text: string): string {
  return text.normalize("NFKC").replace(/\.{3,}|⋯|…+/g, "…");
}

/**
 * 正規化した本文（空白なし = compact）と、空白を1つに詰めた本文（spaced）、
 * および compact の各文字が spaced / 原文のどこにあるかの対応表。
 * 1文字ずつ正規化するため、結合文字の扱いが文字列全体の NFKC とわずかに異なる場合がある。
 */
interface IndexedText {
  compact: string;
  spaced: string;
  /** compact[i] に対応する spaced の位置 */
  toSpaced: number[];
  /** compact[i] に対応する原文の位置 */
  toOriginal: number[];
}

function indexText(original: string): IndexedText {
  let compact = "";
  let spaced = "";
  const toSpaced: number[] = [];
  const toOriginal: number[] = [];
  let pendingSpace = false;
  let offset = 0;
  for (const ch of Array.from(original)) {
    const n = normalizeChars(ch);
    for (const c of Array.from(n)) {
      if (/\s/.test(c)) {
        pendingSpace = spaced.length > 0;
        continue;
      }
      if (pendingSpace) {
        spaced += " ";
        pendingSpace = false;
      }
      toSpaced.push(spaced.length);
      toOriginal.push(offset);
      spaced += c;
      compact += c;
    }
    offset += ch.length;
  }
  return { compact, spaced, toSpaced, toOriginal };
}

/**
 * 省略した本文に含まれると意味が反転しうる語（否定・禁止・例外）。
 * compact（空白なし）に対する部分一致のため、"another" 等の誤検出は安全側（不一致）になる。
 */
const NEGATION_IN_GAP =
  /not|never|n't|cannot|except|unless|however|prohibit|forbid|ない|ず|ません|禁止|禁じ|除く|除き|ただし|但し|例外/;

/** 引用の直前にあると意味を反転させる語（英語: 語単位、日本語: 直前の接頭辞） */
const NEGATION_BEFORE_EN =
  /\b(no|not|never|neither|nor|cannot|can't|won't|isn't|aren't|doesn't|don't|without|except|unless)\b[^.;:]*$/;
const NEGATION_BEFORE_JA = /[無不非未]$/;

/** 引用の直後に続くと意味を反転・限定する語 */
const NEGATION_AFTER_EN =
  /^[\s,;:]*(not|never|unless|except|only if|only when|provided that|provided,|if and only if|but not|save that|subject to)\b/;
const NEGATION_AFTER_JA =
  /^(?:し|せ|さ)?(?:てはならな|てはいけな|ない|ず|ません|禁止|禁じ)|^(?:こと|事)?(?:はできな|ができな)|^(?:わけ|訳)ではな|^とは限らな|^場合(?:を|は)除|^ただし|^但し|^に限り|^に限る|^のみ/;

function minChars(fragment: string, ja: number, other: number): number {
  return CJK.test(fragment) ? ja : other;
}

function contextNegates(
  idx: IndexedText,
  compactStart: number,
  compactEnd: number
): boolean {
  const s = idx.toSpaced[compactStart];
  const e = idx.toSpaced[compactEnd - 1] + 1;
  const before = idx.spaced.slice(Math.max(0, s - CONTEXT_CHARS), s);
  const after = idx.spaced.slice(e, e + CONTEXT_CHARS);
  const afterCompact = after.replace(/\s+/g, "");
  return (
    NEGATION_BEFORE_EN.test(before) ||
    NEGATION_BEFORE_JA.test(before.trimEnd()) ||
    NEGATION_AFTER_EN.test(after) ||
    NEGATION_AFTER_JA.test(afterCompact)
  );
}

/** 引用の断片（正規化済み）。不正な形式なら null */
function quoteFragments(quote: string): string[] | null {
  const fragments = unifyEllipsis(quote)
    .split("…")
    .map(normalizeForQuote)
    .filter((f) => f.length > 0);
  if (fragments.length === 0 || fragments.length > 2) return null;
  if (fragments.length === 1) {
    const [f] = fragments;
    if (f.length < minChars(f, MIN_CONTIGUOUS_CHARS_JA, MIN_CONTIGUOUS_CHARS))
      return null;
  } else if (
    fragments.some(
      (f) => f.length < minChars(f, MIN_FRAGMENT_CHARS_JA, MIN_FRAGMENT_CHARS)
    )
  ) {
    return null;
  }
  return fragments;
}

interface QuoteSpan {
  /** compact 上の開始位置（最初の断片） */
  start: number;
  /** compact 上の終了位置（最後の断片の終わり、排他） */
  end: number;
}

function findQuote(idx: IndexedText, fragments: string[]): QuoteSpan | null {
  const body = idx.compact;
  const [first, second] = fragments;
  // すべての出現位置を試す（最初の出現だけでは誤って不一致になる場合がある）
  for (
    let at = body.indexOf(first);
    at >= 0;
    at = body.indexOf(first, at + 1)
  ) {
    const firstEnd = at + first.length;
    if (second === undefined) {
      if (!contextNegates(idx, at, firstEnd))
        return { start: at, end: firstEnd };
      continue;
    }
    const at2 = body.indexOf(second, firstEnd);
    if (at2 < 0) continue;
    const gap = body.slice(firstEnd, at2);
    if (gap.length > MAX_ELLIPSIS_GAP || NEGATION_IN_GAP.test(gap)) continue;
    if (contextNegates(idx, at, firstEnd)) continue;
    if (contextNegates(idx, at2, at2 + second.length)) continue;
    return { start: at, end: at2 + second.length };
  }
  return null;
}

/**
 * 引用が条文本文と一致するか（意味の反転を防ぐため厳格に判定する）。
 * - 連続した引用: 20 文字（日本語 10 文字）以上。省略記号は1か所まで（各断片 15 / 8 文字以上、
 *   省略部分は 200 文字以内で否定・禁止・例外の語を含まない）
 * - 引用の直前に否定（no / not / never / 無・不 等）、直後に否定・限定（not / unless /
 *   only if / ない / ことはできない / わけではない / 場合を除き 等）がある場合は不一致
 */
export function quoteMatchesArticle(quote: string, content: string): boolean {
  const fragments = quoteFragments(quote);
  if (!fragments) return false;
  return findQuote(indexText(content), fragments) !== null;
}

export interface QuoteContext {
  /** 引用を含む文の、引用より前の部分（原文） */
  before: string;
  /** 引用部分（原文。省略記号で分けた場合は最初から最後の断片まで） */
  match: string;
  /** 引用を含む文の、引用より後の部分（原文） */
  after: string;
}

/** 文の区切り（日本語の句点・感嘆符・疑問符、英語のピリオド等 + 空白/行末） */
const SENTENCE_END = /[。．！？!?]|\.(?=\s|$)/g;

/**
 * 引用を含む文全体を原文から取り出す（表示用。引用部分を強調表示する）。
 * 照合できない場合は null。
 */
export function extractQuoteContext(
  quote: string,
  content: string
): QuoteContext | null {
  const fragments = quoteFragments(quote);
  if (!fragments) return null;
  const idx = indexText(content);
  const span = findQuote(idx, fragments);
  if (!span) return null;

  const matchStart = idx.toOriginal[span.start];
  const lastChar = idx.toOriginal[span.end - 1];
  const matchEnd = lastChar + (content.codePointAt(lastChar)! > 0xffff ? 2 : 1);

  let sentenceStart = 0;
  let sentenceEnd = content.length;
  SENTENCE_END.lastIndex = 0;
  for (let m = SENTENCE_END.exec(content); m; m = SENTENCE_END.exec(content)) {
    const boundary = m.index + m[0].length;
    if (boundary <= matchStart) sentenceStart = boundary;
    else if (m.index >= matchEnd - 1) {
      sentenceEnd = boundary;
      break;
    }
  }
  return {
    before: content.slice(sentenceStart, matchStart).replace(/^\s+/, ""),
    match: content.slice(matchStart, matchEnd),
    after: content.slice(matchEnd, sentenceEnd),
  };
}
