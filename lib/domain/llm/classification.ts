import type { IncidentCategory, PlayerColor } from "@/lib/domain/entities";
import { isKnownSubtype } from "@/lib/domain/follow-up";
import { needsTournamentRules } from "./keyword-classifier";
import type { IncidentClassification } from "./types";

export const INCIDENT_CATEGORIES: readonly IncidentCategory[] = [
  "illegal-move",
  "board-piece",
  "clock-time",
  "game-result",
  "draw",
  "scoresheet",
  "player-behavior",
  "team",
  "fair-play",
  "tournament-admin",
];

const MAX_ITEMS = 5;
const MAX_TEXT = 200;

function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= MAX_TEXT)
    .slice(0, MAX_ITEMS);
}

/**
 * LLM の分類出力を検証・正規化する（純粋関数）。不正な場合は null。
 * - category は 10 分類のいずれか
 * - subtype は既知のもの（isKnownSubtype）のみ残す
 * - confidence は最大 medium（"high" は medium に制限）
 */
export function parseLlmClassification(
  raw: unknown
): IncidentClassification | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const r = raw as Record<string, unknown>;
  const category = r.category;
  if (
    typeof category !== "string" ||
    !(INCIDENT_CATEGORIES as readonly string[]).includes(category)
  )
    return null;
  const cat = category as IncidentCategory;
  const subtype =
    typeof r.subtype === "string" && isKnownSubtype(cat, r.subtype)
      ? r.subtype
      : undefined;
  const playerColor =
    r.playerColor === "white" || r.playerColor === "black"
      ? (r.playerColor as PlayerColor)
      : undefined;
  return {
    category: cat,
    subtype,
    playerColor,
    missingInformation: strings(r.missingInformation),
    followUpQuestions: strings(r.followUpQuestions),
    needsTournamentRules:
      typeof r.needsTournamentRules === "boolean"
        ? r.needsTournamentRules || needsTournamentRules(cat)
        : needsTournamentRules(cat),
    confidence: r.confidence === "low" ? "low" : "medium",
    method: "llm",
  };
}
