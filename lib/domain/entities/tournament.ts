export type CompetitionType = "standard" | "rapid" | "blitz";

/**
 * Rapid / Blitz の監督体制（FIDE Laws of Chess 2023, Appendix A / B）。
 *
 * 2023年版 Laws の条文との対応:
 * - Rapid
 *   - "competition-rules" = Article A.4（1人のアービターが最大3局を監督し、
 *     各局が記録される場合は Competitive Rules of Play を適用）
 *   - "basic-rules"       = Article A.5（それ以外。違法手は A.5.2 による）
 * - Blitz
 *   - "competition-rules" = Article B.2（1人のアービターが1局を監督し、記録される場合）
 *   - "basic-rules"       = Article B.3（それ以外。A.2, A.3, A.5 に従う）
 *
 * 要件・設計資料の "Rapid A.4 / A.5" は 2023年版の Rapid A.4 / A.5 と一致する。
 * ただし Blitz では同じ区別が B.2 / B.3 になるため、条文番号ではなく中立な名称で表現する。
 * どちらを適用するかは大会規定で指定される（A.6 / B.4）。
 */
export type SupervisionRegime = "competition-rules" | "basic-rules";

/** 判断に用いる規則セットのバージョン */
export type RulesVersion = "FIDE-2023";

export const SUPPORTED_RULES_VERSIONS: readonly RulesVersion[] = ["FIDE-2023"];

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
  /** 大会管理機能（後続マイルストーン）までは未設定の場合がある */
  timeControl?: TimeControl;
  /** Rapid / Blitz の場合は必須（大会規定で指定） */
  supervisionRegime?: SupervisionRegime;
  rulesVersion: RulesVersion;
  startDate: Date;
  endDate?: Date;
  regulations: TournamentRegulation[];
  createdAt: Date;
  updatedAt: Date;
}
