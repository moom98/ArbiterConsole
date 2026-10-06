#!/usr/bin/env node
/**
 * 埋め込みモデルを Hugging Face Hub からダウンロードし public/models/ に配置する。
 *
 *   npm run fetch-models            # 未取得・ハッシュ不一致のファイルのみ取得
 *   npm run fetch-models -- --force # 全て再取得
 *
 * アプリは実行時に HF Hub へアクセスしない（env.allowRemoteModels = false）。
 * リビジョンはコミットSHAに固定し、ダウンロード後にハッシュを検証する。
 * 生成物（約135MB）は .gitignore 対象のためリポジトリにはコミットしない。
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FILES, MODEL_DIR, MODEL_ID, REVISION, verifyFile } from "./model-assets.mjs";

const force = process.argv.includes("--force");

for (const file of FILES) {
  const target = join(MODEL_DIR, file.path);
  if (!force && existsSync(target) && verifyFile(file, target)) {
    console.log(`[models] ok (verified) ${file.path}`);
    continue;
  }

  const url = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${file.path}`;
  console.log(`[models] downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));

  if (!verifyFile(file, partial)) {
    rmSync(partial, { force: true });
    throw new Error(`Hash mismatch for ${file.path} (revision ${REVISION})`);
  }
  renameSync(partial, target);
  console.log(`[models] verified ${file.path}`);
}

console.log(`[models] ${MODEL_ID}@${REVISION.slice(0, 7)} ready in public/models/`);
