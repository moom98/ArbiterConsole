# ADR-009: Deploy to Cloudflare Workers via OpenNext (first deployment without the embedding model)

**Status:** Accepted

**Date:** 2026-10-08

---

## Context

- The user chose **Cloudflare Workers** as the first deployment target (2026-10-08).
- The AI routes `/api/llm/{reason,classify}` (ADR-007) need a server runtime, so a static export is not enough.
- Next.js on Workers runs through the **OpenNext Cloudflare adapter**:
  - the latest adapter (1.16+) requires Next.js 15.5+ or 16;
  - **1.15.x** is the last line that supports Next.js 14, and only `^14.2.35`;
  - the app is on Next.js 14 (ADR-001).
- Workers static assets are limited to **25 MiB per file**. The pinned embedding model `onnx/model_quantized.onnx` (ADR-003) is **118 MB**, so it cannot be served as a Worker asset.
- The user chose to deploy **without the embedding model first**. Rule search then uses keywords only, and model hosting comes later.

## Decision

1. **Adapter and versions.**
   - `next` and `eslint-config-next` go from 14.2.18 to **14.2.35**: a patch-level security update that stays on Next 14 (ADR-001).
   - Add `@opennextjs/cloudflare@~1.15.1` and `wrangler@^4.148`. The `~` pin matters, because 1.16+ drops Next 14.
   - The adapter imports `esbuild` without declaring it, so `esbuild@0.28.1` is a root devDependency. It matches wrangler and satisfies vite's peer range.
2. **Configuration.**
   - `wrangler.jsonc`:
     - worker `arbiter-console`;
     - flags `nodejs_compat` and `global_fetch_strictly_public`;
     - assets from `.open-next/assets`;
     - a self-reference service binding;
     - observability on.
   - `open-next.config.ts`: the default config, with no R2 incremental cache and no Images binding. The app uses neither ISR nor `next/image`, so the first deploy needs no extra Cloudflare resources.
3. **Transformers.js stays out of the server bundle.** The webpack server build aliases `@xenova/transformers` and `onnxruntime-node` to empty modules. Before, they were `commonjs` externals, which pulled `onnxruntime-node`'s native `.node` binaries into the server output, and Workers cannot bundle those. The embedding generator only loads them through a dynamic `import()` in the browser, so behaviour on Node is unchanged.
4. **Secrets and environment.**
   - `GEMINI_API_KEY` and `LLM_ACCESS_TOKEN` are Worker **secrets**, set with `npx wrangler secret put`. They are never in `wrangler.jsonc` or the repo.
   - The AI routes are protected by the access token. The user chose this over platform auth.
   - In production the routes fail closed without the token (ADR-007).
5. **Build and deploy.**
   - Command: `ALLOW_MISSING_MODEL=1 npm run cf:deploy`.
   - This runs the OpenNext build, which runs `next build` with the existing prebuild checks, then `wrangler deploy`.
   - `ALLOW_MISSING_MODEL=1` is required only while the model is not hosted.

## Verification (local, `wrangler dev` on the built worker)

- All pages return 200: `/home`, `/report`, `/search`, `/log`, `/settings`, `/tournament`, `/tournament/new`, `/tournament/[id]`, `/tournament/[id]/rounds/[n]`. `/` returns 307 to `/home`.
- Also served: `manifest.json`, `sw.js`, the ORT WASM (≈10 MB) and the pdf.js worker.
- `/api/llm/classify`:
  - no token configured: 503 `not-configured` (fail closed);
  - token configured, no header: 401;
  - correct token: reaches Gemini. A dummy key gives upstream status 400, which is mapped to 502 `upstream-error`. This shows the `@google/genai` SDK runs on Workers;
  - fair-play text: 400.
- Worker size: 6.2 MiB raw, **1.28 MiB gzip**, under the free plan's 3 MiB limit. 58 static assets, none over 20 MB.

## Consequences

- Semantic (vector) rule search is not available in this deployment; keyword search works. Restoring it needs the model hosted elsewhere, e.g. Cloudflare R2 with a pinned revision and hash check, plus an ADR-003 update. That is a follow-up.
- **Next.js 14 is end-of-life, and adapter 1.15.x will not get new fixes.** Plan an upgrade to Next.js 15.5+/16 and the current adapter. This touches React 19 and `next-pwa` compatibility, so it needs its own milestone.
- The in-memory rate limit and daily cap are per Worker isolate (ADR-007). Set Google Cloud quotas and a billing budget for the Gemini key.
- `npm run build` and `next start` on Node still work, so the Node deployment path is unchanged.
