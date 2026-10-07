import { createLlmRouteHandler } from "@/lib/infrastructure/llm/server/handler";
import { geminiGenerateJson } from "@/lib/infrastructure/llm/server/gemini-client";

// ADR-006: Gemini はサーバーからのみ呼び出す（API キーはサーバーの環境変数）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createLlmRouteHandler("reason", {
  generate: geminiGenerateJson,
});

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
