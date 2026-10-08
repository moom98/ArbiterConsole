/**
 * 事故由来のテキストの送信前処理（external-ai-data-protection.md §3 の A〜E）。純粋関数。
 *
 *   A. Sensitive Gate（元の本文とカテゴリ）      → blocked / uncertain ならローカルで処理
 *   B. PII の置き換え（対応表は端末に残る）
 *   C. ルートごとの最小化
 *   D. 残存チェック（独立した検出器）             → 何か見つかればローカルで処理
 *   E. Sensitive Gate を置き換え後の本文にもう一度 → blocked / uncertain ならローカルで処理
 *   E2. サーバーと同じ再確認（server-recheck, L5）を送る形の本文に → 止まればローカルで処理
 *       （正しいクライアントの送信がサーバーで 400 にならないようにする）
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
import { recheckIncidentText, type RecheckFinding } from "./server-recheck";

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
      stage: "gate-raw" | "residual" | "gate-redacted" | "recheck";
      gate: GateResult;
      residual?: ResidualFinding[];
      /** E2 で止めた理由（コードだけ） */
      recheck?: RecheckFinding[];
    };

/**
 * 切った後にも前後の空白を除く（送信の途中で trim されると、末尾を見る規則（「三時」の $ など）が
 * サーバーでだけ当たり、プレビューと送る本文も変わるため。送るのはこの値そのもの）
 */
function minimize(route: ProtectedTextRoute, redacted: string): string {
  switch (route) {
    case "classify":
    case "facts":
      return minimizeNarrative(redacted, MINIMIZATION_LIMITS.narrative).trim();
    case "reason-description":
      return truncate(
        redacted.trim(),
        MINIMIZATION_LIMITS.reasonDescription
      ).trim();
    case "embed-query":
      return truncate(redacted.trim(), MINIMIZATION_LIMITS.embedQuery).trim();
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

  // E: 登録されていない語のプレースホルダーは元に戻して判定する（中身が名前とは限らない。
  // 「妊婦さん」「リハビリクラブ」）。判定は端末内だけで行い、送るのは minimized
  const again = evaluateSensitivity({
    ...common,
    text: input.map.restoreUnverified(minimized),
  });
  if (again.verdict !== "clear")
    return { ok: false, stage: "gate-redacted", gate: again };

  // E2: サーバーは対応表を持たないため、プレースホルダーのままの本文で判定する
  const recheck = recheckIncidentText(minimized, input.route);
  if (!recheck.ok)
    return {
      ok: false,
      stage: "recheck",
      gate: { verdict: "uncertain", reasons: [{ code: "residual" }] },
      recheck: recheck.findings,
    };
  return { ok: true, text: minimized };
}
