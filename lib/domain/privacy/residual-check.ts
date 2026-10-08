/**
 * 置き換え後の残存チェック（external-ai-data-protection.md §5.4）。純粋関数。
 *
 * pii-redaction とは**独立した**検出器を使う（同じ完全一致を置き換え後にもう一度
 * 確かめても、必ず通ってしまうため）。何か見つかれば送信しない（fail closed）。
 */
import type { KnownIdentifiers } from "./pii-redaction";
import { normalizeName } from "./normalize";
import { neutralizeBrackets, textOutsidePlaceholders } from "./placeholders";

export type ResidualFinding =
  /** 登録済みの識別子（緩い照合: かな・空白・中黒・姓だけ） */
  | "registered-identifier"
  /** 3桁以上の数字（手・秒・分・回・目が続くものを除く） */
  | "digits"
  /** 日付 */
  | "date"
  /** 時刻（時計の表示を除く） */
  | "time"
  /** 盤・ラウンド */
  | "board-round"
  /** ラベル付きの ID */
  | "labelled-id"
  /** 英字の敬称・タイトルの後の大文字の語 */
  | "latin-title-name"
  /** 連絡先 */
  | "contact"
  /** プレースホルダー以外の文字が少なすぎる（classify / facts） */
  | "too-short";

export interface ResidualResult {
  ok: boolean;
  findings: ResidualFinding[];
}

/** classify / facts で、プレースホルダー以外に必要な文字数 */
export const MIN_NARRATIVE_CHARS = 8;

const DETECTORS: readonly { finding: ResidualFinding; re: RegExp }[] = [
  { finding: "contact", re: /@[\w-]+\.|https?:|www\.|\d{2,4}-\d{2,4}-\d{3,4}/ },
  {
    finding: "date",
    re: /(令和|平成|昭和)\s*(元|\d|[一二三四五六七八九十])|\d+\s*日(?![目間])|\d{4}\s*年|\d+\s*月\s*\d+\s*日|[〇一二三四五六七八九十]+月[〇一二三四五六七八九十]+日|\d{4}[-/.]\d{1,2}|(?<![\d/-])\d{1,2}\/\d{1,2}(?![\d/-])|[月火水木金土日]曜/,
  },
  {
    finding: "time",
    re: /(午前|午後)\s*[\d〇一二三四五六七八九十]|\d+\s*時(?![間計])\s*\d*|[〇一二三四五六七八九十]+時(半|[〇一二三四五六七八九十]+分|頃|ごろ|に|から|まで|過ぎ|すぎ|ちょうど)/,
  },
  {
    finding: "board-round",
    re: /(ラウンド|回戦)\s*[\d〇一二三四五六七八九十]|\d+\s*(回戦|ラウンド|番?(ボード|盤|テーブル|卓|席))|第\s*[0-9〇一二三四五六七八九十]+\s*(回戦|ラウンド|局|番|ボード|盤|テーブル|卓|席)|(ボード|盤|テーブル|席)\s*\d|\b(Board|Round|Table)\s*\d/i,
  },
  {
    finding: "labelled-id",
    re: /(会員|登録|JCF|FIDE|LINE|ID|番号|No\.?)\s*[:：]\s*[A-Za-z0-9_.@-]{3,}|(会員|登録|JCF|FIDE|LINE|ID|番号|No\.?)\s*[A-Za-z0-9_.-]*\d/,
  },
  {
    finding: "latin-title-name",
    re: /\b(GM|IM|FM|CM|WGM|WIM|WFM|WCM|NM|Mr|Ms|Mrs|Miss|Dr)\.?\s+[A-Z]/,
  },
];

/** 時計の表示（残り・時計・白・黒・フラッグなどの近くの H:MM）は時刻として扱わない */
function withoutClockReadings(text: string): string {
  const strong = text.replace(
    /((?:残り|持ち時間|時計|表示|秒読み)[\s\S]{0,6}?)\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}(?::\d{2})?(?=\s*残)/g,
    (_m, before?: string) => `${before ?? ""}#`
  );
  // 白・黒・フラッグの近くは 2:59 以下だけ（時刻と区別する。pii-redaction と同じ範囲）
  return strong.replace(
    /((?:白番|黒番|白|黒|フラッグ|フラグ)[\s\S]{0,6}?)(?<!\d)[0-2]:\d{2}(?::\d{2})?(?![\d:])|(?<![\d:])[0-2]:\d{2}(?::\d{2})?(?=\s*で?(フラッグ|フラグ|時間切|0になった))/g,
    (_m, before?: string) => `${before ?? ""}#`
  );
}

/** 3桁以上の数字（手・秒・分・回・目が続くものは回数・時間として残す） */
const DIGITS = /\d{3,}(?![\d手秒分回目])/;
/** 時計の表示以外の H:MM（時刻） */
const CLOCK_LIKE = /\d{1,2}:\d{2}/;

function looseIdentifierHit(text: string, ids: KnownIdentifiers): boolean {
  const hay = normalizeName(text);
  const needles: string[] = [];
  /** 1文字の漢字の姓（前後が漢字でない場合だけ） */
  const singles: string[] = [];
  const add = (v?: string) => {
    if (!v) return;
    const n = normalizeName(v);
    if (n.length >= 2) needles.push(n);
  };
  for (const p of ids.players) {
    add(p.name);
    add(p.fideId);
    const parts = p.name
      .normalize("NFKC")
      .trim()
      .split(/[\s・]+/);
    parts.forEach((part, index) => {
      add(part);
      const n = normalizeName(part);
      // 1文字の漢字は姓（先頭の部分）だけ（pii-redaction と同じ）
      if (
        parts.length > 1 &&
        index === 0 &&
        n.length === 1 &&
        /[\u4e00-\u9fff々]/.test(n)
      )
        singles.push(n);
    });
    // 空白なしで登録された漢字の名前: 先頭2文字（姓）でも照合する
    const n = normalizeName(p.name);
    if (parts.length === 1 && n.length >= 3 && /^[一-鿿々]{2}/.test(n))
      needles.push(n.slice(0, 2));
    // 1文字の漢字の名前（「林」）
    if (n.length === 1 && /[一-鿿々]/.test(n)) singles.push(n);
  }
  for (const v of [...ids.tournaments, ...ids.venues, ...ids.officials]) {
    add(v);
    for (const part of v
      .normalize("NFKC")
      .trim()
      .split(/[\s・]+/))
      add(part);
  }
  if (
    singles.some((n) =>
      new RegExp(
        // 直後が漢字、または送り仮名（助詞以外のひらがな）なら別の語
        `(?<![\\u4e00-\\u9fff々])${n}(?![\\u4e00-\\u9fff々]|[ぁ-ゖ](?<![がのはをにともへやで]))`
      ).test(hay)
    )
  )
    return true;
  return needles.some((n) =>
    /^[a-z0-9]+$/.test(n)
      ? new RegExp(`(?<![a-z0-9])${n}(?![a-z0-9])`).test(hay)
      : hay.includes(n)
  );
}

export function residualCheck(
  redacted: string,
  ids: KnownIdentifiers,
  options: { minNarrativeChars?: number } = {}
): ResidualResult {
  const findings = new Set<ResidualFinding>();
  const beforeClock = textOutsidePlaceholders(
    neutralizeBrackets(redacted.normalize("NFKC"))
  );
  // 3時以降の H:MM に「に・から・まで・頃・過ぎ」が続けば、時計の近くでも時刻
  if (
    /(?<![\d:])([3-9]|1\d|2[0-3]):\d{2}(?=\s*(に|から|まで|頃|ごろ|過ぎ|すぎ))/.test(
      beforeClock
    )
  )
    findings.add("time");
  const outside = withoutClockReadings(beforeClock);
  if (looseIdentifierHit(outside, ids)) findings.add("registered-identifier");
  if (DIGITS.test(outside)) findings.add("digits");
  for (const d of DETECTORS) if (d.re.test(outside)) findings.add(d.finding);
  if (CLOCK_LIKE.test(outside)) findings.add("time");
  if (
    options.minNarrativeChars !== undefined &&
    outside.replace(/[\s、。・,.!?！？]/g, "").length <
      options.minNarrativeChars
  )
    findings.add("too-short");
  return { ok: findings.size === 0, findings: Array.from(findings) };
}
