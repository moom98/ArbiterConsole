import { createLlmRouteHandler } from "@/lib/infrastructure/llm/server/handler";
import { llmProvider } from "@/lib/infrastructure/llm/server/provider";

// ADR-007: Gemini はサーバーからのみ呼び出す（API キーはサーバーの環境変数）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createLlmRouteHandler("reason", {
  generate: llmProvider,
});

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
