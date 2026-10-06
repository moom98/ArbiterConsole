export type CompetitionType = "standard" | "rapid" | "blitz";
export type RapidRulesType = "A4" | "A5";

export interface TimeControl {
  initialMinutes: number;
  incrementSeconds: number;
  additionalTimeAfterMove?: number;
}

export interface TournamentRegulation {
  id: string;
  title: string;
  content: string;
  priority: number;
  createdAt: Date;
}

export interface Tournament {
  id: string;
  name: string;
  competitionType: CompetitionType;
  timeControl: TimeControl;
  rapidRulesType?: RapidRulesType;
  startDate: Date;
  endDate?: Date;
  regulations: TournamentRegulation[];
  createdAt: Date;
  updatedAt: Date;
}
