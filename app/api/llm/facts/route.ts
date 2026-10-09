import { createFactsRouteHandler } from "@/lib/infrastructure/llm/server/handler";
import { jevEvaluateProvider } from "@/lib/infrastructure/llm/server/provider";

// fact-model.md §4: 報告文に fact が明示されているかを Jev に尋ねる（Jev のみ）。
// LLM_CLASSIFIER_PROVIDER=jev と TYPESAFE_API_KEY がない場合は 503（クライアントは全件「記載なし」）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// サーバー側の全体締め切り（10 秒）+ 余裕
export const maxDuration = 15;

const handler = createFactsRouteHandler({ evaluate: jevEvaluateProvider });

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
