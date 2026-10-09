/**
 * J3: 分類器の評価を実キーで実行する（jev-classifier-design §9）。CI では実行しない。
 *
 * 実行は scripts/eval-classifier.mjs から（先にプライバシーの確認とデータセットの検査を通す）。
 *
 * - 送るのは合成データ（__tests__/fixtures/classification-eval.ja.json）だけ。各項目は本番と同じ
 *   protectIncidentText（route: classify）を通し、送る形（置き換え・最小化済み）にしてから送る
 * - キーは ~/.config/arbiter-console/{typesafe,gemini}.key から読む（リポジトリ・.env* には置かない）。
 *   キー・上流のエラー本文は出力しない
 * - EVAL_REUSE=<以前の実行のディレクトリ> で、記録のあるプロバイダーは API を呼ばずに再利用する
 * - 出力（docs/progress/evaluations/<run>/）: records.json（本文なし）、report.md、
 *   較正の候補 calibration.candidate.json（作れた場合のみ）。較正の登録は人が行う（テストで一致を確認）
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import type { IncidentCategory } from "@/lib/domain/entities";
import { parseLlmClassification } from "@/lib/domain/llm/classification";
import { classifyByKeywords } from "@/lib/domain/llm/keyword-classifier";
import {
  NO_IDENTIFIERS,
  PlaceholderMap,
  protectIncidentText,
} from "@/lib/domain/privacy";
import {
  buildJevCalibration,
  evaluateJev,
  type EvalItem,
  type EvalProvider,
  type EvalRecord,
  type JevEvaluation,
  type ProviderSummary,
} from "@/lib/evaluation/classifier-eval";
import {
  geminiClassifyIncident,
  jevClassifyIncident,
  type ClassifyIncidentFn,
} from "@/lib/infrastructure/llm/server/classify-port";
import { readLlmConfig } from "@/lib/infrastructure/llm/server/config";
import { geminiGenerateJson } from "@/lib/infrastructure/llm/server/gemini-client";
import { toUpstreamError } from "@/lib/infrastructure/llm/server/generate";
import { createJevEvaluate } from "@/lib/infrastructure/llm/server/jev-client";
import { buildJevClassificationQuestions } from "@/lib/infrastructure/llm/server/jev-questions";
import { CLASSIFIER_SYSTEM_PROMPT } from "@/lib/infrastructure/llm/server/prompts";

const ROOT = process.cwd();
const DATASET_PATH = join(
  ROOT,
  "__tests__/fixtures/classification-eval.ja.json"
);
const KEY_DIR = join(homedir(), ".config", "arbiter-console");
const TIMEOUT_MS = { jev: 3_000, gemini: 30_000 } as const;
const CONCURRENCY = { jev: 4, gemini: 2 } as const;
const MAX_ATTEMPTS = 3;

/**
 * 実行の条件（meta.json）。EVAL_REUSE はこれが一致する記録だけを再利用する
 * （説明・ラベル・モデルを変えた後に古い応答を新しい条件で採点しない）
 */
interface RunMeta {
  dataset: { id: string; version: string; sha256: string };
  providers: Partial<
    Record<"jev" | "gemini", { model: string; requestSha256: string }>
  >;
}

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

interface Dataset {
  id: string;
  version: string;
  items: EvalItem[];
}

function readKey(name: string): string | undefined {
  const file = join(KEY_DIR, `${name}.key`);
  if (!existsSync(file)) return undefined;
  const key = readFileSync(file, "utf8").trim();
  return key || undefined;
}

/** 本番と同じく 408・429・5xx・通信の失敗だけ再試行する */
const retryable = (e: unknown) => toUpstreamError(e).transient;

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/** 失敗の分類（コードだけ。上流のエラー本文は入力を含みうるため残さない） */
const errorCode = (e: unknown) => {
  const u = toUpstreamError(e);
  return `upstream-${u.kind}${u.status ? `-${u.status}` : ""}`;
};

async function runProvider(
  provider: "jev" | "gemini",
  classify: ClassifyIncidentFn,
  config: ReturnType<typeof readLlmConfig>,
  items: readonly EvalItem[]
): Promise<EvalRecord[]> {
  return mapLimit(items, CONCURRENCY[provider], async (item) => {
    const base = {
      id: item.id,
      split: item.split,
      provider,
      label: item.category,
      labelSubtype: item.subtype,
    } satisfies Partial<EvalRecord>;
    const prot = protectIncidentText({
      route: "classify",
      text: item.text,
      identifiers: NO_IDENTIFIERS,
      map: new PlaceholderMap(),
    });
    if (!prot.ok) return { ...base, status: "not-sent", reason: prot.stage };

    for (let attempt = 1; ; attempt++) {
      const started = performance.now();
      try {
        const outcome = await classify({
          narrative: prot.text,
          config,
          timeoutMs: TIMEOUT_MS[provider],
          signal: AbortSignal.timeout(TIMEOUT_MS[provider]),
        });
        const latencyMs = Math.round(performance.now() - started);
        if (!outcome.ok)
          return { ...base, status: "error", reason: outcome.code, latencyMs };
        const raw = outcome.result as Record<string, unknown>;
        const probabilities =
          provider === "jev"
            ? (raw.categoryProbabilities as Partial<
                Record<IncidentCategory, number>
              >)
            : undefined;
        // 較正なしで検証する（形・合計の確認。しきい値はこの評価で決める）
        const parsed = parseLlmClassification(raw, {
          model: outcome.model,
          calibrations: [],
        });
        const common = {
          ...base,
          model: outcome.model,
          latencyMs,
          probabilities,
          subtype:
            provider === "jev"
              ? (raw.subtype as string | null)
              : (parsed?.subtype ?? null),
          subtypeProbability:
            provider === "jev"
              ? (raw.subtypeProbability as number | null)
              : null,
        };
        if (!parsed)
          return { ...common, status: "rejected", reason: "domain-validator" };
        return { ...common, status: "ok", predicted: parsed.category };
      } catch (e) {
        if (attempt < MAX_ATTEMPTS && retryable(e)) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }
        return { ...base, status: "error", reason: errorCode(e) };
      }
    }
  });
}

function runKeyword(items: readonly EvalItem[]): EvalRecord[] {
  return items.map((item) => {
    const prot = protectIncidentText({
      route: "classify",
      text: item.text,
      identifiers: NO_IDENTIFIERS,
      map: new PlaceholderMap(),
    });
    const base = {
      id: item.id,
      split: item.split,
      provider: "keyword" as const,
      label: item.category,
      labelSubtype: item.subtype,
    };
    // 本番のフォールバックと同じく、元の本文で端末内で分類する
    const result = classifyByKeywords(item.text);
    if (!prot.ok)
      return { ...base, status: "not-sent" as const, reason: prot.stage };
    return result
      ? {
          ...base,
          status: "ok" as const,
          predicted: result.category,
          subtype: result.subtype ?? null,
        }
      : { ...base, status: "error" as const, reason: "no-keyword-match" };
  });
}

// ---------------------------------------------------------------------------
// レポート
// ---------------------------------------------------------------------------

const pct = (v: number | undefined) =>
  v === undefined || Number.isNaN(v) ? "n/a" : `${Math.round(v * 1000) / 10}%`;

function summaryRow(s: ProviderSummary | undefined, name: string): string {
  if (!s) return `| ${name} | (未実行) | | | | | |`;
  return `| ${name} | ${s.model ?? "-"} | ${pct(s.accuracy.tuning)} | ${pct(s.accuracy.heldout)} | ${pct(s.top2Heldout)} | ${ms(s.latency.p50)} / ${ms(s.latency.p95)} | ok ${s.statusCounts.ok}, rejected ${s.statusCounts.rejected}, not-sent ${s.statusCounts["not-sent"]}, error ${s.statusCounts.error} |`;
}

const ms = (v: number) => (Number.isNaN(v) ? "-" : `${v} ms`);

function renderReport(
  dataset: Dataset,
  evaluated: number,
  evaluation: JevEvaluation,
  createdAt: string,
  calibrationWritten: boolean
): string {
  const e = evaluation;
  const cats = Object.keys(e.jev.perCategoryHeldout) as IncidentCategory[];
  const lines = [
    `# Classifier evaluation (${createdAt})`,
    "",
    `Dataset: \`${dataset.id}\` v${dataset.version}, ${evaluated} of ${dataset.items.length} items (synthetic; sent through protectIncidentText, route classify).`,
    "",
    "## Summary",
    "",
    "| Provider | Model | Accuracy (tuning) | Accuracy (held-out) | Top-2 (held-out) | Latency p50 / p95 | Status |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    summaryRow(e.jev, "Jev"),
    summaryRow(e.gemini, "Gemini"),
    summaryRow(e.keyword, "Keyword (local)"),
    "",
    "## Acceptance gate (jev-classifier-design §9.3)",
    "",
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...e.checks.map(
      (c) => `| ${c.id} | ${c.pass ? "PASS" : "FAIL"} | ${c.detail} |`
    ),
    "",
    `**Accepted:** ${e.accepted ? "yes" : "no"}. **Calibration candidate:** ${calibrationWritten ? "written (calibration.candidate.json)" : "not written"}.`,
    "",
    "## Held-out accuracy per category",
    "",
    "| Category | n | Jev | Gemini | Keyword |",
    "| --- | --- | --- | --- | --- |",
    ...cats.map(
      (c) =>
        `| ${c} | ${e.jev.perCategoryHeldout[c]?.n} | ${pct(e.jev.perCategoryHeldout[c]?.accuracy)} | ${pct(e.gemini?.perCategoryHeldout[c]?.accuracy)} | ${pct(e.keyword?.perCategoryHeldout[c]?.accuracy)} |`
    ),
    "",
    "## Thresholds",
    "",
    `- T_medium (target 90%): ${JSON.stringify(e.medium)}`,
    `- T_prefill (target 80%): ${JSON.stringify(e.prefill)}`,
    `- T_subtype (target 90%): ${JSON.stringify(e.subtype)}`,
    "",
    "## Reliability (Jev, held-out, chosen category)",
    "",
    "| p range | n | mean p | accuracy |",
    "| --- | --- | --- | --- |",
    ...e.reliabilityHeldout.map(
      (r) =>
        `| ${r.from}–${r.to} | ${r.n} | ${Number.isNaN(r.meanP) ? "-" : r.meanP.toFixed(3)} | ${pct(r.accuracy)} |`
    ),
    "",
    "## Probability sum (Jev raw, §14.3)",
    "",
    `n=${e.sumDrift.n}, drift min ${e.sumDrift.min}, max ${e.sumDrift.max}, max |drift| ${e.sumDrift.maxAbs} (tolerance ±0.02).`,
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

it(
  "classifier evaluation (live)",
  async () => {
    const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8")) as Dataset;
    const providers = (process.env.EVAL_PROVIDERS ?? "jev,gemini,keyword")
      .split(",")
      .map((s) => s.trim()) as EvalProvider[];
    const limit = Number(process.env.EVAL_LIMIT ?? "0");
    const items = limit > 0 ? dataset.items.slice(0, limit) : dataset.items;

    const typesafeApiKey = readKey("typesafe");
    const geminiApiKey = readKey("gemini");
    const config = {
      ...readLlmConfig({}),
      apiKey: geminiApiKey,
      typesafeApiKey,
    };

    // 今回の条件。リクエストのハッシュは、プロバイダーに送る固定部分（質問・プロンプト）
    const datasetText = readFileSync(DATASET_PATH, "utf8");
    const conditions: RunMeta["providers"] = {
      jev: {
        model: config.jevModel,
        requestSha256: sha256(
          JSON.stringify(buildJevClassificationQuestions())
        ),
      },
      gemini: {
        model: config.classifierModel,
        requestSha256: sha256(CLASSIFIER_SYSTEM_PROMPT),
      },
    };
    const meta: RunMeta = {
      dataset: {
        id: dataset.id,
        version: dataset.version,
        sha256: sha256(datasetText),
      },
      providers: {},
    };

    console.log(
      `[eval] conditions ${JSON.stringify({ dataset: meta.dataset, conditions })}`
    );

    // EVAL_REUSE=<以前の実行のディレクトリ>: 条件（meta.json）が一致するプロバイダーの記録を
    // 再利用し、API を呼ばない（集計の規則を変えた後の再計算や、Gemini だけを後から追加する場合）
    const reuseDir = process.env.EVAL_REUSE;
    const reusedMeta: RunMeta | undefined =
      reuseDir && existsSync(join(reuseDir, "meta.json"))
        ? (JSON.parse(
            readFileSync(join(reuseDir, "meta.json"), "utf8")
          ) as RunMeta)
        : undefined;
    if (reuseDir && !reusedMeta)
      throw new Error(
        `${reuseDir}/meta.json がない（条件を確認できないため再利用しない）`
      );
    if (reusedMeta && reusedMeta.dataset.sha256 !== meta.dataset.sha256)
      throw new Error("評価データが変わっているため再利用しない");
    const reused: EvalRecord[] = reuseDir
      ? (JSON.parse(
          readFileSync(join(reuseDir, "records.json"), "utf8")
        ) as EvalRecord[])
      : [];
    const itemIds = new Set(items.map((i) => i.id));
    const reuse = (provider: "jev" | "gemini") => {
      const prior = reusedMeta?.providers[provider];
      if (!prior) return null;
      const now = conditions[provider]!;
      if (
        prior.model !== now.model ||
        prior.requestSha256 !== now.requestSha256
      ) {
        console.log(`[eval] ${provider}: 条件が変わったため再利用しない`);
        return null;
      }
      const rs = reused.filter(
        (r) => r.provider === provider && itemIds.has(r.id)
      );
      return rs.length === items.length ? rs : null;
    };

    const records: EvalRecord[] = [];
    if (providers.includes("keyword")) records.push(...runKeyword(items));
    if (providers.includes("jev")) {
      const prior = reuse("jev");
      if (prior) {
        console.log(`[eval] jev: ${prior.length} records reused`);
        records.push(...prior);
      } else {
        if (!typesafeApiKey) throw new Error("typesafe.key がない");
        console.log(`[eval] jev: ${items.length} items`);
        records.push(
          ...(await runProvider(
            "jev",
            jevClassifyIncident(createJevEvaluate(fetch)),
            config,
            items
          ))
        );
      }
    }
    if (providers.includes("gemini")) {
      const prior = reuse("gemini");
      if (prior) {
        console.log(`[eval] gemini: ${prior.length} records reused`);
        records.push(...prior);
      } else if (!geminiApiKey)
        console.log("[eval] gemini.key がないため Gemini は実行しない");
      else {
        console.log(
          `[eval] gemini (${config.classifierModel}): ${items.length} items`
        );
        records.push(
          ...(await runProvider(
            "gemini",
            geminiClassifyIncident(geminiGenerateJson),
            config,
            items
          ))
        );
      }
    }

    const createdAt = new Date().toISOString();
    for (const provider of ["jev", "gemini"] as const)
      if (records.some((r) => r.provider === provider))
        meta.providers[provider] = conditions[provider];
    const evaluation = evaluateJev(records);
    const outDir = join(
      ROOT,
      "docs/progress/evaluations",
      `classifier-${createdAt.slice(0, 19).replace(/[:T]/g, "-")}`
    );
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, "meta.json"),
      JSON.stringify(meta, null, 2) + "\n"
    );
    writeFileSync(
      join(outDir, "records.json"),
      JSON.stringify(records, null, 2) + "\n"
    );
    writeFileSync(
      join(outDir, "evaluation.json"),
      JSON.stringify(evaluation, null, 2) + "\n"
    );

    const tuningSize = items.filter((i) => i.split === "tuning").length;
    const calibration =
      limit > 0
        ? null // 一部だけの実行からは較正を作らない
        : buildJevCalibration(
            evaluation,
            {
              id: dataset.id,
              version: dataset.version,
              tuningSize,
              heldOutSize: items.length - tuningSize,
            },
            createdAt
          );
    if (calibration)
      writeFileSync(
        join(outDir, "calibration.candidate.json"),
        JSON.stringify(calibration, null, 2) + "\n"
      );
    writeFileSync(
      join(outDir, "report.md"),
      renderReport(
        dataset,
        items.length,
        evaluation,
        createdAt,
        calibration !== null
      )
    );
    console.log(
      `[eval] accepted=${evaluation.accepted} calibratable=${evaluation.calibratable} → ${outDir}`
    );
  },
  30 * 60_000
);
