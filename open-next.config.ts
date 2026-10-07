import { defineCloudflareConfig } from "@opennextjs/cloudflare/config";

// ISR・画像最適化は使わないため、キャッシュの上書き（R2 等）は設定しない（ADR-009）
export default defineCloudflareConfig();
