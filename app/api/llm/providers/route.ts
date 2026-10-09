import { createProvidersRouteHandler } from "@/lib/infrastructure/llm/server/handler";

// 外部AIの送り先（分類のプロバイダー・fact の判定の可否）。送信前のプレビューに実際の送り先を
// 示すために使う（D13, jev-classifier-design §14.3）。上流は呼ばない
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createProvidersRouteHandler();

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
