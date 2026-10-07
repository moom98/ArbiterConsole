import type {
  CompetitionType,
  Game,
  RulesVersion,
  SupervisionRegime,
  Tournament,
  RulesetSnapshot,
} from "@/lib/domain/entities";
import { SUPPORTED_RULES_VERSIONS } from "@/lib/domain/entities";

/**
 * 報告時に明示的に指定する最小限の対局コンテキスト（暫定大会用。ADR-004）。
 * 大会が登録されている場合は、大会から導出した TournamentRuleset と対局を使う（ADR-006）。
 */
export interface ReportContext {
  competitionType: CompetitionType;
  /** Rapid / Blitz の場合は必須 */
  supervisionRegime?: SupervisionRegime;
  rulesVersion: RulesVersion;
  round: number;
  boardNumber: number;
}

function isPositiveInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1;
}

/** コンテキストの不足・不正を返す（空配列なら有効） */
export function validateReportContext(ctx: Partial<ReportContext>): string[] {
  const errors: string[] = [];
  if (!ctx.competitionType) errors.push("競技区分を選択してください");
  if (
    ctx.competitionType &&
    ctx.competitionType !== "standard" &&
    !ctx.supervisionRegime
  ) {
    errors.push("適用規則（A.4/A.5・B.2/B.3）を選択してください");
  }
  if (!ctx.rulesVersion) errors.push("規則バージョンを選択してください");
  if (!isPositiveInteger(ctx.round))
    errors.push("ラウンドは1以上の整数で入力してください");
  if (!isPositiveInteger(ctx.boardNumber))
    errors.push("ボード番号は1以上の整数で入力してください");
  return errors;
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 暫定大会の ID。同じ日・同じ規則セットの報告は同じ大会として扱う。
 */
export function adHocTournamentId(ctx: ReportContext, date: Date): string {
  const regime =
    ctx.competitionType === "standard" ? "-" : (ctx.supervisionRegime ?? "-");
  return `adhoc:${localDateKey(date)}:${ctx.competitionType}:${regime}:${ctx.rulesVersion}`;
}

/** 暫定対局の ID（大会 × ラウンド × ボード）。違法手回数の履歴キーになる */
export function adHocGameId(ctx: ReportContext, date: Date): string {
  return `${adHocTournamentId(ctx, date)}:r${ctx.round}:b${ctx.boardNumber}`;
}

export function buildAdHocTournament(
  ctx: ReportContext,
  now: Date
): Tournament {
  return {
    id: adHocTournamentId(ctx, now),
    name: `暫定大会 ${localDateKey(now)}`,
    competitionType: ctx.competitionType,
    supervisionRegime:
      ctx.competitionType === "standard" ? undefined : ctx.supervisionRegime,
    rulesVersion: ctx.rulesVersion,
    startDate: now,
    regulations: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function buildAdHocGame(ctx: ReportContext, now: Date): Game {
  return {
    id: adHocGameId(ctx, now),
    tournamentId: adHocTournamentId(ctx, now),
    round: ctx.round,
    boardNumber: ctx.boardNumber,
    // プレーヤー情報は大会管理機能で登録する（現時点では未登録）
    white: { name: "" },
    black: { name: "" },
    startTime: now,
    createdAt: now,
    updatedAt: now,
  };
}

/** 大会から導出した、判断に用いる規則セット（すべて大会プロファイルの明示的な値） */
export type TournamentRuleset = RulesetSnapshot;

export type TournamentRulesetResult =
  { ok: true; ruleset: TournamentRuleset } | { ok: false; errors: string[] };

/**
 * 大会プロファイルから規則セットを導出する。不足があれば既定値で補わずエラーを返す
 * （domain.md rule 5）。
 */
export function deriveRulesetFromTournament(
  tournament: Pick<
    Tournament,
    "competitionType" | "supervisionRegime" | "rulesVersion" | "overrides"
  >
): TournamentRulesetResult {
  const errors: string[] = [];
  if (!tournament.competitionType)
    errors.push("大会の競技区分が設定されていません");
  if (
    tournament.competitionType &&
    tournament.competitionType !== "standard" &&
    !tournament.supervisionRegime
  )
    errors.push("大会の適用規則（A.4/A.5・B.2/B.3）が設定されていません");
  if (!tournament.rulesVersion)
    errors.push("大会の規則バージョンが設定されていません");
  else if (!SUPPORTED_RULES_VERSIONS.includes(tournament.rulesVersion))
    errors.push(`未対応の規則バージョンです: ${tournament.rulesVersion}`);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    ruleset: {
      competitionType: tournament.competitionType,
      supervisionRegime:
        tournament.competitionType === "standard"
          ? undefined
          : tournament.supervisionRegime,
      rulesVersion: tournament.rulesVersion,
      // 報告時のスナップショットとして保存するため複製する
      tournamentOverrides: tournament.overrides
        ? structuredCloneOverrides(tournament.overrides)
        : undefined,
    },
  };
}

function structuredCloneOverrides(
  o: NonNullable<Tournament["overrides"]>
): NonNullable<Tournament["overrides"]> {
  const b2 = o.blitzCompetitionTimePenaltySeconds;
  return b2
    ? {
        blitzCompetitionTimePenaltySeconds: {
          value: b2.value,
          source: { ...b2.source },
        },
      }
    : {};
}
