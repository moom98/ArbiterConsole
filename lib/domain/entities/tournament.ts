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
  /** 遅延（Delay）秒数。設定がない場合は省略 */
  delaySeconds?: number;
}

/**
 * 大会規定による上書きの出典。上書き値は必ず出典とともに保持する
 * （出典のない上書きは受け付けない。domain.md rule 3）。
 */
export interface TournamentRuleReference {
  /** 大会規定の資料名（例: "第10回○○ブリッツ大会要項"） */
  document: string;
  /** 条項（例: "第5条2項"）。任意 */
  article?: string;
  /** 規定の文言（逐語）。任意 */
  quote?: string;
}

export interface SourcedOverride<T> {
  value: T;
  source: TournamentRuleReference;
}

/**
 * 決定木が明示的に参照する大会固有の上書き。
 * 未設定の項目は上書きなし（FIDE/JCF の扱いのまま）であり、既定値を仮定しない。
 */
export interface TournamentOverrides {
  /**
   * Blitz B.2（competition-rules）で、違法手（7.5.5）・誤ったドロー主張（9.5.3）により
   * 相手へ加算する時間（秒）。ADR-005 で原典から確定できないとした値を大会規定で確定する。
   * Blitz かつ competition-rules の大会でのみ有効。
   */
  blitzCompetitionTimePenaltySeconds?: SourcedOverride<number>;
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
  /** 暫定大会（ADR-004）では未設定 */
  timeControl?: TimeControl;
  /** Rapid / Blitz の場合は必須（大会規定で指定） */
  supervisionRegime?: SupervisionRegime;
  rulesVersion: RulesVersion;
  startDate: Date;
  endDate?: Date;
  /** 会場（任意） */
  venue?: string;
  /** Chief Arbiter（任意） */
  chiefArbiter?: string;
  /** 予定ラウンド数（任意） */
  totalRounds?: number;
  /** 大会規定による明示的な上書き（ADR-006） */
  overrides?: TournamentOverrides;
  regulations: TournamentRegulation[];
  createdAt: Date;
  updatedAt: Date;
}

/** 報告フローの暫定大会（ADR-004）の ID 接頭辞 */
export const AD_HOC_TOURNAMENT_PREFIX = "adhoc:";

/** 暫定大会（大会管理で作成されていない大会）か */
export function isAdHocTournament(t: Pick<Tournament, "id">): boolean {
  return t.id.startsWith(AD_HOC_TOURNAMENT_PREFIX);
}
