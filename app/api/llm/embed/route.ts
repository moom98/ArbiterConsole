import { createEmbedRouteHandler } from "@/lib/infrastructure/llm/server/handler";
import { embedProvider } from "@/lib/infrastructure/llm/server/provider";

// ADR-010: 意味検索の埋め込みもサーバーからのみ Gemini を呼び出す（API キーはサーバーの環境変数）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// サーバー側の全体締め切り（30 秒）+ 余裕。クライアントは 35 秒で打ち切る
export const maxDuration = 35;

const handler = createEmbedRouteHandler({ embed: embedProvider });

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
