/**
 * 送信内容の再確認（L5。external-ai-data-protection.md §7）。純粋関数。
 *
 * サーバーは受け取った本文に、端末の識別子を知らないまま、次をもう一度行う:
 * - 事故由来のテキスト: Sensitive Gate の L2〜L4（語彙の判定を含む）、パターンの規則
 *   （§5.2 の 1〜3, 5〜13。登録済みの識別子がないため 4 は何もしない）、残存チェック
 * - 大会規定の本文: 規則 1・5・12 だけ（§5.5）
 *
 * 正しいクライアントの送信内容では何も変わらない（冪等）。ゲートが clear でない、または
 * 規則が本文を1か所でも変える場合は送らない。サーバーは本文を書き換えない（アービターが
 * プレビューで見た内容だけを送るため）。
 *
 * クライアント（protect.ts, external-ai-guard）も送る直前に同じ関数を通す。正しい
 * クライアントがサーバーで 400 にならないことを、この共有で保証する。
 */
import { redactPii, NO_IDENTIFIERS } from "./pii-redaction";
import { PlaceholderMap } from "./placeholders";
import { evaluateSensitivity, type GateReasonCode } from "./sensitive-gate";
import {
  MIN_NARRATIVE_CHARS,
  residualCheck,
  type ResidualFinding,
} from "./residual-check";
import type { ProtectedTextRoute } from "./protect";

/** 再確認で止めた理由（コードだけ。本文は含めない） */
export type RecheckFinding =
  /** パターンの規則が本文を変える（置き換えられていない識別子がある） */
  | "pattern"
  /** ゲートの判定が clear でない */
  | GateReasonCode
  /** 残存チェック */
  | ResidualFinding;

export type RecheckResult =
  { ok: true } | { ok: false; findings: RecheckFinding[] };

function result(findings: Set<RecheckFinding>): RecheckResult {
  return findings.size === 0
    ? { ok: true }
    : { ok: false, findings: Array.from(findings) };
}

/** 事故由来のテキスト（置き換え・最小化した後の、送る形のもの）を再確認する */
export function recheckIncidentText(
  text: string,
  route: ProtectedTextRoute
): RecheckResult {
  const findings = new Set<RecheckFinding>();

  if (redactPii(text, NO_IDENTIFIERS, new PlaceholderMap()).text !== text)
    findings.add("pattern");

  const gate = evaluateSensitivity({ text });
  if (gate.verdict !== "clear")
    for (const r of gate.reasons) findings.add(r.code);

  const narrativeRoute = route === "classify" || route === "facts";
  const residual = residualCheck(text, NO_IDENTIFIERS, {
    minNarrativeChars: narrativeRoute ? MIN_NARRATIVE_CHARS : undefined,
  });
  for (const f of residual.findings) findings.add(f);

  return result(findings);
}

/** 大会規定の本文（条文番号・題名・本文）を再確認する。規則 1・5・12 だけ（§5.5） */
export function recheckRegulationText(text: string): RecheckResult {
  const findings = new Set<RecheckFinding>();
  if (
    redactPii(text, NO_IDENTIFIERS, new PlaceholderMap(), "regulation").text !==
    text
  )
    findings.add("pattern");
  return result(findings);
}
