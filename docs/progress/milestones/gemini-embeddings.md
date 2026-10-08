# Gemini Embedding for Semantic Search (ADR-010)

**Status:** Merged (PR #3) and deployed on 2026-10-08 (version `7221140b`). Reviewed: verdict MERGE; its two should-fix items and the nits were fixed (see below). Real-device verification with the real Gemini key is still pending.
**Date:** 2026-10-08
**Decision record:** [ADR-010](../../decisions/ADR-010-gemini-embeddings-for-semantic-search.md)

## Why

- The self-hosted model (118 MB) cannot be served on Cloudflare Workers (ADR-009), so the first deployment had keyword search only.
- The user chose Gemini Embedding (option A) over hosting the model on R2 (option B).

## Completed work

- **Server** (`lib/infrastructure/llm/server/`):
  - `/api/llm/embed` (`createEmbedRouteHandler`). It shares the guard with the other AI routes: fail closed in production, token before rate limit, body limit.
  - Own rate limit (`LLM_RATE_LIMIT_EMBED_PER_MINUTE`, default 60) and daily cap (`LLM_DAILY_EMBED_REQUEST_LIMIT`, default 1000).
  - Input validation: 1–16 texts of at most 3,000 characters; a query is exactly one text; fair-play queries are rejected.
  - `geminiEmbedTexts` uses `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` and 768 dimensions. A malformed response becomes `invalid-model-output`, without retrying.
  - The common pre-processing was extracted into `guard()`. The behaviour of `reason`/`classify` is unchanged.
- **Contract:** `EMBEDDING_MODEL` (`gemini-embedding-001`, 768 dimensions, key `gemini-embedding-001@768`) is fixed in code and shared by server and client.
- **Client** (`lib/infrastructure/embeddings/generator.ts`):
  - Documents are sent in batches of 16. Transient failures wait 5/15/30/60 s and retry.
  - Queries are not retried, and fair-play queries are never sent.
  - Responses are checked for the model key, count and dimension.
- **Backfill** (`lib/application/embedding-backfill.ts`):
  - Creates embeddings for searchable rules that lack a current-model one.
  - Deletes other models' embeddings.
  - Saves each batch, skipping rules deleted meanwhile and rules already embedded, and resumes after a failure.
  - Concurrent calls share one run.
- **Search:**
  - When the device has no current-model embeddings, no request is sent.
  - Otherwise the query is embedded online. Any failure falls back to keyword search.
  - Default `vectorMinSimilarity` is 0.65 (provisional).
- **UI (Settings):**
  - A notice and the button 意味検索用データを作成 when searchable rules have no embedding.
  - Import warning text updated.
  - The per-source count of embeddings is unchanged.
- **Removed:**
  - Transformers.js and the ONNX runtimes.
  - The model fetch/check scripts and `ALLOW_MISSING_MODEL`.
  - `public/ort`, `public/models` and `public/.assetsignore`.
  - The `/models/` and `/ort/` service-worker caches, and the server webpack aliases.
  - Static assets went from about 40 MB to 3.1 MB.
- **Docs:**
  - ADR-010 added.
  - ADR-003 marked partially superseded; ADR-009 consequence resolved.
  - README (features, stack, setup, env table, model notes, build/deploy) and `.env.example` updated.

## Review fixes

- **Search latency:** a query is one attempt with a 4 s server deadline and a 5 s client timeout, so slow Gemini or flaky Wi-Fi no longer holds back keyword results for up to 35 s.
- **Import:** a failed batch no longer discards earlier batches. The vectors created so far are saved with the rules, and the progress message shows retry waits. Document retry waits are 5/15/30 s.
- **Fair play:** checked on the full query before truncation.
- **Search screen:** the banner says why semantic search was skipped (the reason plus offline / token / no-data hints).
- **Input size:** reduced to 2,000 characters per text, for the 2,048-token limit.
- **Design docs:** `ai-rag-design.md` and `DESIGN-SUMMARY.md` now point to ADR-010.

## Tests / verification

- New: `__tests__/llm/embed-route.test.ts` (12) and `__tests__/rule-search/gemini-embeddings.test.ts` (9). They cover:
  - the client: batching, truncation, retry/give-up, response checks, fair-play queries;
  - the backfill: active rules only, stale-model cleanup, partial failure and resume, a rule deleted mid-run, a shared run;
  - stats;
  - search: no request without embeddings, vector results with them.
- Full suite after the review fixes: 50 files / 769 tests. tsc is clean and eslint reports 0 errors.
- `npm run build` and `npm run cf:build` succeed.
- **Not tested against the real Gemini API** (the key is only in Cloudflare secrets). After deploying, check:
  - importing a PDF creates embeddings;
  - a natural-language search returns semantic results.

## Known issues

- `vectorMinSimilarity` 0.65 needs tuning on real FIDE/JCF PDFs.
- Semantic search needs the network and the token. Each device creates its own embeddings.
- Free-tier limits (100 requests and 30k tokens per minute) can make imports slow. The client waits and retries. If it still fails, the rules and the vectors created so far are saved, and the backfill completes the rest.
- Over-length input behaviour (truncated or rejected) is unverified against the real API.
