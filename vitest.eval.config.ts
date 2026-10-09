import { defineConfig } from "vitest/config";
import path from "path";

/**
 * 実キーでの評価（J3）専用。CI・通常の `vitest` では実行しない（*.eval.ts は既定の対象外）。
 * 実行は scripts/eval-classifier.mjs から
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/eval/**/*.eval.ts"],
    exclude: ["**/node_modules/**", ".claude/**"],
    testTimeout: 30 * 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
