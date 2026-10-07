import type { Tournament } from "@/lib/domain/entities";
import type { TournamentProfileInput } from "@/lib/domain/services/tournament-profile";
import { FIXED_NOW } from "../helpers";

export function profileInput(
  over: Partial<TournamentProfileInput> = {}
): TournamentProfileInput {
  return {
    name: "テスト大会",
    startDate: new Date(2026, 9, 10),
    competitionType: "standard",
    rulesVersion: "FIDE-2023",
    timeControl: { initialMinutes: 90, incrementSeconds: 30 },
    ...over,
  };
}

export const B2_OVERRIDE = {
  value: 120,
  source: { document: "第1回テストブリッツ大会要項", article: "第5条" },
};

export function tournament(over: Partial<Tournament> = {}): Tournament {
  return {
    id: "T1",
    name: "テスト大会",
    competitionType: "standard",
    rulesVersion: "FIDE-2023",
    timeControl: { initialMinutes: 90, incrementSeconds: 30 },
    startDate: FIXED_NOW,
    regulations: [],
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...over,
  };
}
