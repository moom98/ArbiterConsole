/**
 * 外部 AI のデータ保護（ADR-012）で使う文字の正規化。純粋関数。
 *
 * - NFKC: 全角英数・半角カナを揃える
 * - かな折り畳み: カタカナをひらがなへ（1文字ずつ置き換えるため、位置が変わらない）
 */

/** NFKC 正規化 */
export function nfkc(text: string): string {
  return text.normalize("NFKC");
}

const KATAKANA_START = 0x30a1; // ァ
const KATAKANA_END = 0x30f6; // ヶ
const HIRAGANA_START = 0x3041; // ぁ
const HIRAGANA_END = 0x3096; // ゖ
const KANA_OFFSET = KATAKANA_START - HIRAGANA_START;

/** カタカナをひらがなへ折り畳む（文字数・位置は変わらない） */
export function foldToHiragana(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    out +=
      code >= KATAKANA_START && code <= KATAKANA_END
        ? String.fromCodePoint(code - KANA_OFFSET)
        : ch;
  }
  return out;
}

/** ひらがなをカタカナへ（既存のカタカナの規則を、ひらがなの表記にも当てるため） */
export function foldToKatakana(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    out +=
      code >= HIRAGANA_START && code <= HIRAGANA_END
        ? String.fromCodePoint(code + KANA_OFFSET)
        : ch;
  }
  return out;
}

/**
 * 2通りで照合する正規表現（Appendix A の照合規則）。
 * - そのまま（NFKC の本文）
 * - ひらがなへ折り畳んだ本文に、ひらがなへ折り畳んだ規則（unfoldedOnly なら行わない）
 */
export interface DualPattern {
  nfkc: RegExp;
  folded?: RegExp;
}

/** 規則の文字列から DualPattern を作る（g フラグ付き。exec / matchAll 用） */
export function dual(
  source: string,
  options: { flags?: string; unfoldedOnly?: boolean } = {}
): DualPattern {
  const flags = `g${options.flags ?? ""}`;
  return {
    nfkc: new RegExp(source, flags),
    folded: options.unfoldedOnly
      ? undefined
      : new RegExp(foldToHiragana(source), flags),
  };
}

/** 照合に使う本文の組 */
export interface MatchText {
  nfkc: string;
  folded: string;
}

export function matchText(raw: string): MatchText {
  const n = nfkc(raw);
  return { nfkc: n, folded: foldToHiragana(n) };
}

export interface Span {
  start: number;
  end: number;
}

/** 本文の組で一致する範囲（NFKC と折り畳みは同じ位置） */
export function spans(pattern: DualPattern, text: MatchText): Span[] {
  const out: Span[] = [];
  const run = (re: RegExp, s: string) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      out.push({ start: m.index, end: m.index + m[0].length });
    }
  };
  run(pattern.nfkc, text.nfkc);
  if (pattern.folded) run(pattern.folded, text.folded);
  return out;
}

export function matchesAny(
  patterns: readonly DualPattern[],
  text: MatchText
): boolean {
  return patterns.some((p) => spans(p, text).length > 0);
}

/** 名前の照合用: NFKC・ひらがなへ折り畳み・空白と「・」を除く・英字は小文字 */
export function normalizeName(text: string): string {
  return foldToHiragana(nfkc(text))
    .replace(/[\s・･]/g, "")
    .toLowerCase();
}

/**
 * 名前の照合用に正規化した本文と、正規化後の各文字の元の位置。
 * 元の本文の範囲へ戻して置き換えるために使う。
 */
export function normalizedWithOrigins(text: string): {
  text: string;
  /** 正規化後の i 文字目（UTF-16 の位置）の元の開始位置 */
  starts: number[];
  /** 正規化後の i 文字目の元の終了位置 */
  ends: number[];
} {
  let out = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of text) {
    const n = normalizeName(ch);
    for (let k = 0; k < n.length; k++) {
      out += n[k];
      starts.push(i);
      ends.push(i + ch.length);
    }
    i += ch.length;
  }
  return { text: out, starts, ends };
}
