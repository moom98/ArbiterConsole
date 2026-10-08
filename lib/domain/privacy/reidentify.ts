/**
 * 端末での元の表記への復元（external-ai-data-protection.md §6.2）。純粋関数。
 *
 * - 対応表はリクエストごとに作り、端末のメモリ内だけにある
 * - 対応表にないプレースホルダー（モデルが作ったものなど）はそのまま残し、
 *   unknownPlaceholders で返す（判断は validation: needs-review にする）
 * - 表示用。保存する LLM の生の出力（llmRaw）はプレースホルダーのまま
 */
import { PLACEHOLDER_PATTERN, type PlaceholderMap } from "./placeholders";

export interface ReidentifyResult {
  text: string;
  unknownPlaceholders: string[];
}

export function reidentify(
  text: string,
  map: PlaceholderMap
): ReidentifyResult {
  const unknown = new Set<string>();
  const out = text.replace(
    new RegExp(PLACEHOLDER_PATTERN.source, "g"),
    (ph: string) => {
      const original = map.original(ph);
      if (original === undefined) {
        unknown.add(ph);
        return ph;
      }
      return original;
    }
  );
  return { text: out, unknownPlaceholders: Array.from(unknown) };
}
