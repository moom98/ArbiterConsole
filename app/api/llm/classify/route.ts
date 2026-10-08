import { createLlmRouteHandler } from "@/lib/infrastructure/llm/server/handler";
import {
  classifierProvider,
  llmProvider,
} from "@/lib/infrastructure/llm/server/provider";

// ADR-007 / ADR-011: 分類のプロバイダー（Gemini / Jev）はサーバーからのみ呼び出す
// （API キーはサーバーの環境変数）。LLM_CLASSIFIER_PROVIDER で選ぶ（既定 gemini）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// サーバー側の全体締め切り（30 秒）+ 余裕。クライアントは 35 秒で打ち切る
export const maxDuration = 35;

const handler = createLlmRouteHandler("classify", {
  generate: llmProvider,
  classifierFor: classifierProvider,
});

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
