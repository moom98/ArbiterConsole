#!/usr/bin/env node
/**
 * J3: 分類と fact の記載の評価（jev-classifier-design §9）。本体は scripts/eval/eval-classifier.ts。
 * TypeScript のアプリのコード（前処理・Jev のクライアント・ドメインの検証）をそのまま使うため、
 * esbuild で1つにまとめて node_modules/.cache に置き、実行する。
 *
 * 使い方:
 *   node scripts/eval-classifier.mjs check
 *   node scripts/eval-classifier.mjs run --provider jev
 *   node scripts/eval-classifier.mjs run --provider gemini
 *   node scripts/eval-classifier.mjs run --provider jev --set presence
 *   node scripts/eval-classifier.mjs fit --jev <file> --gemini <file> [--presence <file>]
 *
 * API キーは ~/.config/arbiter-console/typesafe.key と gemini.key（chmod 600）。.env には置かない。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "node_modules", ".cache", "arbiter-eval", "eval.mjs");
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [join(root, "scripts", "eval", "eval-classifier.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // @/* は tsconfig の paths で解決する。npm パッケージは node_modules から読む
  tsconfig: join(root, "tsconfig.json"),
  packages: "external",
  logLevel: "warning",
});

const { main, defaultKeyReader } = await import(pathToFileURL(outfile).href);

const code = await main(process.argv.slice(2), {
  root,
  fetch: globalThis.fetch,
  runPrivacyCheck: () =>
    spawnSync("npx", ["vitest", "run", "__tests__/privacy"], {
      cwd: root,
      stdio: "inherit",
    }).status === 0,
  readKey: defaultKeyReader,
  env: process.env,
  now: () => new Date(),
  log: (line) => console.log(line),
});
process.exit(code);
