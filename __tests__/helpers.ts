import type { DomainProviders } from "@/lib/domain/providers";
import type { MatePositionInput } from "@/lib/domain/entities";
import type { MatePossibility } from "@/lib/domain/services/mate-possibility";

/**
 * Decision Tree 単体テスト用: 局面から判定したメイト可能性（ADR-014 §5）。
 * true = 検証済みのメイト手順あり / false = 駒の構成上メイト不可能 / "unknown" = 局面を入力できない
 */
export function mateOf(v: boolean | "unknown"): {
  matePosition: MatePositionInput;
  mate?: MatePossibility;
} {
  if (v === "unknown") return { matePosition: "unknown" };
  return {
    matePosition: "fen",
    mate: v
      ? {
          verdict: "can-mate",
          reason: "メイトする手順があります: 30. Qh7#",
          line: "30. Qh7#",
        }
      : {
          verdict: "cannot-mate",
          reason: "キングのみではチェックメイトできません",
        },
  };
}

export const FIXED_NOW = new Date("2026-01-01T10:00:00Z");

/** 決定的な ID・時刻を返す provider（テスト用） */
export function fixedProviders(prefix = "id"): DomainProviders {
  let n = 0;
  return {
    generateId: () => `${prefix}-${++n}`,
    now: () => new Date(FIXED_NOW),
  };
}

/**
 * 外部AIガードのテスト用: /api/llm/providers（送り先の確認）に答え、それ以外は call に渡す。
 * 分類は送信前に送り先を確かめるため（J2-1）
 */
export function answeringProviders<
  F extends (kind: string, body: unknown, deps?: unknown) => unknown,
>(
  call: F,
  info: { classify: "gemini" | "jev"; facts: boolean } = {
    classify: "gemini",
    facts: false,
  }
): F {
  return (async (kind: string, body: unknown, deps?: unknown) =>
    kind === "providers"
      ? { ok: true, result: info, model: "" }
      : call(kind, body, deps)) as unknown as F;
}
