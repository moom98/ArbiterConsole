#!/usr/bin/env node
/**
 * Cloudflare Workers 向けビルド（cf:build / cf:preview / cf:deploy）の前に実行する。
 *
 * OpenNext は .env / .env.local / .env.production(.local) の値をワーカーのスクリプトに埋め込む。
 * 開発用の GEMINI_API_KEY や LLM_ALLOW_UNAUTHENTICATED=1 が本番に混入しないよう、
 * これらのファイルがある場合はビルドを中止する（ADR-009）。
 * Workers のローカル確認用の値は .dev.vars に、本番の値は `npx wrangler secret put` で設定する。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const FILES = [".env", ".env.local", ".env.production", ".env.production.local"];
const found = FILES.filter((f) => existsSync(join(process.cwd(), f)));

if (found.length > 0) {
  console.error(
    [
      `[cf] Found ${found.join(", ")}. OpenNext would embed these values in the deployed worker.`,
      "[cf] Move local values to .dev.vars (wrangler dev) and production values to `npx wrangler secret put`,",
      "[cf] or temporarily rename the files, then run the command again.",
    ].join("\n")
  );
  process.exit(1);
}
