/**
 * J3: 分類と fact の記載の評価（jev-classifier-design §9, fact-model.md §5.2）。
 * scripts/eval-classifier.mjs がこのファイルを esbuild でまとめて実行する。
 *
 *   check                         データセットの確認とガードの集計（通信しない）
 *   run --provider jev|gemini     分類の評価（先にプライバシーの確認を実行する）
 *   run --provider jev --set presence
 *                                 fact の記載の評価（Jev のみ）
 *   fit --jev <file> [--gemini <file>] [--presence <file>]
 *                                 しきい値を選び、受け入れ判定と較正（JSON）を書き出す
 *
 * - 送るのは合成した報告を本番と同じ前処理に通した本文だけ
 * - API キーは ~/.config/arbiter-console/{typesafe,gemini}.key から読む。表示・保存しない
 * - 結果ファイルには本文を書かない（case id・確率・応答時間だけ）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  runClassificationEval,
  runPresenceEval,
  summarizeDeidentification,
  validateClassificationDataset,
  validatePresenceDataset,
  type ClassificationEvalDataset,
  type EvalClassifyFn,
  type EvalPresenceFn,
  type PresenceEvalDataset,
} from "@/lib/application/classifier-evaluation";
import {
  buildJevCalibration,
  evaluateAcceptance,
  fitCategory,
  fitPresence,
  summarizeClassification,
  toClassificationObservation,
  type ClassificationObservation,
  type ClassificationRecord,
  type EvalProvider,
  type FittedThreshold,
  type PresenceRecord,
} from "@/lib/domain/llm/calibration/fit";
import {
  geminiClassifyIncident,
  jevClassifyIncident,
} from "@/lib/infrastructure/llm/server/classify-port";
import { readLlmConfig } from "@/lib/infrastructure/llm/server/config";
import {
  DEFAULT_RETRY,
  withRetry,
  withTimeout,
  type RetryOptions,
} from "@/lib/infrastructure/llm/server/generate";
import {
  CLASSIFY_ATTEMPT_TIMEOUT_MS,
  JEV_ATTEMPT_TIMEOUT_MS,
  jevRetry,
} from "@/lib/infrastructure/llm/server/handler";
import { createJevEvaluate } from "@/lib/infrastructure/llm/server/jev-client";
import {
  buildJevPresenceQuestions,
  jevAnswersToRawPresence,
} from "@/lib/infrastructure/llm/server/jev-presence";
import { buildJevState } from "@/lib/infrastructure/llm/server/jev-questions";

export const CLASSIFICATION_DATASET =
  "__tests__/fixtures/classification-eval.ja.json";
export const PRESENCE_DATASET = "__tests__/fixtures/presence-eval.ja.json";
export const RESULTS_DIR = "docs/progress/eval/results";
export const REPORTS_DIR = "docs/progress/eval";
export const CALIBRATION_DIR = "lib/domain/llm/calibration";

export interface EvalDeps {
  root: string;
  fetch: typeof fetch;
  /** プライバシーの確認（§9.4）。成功なら true */
  runPrivacyCheck: () => boolean;
  readKey: (provider: EvalProvider) => string;
  env: Record<string, string | undefined>;
  now: () => Date;
  log: (line: string) => void;
}

export function defaultKeyReader(provider: EvalProvider): string {
  const file = join(
    homedir(),
    ".config",
    "arbiter-console",
    provider === "jev" ? "typesafe.key" : "gemini.key"
  );
  if (!existsSync(file))
    throw new Error(`API キーのファイルがない: ${file}（chmod 600 で置く）`);
  const key = readFileSync(file, "utf8").trim();
  if (!key) throw new Error(`API キーのファイルが空: ${file}`);
  return key;
}

function readJson<T>(root: string, path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as T;
}

function writeJson(root: string, path: string, value: unknown): void {
  const full = resolve(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`);
}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

function check(deps: EvalDeps): number {
  const cls = readJson<ClassificationEvalDataset>(
    deps.root,
    CLASSIFICATION_DATASET
  );
  const errors = validateClassificationDataset(cls);
  deps.log(`classification ${cls.id}@${cls.version}: ${cls.cases.length} 件`);
  const byCategory = summarizeDeidentification(
    cls.cases,
    cls.identifiers,
    (c) => `${c.category}/${c.split}`
  );
  for (const [key, v] of Object.entries(byCategory).sort())
    deps.log(
      `  ${key}: ${v.total} 件, 送らない ${v.notSent}${v.stages.length ? `（${v.stages.join(", ")}）` : ""}`
    );
  if (existsSync(resolve(deps.root, PRESENCE_DATASET))) {
    const pres = readJson<PresenceEvalDataset>(deps.root, PRESENCE_DATASET);
    errors.push(...validatePresenceDataset(pres));
    deps.log(`presence ${pres.id}@${pres.version}: ${pres.cases.length} 件`);
    const byFact = summarizeDeidentification(
      pres.cases,
      pres.identifiers,
      (c) => `${c.factId}/${c.kind}/${c.split}`,
      "facts"
    );
    for (const [key, v] of Object.entries(byFact).sort())
      deps.log(`  ${key}: ${v.total} 件, 送らない ${v.notSent}`);
  }
  for (const e of errors) deps.log(`ERROR ${e}`);
  return errors.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

/** 本番と同じ再試行（handler.ts: 分類は 3 回・全体 30 秒、Jev は 1 回 3 秒・全体 10 秒） */
function retryOptions(provider: EvalProvider): RetryOptions {
  const base: RetryOptions = {
    ...DEFAULT_RETRY,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
  };
  return provider === "jev" ? jevRetry(base) : base;
}

const attemptTimeoutMs = (provider: EvalProvider) =>
  provider === "jev" ? JEV_ATTEMPT_TIMEOUT_MS : CLASSIFY_ATTEMPT_TIMEOUT_MS;

/**
 * 結果ファイルに残す欄だけにする（§18.2: 本文を書かない）。Gemini の missingInformation・
 * followUpQuestions は記述を言い換えうるため捨てる。parseLlmClassification が使う欄だけ残す
 */
export function minimizeRaw(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const keep = [
    "category",
    "categoryProbabilities",
    "subtype",
    "subtypeProbability",
    "needsTournamentRules",
    "needsTournamentRulesProbability",
    "playerColor",
    "confidence",
    "provider",
  ];
  const r = raw as Record<string, unknown>;
  return Object.fromEntries(
    keep.filter((k) => Object.hasOwn(r, k)).map((k) => [k, r[k]])
  );
}

export function classifierFor(
  provider: EvalProvider,
  deps: EvalDeps
): EvalClassifyFn {
  const key = deps.readKey(provider);
  const config = readLlmConfig({
    ...(provider === "jev"
      ? { TYPESAFE_API_KEY: key }
      : { GEMINI_API_KEY: key }),
    JEV_MODEL: deps.env.JEV_MODEL,
    GEMINI_MODEL_CLASSIFIER: deps.env.GEMINI_MODEL_CLASSIFIER,
    GEMINI_THINKING_LEVEL: deps.env.GEMINI_THINKING_LEVEL,
  });
  const classify =
    provider === "jev"
      ? jevClassifyIncident(createJevEvaluate(deps.fetch))
      : // Gemini は SDK を使う（本番と同じ実装）。fetch の差し替えは効かない
        geminiClassifyIncident(
          // esbuild はこの import も先頭にまとめるため、SDK は常に読み込まれる（依存にあるので問題ない）
          async (req) =>
            (
              await import("@/lib/infrastructure/llm/server/gemini-client")
            ).geminiGenerateJson(req)
        );
  const perAttemptMs = attemptTimeoutMs(provider);
  // 通信の失敗は再試行後に例外のまま投げる（runner が transport として記録する）
  return async (narrative) => {
    const { value: outcome, attempts } = await withRetry(
      (_attempt, remainingMs) => {
        const timeoutMs = Math.max(1, Math.min(perAttemptMs, remainingMs));
        return withTimeout(timeoutMs, (signal) =>
          classify({ narrative, config, timeoutMs, signal })
        );
      },
      retryOptions(provider)
    );
    return outcome.ok
      ? {
          ok: true,
          raw: minimizeRaw(outcome.result),
          model: outcome.model,
          attempts,
        }
      : { ok: false, error: outcome.code, attempts };
  };
}

export function presenceFor(deps: EvalDeps): EvalPresenceFn {
  const key = deps.readKey("jev");
  const config = readLlmConfig({
    TYPESAFE_API_KEY: key,
    JEV_MODEL: deps.env.JEV_MODEL,
  });
  const evaluate = createJevEvaluate(deps.fetch);
  return async (narrative, factIds) => {
    try {
      const { value: response } = await withRetry((_attempt, remainingMs) => {
        const timeoutMs = Math.max(
          1,
          Math.min(JEV_ATTEMPT_TIMEOUT_MS, remainingMs)
        );
        return withTimeout(timeoutMs, (signal) =>
          evaluate({
            apiKey: config.typesafeApiKey ?? "",
            model: config.jevModel,
            state: buildJevState(narrative),
            questions: buildJevPresenceQuestions(factIds),
            signal,
          })
        );
      }, retryOptions("jev"));
      return {
        ok: true,
        presence: jevAnswersToRawPresence(response.answers, factIds).presence,
        model: response.model,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.name : "error",
      };
    }
  };
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-");

async function run(argv: readonly string[], deps: EvalDeps): Promise<number> {
  const provider = arg(argv, "provider");
  if (provider !== "jev" && provider !== "gemini") {
    deps.log("--provider jev|gemini を指定する");
    return 2;
  }
  const set = arg(argv, "set") ?? "classification";
  if (set !== "classification" && set !== "presence") {
    deps.log("--set classification|presence を指定する");
    return 2;
  }
  if (set === "presence" && provider !== "jev") {
    deps.log("presence は Jev だけを評価する");
    return 2;
  }
  const concurrency = Number(arg(argv, "concurrency") ?? "1");
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    deps.log("--concurrency は 1 以上の整数");
    return 2;
  }
  // §9.4: 精度の評価の前に、通信なしのプライバシーの確認が通ること
  deps.log("プライバシーの確認（__tests__/privacy）を実行する…");
  if (!deps.runPrivacyCheck()) {
    deps.log("プライバシーの確認に失敗した。送らずに終了する");
    return 1;
  }
  const progress = (done: number, total: number) => {
    if (done === total || done % 20 === 0) deps.log(`  ${done}/${total}`);
  };
  const runAt = deps.now();

  if (set === "classification") {
    const ds = readJson<ClassificationEvalDataset>(
      deps.root,
      CLASSIFICATION_DATASET
    );
    const errors = validateClassificationDataset(ds);
    if (errors.length) {
      errors.forEach((e) => deps.log(`ERROR ${e}`));
      return 1;
    }
    const records = await runClassificationEval(
      ds,
      classifierFor(provider, deps),
      { concurrency, onProgress: progress }
    );
    const out = `${RESULTS_DIR}/classification-${provider}-${stamp(runAt)}.json`;
    writeJson(deps.root, out, {
      kind: "classification",
      provider,
      dataset: { id: ds.id, version: ds.version },
      runAt: runAt.toISOString(),
      models: modelsOf(records),
      records,
    });
    deps.log(`書き出した: ${out}`);
    return 0;
  }

  const ds = readJson<PresenceEvalDataset>(deps.root, PRESENCE_DATASET);
  const errors = validatePresenceDataset(ds);
  if (errors.length) {
    errors.forEach((e) => deps.log(`ERROR ${e}`));
    return 1;
  }
  const records = await runPresenceEval(ds, presenceFor(deps), {
    concurrency,
    onProgress: progress,
  });
  const out = `${RESULTS_DIR}/presence-jev-${stamp(runAt)}.json`;
  writeJson(deps.root, out, {
    kind: "presence",
    provider: "jev",
    dataset: { id: ds.id, version: ds.version },
    runAt: runAt.toISOString(),
    models: modelsOf(records),
    records,
  });
  deps.log(`書き出した: ${out}`);
  return 0;
}

function modelsOf(records: readonly { model?: string }[]): string[] {
  return Array.from(
    new Set(records.map((r) => r.model).filter((m): m is string => !!m))
  ).sort();
}

// ---------------------------------------------------------------------------
// fit
// ---------------------------------------------------------------------------

interface ResultsFile<R> {
  kind: "classification" | "presence";
  provider: EvalProvider;
  dataset: { id: string; version: string };
  runAt: string;
  models: string[];
  records: R[];
}

const pct = (v: number | undefined) =>
  v === undefined ? "-" : `${(v * 100).toFixed(1)}%`;
const ms = (v: number | undefined) =>
  v === undefined ? "-" : `${Math.round(v)} ms`;

function thresholdRow(name: string, f: FittedThreshold): string {
  if (!f.tuning) return `| ${name} | - | - | - | - | no |`;
  return `| ${name} | ${f.tuning.threshold} | ${pct(f.tuning.precision)} (n=${f.tuning.support}) | ${pct(f.heldOut?.precision)} (n=${f.heldOut?.support ?? 0}) | ${f.tuning.wilson.toFixed(3)} | ${f.accepted ? "yes" : "no"} |`;
}

export function renderReport(input: {
  jev: ResultsFile<ClassificationRecord>;
  gemini?: ResultsFile<ClassificationRecord>;
  presence?: ResultsFile<PresenceRecord>;
  createdAt: string;
}): {
  markdown: string;
  calibration?: ReturnType<typeof buildJevCalibration>;
  accepted: boolean;
} {
  const observe = (
    file: ResultsFile<ClassificationRecord>,
    provider: EvalProvider
  ) =>
    file.records
      .map((r) => toClassificationObservation(r, provider))
      .filter((o): o is ClassificationObservation => o !== undefined);
  const jevObs = observe(input.jev, "jev");
  const geminiObs = input.gemini ? observe(input.gemini, "gemini") : undefined;
  const heldOut = (o: ClassificationObservation[]) =>
    o.filter((x) => x.split === "held-out");

  const jevAll = summarizeClassification(jevObs, "jev");
  const jevHeld = summarizeClassification(heldOut(jevObs), "jev");
  const geminiHeld = geminiObs
    ? summarizeClassification(heldOut(geminiObs), "gemini")
    : undefined;
  const category = fitCategory(jevObs);
  const gate = evaluateAcceptance({
    jevHeldOut: jevHeld,
    geminiHeldOut: geminiHeld,
    category,
    jevModels: input.jev.models,
  });
  const presence = input.presence ? fitPresence(input.presence.records) : [];
  const model = input.jev.models[0] ?? "unknown";
  const calibration =
    input.jev.models.length === 1
      ? buildJevCalibration({
          model,
          dataset: input.jev.dataset,
          presenceDataset: input.presence?.dataset,
          createdAt: input.createdAt,
          observations: jevObs,
          category,
          presence,
        })
      : undefined;

  const heldOutNotSent = (category: string) =>
    input.jev.records.filter(
      (r) => r.split === "held-out" && r.label === category && r.notSent
    ).length;
  const notSent = (f: ResultsFile<{ notSent?: string }>) =>
    f.records.filter((r) => r.notSent).length;
  const lines: string[] = [
    `# Classifier evaluation: ${model}`,
    "",
    `- Created: ${input.createdAt}`,
    `- Dataset: ${input.jev.dataset.id}@${input.jev.dataset.version}（Jev run ${input.jev.runAt}${input.gemini ? `, Gemini run ${input.gemini.runAt} (${input.gemini.models.join(", ")})` : ""}）`,
    `- Not sent by the guard: ${notSent(input.jev)} / ${input.jev.records.length}`,
    `- **Acceptance (§9.3): ${gate.accepted ? "PASS" : "FAIL"}**`,
    "",
    "## Gate",
    "",
    "| Item | Result | Detail |",
    "| --- | --- | --- |",
    ...gate.items.map(
      (i) =>
        `| ${i.id} | ${i.notEvaluated ? "not evaluated" : i.pass ? "pass" : "FAIL"} | ${i.detail} |`
    ),
    "",
    "## Category (held-out)",
    "",
    "| Provider | n | invalid (transport) | accuracy | top-2 | p50 | p95 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    `| Jev | ${jevHeld.n} | ${jevHeld.invalid} (${jevHeld.transportErrors}) | ${pct(jevHeld.accuracy)} | ${pct(jevHeld.top2Accuracy)} | ${ms(jevHeld.latency.p50)} | ${ms(jevHeld.latency.p95)} |`,
    ...(geminiHeld
      ? [
          `| Gemini | ${geminiHeld.n} | ${geminiHeld.invalid} (${geminiHeld.transportErrors}) | ${pct(geminiHeld.accuracy)} | - | ${ms(geminiHeld.latency.p50)} | ${ms(geminiHeld.latency.p95)} |`,
        ]
      : []),
    "",
    "| Category | not sent | Jev | Gemini |",
    "| --- | --- | --- | --- |",
    ...Object.entries(jevHeld.perCategory).map(
      ([c, v]) =>
        `| ${c} | ${heldOutNotSent(c)} | ${pct(v!.accuracy)} (${v!.correct}/${v!.n}) | ${geminiHeld?.perCategory[c as keyof typeof geminiHeld.perCategory] ? pct(geminiHeld.perCategory[c as keyof typeof geminiHeld.perCategory]!.accuracy) : "-"} |`
    ),
    "",
    "## Thresholds (tuning → held-out)",
    "",
    "| Threshold | T | tuning precision | held-out precision | tuning Wilson | accepted |",
    "| --- | --- | --- | --- | --- | --- |",
    thresholdRow("category.medium (≥0.90)", category.medium),
    thresholdRow("category.prefill (≥0.80)", category.prefill),
    thresholdRow("subtype (≥0.90)", category.subtype),
    "",
    "## Reliability (all splits, Jev top probability)",
    "",
    "| Bucket | n | mean p | accuracy |",
    "| --- | --- | --- | --- |",
    ...(jevAll.reliability ?? [])
      .filter((b) => b.n > 0)
      .map(
        (b) =>
          `| ${b.from.toFixed(1)}–${b.to.toFixed(1)} | ${b.n} | ${b.meanProbability.toFixed(3)} | ${pct(b.accuracy)} |`
      ),
    "",
    "## Probability sum (§14.3)",
    "",
    jevAll.probabilitySum
      ? `min ${jevAll.probabilitySum.min.toFixed(4)}, max ${jevAll.probabilitySum.max.toFixed(4)}, max |sum − 1| ${jevAll.probabilitySum.maxAbsDeviation.toFixed(4)}; outside ±${jevAll.probabilitySum.tolerance}: ${jevAll.probabilitySum.outsideTolerance}. ${jevAll.probabilitySum.outsideTolerance > 0 ? "**Widen PROBABILITY_SUM_TOLERANCE (with a test) before switching.**" : "The tolerance holds."}`
      : "No probability sums recorded.",
    "",
  ];
  if (presence.length) {
    lines.push(
      "## Fact presence (fact-model §5.2)",
      "",
      "| Fact | level | tuning n (present) | held-out n (present) | T | tuning precision / Wilson | held-out precision | held-out recall | accepted |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...presence.map(
        (f) =>
          `| ${f.factId} | ${f.level} | ${f.counts.tuning.n} (${f.counts.tuning.present}) | ${f.counts["held-out"].n} (${f.counts["held-out"].present}) | ${f.tuning?.threshold ?? "-"} | ${f.tuning ? `${pct(f.tuning.precision)} / ${f.tuning.wilson.toFixed(3)}` : "-"} | ${pct(f.heldOut?.precision)} | ${pct(f.heldOutRecall)} | ${f.accepted ? "yes" : "no"} |`
      ),
      "",
      'Facts without an accepted threshold stay always "missing" (safe).',
      ""
    );
  }
  lines.push(
    "## Calibration",
    "",
    calibration && gate.accepted
      ? `Written to \`${CALIBRATION_DIR}/${model}.json\`. Register it in \`JEV_CALIBRATIONS\` after review (design §18.2).`
      : calibration
        ? `Thresholds were found, but the gate failed: **no calibration file was written**. Values for reference: medium ${calibration.category.medium}, prefill ${calibration.category.prefill}${calibration.subtype !== undefined ? `, subtype ${calibration.subtype}` : ""}.`
        : "Not built (medium/prefill not confirmed on held-out).",
    ""
  );
  return { markdown: lines.join("\n"), calibration, accepted: gate.accepted };
}

/** ファイル名に使ってよいモデル名（パスの区切り・.. を含まない） */
const SAFE_MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isSafeModelName(model: string): boolean {
  return SAFE_MODEL_NAME.test(model) && model.indexOf("..") < 0;
}

/**
 * 結果ファイルの組み合わせを確かめる。モデル・データセットが混ざった較正は作らない
 * （fact-model §5: 較正はモデルごと）。問題がなければ空配列
 */
export function checkResultFiles(input: {
  jev: ResultsFile<ClassificationRecord>;
  gemini?: ResultsFile<ClassificationRecord>;
  presence?: ResultsFile<PresenceRecord>;
}): string[] {
  const errors: string[] = [];
  const expect = (
    name: string,
    f: { kind?: unknown; provider?: unknown } | undefined,
    kind: string,
    provider: string
  ) => {
    if (f && (f.kind !== kind || f.provider !== provider))
      errors.push(`--${name} は ${kind}/${provider} の結果ファイルでない`);
  };
  expect("jev", input.jev, "classification", "jev");
  expect("gemini", input.gemini, "classification", "gemini");
  expect("presence", input.presence, "presence", "jev");
  const models = input.jev.models ?? [];
  if (models.length !== 1)
    errors.push(
      `Jev の応答の model が1つでない: ${models.join(", ") || "なし"}`
    );
  else if (!isSafeModelName(models[0]))
    errors.push(`model 名をファイル名に使えない: ${models[0]}`);
  if (input.presence) {
    const pm = input.presence.models ?? [];
    if (pm.length !== 1 || pm[0] !== models[0])
      errors.push(
        `presence の model（${pm.join(", ") || "なし"}）が分類の model（${models.join(", ")}）と一致しない`
      );
  }
  if (
    input.gemini &&
    (input.gemini.dataset?.id !== input.jev.dataset?.id ||
      input.gemini.dataset?.version !== input.jev.dataset?.version)
  )
    errors.push("Gemini と Jev のデータセット（id・version）が一致しない");
  return errors;
}

function fit(argv: readonly string[], deps: EvalDeps): number {
  const jevPath = arg(argv, "jev");
  if (!jevPath) {
    deps.log("--jev <results file> を指定する");
    return 2;
  }
  const geminiPath = arg(argv, "gemini");
  const presencePath = arg(argv, "presence");
  const files = {
    jev: readJson<ResultsFile<ClassificationRecord>>(deps.root, jevPath),
    gemini: geminiPath
      ? readJson<ResultsFile<ClassificationRecord>>(deps.root, geminiPath)
      : undefined,
    presence: presencePath
      ? readJson<ResultsFile<PresenceRecord>>(deps.root, presencePath)
      : undefined,
  };
  const errors = checkResultFiles(files);
  if (errors.length) {
    errors.forEach((e) => deps.log(`ERROR ${e}`));
    return 1;
  }
  const { markdown, calibration, accepted } = renderReport({
    ...files,
    createdAt: deps.now().toISOString(),
  });
  const model = files.jev.models[0];
  const report = `${REPORTS_DIR}/classifier-eval-${model}.md`;
  const full = resolve(deps.root, report);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, markdown);
  deps.log(`書き出した: ${report}`);
  // 不合格の較正はソースツリーに置かない（JEV_CALIBRATIONS へ写し間違えないため）
  if (calibration && accepted) {
    const out = `${CALIBRATION_DIR}/${model}.json`;
    writeJson(deps.root, out, calibration);
    deps.log(`書き出した: ${out}`);
  }
  deps.log(`受け入れ判定: ${accepted ? "PASS" : "FAIL"}`);
  return 0;
}

// ---------------------------------------------------------------------------

export async function main(
  argv: readonly string[],
  deps: EvalDeps
): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "check":
      return check(deps);
    case "run":
      return run(rest, deps);
    case "fit":
      return fit(rest, deps);
    default:
      deps.log(
        "使い方: node scripts/eval-classifier.mjs check | run --provider jev|gemini [--set classification|presence] [--concurrency N] | fit --jev <file> [--gemini <file>] [--presence <file>]"
      );
      return 2;
  }
}
