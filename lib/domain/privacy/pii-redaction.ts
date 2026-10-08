/**
 * PII の置き換え（external-ai-data-protection.md §5.1, §5.2, §5.5）。純粋関数。
 *
 * - 規則は決まった順に適用する（電話番号や ISO の日付を途中で分割しないため）
 * - どの規則も〈…〉の中は対象外。出力にもう一度かけても変わらない（冪等）
 * - 機微かどうかは判断しない（Sensitive Gate の役割。D8）
 */
import { normalizeName, normalizedWithOrigins } from "./normalize";
import {
  PlaceholderMap,
  mapOutsidePlaceholders,
  type PlaceholderKind,
} from "./placeholders";

/** 端末に登録済みの識別子（§5.1）。リポジトリが読み込む */
export interface KnownIdentifiers {
  /** PlayerProfile と Game.white / Game.black（暫定大会の手入力の名前を含む） */
  players: readonly { name: string; fideId?: string; title?: string }[];
  /** Tournament.name */
  tournaments: readonly string[];
  /** Tournament.venue */
  venues: readonly string[];
  /** Tournament.chiefArbiter など、選手以外の人物 */
  officials: readonly string[];
}

export const NO_IDENTIFIERS: KnownIdentifiers = {
  players: [],
  tournaments: [],
  venues: [],
  officials: [],
};

/**
 * - incident: 事故由来のテキスト（報告文・メモ・検索語）。すべての規則
 * - regulation: 大会規定の本文。規則 1・4・5・12 だけ（§5.5）
 */
export type RedactionMode = "incident" | "regulation";

// ---------------------------------------------------------------------------
// 共通の表現
// ---------------------------------------------------------------------------

const KANJI_NUM = "[〇一二三四五六七八九十百]";
const NUM = `(?:[0-9]+|${KANJI_NUM}+)`;
/** 名前・団体名などに使う文字（漢字・カタカナ・英字。ひらがなで区切る） */
const NAME_CHARS = "[\\u3400-\\u4dbf\\u4e00-\\u9fff々〆ヶァ-ヺーA-Za-z]";

/** 時計の表示として残す（§5.2.1）: 直前6文字以内に「残り」等、または直後に「残」 */
const CLOCK_BEFORE = /(残り|持ち時間|時計|表示|秒読み).{0,6}$/;
const CLOCK_AFTER = /^\s*残/;

type Replacer = (segment: string, map: PlaceholderMap) => string;

function rule(
  pattern: RegExp,
  kind: PlaceholderKind | ((m: string) => PlaceholderKind),
  keep?: (match: RegExpExecArray, segment: string) => boolean
): Replacer {
  return (segment, map) => {
    const re = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"
    );
    let out = "";
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(segment)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (keep?.(m, segment)) continue;
      const k = typeof kind === "function" ? kind(m[0]) : kind;
      out += segment.slice(last, m.index) + map.placeholder(k, m[0]);
      last = m.index + m[0].length;
    }
    return out + segment.slice(last);
  };
}

// ---------------------------------------------------------------------------
// 規則（§5.2 の順）
// ---------------------------------------------------------------------------

/** 1. 連絡先 */
const CONTACT = rule(
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?:\/\/[^\s〈〉]+|www\.[^\s〈〉]+|\+81[\d\s-]{8,}\d|0\d{1,4}-\d{1,4}-\d{3,4}|0\d{9,10}(?!\d)/,
  "連絡先"
);

/** 2. 日付 */
const DATE = rule(
  new RegExp(
    [
      "\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}",
      "\\d{4}年\\s*\\d{1,2}月\\s*\\d{1,2}日",
      "\\d{1,2}月\\s*\\d{1,2}日",
      `${KANJI_NUM}{1,3}月${KANJI_NUM}{1,3}日`,
      // 「1/2-1/2」（引き分けの結果）は日付ではない
      "(?<![\\d/-])\\d{1,2}/\\d{1,2}(?![\\d/-])",
      "[(（][月火水木金土日][)）]",
      "[月火水木金土日]曜日?",
    ].join("|")
  ),
  "日時"
);

/** 3. 時刻（時計の表示は残す） */
const TIME = rule(
  /(?:午前|午後)\s*\d{1,2}(?:時(?:\d{1,2}分|半)?|:\d{2})(?:頃|ごろ)?|\d{1,2}時(?![間計])(?:\d{1,2}分|半)?(?:頃|ごろ)?|(?<![\d:])\d{1,2}:\d{2}(?::\d{2})?(?![\d:])/,
  "日時",
  (m, segment) =>
    /^\d/.test(m[0]) &&
    m[0].includes(":") &&
    (CLOCK_BEFORE.test(segment.slice(0, m.index)) ||
      CLOCK_AFTER.test(segment.slice(m.index + m[0].length)))
);

/** 5. ラベル付きの会員番号・ID */
const LABELLED_ID = rule(
  /(?:会員|登録|JCF|FIDE|ID|番号|No\.?)\s*[:：]?\s*[A-Za-z0-9-]*\d[A-Za-z0-9-]*(?<=[A-Za-z0-9-]{3,})|\b[A-Z]{1,4}-?\d{3,}\b/,
  "ID"
);

/** 6. 登録されていない大会名 */
const TOURNAMENT_NAME = rule(
  new RegExp(
    `第${NUM}回${NAME_CHARS}{0,20}?(?:大会|選手権|杯|オープン|リーグ)|${NAME_CHARS}{1,12}(?:杯|選手権)`
  ),
  "大会"
);

/** 7. チーム・学校・クラブ */
const ORGANIZATION = rule(
  new RegExp(
    `${NAME_CHARS}{1,12}(?:高等学校|高校|中学校|中学|小学校|大学|クラブ|チーム|支部|道場|教室|同好会)`
  ),
  "団体"
);

/**
 * 8. 盤・テーブル・ラウンド・席（「N台」は対象外）。
 * 棋譜の表記に一致させない: 小文字の「b4」はマス、「Bd3」「Rd1」は駒の手。
 * 略記の Bd / Rd は空白か「.」の後の番号だけを対象にする
 */
const BOARD = rule(
  new RegExp(
    [
      `第?${NUM}番?(?:ボード|盤|テーブル|卓|席)`,
      `(?:ボード|盤|テーブル|席)\\s?${NUM}(?:番)?`,
      "\\b(?:Board|board|BOARD|Table|table|TABLE)\\s?\\d+\\b",
      "\\bBd(?:\\.\\s*|\\s+)\\d+\\b",
      "\\bB\\s?\\d+\\b",
    ].join("|")
  ),
  "盤"
);
const ROUND = rule(
  new RegExp(
    [
      `第?${NUM}(?:回戦|ラウンド|局)`,
      `第?[0-9]+R(?![A-Za-z])`,
      "\\b(?:Round|round|ROUND)\\s?\\d+\\b",
      "\\bRd(?:\\.\\s*|\\s+)\\d+\\b",
      "\\bR\\s?\\d+\\b",
    ].join("|")
  ),
  "ラウンド"
);

/** 9. 5桁以上の数字 */
const LONG_NUMBER = rule(/\d{5,}/, "ID");

/** 10. その他の4桁の数字（レーティングなど） */
const FOUR_DIGITS = rule(/(?<!\d)\d{4}(?!\d)/, "数値");

/** 11. 準識別子（年齢・学年・タイトル） */
const TITLES = "(?:GM|IM|FM|CM|WGM|WIM|WFM|WCM|NM)";
const ATTRIBUTE_ONLY = rule(
  new RegExp(
    `\\d{1,3}\\s*歳|(?:小学|中学|高校)\\s*[1-6一二三四五六]\\s*年(?:生)?|[1-6一二三四五六]\\s*年生|\\b${TITLES}\\b`
  ),
  "属性"
);
/** タイトルの直後の英字の名前（「IM Smith」）は、タイトルと別に人物として置き換える */
const TITLE_NAME = new RegExp(
  `\\b(${TITLES})\\.?(\\s+)([A-Z][A-Za-z'-]+)`,
  "g"
);
const ATTRIBUTE: Replacer = (segment, map) =>
  ATTRIBUTE_ONLY(
    segment.replace(
      TITLE_NAME,
      (_m, title: string, space: string, name: string) =>
        `${map.placeholder("属性", title)}${space}${map.placeholder("人物", name)}`
    ),
    map
  );

/** 12. 敬称の付いた登録されていない名前（役割の名詞は対象外） */
const ROLE_NOUNS = [
  "白",
  "黒",
  "白番",
  "黒番",
  "相手",
  "両",
  "対戦",
  "当該",
  "隣",
  "本人",
  "女子",
  "男子",
  "若手",
  "年配",
  "高齢",
  "子供",
  "ジュニア",
  "シニア",
  "各",
  "全",
  "同",
  "違反",
  "該当",
];
const HONORIFIC = new RegExp(
  `(${NAME_CHARS}+)(?=さん|君|くん|ちゃん|選手(?!権)|氏(?!名)|様(?!子|々)|先生)`,
  "g"
);
const HONORIFIC_NAME: Replacer = (segment, map) =>
  segment.replace(HONORIFIC, (run: string) =>
    ROLE_NOUNS.some((r) => run.endsWith(r))
      ? run
      : map.placeholder("人物", run, normalizeName(run))
  );

/** 13. 登録されていない英字の名前 */
const LATIN_ALLOW = new Set(
  [
    "Chief",
    "Arbiter",
    "Arbiters",
    "Deputy",
    "Laws",
    "Chess",
    "Article",
    "Articles",
    "Appendix",
    "Guidelines",
    "Quickplay",
    "Finish",
    "Rapid",
    "Blitz",
    "Standard",
    "Fair",
    "Play",
    "Touch",
    "Move",
    "Competition",
    "Rules",
    "Basic",
    "Manual",
    "Handbook",
    "FIDE",
    "JCF",
    "King",
    "Queen",
    "Rook",
    "Bishop",
    "Knight",
    "Pawn",
    "White",
    "Black",
    "Draw",
    "Flag",
    "Illegal",
  ].map((w) => w.toLowerCase())
);
const LATIN_NAME: Replacer = (segment, map) =>
  segment
    .replace(/\b(?:Mr|Ms|Mrs|Miss|Dr)\.?\s+[A-Z][A-Za-z'-]+/g, (m) =>
      map.placeholder("人物", m)
    )
    .replace(/\b[A-Z][a-z'-]+\s+[A-Z][a-z'-]+\b/g, (m) => {
      const [a, b] = m.split(/\s+/);
      return LATIN_ALLOW.has(a.toLowerCase()) &&
        LATIN_ALLOW.has(b.toLowerCase())
        ? m
        : map.placeholder("人物", m);
    });

// ---------------------------------------------------------------------------
// 4. 登録済みの識別子
// ---------------------------------------------------------------------------

interface NameTarget {
  /** 正規化した照合文字列 */
  needle: string;
  kind: PlaceholderKind;
  /** 同じ人の部分（姓・名）を同じプレースホルダーにするための key */
  key: string;
  original: string;
}

/** 照合する名前の一覧（長い順。姓・名だけの照合は、空白で区切られた2文字以上の部分） */
export function nameTargets(ids: KnownIdentifiers): NameTarget[] {
  const out: NameTarget[] = [];
  const add = (
    value: string | undefined,
    kind: PlaceholderKind,
    withParts: boolean
  ) => {
    if (!value) return;
    const key = normalizeName(value);
    if (key.length < 2) return;
    out.push({ needle: key, kind, key, original: value });
    if (!withParts) return;
    const parts = value
      .normalize("NFKC")
      .trim()
      .split(/[\s・]+/);
    if (parts.length < 2) return;
    for (const part of parts) {
      const n = normalizeName(part);
      if (n.length >= 2) out.push({ needle: n, kind, key, original: value });
    }
  };
  for (const p of ids.players) {
    add(p.name, "選手", true);
    if (p.fideId) add(p.fideId, "ID", false);
    if (p.title) add(p.title, "属性", false);
  }
  for (const t of ids.tournaments) add(t, "大会", false);
  for (const v of ids.venues) add(v, "会場", false);
  for (const o of ids.officials) add(o, "人物", true);
  return out.sort((a, b) => b.needle.length - a.needle.length);
}

function registered(targets: NameTarget[]): Replacer {
  return (segment, map) => {
    if (targets.length === 0 || segment === "") return segment;
    const norm = normalizedWithOrigins(segment);
    // 元の本文の範囲 → プレースホルダー（長い名前を先に確保する）
    const taken: { start: number; end: number; ph: string }[] = [];
    for (const t of targets) {
      let from = 0;
      for (;;) {
        const i = norm.text.indexOf(t.needle, from);
        if (i < 0) break;
        from = i + 1;
        // 英数字の識別子は語の途中に一致させない（例: FIDE ID の一部の数字）
        const start = norm.starts[i];
        const end = norm.ends[i + t.needle.length - 1];
        if (taken.some((r) => start < r.end && r.start < end)) continue;
        if (
          /^[a-z0-9]+$/.test(t.needle) &&
          (/[A-Za-z0-9]/.test(segment[start - 1] ?? "") ||
            /[A-Za-z0-9]/.test(segment[end] ?? ""))
        )
          continue;
        taken.push({
          start,
          end,
          ph: map.placeholder(t.kind, t.original, t.key),
        });
      }
    }
    taken.sort((a, b) => a.start - b.start);
    let out = "";
    let last = 0;
    for (const r of taken) {
      out += segment.slice(last, r.start) + r.ph;
      last = r.end;
    }
    return out + segment.slice(last);
  };
}

// ---------------------------------------------------------------------------

export interface RedactionResult {
  text: string;
}

/**
 * 本文の識別子をプレースホルダーへ置き換える。map は同じリクエストの他の欄と共有する
 * （同じ名前は同じプレースホルダー）。
 */
export function redactPii(
  text: string,
  ids: KnownIdentifiers,
  map: PlaceholderMap,
  mode: RedactionMode = "incident"
): RedactionResult {
  const steps: Replacer[] =
    mode === "regulation"
      ? [CONTACT, registered(nameTargets(ids)), LABELLED_ID, HONORIFIC_NAME]
      : [
          CONTACT,
          DATE,
          TIME,
          registered(nameTargets(ids)),
          LABELLED_ID,
          TOURNAMENT_NAME,
          ORGANIZATION,
          BOARD,
          ROUND,
          LONG_NUMBER,
          FOUR_DIGITS,
          ATTRIBUTE,
          HONORIFIC_NAME,
          LATIN_NAME,
        ];
  let out = text.normalize("NFKC");
  map.reserve(out);
  for (const step of steps)
    out = mapOutsidePlaceholders(out, (segment) => step(segment, map));
  return { text: out };
}
