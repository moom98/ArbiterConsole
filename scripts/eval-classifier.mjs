#!/usr/bin/env node
/**
 * J3: 分類器の評価（jev-classifier-design §9）。実キーで外部 API を呼ぶため CI では実行しない。
 *
 * 1. プライバシーの確認（§9.4）とデータセットの検査を先に実行し、失敗すれば中止する（API は呼ばない）
 * 2. scripts/eval/classifier.eval.ts を実行する（Jev・Gemini・端末内のキーワード分類）
 *
 * キー: ~/.config/arbiter-console/typesafe.key（必須）、gemini.key（任意。ない場合は Gemini を比較しない）
 * 環境変数: EVAL_PROVIDERS=jev,gemini,keyword（既定）、EVAL_LIMIT=N（先頭 N 件だけ。較正は作らない）、
 *   EVAL_REUSE=docs/progress/evaluations/<run>（記録のあるプロバイダーは再利用し、API を呼ばない）
 *
 * 使い方: node scripts/eval-classifier.mjs
 */
import { spawnSync } from "node:child_process";

function run(args, label) {
  console.log(`\n[eval-classifier] ${label}`);
  const r = spawnSync("npx", args, { stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error(`[eval-classifier] ${label}: 失敗したため中止します`);
    process.exit(r.status ?? 1);
  }
}

run(
  [
    "vitest",
    "run",
    "__tests__/privacy",
    "__tests__/llm/classification-eval-dataset.test.ts",
  ],
  "プライバシーの確認・データセットの検査（API は呼ばない）"
);
run(
  ["vitest", "run", "--config", "vitest.eval.config.ts"],
  "評価の実行（実キー）"
);
