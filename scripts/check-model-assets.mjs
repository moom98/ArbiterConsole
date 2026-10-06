#!/usr/bin/env node
/**
 * ビルド前に埋め込みモデルが public/models/ に配置済みか確認する。
 *
 * モデルが無いままデプロイすると、意味検索が使えずキーワード検索のみになる。
 * 気付かずに本番へ出さないよう、既定ではビルドを失敗させる。
 * 開発・CI でモデル無しのビルドを意図的に行う場合は ALLOW_MISSING_MODEL=1 を指定する。
 *
 * 存在確認のみ行う（ハッシュ検証は fetch-model-assets.mjs が取得時に実施）。
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { FILES, MODEL_DIR, MODEL_ID } from "./model-assets.mjs";

const missing = FILES.filter((file) => {
  const target = join(MODEL_DIR, file.path);
  return !existsSync(target) || statSync(target).size === 0;
}).map((file) => file.path);

if (missing.length > 0) {
  const banner = "=".repeat(72);
  const message = [
    banner,
    `[models] Embedding model ${MODEL_ID} is MISSING from public/models/:`,
    ...missing.map((p) => `  - ${p}`),
    "Semantic (vector) rule search will NOT work; only keyword search will.",
    "Run `npm run fetch-models` before building for deployment.",
    banner,
  ].join("\n");

  if (process.env.ALLOW_MISSING_MODEL === "1") {
    console.warn(`${message}\n[models] ALLOW_MISSING_MODEL=1 set: continuing.`);
  } else {
    console.error(
      `${message}\n[models] Build aborted. Set ALLOW_MISSING_MODEL=1 to build without the model.`
    );
    process.exit(1);
  }
} else {
  console.log(`[models] ${MODEL_ID} present.`);
}
