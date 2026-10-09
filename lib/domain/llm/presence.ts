import { getFactDefinition } from "@/lib/domain/facts/catalog";
import type { FactId } from "@/lib/domain/facts/types";
import { findJevCalibration, type JevCalibration } from "./calibration";

/**
 * Jev の「報告文に明示されているか」の判定を、較正したしきい値で解釈する（純粋関数）。
 * fact-model.md §4.3, §5。
 *
 * - present は p ≥ その fact のしきい値の場合のみ。不確かな範囲も含め、それ以外はすべて missing
 * - 較正がない model（未較正モード）・しきい値のない fact は常に missing
 * - **値は埋めない。** 結果は質問の並べ方（記載なし → 先、記載あり → 後）にだけ使い、
 *   質問を省略しない（ADR-002, ADR-013）
 * - 不正な応答はすべて missing（安全側。アービターに全部を尋ねる）
 */

export type FactPresence = "present" | "missing";

export interface FactPresenceResult {
  /** 要求したすべての fact の判定（要求順） */
  byFact: Readonly<Record<FactId, FactPresence>>;
  /** 応答の model に較正があった */
  calibrated: boolean;
  /** 応答の形が正しかった（false なら全件 missing） */
  valid: boolean;
}

export interface ParsePresenceOptions {
  /** 応答の model（解決済みのバージョン） */
  model?: string;
  /** 送った factIds（応答はこれ以外のキーを含んではならない） */
  requestedFactIds: readonly FactId[];
  /** 既定は登録済みの較正。テストで差し替える */
  calibrations?: readonly JevCalibration[];
}

const isProbability = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

function allMissing(
  ids: readonly FactId[],
  calibrated: boolean,
  valid: boolean
): FactPresenceResult {
  return {
    byFact: Object.fromEntries(ids.map((id) => [id, "missing" as const])),
    calibrated,
    valid,
  };
}

/**
 * サーバーの raw の形: `{ presence: { [factId]: p }, provider: "jev" }`。
 * 要求していない fact のキー・[0, 1] にない値は不正。要求した fact の欠けは missing。
 */
export function parseFactPresence(
  raw: unknown,
  options: ParsePresenceOptions
): FactPresenceResult {
  const ids = options.requestedFactIds;
  const calibration = findJevCalibration(options.model, options.calibrations);
  const calibrated = calibration !== undefined;

  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return allMissing(ids, calibrated, false);
  const r = raw as Record<string, unknown>;
  if (r.provider !== "jev") return allMissing(ids, calibrated, false);
  const presence = r.presence;
  if (
    typeof presence !== "object" ||
    presence === null ||
    Array.isArray(presence)
  )
    return allMissing(ids, calibrated, false);
  const answers = presence as Record<string, unknown>;
  for (const [key, value] of Object.entries(answers)) {
    if (!ids.includes(key) || !isProbability(value))
      return allMissing(ids, calibrated, false);
  }

  const byFact: Record<FactId, FactPresence> = {};
  for (const id of ids) {
    const p = answers[id];
    const threshold = calibration?.presence[id];
    const definition = getFactDefinition(id);
    byFact[id] =
      definition?.presenceCheckable === true &&
      !definition.localOnly &&
      threshold !== undefined &&
      isProbability(p) &&
      p >= threshold
        ? "present"
        : "missing";
  }
  return { byFact, calibrated, valid: true };
}
