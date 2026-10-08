# ADR-010: Gemini Embedding for Semantic Rule Search (replaces the self-hosted model)

**Status:** Accepted

**Date:** 2026-10-08

**Supersedes:** the embedding-model part of [ADR-003](./ADR-003-offline-rule-search.md). Japanese tokenization, keyword search and the `RuleSource` model stay as they are.

---

## Context

- ADR-003 used a self-hosted, pinned in-browser model (`Xenova/paraphrase-multilingual-MiniLM-L12-v2` via Transformers.js), so semantic search also worked offline.
- On Cloudflare Workers (ADR-009) the model file (118 MB) is over the 25 MiB per-file limit. The first deployment therefore had keyword search only.
- Arbiters mostly use smartphones. Downloading 118 MB once per device, plus about 40 MB of ONNX WASM, is a real cost.
- Gemini is already used through server routes (ADR-007), with an access token, rate limits and a daily cap.
- **User decision (2026-10-08):** use Gemini embeddings (option A) instead of hosting the model on R2 (option B).

## Decision

1. **Model.**
   - `gemini-embedding-001` with `outputDimensionality: 768`.
   - It is fixed in code as `EMBEDDING_MODEL` (`lib/infrastructure/llm/contract.ts`), shared by server and client. Stored vectors carry `model: "gemini-embedding-001@768"`.
   - Unlike the reasoning and classification models, it is **not** configurable by env. A different model or dimension produces vectors that cannot be compared with the stored ones.
   - Task types: `RETRIEVAL_DOCUMENT` for rule text and `RETRIEVAL_QUERY` for search terms.
2. **Server route `/api/llm/embed`.**
   - It has the same guard as `/api/llm/{reason,classify}`: production fail-closed without `LLM_ACCESS_TOKEN`, token checked before the rate limit, body size limit, typed errors.
   - It has its own rate limit (`LLM_RATE_LIMIT_EMBED_PER_MINUTE`, default 60) and its own daily cap (`LLM_DAILY_EMBED_REQUEST_LIMIT`, default 1000), so a PDF import cannot use up the reasoning quota.
   - Input: 1–16 texts per request, each at most 2,000 characters (kept under the 2,048-token input limit for dense Japanese). A query is exactly 1 text.
   - **Documents:** transient upstream errors are retried within the existing 30 s deadline.
   - **Queries:** one attempt with a 4 s deadline, so search stays within a few seconds (§33).
   - A response with the wrong count or dimension becomes `invalid-model-output`, without retrying.
3. **Fair play (§23).**
   - **Queries** may contain incident descriptions. A query that mentions fair play (`mentionsFairPlay`) is never sent: the client skips it and the server rejects it. Search then uses keywords only.
   - **Documents** are rule texts the arbiter imported (FIDE/JCF rules, tournament regulations). They are not accusations about players and may mention fair play, so they are sent.
4. **Client** (`lib/infrastructure/embeddings/generator.ts`).
   - Documents are sent in batches of 16. Transient failures (rate-limited, upstream-unavailable, timeout, network) wait 5/15/30 s and retry, to cope with free-tier per-minute limits. The import progress shows the wait.
   - If a batch still fails, the vectors created so far are attached to the error (`partialVectors`) and saved with the rules. Only the rest is left for the backfill.
   - Queries are not retried and use a 5 s client timeout. If that runs out, the keyword results are shown on their own.
   - The fair-play check runs on the full query, before it is truncated.
   - Responses are checked for the model key, vector count and dimension.
5. **Creating missing embeddings** (`lib/application/embedding-backfill.ts`).
   - Rules are always saved, even when their embeddings cannot be created (offline, no token, cap reached).
   - Settings shows how many searchable rules have no current-model embedding, with a **意味検索用データを作成** button.
   - The backfill:
     - deletes embeddings from other models (they are never used);
     - creates the missing ones in batches of 16;
     - saves each batch in a transaction that skips rules deleted meanwhile and rules already embedded.
   - A failure keeps the batches already saved, and the next run resumes. Concurrent calls share one run.
6. **Search** (`hybrid-search.ts`).
   - If the device has no current-model embeddings, no request is sent and search is keyword-only.
   - Otherwise the query is embedded online and compared on the device (cosine similarity).
   - Any failure (offline, unauthorized, fair-play query) falls back to keyword search, as before.
   - The default `vectorMinSimilarity` is **0.65** (provisional), because Gemini similarities run higher than MiniLM's. Tune it with real PDFs.
7. **Removed:** Transformers.js and its ONNX runtimes, `scripts/{fetch,check}-model-assets.mjs`, `scripts/model-assets.mjs`, `public/ort/`, `public/models/`, the `ALLOW_MISSING_MODEL` build switch, `public/.assetsignore`, the `/models/` and `/ort/` service-worker caches, and the server-side webpack aliases. Static assets went from about 40 MB to 3.1 MB.

## Consequences

- **Semantic search now needs the network and the access token.** Keyword search still works offline and is the fallback for every failure. This is a deliberate change from ADR-003's offline semantic search, accepted by the user.
- **Search terms are sent to Google** (except fair-play ones). Rule texts are sent once, at import. Incident data is otherwise sent only through the existing AI reference flow (ADR-007).
- **Cost:** embeddings are billed per input token (about $0.15 per 1M tokens on the paid tier at the time of writing; there is a free tier). One rulebook is roughly 10⁵ tokens, so the cost is negligible.
- **Existing data:** embeddings from the old model are deleted on the next backfill. The rules themselves stay. Each device creates its own embeddings, because IndexedDB is per device.
- **Threshold:** 0.65 is untested against real Gemini output. Tune it once real PDFs are imported. This is recorded in `docs/progress/current.md`.
- **Changing the model later:** update `EMBEDDING_MODEL`, deploy, then each device runs 意味検索用データを作成. The new key makes all old vectors "missing".
