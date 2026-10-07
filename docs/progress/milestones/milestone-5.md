# Milestone 5: LLM Integration (Gemini via server route)

**Status:** Implemented on branch `feature/m4-and-review-fixes` + worktree commits (394986e … HEAD). Two independent reviews (domain/UI, server/security) asked for fixes before merging; all blocking and listed items are addressed (see "Review fixes").
**Decision record:** [ADR-007](../../decisions/ADR-007-gemini-llm-via-server-route.md). The provider is Google Gemini, called only from the server.

## Completed work

- **Server routes:** `app/api/llm/reason` and `app/api/llm/classify` (`runtime = "nodejs"`, `force-dynamic`, POST only).
  - Request checks: JSON content type is required (415 otherwise). Input is validated by hand-written checks with size limits (`LLM_LIMITS`).
  - Rate limit: one in-memory token bucket per route, env-configurable (default 10/min). The key is the client IP only when `TRUST_PROXY=1`; otherwise all callers share one per-process bucket. There is also a per-process daily cap (`LLM_DAILY_REQUEST_LIMIT`, default 500).
  - Optional `LLM_ACCESS_TOKEN`: requests need the `X-Arbiter-Access-Token` header (401 otherwise, constant-time compare). The client stores the token in localStorage via `LlmAccessTokenField`.
  - Timeouts and retries: per-attempt timeout (reason 20 s, classify 8 s), 30 s total deadline. Up to 3 attempts, with exponential backoff and jitter for 408/429/5xx/network/timeout errors.
  - Typed errors (`lib/infrastructure/llm/contract.ts`). A missing key returns 503 `not-configured`. Logs contain only the error code, status and attempt count.
- **Gemini adapter:** `@google/genai` 2.27.0, pinned exactly.
  - Uses `responseJsonSchema`, and citation `articleId` is an enum of the article IDs that were sent.
  - The SDK's own retry is turned off.
  - The SDK is excluded from the bundle via `experimental.serverComponentsExternalPackages`.
- **Domain (pure, no LLM inside):** `lib/domain/llm/`
  - `output-validator.ts` rejects a draft for:
    - invalid schema;
    - a penalty without a source, or a source not among the citations;
    - an article ID that was not sent, or is no longer in IndexedDB;
    - a quote that does not match the article text (NFKC, whitespace removed, quote characters unified; `…` fragments must appear in order and be at least 4 characters each);
    - speculative wording (JA/EN);
    - a fair-play penalty.

    It applies auto-fixes: `high` confidence → `medium`, `low` confidence → escalate, escalation → `consult-ca`.
  - `llm-decision.ts` builds the Decision. A valid draft gives `generatedBy: "llm"` with citations carrying `RuleSource` name, version and page. A rejected draft gives 「裁定を確定できません」 + CA with `validationErrors`.
  - `keyword-classifier.ts` is the offline fallback. `classification.ts` parses the LLM classification.
  - `ports.ts` defines `LlmAssistPort`.
- **DecisionEngine:** `processIncident` (sync) is unchanged. The new `evaluate()` (async) calls the port only for the old "manual-review / no tree" branch.
  - `offline` → manual review with 「オンライン時にAI参考情報を取得できます。」.
  - `error` → manual review with the reason.
  - `no-articles` → 「該当する規則が見つかりませんでした。」 + CA.
- **Client:**
  - `llm-api-client.ts`: no request when `navigator.onLine === false`; client timeout 35 s.
  - `llm-assist-port.ts`: lazy-loads the hybrid search over IndexedDB, then re-checks with `db.rules.bulkGet`.
  - `lib/application/llm-classification.ts`: LLM classification, falling back to keywords.
- **Store:** `incident-store` uses `engine.evaluate` and has new `llmPending` and `retryEvaluation()`. The default store injects `createLlmAssistPort()`.
- **UI:**
  - `DecisionDisplay`: 「AI参考」 badge, stronger disclaimer, validation status, sources expanded by default with edition/page, offline/unavailable notice with a retry button.
  - `IncidentTextClassifier` (category step): a suggestion only, which pre-fills category, subtype and description.
  - Report page: loading text while the AI request runs, and the retry wiring.
- **Entities:** optional `Decision.llm` (`LlmDecisionMeta`) and `RuleCitation.ruleId`. No DB schema change.
- **Docs:** ADR-007, an index entry, notes in ADR-001/002 and design docs, README env section, `.env.example`.

## Review fixes (after the two independent reviews)

- **D-H1:** strict quote matching blocks quotes stitched together to invert the meaning.
  - A contiguous quote needs ≥20 characters (Japanese ≥10). At most one `…`, with fragments ≥15 (Japanese ≥8).
  - The omitted text must be ≤200 characters with no negation or exception words.
  - A quote that stops right before a Japanese negation is rejected.
  - Ellipsis variants are unified after NFKC.
- **D-H2:** `game-loss`, `both-lose` and `expulsion` from the LLM force CA escalation + `consult-ca`.
- **D-H3:** AI decisions are never treated as applied.
  - The incident stays `pending`.
  - AI penalties are excluded from the summary and per-player history and shown as 「AI参考（未確定）」.
  - The CSV has a `生成元` column.
- **D-M1:** fair-play is never sent to the LLM (reasoning or classification). It gets a deterministic CA checklist (`lib/domain/services/fair-play.ts`).
- **D-M2:** the speculation scan covers every free-text field, with a longer word list. The tension with §14 is resolved through structured fields (see ADR-007).
- **D-M3:** the classifier pre-fills only category and description. The tree asks for the subtype.
- **S-H1:** access token, daily cap and `TRUST_PROXY`. Google Cloud quotas and budget are documented.
- **S-H2:** each attempt's timeout is bounded by the remaining deadline. No retry starts with <3 s left. `maxDuration = 35`.
- **S-M1:** thinking level (`GEMINI_THINKING_LEVEL`, default `low`). Reasoning `maxOutputTokens` is 6,000.
- **S-M2:** the body size limit is enforced while streaming.
- **S-M3:** each route has its own rate bucket.
- **L1:** a replaced decision is marked `supersededBy`.
- **L2:** the deviation from ADR-002 (low confidence auto-escalates) is documented.
- **L4:** `llmPending` uses a counter.
- **S-L2:** the prompt treats every input field as data.
- **S-L3:** only known transport errors are retried.
- **S-L4:** `maxDuration` is set on the routes.
- `Decision.llm` records the model and error code.

## Re-review fixes (after the M6 merge, 2026-10-07)

The re-review returned MERGE and confirmed all earlier blockers fixed. Its should-fix items and nits were then addressed:

- **M6 merge:** `incident-store` passes the game's `tournamentId` to the engine (M6 moved the tournament lookup into `rulesetFor`).
- **SF-1:** fail closed. In production without `LLM_ACCESS_TOKEN`, the routes return 503 unless `LLM_ALLOW_UNAUTHENTICATED=1`.
- **SF-2:** the access token is checked before the rate limit.
- **SF-3:** `mentionsFairPlay()` (with new English patterns) stops fair-play text in the engine, the classification service and the assist port, whatever the top category is. The server rejects `category: "fair-play"` (NIT-2).
- **SF-4:**
  - The quote-context check catches ん+で prohibitions (〜んではならない / いけない, 〜ではない).
  - The preceding-negation check scans back to the start of the sentence (at most 400 characters) instead of 30 characters.
- **NIT-1:** `draw` counts as a severe penalty and forces CA escalation.
- **NIT-4:** `GEMINI_THINKING_BUDGET` is documented in `.env.example` and the README.
- **NIT-5:** `LlmAccessTokenField` is mounted in Settings (AI設定).
- **Not changed (NIT-3):** a quote that ends exactly at the 4,000-character cut. This is rare, and the full-sentence display mitigates it.

## Env vars

- `GEMINI_API_KEY` (required, server only)
- `GEMINI_MODEL_REASONING` (default `gemini-flash-latest`)
- `GEMINI_MODEL_CLASSIFIER` (default `gemini-flash-lite-latest`)
- `GEMINI_THINKING_LEVEL` (default `low`; `off` for models without thinking)
- `LLM_ACCESS_TOKEN` (required in production unless `LLM_ALLOW_UNAUTHENTICATED=1` behind platform auth)
- `LLM_ALLOW_UNAUTHENTICATED` (`1` only when the platform protects the routes)
- `GEMINI_THINKING_BUDGET` (optional explicit thinking token budget)
- `LLM_RATE_LIMIT_REASON_PER_MINUTE` / `LLM_RATE_LIMIT_CLASSIFY_PER_MINUTE` (default 10)
- `LLM_DAILY_REQUEST_LIMIT` (default 500, `0` = unlimited)
- `TRUST_PROXY` (`1` only behind a proxy that overwrites `X-Forwarded-For`)

Both default models are aliases listed in the SDK's model type and README.

### Changing models later (planned follow-up task)

- **Only change:** env vars `GEMINI_MODEL_CLASSIFIER` (classification / 判定) and `GEMINI_MODEL_REASONING` (reasoning / 推論), then restart the server.
- **Defaults:** they live only in `lib/infrastructure/llm/server/config.ts` (`DEFAULT_CLASSIFIER_MODEL`, `DEFAULT_REASONING_MODEL`). When changing them, also update `.env.example` and the README table.
- **Provider:** it is bound only in `lib/infrastructure/llm/server/provider.ts` (`llmProvider`, a `GenerateJsonFn`). To swap providers, add a new adapter and rebind `llmProvider`. Nothing else needs to change.
- **Tests:** `__tests__/llm/route-handler.test.ts` asserts the default model IDs. Update those expectations if the defaults change.

## Tests / verification

- `__tests__/llm/` has 11 test files and 142 tests:
  - validator (each rule);
  - Decision builder;
  - keyword and LLM classification;
  - engine routing (tree-covered incidents never reach the LLM, uncovered → port, offline / error / no-articles);
  - route handler (validation, 413/415, rate limit with Retry-After, missing key 503 without leaks, SDK status mapping, retry/backoff, timeout with abort, deadline, blocked output, invalid JSON);
  - SDK adapter (mocked `@google/genai`);
  - client, port and classification service;
  - store + IndexedDB integration with a fake port (including an article deleted mid-request, and offline → retry);
  - component tests;
  - the review fixes: quote-inversion cases, severe-penalty escalation, speculation in every field, fair-play skip, pending status and penalty exclusion, CSV, access token, daily cap, trusted proxy, per-route buckets, streaming body limit, deadline-bounded retry, unknown errors not retried, thinking level.
- Full suite after the M6 merge and re-review fixes: 45 files, 657 passed.
- `tsc --noEmit` and eslint report no new findings. One existing prettier warning remains in `lib/domain/entities/game.ts`. In the nested worktree, eslint must run with `--no-eslintrc -c .eslintrc.json`.
- `ALLOW_MISSING_MODEL=1 npm run build` succeeds. No SDK code appears in `.next/static`.
- Not tested against the real Gemini API (no key available).

## Known issues / risks

- The rate limit and daily cap are per instance and in memory, so they are not a quota on serverless. Configure Google Cloud quotas and a billing budget. Without `TRUST_PROXY=1`, all callers share one bucket.
- The access token sits in localStorage (shared devices). Platform authentication is preferred.
- There is no "confirm AI suggestion" flow yet. AI-assisted incidents stay `pending` until edited.
- Thinking-level support differs by model. If a configured model rejects `thinkingConfig`, set `GEMINI_THINKING_LEVEL=off`.
- Gemini may return `RECITATION` (treated as `blocked`) when quoting rule text verbatim. This needs a live check.
- Strict quote matching (and the speculative-word list, e.g. 「でしょう」) may reject many otherwise usable answers, which then fall back to CA. Tune it with real outputs.
- `*-latest` model aliases can drift.
- Articles longer than 4,000 characters are truncated, so quotes are only possible from the start of the article.

## Unresolved questions

- Arbiter confirmation flow for AI suggestions: what should "confirmed" record, and should confirmed AI penalties count towards history?
- Player explanation generation (§15) and LLM-generated follow-up questions feeding the trees: these are hints only for now.
- Production deploy target: a Node server is required for `/api`.

## For a fresh session

- Entry points:
  - `lib/domain/decision-engine/index.ts` (`evaluate`)
  - `lib/domain/llm/*`
  - `lib/infrastructure/llm/{contract,llm-api-client,llm-assist-port}.ts`
  - `lib/infrastructure/llm/server/*` (handler, generate/retry, prompts, rate limiter, config, gemini-client)
  - `app/api/llm/*/route.ts`
- Never import `lib/infrastructure/llm/server/**` or `@google/genai` from client code.
- The domain must stay LLM-free and route through `LlmAssistPort`.
- When adding a new Decision Tree, add its routing before the `uncovered` return in `DecisionEngine.route`, so those incidents stop reaching the LLM.
- Adding npm deps drops platform bindings from package-lock. Re-merge the lock (keep `@rolldown/binding-darwin-arm64` and `lightningcss-darwin-arm64`).
