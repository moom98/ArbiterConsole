/**
 * ルートごとの最小化（external-ai-data-protection.md §5.3）。純粋関数。
 * 置き換え後の本文から、判断に必要な部分だけを残す。
 */
import { PLACEHOLDER_PATTERN } from "./placeholders";

/** ルートごとの上限（文字数） */
export const MINIMIZATION_LIMITS = {
  /** classify / facts の narrative */
  narrative: 500,
  /** reason の description */
  reasonDescription: 1_000,
  /** 埋め込みの検索語 */
  embedQuery: 200,
} as const;

/** 意味を持たないつなぎの語（プレースホルダーと一緒にしか出ない文を落とすため） */
const CONNECTIVES =
  /^(?:が|は|と|の|に|で|を|も|や|へ|から|まで|より|および|及び|また|そして|さらに|さん|氏|vs\.?|対|・|-|:|：|\s)*$/i;

/** 文に分ける（句点・感嘆符・疑問符・改行） */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** プレースホルダーとつなぎの語だけの文か */
export function isPlaceholderOnly(sentence: string): boolean {
  const rest = sentence
    .replace(new RegExp(PLACEHOLDER_PATTERN.source, "g"), "")
    .replace(/[。、，,.！？!?「」『』()（）]/g, "");
  return CONNECTIVES.test(rest);
}

/**
 * classify / facts の narrative。プレースホルダーだけの文を落とし、上限で切る。
 * 上限を超える入力は、Sensitive Gate が切る前の長さで uncertain にする（L4）。
 */
export function minimizeNarrative(
  redacted: string,
  limit: number = MINIMIZATION_LIMITS.narrative
): string {
  const kept = sentences(redacted).filter((s) => !isPlaceholderOnly(s));
  return truncate(kept.join(""), limit);
}

/** 上限で切る（プレースホルダーの途中では切らない） */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let cut = text.slice(0, limit);
  const open = cut.lastIndexOf("〈");
  if (open > cut.lastIndexOf("〉")) cut = cut.slice(0, open);
  return cut;
}
