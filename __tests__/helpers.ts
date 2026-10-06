import type { DomainProviders } from "@/lib/domain/providers";

export const FIXED_NOW = new Date("2026-01-01T10:00:00Z");

/** 決定的な ID・時刻を返す provider（テスト用） */
export function fixedProviders(prefix = "id"): DomainProviders {
  let n = 0;
  return {
    generateId: () => `${prefix}-${++n}`,
    now: () => new Date(FIXED_NOW),
  };
}
