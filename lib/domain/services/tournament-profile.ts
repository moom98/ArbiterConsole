import type {
  CompetitionType,
  RulesVersion,
  SupervisionRegime,
  TimeControl,
  Tournament,
  TournamentOverrides,
  TournamentRuleReference,
} from "@/lib/domain/entities";
import {
  AD_HOC_TOURNAMENT_PREFIX,
  SUPPORTED_RULES_VERSIONS,
} from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import { isValidTimePenaltyOverride } from "@/lib/domain/rules/time-penalty";
import {
  buildTimeControl,
  normalizeTimeControl,
  validateTimeControl,
  type TimeControlInput,
} from "./time-control";

/**
 * Tournament Profile（要件 §7）の入力・検証・生成。
 *
 * 競技区分・適用規則（A.4/A.5・B.2/B.3）・規則バージョンは必ず明示的に入力させる。
 * 持ち時間から競技区分を推定しない（§7: 初期持ち時間のみでは判断しない）。
 */
export interface TournamentProfileInput {
  name: string;
  startDate?: Date;
  endDate?: Date;
  venue?: string;
  chiefArbiter?: string;
  competitionType?: CompetitionType;
  supervisionRegime?: SupervisionRegime;
  rulesVersion?: RulesVersion;
  timeControl?: TimeControlInput;
  totalRounds?: number;
  /** Blitz B.2 の加算時間（秒）と出典。両方そろった場合のみ上書きとして保存する */
  blitzCompetitionTimePenalty?: {
    seconds?: number;
    source?: Partial<TournamentRuleReference>;
  };
}

function isPositiveInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1;
}

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** B.2 の加算時間の上書きを入力できる大会か（Blitz かつ competition-rules） */
export function acceptsBlitzCompetitionOverride(input: {
  competitionType?: CompetitionType;
  supervisionRegime?: SupervisionRegime;
}): boolean {
  return (
    input.competitionType === "blitz" &&
    input.supervisionRegime === "competition-rules"
  );
}

function overrideIsEmpty(
  o: TournamentProfileInput["blitzCompetitionTimePenalty"]
): boolean {
  return (
    !o ||
    (o.seconds === undefined &&
      !o.source?.document?.trim() &&
      !o.source?.article?.trim() &&
      !o.source?.quote?.trim())
  );
}

/** 入力の不足・不正を返す（空配列なら有効） */
export function validateTournamentProfile(
  input: TournamentProfileInput
): string[] {
  const errors: string[] = [];
  if (!input.name?.trim()) errors.push("大会名を入力してください");
  if (!isValidDate(input.startDate)) errors.push("開始日を入力してください");
  if (input.endDate !== undefined) {
    if (!isValidDate(input.endDate)) errors.push("終了日が不正です");
    else if (isValidDate(input.startDate) && input.endDate < input.startDate)
      errors.push("終了日は開始日以降にしてください");
  }
  if (!input.competitionType) errors.push("競技区分を選択してください");
  if (
    input.competitionType &&
    input.competitionType !== "standard" &&
    !input.supervisionRegime
  )
    errors.push("適用規則（A.4/A.5・B.2/B.3）を選択してください");
  if (!input.rulesVersion) errors.push("規則バージョンを選択してください");
  else if (!SUPPORTED_RULES_VERSIONS.includes(input.rulesVersion))
    errors.push("未対応の規則バージョンです");

  errors.push(...validateTimeControl(input.timeControl));
  if (input.totalRounds !== undefined && !isPositiveInteger(input.totalRounds))
    errors.push("ラウンド数は1以上の整数で入力してください");

  const o = input.blitzCompetitionTimePenalty;
  if (!overrideIsEmpty(o)) {
    if (!acceptsBlitzCompetitionOverride(input)) {
      errors.push(
        "B.2 の加算時間は Blitz・B.2（Competition Rules）の大会でのみ設定できます"
      );
    } else {
      if (!isPositiveInteger(o?.seconds))
        errors.push("大会規定の加算時間は1秒以上の整数で入力してください");
      if (!o?.source?.document?.trim())
        errors.push("大会規定の加算時間の出典（資料名）を入力してください");
    }
  }
  return errors;
}

function optionalText(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

function buildOverrides(
  input: TournamentProfileInput
): TournamentOverrides | undefined {
  const o = input.blitzCompetitionTimePenalty;
  if (overrideIsEmpty(o) || !acceptsBlitzCompetitionOverride(input))
    return undefined;
  const source: TournamentRuleReference = {
    document: o!.source!.document!.trim(),
    article: optionalText(o!.source?.article),
    quote: optionalText(o!.source?.quote),
  };
  if (!isValidTimePenaltyOverride(o!.seconds, source)) return undefined;
  return {
    blitzCompetitionTimePenaltySeconds: { value: o!.seconds!, source },
  };
}

export class TournamentProfileError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" / "));
    this.name = "TournamentProfileError";
  }
}

/**
 * 入力から Tournament を生成する（既存の大会の編集では id・作成日時・規定を引き継ぐ）。
 * 不正な入力は TournamentProfileError。
 */
export function buildTournament(
  input: TournamentProfileInput,
  providers: DomainProviders,
  existing?: Tournament
): Tournament {
  const errors = validateTournamentProfile(input);
  if (errors.length > 0) throw new TournamentProfileError(errors);
  const now = providers.now();
  const tc = input.timeControl!;
  const id = existing?.id ?? providers.generateId();
  if (id.startsWith(AD_HOC_TOURNAMENT_PREFIX))
    throw new TournamentProfileError(["暫定大会は編集できません"]);
  return {
    id,
    name: input.name.trim(),
    competitionType: input.competitionType!,
    supervisionRegime:
      input.competitionType === "standard"
        ? undefined
        : input.supervisionRegime,
    rulesVersion: input.rulesVersion!,
    timeControl: buildTimeControl(tc),
    startDate: input.startDate!,
    endDate: input.endDate,
    venue: optionalText(input.venue),
    chiefArbiter: optionalText(input.chiefArbiter),
    totalRounds: input.totalRounds,
    overrides: buildOverrides(input),
    regulations: existing?.regulations ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/** 既存の大会をフォーム入力に戻す（編集用） */
export function toProfileInput(t: Tournament): TournamentProfileInput {
  const o = t.overrides?.blitzCompetitionTimePenaltySeconds;
  return {
    name: t.name,
    startDate: t.startDate,
    endDate: t.endDate,
    venue: t.venue,
    chiefArbiter: t.chiefArbiter,
    competitionType: t.competitionType,
    supervisionRegime: t.supervisionRegime,
    rulesVersion: t.rulesVersion,
    timeControl: toTimeControlInput(t.timeControl),
    totalRounds: t.totalRounds,
    blitzCompetitionTimePenalty: o
      ? { seconds: o.value, source: { ...o.source } }
      : undefined,
  };
}

/**
 * 編集用の入力へ戻す（旧形式の値も変換する）。ピリオドが不完全な旧形式の値は、
 * 保存し直すまで periodsIncomplete と additionalTimeAfterMove を引き継ぐ。
 */
function toTimeControlInput(
  raw: TimeControl | undefined
): TimeControlInput | undefined {
  const tc = normalizeTimeControl(raw);
  if (!tc) return undefined;
  return { ...tc, periods: tc.periods.map((p) => ({ ...p })) };
}

/** 例: "3分+2秒"、"40手90分+30秒 → 30分+30秒" */
export function formatTimeControl(raw: TimeControl | undefined): string {
  const tc = normalizeTimeControl(raw);
  if (!tc) return "持ち時間未設定";
  const periods = tc.periods
    .map(
      (p) =>
        `${p.moves !== undefined ? `${p.moves}手` : ""}${p.minutes}分` +
        (p.incrementSeconds > 0 ? `+${p.incrementSeconds}秒` : "")
    )
    .join(" → ");
  const parts = [periods];
  if (tc.delaySeconds) parts.push(`（遅延${tc.delaySeconds}秒）`);
  if (tc.periodsIncomplete) parts.push("（ピリオド未確認）");
  return parts.join("");
}

const COMPETITION_LABEL: Record<CompetitionType, string> = {
  standard: "Standard",
  rapid: "Rapid",
  blitz: "Blitz",
};

export function regimeLabel(
  competitionType: CompetitionType,
  regime: SupervisionRegime | undefined
): string | null {
  if (competitionType === "standard" || !regime) return null;
  if (competitionType === "rapid")
    return regime === "competition-rules" ? "A.4" : "A.5";
  return regime === "competition-rules" ? "B.2" : "B.3";
}

export function formatRulesetSummary(t: Tournament): string {
  return [
    COMPETITION_LABEL[t.competitionType],
    regimeLabel(t.competitionType, t.supervisionRegime),
    formatTimeControl(t.timeControl),
    t.rulesVersion,
  ]
    .filter(Boolean)
    .join(" · ");
}
