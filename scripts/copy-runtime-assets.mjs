#!/usr/bin/env node
/**
 * node_modules にある実行時アセットを public/ にコピーする（ネットワーク不要）。
 *
 * - pdfjs-dist legacy worker  → public/pdfjs/pdf.worker.min.mjs
 * - onnxruntime-web WASM      → public/ort/*.wasm（Transformers.js が使用）
 *
 * 同一オリジンから配信することで CDN に依存せずオフラインで動作させる（ADR-003）。
 * `npm run dev` / `npm run build` の前に自動実行される。生成物は .gitignore 対象。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");

function copy(from, to) {
  if (!existsSync(from)) {
    throw new Error(`Runtime asset not found: ${from} (run npm install)`);
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(
    `[assets] ${from.replace(root + "/", "")} -> ${to.replace(root + "/", "")}`
  );
}

copy(
  join(root, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
  join(publicDir, "pdfjs/pdf.worker.min.mjs")
);

// Transformers.js v2 に同梱された onnxruntime-web と同じバージョンの WASM を使う
const ortDist = join(root, "node_modules/@xenova/transformers/dist");
for (const name of readdirSync(ortDist).filter((f) => f.endsWith(".wasm"))) {
  copy(join(ortDist, name), join(publicDir, "ort", name));
}
