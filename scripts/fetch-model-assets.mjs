#!/usr/bin/env node
/**
 * 埋め込みモデルを Hugging Face Hub からダウンロードし public/models/ に配置する。
 *
 *   npm run fetch-models
 *
 * アプリは実行時に HF Hub へアクセスしない（env.allowRemoteModels = false）。
 * このスクリプトはデプロイ前（ビルド環境）に一度だけ実行する。
 * 生成物（約120MB）は .gitignore 対象のためリポジトリにはコミットしない。
 *
 * モデルIDは lib/infrastructure/embeddings/generator.ts の EMBEDDING_MODEL_ID と
 * 一致させること（ADR-003）。
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const REVISION = "main";
const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = join(root, "public/models", MODEL_ID);
const force = process.argv.includes("--force");

for (const file of FILES) {
  const target = join(modelDir, file);
  if (!force && existsSync(target) && statSync(target).size > 0) {
    console.log(`[models] skip (exists) ${file}`);
    continue;
  }

  const url = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${file}`;
  console.log(`[models] downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
}

console.log(`[models] ${MODEL_ID} ready in public/models/`);
