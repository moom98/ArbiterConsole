/**
 * 置き換えの対応表（external-ai-data-protection.md §5.2, §6.2）。
 *
 * - プレースホルダーは〈…〉で、リクエストごとに番号を振る（〈選手A〉〈日時1〉…）
 * - 同じ元の文字列は、同じリクエストの中で同じプレースホルダーになる
 * - 1つのプレースホルダーは1つの元の文字列だけを表すため、元へ戻せる（reidentify）
 * - 対応表は端末のメモリ内だけで使い、送信・保存しない
 */

export type PlaceholderKind =
  | "選手"
  | "人物"
  | "日時"
  | "ID"
  | "連絡先"
  | "大会"
  | "会場"
  | "団体"
  | "盤"
  | "ラウンド"
  | "数値"
  | "属性";

/** 〈…〉で囲まれた部分（置き換えの対象外） */
export const PLACEHOLDER_PATTERN = /〈[^〈〉]*〉/g;

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function letterIndex(n: number): string {
  // A..Z, AA..AZ, ...
  let out = "";
  let i = n;
  do {
    out = LETTERS[i % 26] + out;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return out;
}

export class PlaceholderMap {
  private readonly byKey = new Map<string, string>();
  private readonly byPlaceholder = new Map<string, string>();
  private readonly counters = new Map<PlaceholderKind, number>();
  /** 本文にもともとあったプレースホルダー（番号を重ねない） */
  private readonly reserved = new Set<string>();

  /**
   * 本文にすでにある〈…〉を予約する（入力された〈…〉や、別の対応表で置き換えた本文）。
   * 新しいプレースホルダーはその番号を使わないため、対応は1対1のまま
   */
  reserve(text: string): void {
    const re = new RegExp(PLACEHOLDER_PATTERN.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null)
      if (!this.byPlaceholder.has(m[0])) this.reserved.add(m[0]);
  }

  /**
   * 元の文字列のプレースホルダー。key は同一性の判定に使う（例: 正規化した名前）。
   * 同じ key は同じプレースホルダーになる
   */
  placeholder(kind: PlaceholderKind, original: string, key = original): string {
    const k = `${kind}\u0000${key}`;
    const existing = this.byKey.get(k);
    if (existing) return existing;
    let n = this.counters.get(kind) ?? 0;
    let ph: string;
    do {
      const index = kind === "選手" ? letterIndex(n) : String(n + 1);
      ph = `〈${kind}${index}〉`;
      n++;
    } while (this.reserved.has(ph));
    this.counters.set(kind, n);
    this.byKey.set(k, ph);
    this.byPlaceholder.set(ph, original);
    return ph;
  }

  /** プレースホルダー → 元の文字列 */
  original(placeholder: string): string | undefined {
    return this.byPlaceholder.get(placeholder);
  }

  get size(): number {
    return this.byPlaceholder.size;
  }

  /**
   * JSON にしない（送信・保存の誤りを防ぐ）。JSON.stringify は空のオブジェクトになる
   */
  toJSON(): Record<string, never> {
    return {};
  }
}

/**
 * プレースホルダー以外の部分にだけ fn を適用する（置き換えを冪等にするため）。
 */
export function mapOutsidePlaceholders(
  text: string,
  fn: (segment: string) => string
): string {
  let out = "";
  let last = 0;
  const re = new RegExp(PLACEHOLDER_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last));
}

/** プレースホルダーを除いた本文 */
export function textOutsidePlaceholders(text: string): string {
  return text.replace(PLACEHOLDER_PATTERN, "");
}
