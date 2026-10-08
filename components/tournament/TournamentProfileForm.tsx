"use client";

import { useState } from "react";
import type {
  CompetitionType,
  RulesVersion,
  SupervisionRegime,
} from "@/lib/domain/entities";
import { SUPPORTED_RULES_VERSIONS } from "@/lib/domain/entities";
import { QUESTIONS } from "@/lib/domain/follow-up";
import {
  acceptsBlitzCompetitionOverride,
  validateTournamentProfile,
  type TournamentProfileInput,
} from "@/lib/domain/services/tournament-profile";
import { MAX_TIME_CONTROL_PERIODS } from "@/lib/domain/services/time-control";

/** <input type="date"> の "YYYY-MM-DD" をローカル日付として解釈する */
function parseLocalDate(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatLocalDate(date: Date | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIntOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

interface PeriodFields {
  moves: string;
  minutes: string;
  incrementSeconds: string;
}

const EMPTY_PERIOD: PeriodFields = {
  moves: "",
  minutes: "",
  incrementSeconds: "",
};

interface FormFields {
  name: string;
  startDate: string;
  endDate: string;
  venue: string;
  chiefArbiter: string;
  competitionType?: CompetitionType;
  supervisionRegime?: SupervisionRegime;
  rulesVersion?: RulesVersion;
  /** 持ち時間のピリオド（ADR-014 §7）。最後のピリオドの moves は使わない */
  periods: PeriodFields[];
  delaySeconds: string;
  /** 旧形式の追加時間（何手目の後か不明）。確認済みにするまで保存し直しても引き継ぐ */
  legacyAdditionalMinutes?: number;
  /** 読み込んだ持ち時間のピリオドが不完全だったか（確認欄を表示し続ける） */
  legacyIncomplete: boolean;
  periodsConfirmed: boolean;
  totalRounds: string;
  b2Minutes: string;
  b2Document: string;
  b2Article: string;
  b2Quote: string;
}

function toFields(input?: TournamentProfileInput): FormFields {
  const o = input?.blitzCompetitionTimePenalty;
  return {
    name: input?.name ?? "",
    startDate: formatLocalDate(input?.startDate),
    endDate: formatLocalDate(input?.endDate),
    venue: input?.venue ?? "",
    chiefArbiter: input?.chiefArbiter ?? "",
    competitionType: input?.competitionType,
    supervisionRegime: input?.supervisionRegime,
    rulesVersion: input?.rulesVersion,
    periods: input?.timeControl?.periods?.length
      ? input.timeControl.periods.map((p) => ({
          moves: p.moves?.toString() ?? "",
          minutes: p.minutes?.toString() ?? "",
          incrementSeconds: p.incrementSeconds?.toString() ?? "",
        }))
      : [{ ...EMPTY_PERIOD }],
    delaySeconds: input?.timeControl?.delaySeconds?.toString() ?? "",
    legacyAdditionalMinutes: input?.timeControl?.periodsIncomplete
      ? input.timeControl.additionalTimeAfterMove
      : undefined,
    legacyIncomplete: !!input?.timeControl?.periodsIncomplete,
    periodsConfirmed: !input?.timeControl?.periodsIncomplete,
    totalRounds: input?.totalRounds?.toString() ?? "",
    b2Minutes: o?.seconds !== undefined ? String(o.seconds / 60) : "",
    b2Document: o?.source?.document ?? "",
    b2Article: o?.source?.article ?? "",
    b2Quote: o?.source?.quote ?? "",
  };
}

function toInput(f: FormFields): TournamentProfileInput {
  const b2Minutes = parseIntOrUndefined(f.b2Minutes);
  const hasB2 =
    f.b2Minutes.trim() !== "" ||
    f.b2Document.trim() !== "" ||
    f.b2Article.trim() !== "" ||
    f.b2Quote.trim() !== "";
  return {
    name: f.name,
    startDate: parseLocalDate(f.startDate),
    endDate: f.endDate ? parseLocalDate(f.endDate) : undefined,
    venue: f.venue,
    chiefArbiter: f.chiefArbiter,
    competitionType: f.competitionType,
    supervisionRegime: f.supervisionRegime,
    rulesVersion: f.rulesVersion,
    timeControl: {
      periods: f.periods.map((p, i) => ({
        moves:
          i < f.periods.length - 1 ? parseIntOrUndefined(p.moves) : undefined,
        minutes: parseIntOrUndefined(p.minutes),
        incrementSeconds: parseIntOrUndefined(p.incrementSeconds),
      })),
      delaySeconds: parseIntOrUndefined(f.delaySeconds),
      ...(f.periodsConfirmed
        ? {}
        : {
            periodsIncomplete: true,
            additionalTimeAfterMove: f.legacyAdditionalMinutes,
          }),
    },
    totalRounds: parseIntOrUndefined(f.totalRounds),
    blitzCompetitionTimePenalty: hasB2
      ? {
          seconds:
            b2Minutes === undefined ? undefined : Math.round(b2Minutes * 60),
          source: {
            document: f.b2Document,
            article: f.b2Article,
            quote: f.b2Quote,
          },
        }
      : undefined,
  };
}

const RULES_VERSION_LABEL: Record<RulesVersion, string> = {
  "FIDE-2023": "FIDE Laws of Chess 2023",
};

export interface TournamentProfileFormProps {
  initial?: TournamentProfileInput;
  submitLabel: string;
  onSubmit: (input: TournamentProfileInput) => Promise<void>;
  onCancel?: () => void;
}

const inputClass =
  "mt-1 w-full min-h-12 px-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

/**
 * Tournament Profile の作成・編集フォーム（要件 §7）。検証はドメイン（validateTournamentProfile）。
 */
export function TournamentProfileForm(props: TournamentProfileFormProps) {
  const [f, setF] = useState<FormFields>(() => toFields(props.initial));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const input = toInput(f);
  const errors = validateTournamentProfile(input);
  const showB2 = acceptsBlitzCompetitionOverride(f);
  const set = (patch: Partial<FormFields>) => setF((p) => ({ ...p, ...patch }));
  const setPeriod = (index: number, patch: Partial<PeriodFields>) =>
    setF((p) => ({
      ...p,
      periods: p.periods.map((x, i) => (i === index ? { ...x, ...patch } : x)),
    }));
  const multi = f.periods.length > 1;

  const handleSubmit = async () => {
    setSubmitted(true);
    if (errors.length > 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await props.onSubmit(input);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <label className="block font-semibold">
        大会名
        <input
          type="text"
          value={f.name}
          onChange={(e) => set({ name: e.target.value })}
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block font-semibold">
          開始日
          <input
            type="date"
            value={f.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="block font-semibold">
          終了日（任意）
          <input
            type="date"
            value={f.endDate}
            onChange={(e) => set({ endDate: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>

      <fieldset>
        <legend className="font-semibold mb-2">
          {QUESTIONS.competitionType.label}
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {QUESTIONS.competitionType.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={f.competitionType === opt.value}
              onClick={() =>
                set({ competitionType: opt.value as CompetitionType })
              }
              className={`min-h-12 rounded-lg border-2 font-semibold ${
                f.competitionType === opt.value
                  ? "border-blue-600 bg-blue-50"
                  : "border-gray-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-600 mt-1">
          競技区分は大会要項に従って選択してください（持ち時間だけでは判定しません）。
        </p>
      </fieldset>

      {f.competitionType && f.competitionType !== "standard" && (
        <fieldset>
          <legend className="font-semibold mb-2">
            {QUESTIONS.supervisionRegime.label}
          </legend>
          <div className="grid grid-cols-1 gap-2">
            {QUESTIONS.supervisionRegime.options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={f.supervisionRegime === opt.value}
                onClick={() =>
                  set({ supervisionRegime: opt.value as SupervisionRegime })
                }
                className={`min-h-12 px-3 rounded-lg border-2 text-left font-semibold ${
                  f.supervisionRegime === opt.value
                    ? "border-blue-600 bg-blue-50"
                    : "border-gray-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="font-semibold mb-2">規則バージョン</legend>
        {SUPPORTED_RULES_VERSIONS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={f.rulesVersion === v}
            onClick={() => set({ rulesVersion: v })}
            className={`w-full min-h-12 px-3 rounded-lg border-2 text-left font-semibold ${
              f.rulesVersion === v
                ? "border-blue-600 bg-blue-50"
                : "border-gray-200"
            }`}
          >
            {RULES_VERSION_LABEL[v]}
          </button>
        ))}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-semibold mb-2">持ち時間</legend>
        {f.periods.map((p, i) => {
          const isLast = i === f.periods.length - 1;
          const prefix = multi ? `第${i + 1}ピリオド ` : "";
          return (
            <div
              key={i}
              className={multi ? "p-3 border border-gray-200 rounded-lg" : ""}
            >
              {multi && (
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold">
                    第{i + 1}ピリオド{isLast ? "（残りの全ての手）" : ""}
                  </span>
                  <button
                    type="button"
                    aria-label={`第${i + 1}ピリオドを削除`}
                    onClick={() =>
                      set({ periods: f.periods.filter((_, j) => j !== i) })
                    }
                    className="min-h-10 px-3 text-sm text-red-700 bg-red-50 rounded-lg"
                  >
                    削除
                  </button>
                </div>
              )}
              <div
                className={`grid gap-3 ${multi && !isLast ? "grid-cols-3" : "grid-cols-2"}`}
              >
                {multi && !isLast && (
                  <label className="block font-semibold">
                    {prefix}手数
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={p.moves}
                      onChange={(e) => setPeriod(i, { moves: e.target.value })}
                      className={inputClass}
                    />
                  </label>
                )}
                <label className="block font-semibold">
                  {prefix}持ち時間（分）
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={p.minutes}
                    onChange={(e) => setPeriod(i, { minutes: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="block font-semibold">
                  {prefix}加算（秒/手）
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={p.incrementSeconds}
                    onChange={(e) =>
                      setPeriod(i, { incrementSeconds: e.target.value })
                    }
                    className={inputClass}
                  />
                </label>
              </div>
            </div>
          );
        })}
        {f.periods.length < MAX_TIME_CONTROL_PERIODS && (
          <button
            type="button"
            onClick={() =>
              set({ periods: [...f.periods, { ...EMPTY_PERIOD }] })
            }
            className="w-full min-h-12 px-3 rounded-lg border-2 border-dashed border-gray-300 font-semibold"
          >
            ピリオドを追加（例: 40手90分 → 残り30分）
          </button>
        )}
        <p className="text-xs text-gray-600">
          複数のピリオドがある場合、最後のピリオドは残りの全ての手を指すため、手数を入力しません。最終ピリオドかどうか（両フラッグの判断など）と
          8.4 の加算はこの設定から求めます。
        </p>
        {f.legacyIncomplete && (
          <div
            role="status"
            className="p-3 border border-yellow-300 bg-yellow-50 rounded-lg text-sm space-y-2"
          >
            <p>
              この持ち時間は以前の形式で保存されており、2つ目以降のピリオド（例:
              40手の後の追加時間）があるかどうかが分かりません。
              {f.legacyAdditionalMinutes !== undefined
                ? `旧形式の追加時間の値（単位・何手目の後かは不明）: ${f.legacyAdditionalMinutes}。`
                : ""}
              大会要項を見てピリオドを入力し直し、確認してください。確認するまで、最終ピリオドかどうかは毎回質問します。
            </p>
            <label className="flex items-center gap-2 min-h-12 font-semibold">
              <input
                type="checkbox"
                className="w-5 h-5"
                checked={f.periodsConfirmed}
                onChange={(e) => set({ periodsConfirmed: e.target.checked })}
              />
              大会要項でピリオドを確認して入力した（ピリオドが1つだけなら、全ての手をこの持ち時間で指す）
            </label>
          </div>
        )}
        <label className="block font-semibold">
          遅延（秒・任意）
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={f.delaySeconds}
            onChange={(e) => set({ delaySeconds: e.target.value })}
            className={inputClass}
          />
        </label>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="block font-semibold">
          ラウンド数（任意）
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={f.totalRounds}
            onChange={(e) => set({ totalRounds: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="block font-semibold">
          会場（任意）
          <input
            type="text"
            value={f.venue}
            onChange={(e) => set({ venue: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>

      <label className="block font-semibold">
        Chief Arbiter（任意）
        <input
          type="text"
          value={f.chiefArbiter}
          onChange={(e) => set({ chiefArbiter: e.target.value })}
          className={inputClass}
        />
      </label>

      {showB2 && (
        <fieldset className="p-3 border border-yellow-300 bg-yellow-50 rounded-lg space-y-2">
          <legend className="font-semibold px-1">
            大会規定: B.2 の加算時間（任意）
          </legend>
          <p className="text-sm text-gray-700">
            違法手（7.5.5）・誤ったドロー主張（9.5.3）で相手に加算する時間です。原典では確定できないため（ADR-005）、大会規定に明記されている場合のみ、出典とともに入力してください。未入力の場合は「2分（要確認）」として提示し、自動適用しません。
          </p>
          <label className="block text-sm font-semibold">
            加算時間（分）
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={f.b2Minutes}
              onChange={(e) => set({ b2Minutes: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-semibold">
            出典: 資料名（必須）
            <input
              type="text"
              placeholder="例: 第10回○○ブリッツ大会要項"
              value={f.b2Document}
              onChange={(e) => set({ b2Document: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-semibold">
            出典: 条項（任意）
            <input
              type="text"
              placeholder="例: 第5条2項"
              value={f.b2Article}
              onChange={(e) => set({ b2Article: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-semibold">
            規定の文言（任意・原文のまま）
            <textarea
              value={f.b2Quote}
              onChange={(e) => set({ b2Quote: e.target.value })}
              className="mt-1 w-full h-20 px-3 py-2 border border-gray-300 rounded-lg"
            />
          </label>
        </fieldset>
      )}

      {submitted && errors.length > 0 && (
        <ul role="alert" className="text-sm text-red-700 list-disc ml-5">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {saveError && (
        <p role="alert" className="text-sm text-red-700">
          {saveError}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 min-h-12 px-4 bg-blue-600 text-white rounded-lg font-semibold disabled:bg-gray-400"
        >
          {saving ? "保存中..." : props.submitLabel}
        </button>
        {props.onCancel && (
          <button
            type="button"
            onClick={props.onCancel}
            className="min-h-12 px-4 bg-gray-100 rounded-lg"
          >
            キャンセル
          </button>
        )}
      </div>
    </form>
  );
}
