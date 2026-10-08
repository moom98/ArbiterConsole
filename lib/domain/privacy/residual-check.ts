/**
 * 置き換え後の残存チェック（external-ai-data-protection.md §5.4）。純粋関数。
 *
 * pii-redaction とは**独立した**検出器を使う（同じ完全一致を置き換え後にもう一度
 * 確かめても、必ず通ってしまうため）。何か見つかれば送信しない（fail closed）。
 */
import type { KnownIdentifiers } from "./pii-redaction";
import { normalizeName } from "./normalize";
import { textOutsidePlaceholders } from "./placeholders";

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
    re: /\d+\s*月\s*\d+\s*日|[〇一二三四五六七八九十]+月[〇一二三四五六七八九十]+日|\d{4}[-/.]\d{1,2}|(?<![\d/-])\d{1,2}\/\d{1,2}(?![\d/-])|[月火水木金土日]曜/,
  },
  { finding: "time", re: /(午前|午後)\s*\d|\d+\s*時(?![間計])\s*\d*/ },
  {
    finding: "board-round",
    re: /\d+\s*(回戦|ラウンド|番?(ボード|盤|テーブル|卓|席))|第\s*[0-9〇一二三四五六七八九十]+\s*(回戦|ラウンド|局|番|ボード|盤|テーブル|卓|席)|(ボード|盤|テーブル|席)\s*\d|\b(Board|Round|Table)\s*\d/i,
  },
  {
    finding: "labelled-id",
    re: /(会員|登録|JCF|FIDE|ID|番号|No\.?)\s*[:：]?\s*[A-Za-z0-9-]*\d/,
  },
  {
    finding: "latin-title-name",
    re: /\b(GM|IM|FM|CM|WGM|WIM|WFM|WCM|NM|Mr|Ms|Mrs|Miss|Dr)\.?\s+[A-Z]/,
  },
];

/** 時計の表示（残り・持ち時間などの近くの H:MM）は時刻として扱わない */
function withoutClockReadings(text: string): string {
  return text.replace(
    /((?:残り|持ち時間|時計|表示|秒読み).{0,6}?)\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}(?::\d{2})?(?=\s*残)/g,
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
    for (const part of parts) add(part);
    // 空白なしで登録された漢字の名前: 先頭2文字（姓）でも照合する
    const n = normalizeName(p.name);
    if (parts.length === 1 && n.length >= 3 && /^[一-鿿々]{2}/.test(n))
      needles.push(n.slice(0, 2));
  }
  for (const v of [...ids.tournaments, ...ids.venues, ...ids.officials]) {
    add(v);
    for (const part of v
      .normalize("NFKC")
      .trim()
      .split(/[\s・]+/))
      add(part);
  }
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
  const outside = withoutClockReadings(
    textOutsidePlaceholders(redacted.normalize("NFKC"))
  );
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
