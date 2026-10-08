/**
 * Sensitive Gate（external-ai-data-protection.md §4, ADR-012）。純粋関数。
 *
 * 外部 AI へ送ってよいかを判断する。本文は変更しない（PII の置き換えは pii-redaction）。
 * - clear だけが送信できる。uncertain と blocked はローカルで処理する（D7）
 * - 偽陰性（機微な報告が clear）が最も重い誤り（D9）。迷う場合は uncertain にする
 * - 対象は事故由来のテキストだけ（規則の本文・構造化コードには使わない。§2）
 */
import type { IncidentCategory } from "@/lib/domain/entities";
import { mentionsFairPlay } from "@/lib/domain/llm/keyword-classifier";
import {
  foldToKatakana,
  matchText,
  spans,
  type MatchText,
  type Span,
} from "./normalize";
import {
  CONTEXT_EXPRESSIONS,
  SENSITIVE_EXPRESSIONS,
  type SensitiveClass,
} from "./sensitive-terms";

export type GateVerdict = "clear" | "uncertain" | "blocked";

export type GateReasonCode =
  /** L0: アービターが不正（フェアプレー）のカテゴリを選んだ */
  | "explicit-fair-play"
  /** L1: 「外部AIに送らない」がオン */
  | "arbiter-opt-out"
  /** L2: 既知の機微な表現 */
  | SensitiveClass
  /** L3: 文脈で機微と判断した表現 */
  | "context-sensitive"
  /** L3: 文脈で判断できない表現 */
  | "context-uncertain"
  /** L4: 解析できない文字が多い */
  | "unanalyzable"
  /** L4: 英字が主の本文 */
  | "mostly-latin"
  /** L4: 入力の上限を超える */
  | "too-long"
  /** L4: 置き換え後の残存チェックに失敗した */
  | "residual";

export interface GateReason {
  code: GateReasonCode;
  /** L3 の登録簿の ID（例: "smartphone"） */
  entry?: string;
}

export interface GateResult {
  verdict: GateVerdict;
  /** 表示用のコード。外部へ送らず、本文と一緒に記録しない */
  reasons: GateReason[];
}

export interface GateInput {
  /** 事故由来のテキスト（報告文・メモ・検索語） */
  text: string;
  /** アービターが選んだ、または Incident のカテゴリ（L0） */
  category?: IncidentCategory;
  /** L1: 「外部AIに送らない」スイッチ */
  doNotSend?: boolean;
  /** L1: フローの中で以前に付いた不正（フェアプレー）の印 */
  fairPlayFlag?: boolean;
  /** L4: ルートの入力上限（切り詰める前の文字数で判断する） */
  maxLength?: number;
  /** L4: 残存チェック（residual-check）が失敗した */
  residualFailed?: boolean;
}

/** L4: 日本語・英字・数字・一般的な記号以外の文字の割合の上限 */
export const MAX_UNANALYZABLE_RATIO = 0.1;
/** L4: 文字（日本語 + 英字）のうち英字の割合の上限 */
export const MAX_LATIN_LETTER_RATIO = 0.5;

const JAPANESE = /[぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿々〆ー]/;
const LATIN = /[A-Za-z]/;
const DIGIT = /[0-9]/;
/** 一般的な記号（全角は NFKC で半角へ揃えた後） */
const COMMON =
  /[\s、。・「」『』()（）［］[\]!?,.:;'"“”‘’…〜~\-+*/%#&=<>@_|〈〉→←↑↓○×]/;

const SEVERITY: Record<GateVerdict, number> = {
  clear: 0,
  uncertain: 1,
  blocked: 2,
};

function worst(a: GateVerdict, b: GateVerdict): GateVerdict {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
const covers = (outer: Span, inner: Span) =>
  outer.start <= inner.start && inner.end <= outer.end;

/** L2: 既知の機微な表現 */
function knownSensitive(text: MatchText): SensitiveClass[] {
  const out = new Set<SensitiveClass>();
  // 既存の不正の判定（カタカナの規則）は、ひらがなの表記にも当てる
  if (
    mentionsFairPlay(text.nfkc) ||
    mentionsFairPlay(foldToKatakana(text.nfkc))
  )
    out.add("fair-play");
  for (const e of SENSITIVE_EXPRESSIONS)
    if (spans(e.pattern, text).length > 0) out.add(e.class);
  return Array.from(out);
}

/** L3: 文脈で判断する表現（出現ごとに判断し、最も重い結果） */
function contextVerdicts(
  text: MatchText
): { entry: string; verdict: GateVerdict }[] {
  const out: { entry: string; verdict: GateVerdict }[] = [];
  for (const e of CONTEXT_EXPRESSIONS) {
    const occurrences = spans(e.triggers, text);
    if (occurrences.length === 0) continue;
    const sensitive = e.sensitive.flatMap((p) => spans(p, text));
    const benign = e.benign.flatMap((p) => spans(p, text));
    let verdict: GateVerdict = "clear";
    for (const occ of occurrences) {
      const v: GateVerdict = sensitive.some((s) => overlaps(s, occ))
        ? "blocked"
        : benign.some((b) => covers(b, occ))
          ? "clear"
          : "uncertain";
      verdict = worst(verdict, v);
    }
    if (verdict !== "clear") out.push({ entry: e.id, verdict });
  }
  return out;
}

/** L4: 解析できない入力 */
function unanalyzable(text: string): GateReasonCode[] {
  const out: GateReasonCode[] = [];
  let total = 0;
  let other = 0;
  let japanese = 0;
  let latin = 0;
  for (const ch of text) {
    total++;
    if (JAPANESE.test(ch)) japanese++;
    else if (LATIN.test(ch)) latin++;
    else if (!DIGIT.test(ch) && !COMMON.test(ch)) other++;
  }
  if (total > 0 && other / total > MAX_UNANALYZABLE_RATIO)
    out.push("unanalyzable");
  const letters = japanese + latin;
  if (letters > 0 && latin / letters > MAX_LATIN_LETTER_RATIO)
    out.push("mostly-latin");
  return out;
}

/**
 * 外部 AI へ送ってよいかを判断する（L0〜L4）。L5（サーバーでの再確認）はサーバーが
 * 同じ関数を使う。
 */
export function evaluateSensitivity(input: GateInput): GateResult {
  // L0: 不正（フェアプレー）のカテゴリは無条件（本文を見る前に判断する。D6）
  if (input.category === "fair-play")
    return { verdict: "blocked", reasons: [{ code: "explicit-fair-play" }] };

  const reasons: GateReason[] = [];
  let verdict: GateVerdict = "clear";

  // L1: 明示的な印
  if (input.doNotSend) {
    verdict = "blocked";
    reasons.push({ code: "arbiter-opt-out" });
  }
  if (input.fairPlayFlag) {
    verdict = "blocked";
    reasons.push({ code: "explicit-fair-play" });
  }

  const text = matchText(input.text);

  // L2
  for (const cls of knownSensitive(text)) {
    verdict = "blocked";
    reasons.push({ code: cls });
  }

  // L3
  for (const c of contextVerdicts(text)) {
    verdict = worst(verdict, c.verdict);
    reasons.push({
      code: c.verdict === "blocked" ? "context-sensitive" : "context-uncertain",
      entry: c.entry,
    });
  }

  // L4
  const l4: GateReasonCode[] = unanalyzable(text.nfkc);
  if (input.maxLength !== undefined && input.text.length > input.maxLength)
    l4.push("too-long");
  if (input.residualFailed) l4.push("residual");
  for (const code of l4) {
    verdict = worst(verdict, "uncertain");
    reasons.push({ code });
  }

  return { verdict, reasons };
}
