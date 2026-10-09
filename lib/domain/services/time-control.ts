/**
 * 持ち時間のピリオド（FIDE Laws 2023 Article 8.4 / Guidelines III.3.1。ADR-014 §7）のドメインサービス。
 *
 * - 旧形式（initialMinutes / incrementSeconds）の持ち時間を、1つのピリオドへ変換する（Dexie v8・読み込み時）。
 * - 手数から現在のピリオドを求め、加算と「最終ピリオドか」を設定から導出する。
 *   求められない場合（ピリオドが不完全、複数ピリオドで手数が不明）は undefined を返し、呼び出し側が質問する。
 * - 8.4（記録義務の免除）を、残り時間・ピリオド中に5分を下回ったか・加算から判定する。
 *
 * 純粋関数のみ（React・DB・LLM に依存しない）。
 */

import type {
  CompetitionType,
  RuleCitation,
  TimeControl,
  TimeControlPeriod,
} from "@/lib/domain/entities";
import type { FactAnswer, FactId } from "@/lib/domain/facts/types";
import { cite } from "@/lib/domain/rules/citations";

/** 8.4 の「5分」（秒） */
export const RECORDING_EXEMPTION_THRESHOLD_SECONDS = 5 * 60;
/** 8.4 の「30秒以上の加算」（秒） */
export const RECORDING_EXEMPTION_MAX_INCREMENT_SECONDS = 30;
/** 入力できるピリオドの上限（実際の持ち時間は多くても3〜4） */
export const MAX_TIME_CONTROL_PERIODS = 5;

function isPositiveInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1;
}

function isNonNegativeInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** フォーム等からの入力（未入力の項目を許す） */
export interface TimeControlInput {
  periods?: Partial<TimeControlPeriod>[];
  delaySeconds?: number;
  periodsIncomplete?: boolean;
  additionalTimeAfterMove?: number;
}

/** 入力の不足・不正を返す（空配列なら有効） */
export function validateTimeControl(
  tc: TimeControlInput | undefined
): string[] {
  const errors: string[] = [];
  const periods = tc?.periods ?? [];
  if (periods.length === 0) {
    errors.push("持ち時間（分）は1以上の整数で入力してください");
    errors.push("加算（秒/手）は0以上の整数で入力してください");
    return errors;
  }
  if (periods.length > MAX_TIME_CONTROL_PERIODS)
    errors.push(`ピリオドは${MAX_TIME_CONTROL_PERIODS}つまでです`);
  const single = periods.length === 1;
  periods.forEach((p, i) => {
    const label = single ? "" : `第${i + 1}ピリオドの`;
    const isLast = i === periods.length - 1;
    if (!isPositiveInteger(p.minutes))
      errors.push(`${label}持ち時間（分）は1以上の整数で入力してください`);
    if (!isNonNegativeInteger(p.incrementSeconds))
      errors.push(`${label}加算（秒/手）は0以上の整数で入力してください`);
    if (isLast) {
      if (p.moves !== undefined)
        errors.push(
          "最後のピリオドは残りの全ての手を指すため、手数を入力しないでください"
        );
    } else if (!isPositiveInteger(p.moves)) {
      errors.push(`${label}手数は1以上の整数で入力してください`);
    }
  });
  if (tc?.delaySeconds !== undefined && !isNonNegativeInteger(tc.delaySeconds))
    errors.push("遅延（秒）は0以上の整数で入力してください");
  return errors;
}

/** 検証済みの入力から TimeControl を作る（不要なフィールドを落とし、複製する） */
export function buildTimeControl(tc: TimeControlInput): TimeControl {
  const periods = (tc.periods ?? []).map((p, i, all): TimeControlPeriod => ({
    ...(i < all.length - 1 ? { moves: p.moves! } : {}),
    minutes: p.minutes!,
    incrementSeconds: p.incrementSeconds!,
  }));
  return {
    periods,
    ...(tc.delaySeconds !== undefined ? { delaySeconds: tc.delaySeconds } : {}),
    ...(tc.periodsIncomplete ? { periodsIncomplete: true } : {}),
    ...(tc.additionalTimeAfterMove !== undefined
      ? { additionalTimeAfterMove: tc.additionalTimeAfterMove }
      : {}),
  };
}

/**
 * 保存されている持ち時間を現在の形式へ変換する（Dexie v8 の upgrade と、読み込み時の保険）。
 * - periods がある: そのまま（複製）。
 * - 旧形式 { initialMinutes, incrementSeconds }: 1つのピリオドにするが、**常に periodsIncomplete** とする。
 *   旧フォームには2つ目以降のピリオドを入力する欄がなく、"40手90分 → 30分" の大会も
 *   "90分+30秒" として保存されているため、単一ピリオド（= 常に最終ピリオド）とは限らない。
 *   アービターがプロフィール画面でピリオドを確認するまで、現在のピリオド・最終ピリオドは質問する。
 * - 旧形式の additionalTimeAfterMove: 何手目の後に加わるかが分からないため値を保持する。
 * 解釈できない値は undefined（持ち時間未設定として扱い、質問する）。
 */
export function normalizeTimeControl(raw: unknown): TimeControl | undefined {
  if (!isRecord(raw)) return undefined;
  const delay = isNonNegativeInteger(raw.delaySeconds)
    ? { delaySeconds: raw.delaySeconds }
    : {};
  const legacyExtra = isNonNegativeInteger(raw.additionalTimeAfterMove)
    ? {
        additionalTimeAfterMove: raw.additionalTimeAfterMove,
        periodsIncomplete: true as const,
      }
    : {};
  if (Array.isArray(raw.periods)) {
    const periods = raw.periods as Partial<TimeControlPeriod>[];
    const tc: TimeControlInput = {
      periods,
      ...delay,
      ...(raw.periodsIncomplete === true ? { periodsIncomplete: true } : {}),
      ...legacyExtra,
    };
    return validateTimeControl(tc).length === 0
      ? buildTimeControl(tc)
      : undefined;
  }
  if (
    isPositiveInteger(raw.initialMinutes) &&
    isNonNegativeInteger(raw.incrementSeconds)
  ) {
    return {
      periods: [
        { minutes: raw.initialMinutes, incrementSeconds: raw.incrementSeconds },
      ],
      ...delay,
      ...legacyExtra,
      periodsIncomplete: true,
    };
  }
  return undefined;
}

export interface CurrentPeriod {
  /** 1から数える */
  number: number;
  period: TimeControlPeriod;
  /** 残りの全ての手を指す最後のピリオドか */
  isLast: boolean;
}

/**
 * 現在のピリオド。moveNumber は今指している手の番号（1から。例: 40手で区切る場合、
 * 40手目までが第1ピリオド、41手目から第2ピリオド）。
 * - ピリオドが1つなら手数なしで求まる。
 * - 複数なら手数が必要。ピリオドが不完全・手数が不正なら undefined。
 */
export function currentPeriod(
  tc: TimeControl | undefined,
  moveNumber?: number
): CurrentPeriod | undefined {
  if (!tc || tc.periodsIncomplete || tc.periods.length === 0) return undefined;
  const last = tc.periods.length;
  if (last === 1) return { number: 1, period: tc.periods[0], isLast: true };
  if (!isPositiveInteger(moveNumber)) return undefined;
  let end = 0;
  for (let i = 0; i < last; i++) {
    const p = tc.periods[i];
    if (i === last - 1) return { number: i + 1, period: p, isLast: true };
    // 検証済みのデータでは起きない（最後以外のピリオドに手数がない）。判断しない
    if (!isPositiveInteger(p.moves)) return undefined;
    end += p.moves;
    if (moveNumber <= end) return { number: i + 1, period: p, isLast: false };
  }
  return undefined;
}

/**
 * 持ち時間の設定（と手数）から求められる fact の値（FactContext.derivedValues 用）。
 * 求められない fact は含めない（その場合は質問する。fact-model §3.6）。
 */
export function deriveTimeControlFacts(
  tc: TimeControl | undefined,
  moveNumber?: number
): Partial<Record<FactId, FactAnswer>> {
  const cur = currentPeriod(tc, moveNumber);
  if (!cur) return {};
  return {
    "ss.current-period": { value: cur.number },
    "ss.increment": { value: cur.period.incrementSeconds },
    "ct.last-period": { value: cur.isLast ? "true" : "false" },
  };
}

/** DT-004 の lastPeriod を設定から求める（求められない場合は undefined = 質問する） */
export function lastPeriodFromTimeControl(
  tc: TimeControl | undefined,
  moveNumber?: number
): boolean | undefined {
  return currentPeriod(tc, moveNumber)?.isLast;
}

// ---------------------------------------------------------------------------
// FIDE 8.4: 記録義務の免除
// ---------------------------------------------------------------------------

export interface RecordingObligationInput {
  competitionType: CompetitionType;
  /** 記入していない側の時計の、今の残り時間（秒。ss.remaining-time） */
  remainingSeconds?: number;
  /**
   * 今の残り時間が5分未満か（ss.remaining-time を5分と比べた回答。DT-011 はこちらを質問する）。
   * remainingSeconds がある場合はそちらを使う
   */
  belowFiveNow?: boolean;
  /** このピリオドの中で、残り時間が一度でも5分を下回ったか（ss.below-five-in-period） */
  belowFiveInPeriod?: boolean;
  /** 現在のピリオドの1手ごとの加算（秒。ss.increment。設定から求めたもの） */
  incrementSeconds?: number;
  /**
   * 現在のピリオドの加算が30秒以上か（設定から秒数を求められない場合の回答・全ピリオドで同じ場合）。
   * incrementSeconds がある場合はそちらを使う
   */
  incrementAtLeast30?: boolean;
  /**
   * 遅延（Delay）秒数。8.4 は「1手ごとに加算される時間」とだけ定めており、遅延を加算と同じに
   * 扱うかは原典から確定できない。遅延がある場合は免除を確定せず、CAへの確認を求める。
   */
  delaySeconds?: number;
}

export type RecordingObligationMissing =
  | "remainingTime"
  | "belowFiveInPeriod"
  | "increment"
  /** 遅延がある持ち時間（8.4 の扱いを原典から確定できない） */
  | "delayTreatment";

export type RecordingObligation =
  /** 8.4 により、このピリオドの残りは 8.1.1 の記録義務がない */
  | { status: "exempt"; explanation: string; sources: RuleCitation[] }
  /** 8.4 の免除に当たらない（8.1.1 の記録義務がある） */
  | { status: "required"; explanation: string; sources: RuleCitation[] }
  /** 判定に必要な事実が足りない */
  | {
      status: "unknown";
      missing: RecordingObligationMissing[];
      explanation: string;
      sources: RuleCitation[];
    }
  /** Standard 以外。8.4 の判定対象外（判断しない） */
  | { status: "not-assessed"; explanation: string; sources: RuleCitation[] };

/**
 * FIDE 8.4 の判定（三値）。
 * - 免除: 加算が30秒未満、かつ（今の残りが5分未満、またはこのピリオド中に一度でも5分未満になった）。
 *   「for the remainder of the period」のため、加算で5分以上に戻っても免除は続く。
 * - 義務あり: 加算が30秒以上、または（今の残りが5分以上で、このピリオド中に5分未満になっていない）。
 * - それ以外は unknown（不足している事実を返す）。
 * 8.1.1 の記録義務がある Standard の対局のみを判定する（fact-model §3.6、カタログ ss.remaining-time）。
 */
export function assessRecordingObligation(
  input: RecordingObligationInput
): RecordingObligation {
  const sources = cite("FIDE_8_4", "FIDE_8_1_1");
  if (input.competitionType !== "standard") {
    return {
      status: "not-assessed",
      explanation:
        "8.4 の判定は Standard の対局だけを対象にしています。大会規定と Appendix を確認してください。",
      sources,
    };
  }
  const inc = isNonNegativeInteger(input.incrementSeconds)
    ? input.incrementSeconds
    : undefined;
  const atLeast30 =
    inc !== undefined
      ? inc >= RECORDING_EXEMPTION_MAX_INCREMENT_SECONDS
      : input.incrementAtLeast30;
  const rem =
    typeof input.remainingSeconds === "number" &&
    Number.isFinite(input.remainingSeconds) &&
    input.remainingSeconds >= 0
      ? input.remainingSeconds
      : undefined;
  const below = input.belowFiveInPeriod;

  if (atLeast30 === true) {
    return {
      status: "required",
      explanation: `1手ごとの加算が${inc !== undefined ? `${inc}秒（30秒以上）` : "30秒以上"}のため、8.4 の免除はありません。8.1.1 により記録が必要です。`,
      sources,
    };
  }
  const lowNow =
    rem === undefined
      ? input.belowFiveNow
      : rem < RECORDING_EXEMPTION_THRESHOLD_SECONDS;
  // ピリオド中に5分未満になったか: 今5分未満、または「下回った」の回答なら成り立つ。
  // 「下回っていない」の回答なら成り立たない（今も5分以上）。それ以外は不明
  const lowInPeriod =
    lowNow === true || below === true
      ? true
      : below === false
        ? false
        : undefined;

  if (lowInPeriod === false) {
    return {
      status: "required",
      explanation:
        "このピリオドで残り時間が5分を下回っていないため、8.4 の免除はありません。8.1.1 により記録が必要です。",
      sources,
    };
  }
  const hasDelay =
    typeof input.delaySeconds === "number" && input.delaySeconds > 0;
  if (lowInPeriod === true && atLeast30 === false && hasDelay) {
    return {
      status: "unknown",
      missing: ["delayTreatment"],
      explanation: `遅延（${input.delaySeconds}秒）のある持ち時間です。8.4 は1手ごとの加算についてだけ定めており、遅延の扱いを原典から確定できないため、CAへ確認してください。`,
      sources,
    };
  }
  if (lowInPeriod === true && atLeast30 === false) {
    return {
      status: "exempt",
      explanation:
        lowNow === true
          ? "残り時間が5分未満で、1手ごとの加算が30秒未満のため、このピリオドの残りは記録義務がありません（8.4）。"
          : "このピリオド中に残り時間が5分を下回り、1手ごとの加算が30秒未満のため、5分以上に戻っていても、このピリオドの残りは記録義務がありません（8.4）。",
      sources,
    };
  }

  const missing: RecordingObligationMissing[] = [];
  if (atLeast30 === undefined) missing.push("increment");
  if (lowInPeriod === undefined) {
    if (lowNow === undefined) missing.push("remainingTime");
    else missing.push("belowFiveInPeriod");
  }
  return {
    status: "unknown",
    missing,
    explanation:
      "8.4 の免除に当たるかを判定するには、残り時間・このピリオド中に5分を下回ったか・現在のピリオドの加算が必要です。",
    sources,
  };
}

// ---------------------------------------------------------------------------
// DT-011: 現在のピリオドの加算（設定から求める・質問する）
// ---------------------------------------------------------------------------

/**
 * 8.4 の判定に使う、現在のピリオドの加算の求め方（DT-011）。
 * - known:       設定から秒数が決まる（確認済みの単一ピリオド、またはピリオドの回答）
 * - class-known: どのピリオドでも「30秒以上か」が同じ（ピリオドを尋ねなくてよい）
 * - ask-period:  確認済みの複数ピリオドで、ピリオドによって変わる（ピリオドを選んでもらう）
 * - ask-increment: 設定がない・不完全（加算を直接尋ねる）
 * - unknown:     ピリオドが「わからない」
 */
export type RecordingIncrement =
  | { status: "known"; incrementSeconds: number }
  | { status: "class-known"; atLeast30: boolean }
  | { status: "ask-period" }
  | { status: "ask-increment" }
  | { status: "unknown" };

/** period: 選ばれたピリオド（1から）または "unknown"。未回答は undefined */
export function recordingIncrement(
  tc: TimeControl | undefined,
  period?: number | "unknown"
): RecordingIncrement {
  if (!tc || tc.periodsIncomplete || tc.periods.length === 0)
    return { status: "ask-increment" };
  const single = currentPeriod(tc);
  if (single)
    return {
      status: "known",
      incrementSeconds: single.period.incrementSeconds,
    };
  const classes = new Set(
    tc.periods.map(
      (p) => p.incrementSeconds >= RECORDING_EXEMPTION_MAX_INCREMENT_SECONDS
    )
  );
  if (classes.size === 1)
    return { status: "class-known", atLeast30: classes.has(true) };
  if (period === undefined) return { status: "ask-period" };
  if (period === "unknown") return { status: "unknown" };
  const p = tc.periods[period - 1];
  return p
    ? { status: "known", incrementSeconds: p.incrementSeconds }
    : { status: "ask-period" };
}

/** ピリオドの選択肢（「第2ピリオド（41〜60手目・加算30秒）」）。DT-011 の質問用 */
export function timeControlPeriodOptions(
  tc: TimeControl
): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  let start = 1;
  tc.periods.forEach((p, i) => {
    const range =
      p.moves !== undefined && i < tc.periods.length - 1
        ? `${start}〜${start + p.moves - 1}手目`
        : `${start}手目以降`;
    out.push({
      value: String(i + 1),
      label: `第${i + 1}ピリオド（${range}・加算${p.incrementSeconds}秒）`,
    });
    if (p.moves !== undefined) start += p.moves;
  });
  return out;
}
