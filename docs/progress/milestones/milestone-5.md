# Milestone 5: LLM Integration (Gemini via server route)

**Status:** Implemented on branch `feature/m4-and-review-fixes` + worktree commits (394986e … HEAD). No independent review yet.
**Decision record:** [ADR-007](../../decisions/ADR-007-gemini-llm-via-server-route.md). The provider is Google Gemini, called only from the server.

## Completed work

- **Server routes:** `app/api/llm/reason` and `app/api/llm/classify` (`runtime = "nodejs"`, `force-dynamic`, POST only).
  - Request checks: JSON content type is required (415 otherwise). Input is validated by hand-written checks with size limits (`LLM_LIMITS`).
  - Rate limit: in-memory token bucket, 10 requests/min per IP, shared by both routes.
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

## Env vars

- `GEMINI_API_KEY` (required, server only)
- `GEMINI_MODEL_REASONING` (default `gemini-flash-latest`)
- `GEMINI_MODEL_CLASSIFIER` (default `gemini-flash-lite-latest`)

Both default models are aliases listed in the SDK's model type and README.

### Changing models later (planned follow-up task)

- **Only change:** env vars `GEMINI_MODEL_CLASSIFIER` (classification / 判定) and `GEMINI_MODEL_REASONING` (reasoning / 推論), then restart the server.
- **Defaults:** they live only in `lib/infrastructure/llm/server/config.ts` (`DEFAULT_CLASSIFIER_MODEL`, `DEFAULT_REASONING_MODEL`). When changing them, also update `.env.example` and the README table.
- **Provider:** it is bound only in `lib/infrastructure/llm/server/provider.ts` (`llmProvider`, a `GenerateJsonFn`). To swap providers, add a new adapter and rebind `llmProvider`. Nothing else needs to change.
- **Tests:** `__tests__/llm/route-handler.test.ts` asserts the default model IDs. Update those expectations if the defaults change.

## Tests / verification

- `__tests__/llm/` has 9 test files and 110 tests:
  - validator (each rule);
  - Decision builder;
  - keyword and LLM classification;
  - engine routing (tree-covered incidents never reach the LLM, uncovered → port, offline / error / no-articles);
  - route handler (validation, 413/415, rate limit with Retry-After, missing key 503 without leaks, SDK status mapping, retry/backoff, timeout with abort, deadline, blocked output, invalid JSON);
  - SDK adapter (mocked `@google/genai`);
  - client, port and classification service;
  - store + IndexedDB integration with a fake port (including an article deleted mid-request, and offline → retry);
  - component tests.
- Full suite: 31 files, 513 passed.
- `tsc --noEmit` and eslint report no new findings. One existing prettier warning remains in `lib/domain/entities/game.ts`. In the nested worktree, eslint must run with `--no-eslintrc -c .eslintrc.json`.
- `ALLOW_MISSING_MODEL=1 npm run build` succeeds. No SDK code appears in `.next/static`.
- Not tested against the real Gemini API (no key available).

## Known issues / risks

- The rate limit is per instance and in memory, so it is not a quota on serverless. `X-Forwarded-For` can be spoofed when there is no trusted proxy.
- Gemini may return `RECITATION` (treated as `blocked`) when quoting rule text verbatim. This needs a live check.
- Strict quote matching (and the speculative-word list, e.g. 「でしょう」) may reject many otherwise usable answers, which then fall back to CA. Tune it with real outputs.
- `*-latest` model aliases can drift.
- `retryEvaluation` stores a new Decision and leaves the old one orphaned in `decisions`.
- A valid AI decision without escalation marks the incident `resolved`, the same as tree decisions. Consider whether AI-assisted should stay `pending`.
- Articles longer than 4,000 characters are truncated, so quotes are only possible from the start of the article.

## Unresolved questions

- Should the LLM be offered for fair-play incidents at all, or only CA escalation? Currently it is called, but penalties are rejected and escalation is forced.
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
