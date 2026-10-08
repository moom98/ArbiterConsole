/**
 * 事故由来のテキストの送信前処理（external-ai-data-protection.md §3 の A〜E）。純粋関数。
 *
 *   A. Sensitive Gate（元の本文とカテゴリ）      → blocked / uncertain ならローカルで処理
 *   B. PII の置き換え（対応表は端末に残る）
 *   C. ルートごとの最小化
 *   D. 残存チェック（独立した検出器）             → 何か見つかればローカルで処理
 *   E. Sensitive Gate を置き換え後の本文にもう一度 → blocked / uncertain ならローカルで処理
 *
 * どの段階も失敗すれば送らない。元の本文は返さない。F（送信前のプレビュー）と
 * 実際の送信は application 層の external-ai-guard が行う。
 */
import type { IncidentCategory } from "@/lib/domain/entities";
import { evaluateSensitivity, type GateResult } from "./sensitive-gate";
import { redactPii, type KnownIdentifiers } from "./pii-redaction";
import {
  MINIMIZATION_LIMITS,
  minimizeNarrative,
  truncate,
} from "./minimization";
import {
  MIN_NARRATIVE_CHARS,
  residualCheck,
  type ResidualFinding,
} from "./residual-check";
import type { PlaceholderMap } from "./placeholders";

/** 事故由来のテキストを送るルート */
export type ProtectedTextRoute =
  "classify" | "facts" | "reason-description" | "embed-query";

/** 切り詰める前の入力の上限（超えれば L4 で uncertain） */
export const RAW_INPUT_LIMITS: Record<ProtectedTextRoute, number> = {
  classify: 2_000,
  facts: 2_000,
  "reason-description": 2_000,
  "embed-query": 1_000,
};

export interface ProtectInput {
  route: ProtectedTextRoute;
  text: string;
  category?: IncidentCategory;
  doNotSend?: boolean;
  fairPlayFlag?: boolean;
  identifiers: KnownIdentifiers;
  /** 同じリクエストの他の欄と共有する対応表 */
  map: PlaceholderMap;
}

export type ProtectResult =
  | { ok: true; text: string }
  | {
      ok: false;
      /** どの段階で止めたか */
      stage: "gate-raw" | "residual" | "gate-redacted";
      gate: GateResult;
      residual?: ResidualFinding[];
    };

function minimize(route: ProtectedTextRoute, redacted: string): string {
  switch (route) {
    case "classify":
    case "facts":
      return minimizeNarrative(redacted, MINIMIZATION_LIMITS.narrative);
    case "reason-description":
      return truncate(redacted.trim(), MINIMIZATION_LIMITS.reasonDescription);
    case "embed-query":
      return truncate(redacted.trim(), MINIMIZATION_LIMITS.embedQuery);
  }
}

export function protectIncidentText(input: ProtectInput): ProtectResult {
  const common = {
    category: input.category,
    doNotSend: input.doNotSend,
    fairPlayFlag: input.fairPlayFlag,
  };
  // A
  const raw = evaluateSensitivity({
    ...common,
    text: input.text,
    maxLength: RAW_INPUT_LIMITS[input.route],
    // 置き換える前の本文では名前が未知の語になる。語彙の判定は E で行う
    vocabulary: false,
  });
  if (raw.verdict !== "clear")
    return { ok: false, stage: "gate-raw", gate: raw };

  // B, C
  const redacted = redactPii(input.text, input.identifiers, input.map).text;
  const minimized = minimize(input.route, redacted);

  // D
  const narrativeRoute = input.route === "classify" || input.route === "facts";
  const residual = residualCheck(minimized, input.identifiers, {
    minNarrativeChars: narrativeRoute ? MIN_NARRATIVE_CHARS : undefined,
  });
  if (!residual.ok) {
    return {
      ok: false,
      stage: "residual",
      gate: evaluateSensitivity({
        ...common,
        text: minimized,
        residualFailed: true,
      }),
      residual: residual.findings,
    };
  }

  // E
  const again = evaluateSensitivity({ ...common, text: minimized });
  if (again.verdict !== "clear")
    return { ok: false, stage: "gate-redacted", gate: again };
  return { ok: true, text: minimized };
}
