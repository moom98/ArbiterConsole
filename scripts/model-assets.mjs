/**
 * 埋め込みモデルの固定情報（scripts/fetch-model-assets.mjs, scripts/check-model-assets.mjs 共通）
 *
 * MODEL_ID は lib/infrastructure/embeddings/generator.ts の EMBEDDING_MODEL_ID と一致させること。
 * REVISION は Hugging Face 上のコミットSHAに固定し、各ファイルのハッシュを検証する（ADR-003）。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const REVISION = "2c4055b12046f11709e9df2c122e59ffbdc2f900";

/**
 * - sha256: Git LFS 管理ファイルの内容SHA-256
 * - gitBlobSha1: 通常ファイルの git blob SHA-1（"blob <size>\0" + 内容）
 */
export const FILES = [
  {
    path: "config.json",
    gitBlobSha1: "ce7fe159b2eee53ef2b9704a72a4efa6c22248b4",
  },
  {
    path: "tokenizer_config.json",
    gitBlobSha1: "9f3bfd538ec86d360dc988dac25e3cfb0c4c14d5",
  },
  {
    path: "special_tokens_map.json",
    gitBlobSha1: "d5698132694f4f1bcff08fa7d937b1701812598e",
  },
  {
    path: "tokenizer.json",
    sha256: "b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441",
  },
  {
    path: "onnx/model_quantized.onnx",
    sha256: "66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc",
  },
];

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MODEL_DIR = join(ROOT, "public/models", MODEL_ID);

export function verifyFile(file, absolutePath) {
  const content = readFileSync(absolutePath);
  if (file.sha256) {
    const actual = createHash("sha256").update(content).digest("hex");
    return actual === file.sha256;
  }
  const actual = createHash("sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex");
  return actual === file.gitBlobSha1;
}
