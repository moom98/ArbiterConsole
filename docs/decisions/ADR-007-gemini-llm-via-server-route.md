# ADR-007: Google Gemini via a Server Route Handler for LLM Features

**Status:** Accepted

**Date:** 2026-10-07

**Supersedes:** the LLM-provider parts of [ADR-001](./ADR-001-technology-stack.md) ("Anthropic Claude API")
and the Claude-specific examples in [ADR-002](./ADR-002-decision-tree-llm-boundary.md) (Haiku / Sonnet,
`claudeAPI.generate`). The Decision Tree / LLM **boundary** in ADR-002 is unchanged.

---

## Context

Milestone 5 adds LLM-based incident classification and LLM reasoning for incidents that no Decision Tree
covers (for example player behaviour: smartwatch, mobile phone). The design documents were written for
the Anthropic Claude API and partly assumed the browser would call the provider directly.

The product owner decided:

1. The LLM provider is **Google Gemini API**, not Claude/Anthropic.
2. The LLM is called **only from the server** (a Next.js Route Handler). The API key is a server
   environment variable and is never sent to or stored on the client.

Constraints that still apply:

- Rule text lives in the client's IndexedDB (ADR-003). The server has no rule database.
- High-frequency, high-impact rulings stay deterministic (requirement §35, ADR-002). The LLM never
  overrides a Decision Tree.
- Every ruling must have verifiable sources (§14, §29, §34).

## Decision

### 1. Provider and SDK

- Google's official JS SDK **`@google/genai`**, pinned to an exact version (2.27.0). It is imported only
  in `lib/infrastructure/llm/server/**` and is kept out of the webpack bundle
  (`experimental.serverComponentsExternalPackages`).
- Model IDs come from environment variables, with these defaults (both are aliases in the SDK's model
  list and README):

  | Variable | Default | Use |
  | --- | --- | --- |
  | `GEMINI_API_KEY` | (required, no default) | Server-only API key |
  | `GEMINI_MODEL_REASONING` | `gemini-flash-latest` | Reasoning for uncovered incidents (structured Decision draft) |
  | `GEMINI_MODEL_CLASSIFIER` | `gemini-flash-lite-latest` | Free-text incident classification (cheaper) |

  The default reasoning model is a Flash model because requirement §33 puts response time ahead of long
  explanations. Operators can set `gemini-pro-latest` or a pinned version.
- Structured output is used for both calls (`responseMimeType: application/json` and
  `responseJsonSchema`). The JSON schema only shapes the response. It does not prove the response is
  correct (see §4).

#### Changing models or the provider (single point of configuration)

- **Model IDs are defined in exactly one place:** `lib/infrastructure/llm/server/config.ts`. It reads `GEMINI_MODEL_CLASSIFIER` and `GEMINI_MODEL_REASONING` and falls back to `DEFAULT_CLASSIFIER_MODEL` and `DEFAULT_REASONING_MODEL`. No other file may contain a model ID. To change a model at deploy time, set the env var and restart; no code change is needed. To change a default, edit only those two constants and update `.env.example` and the README.
- **The provider is behind the `GenerateJsonFn` interface** (`lib/infrastructure/llm/server/generate.ts`). `lib/infrastructure/llm/server/provider.ts` is the only binding point (`llmProvider = geminiGenerateJson`). Both route handlers use it.
- **To switch providers:** add an adapter that implements `GenerateJsonFn`, rebind `llmProvider`, and rename the env vars in `config.ts` if needed. The domain, client and UI do not change.

### 2. Server Route Handlers (`app/api/llm/classify`, `app/api/llm/reason`)

- `runtime = "nodejs"`, `dynamic = "force-dynamic"`, POST only. The request must have
  `Content-Type: application/json`, which forces a CORS preflight for cross-origin browser callers.
- Every request is validated by hand-written checks (types, enums, string lengths, article count, total
  body size). Invalid input returns 400 or 413 with a typed error `{ ok: false, error: { code, message } }`.
- Rate limit: an in-memory token bucket of **10 requests per minute per client IP**, shared by both
  routes. It returns 429 with a `Retry-After` header. **Limitation:** on serverless or multi-instance
  deployments each instance has its own bucket, and the bucket is lost on a cold start. It is a basic
  abuse guard, not a quota. A shared store (for example Redis) is needed for a strict limit.
- Each attempt has a timeout (reasoning 20 s, classification 8 s). The total deadline is 30 s. The
  server retries with exponential backoff and jitter on transient errors (408, 429, 5xx, network
  errors, per-attempt timeouts). The SDK's own retry is turned off, so retry behaviour is defined only
  in this code.
- Errors are mapped to typed codes: `not-configured` (503, key missing; the response never contains the
  key or its presence details), `upstream-timeout` (504), `upstream-unavailable` (503),
  `upstream-error` (502), `invalid-model-output` (502), `blocked` (422, safety block / no text).
- Logging is limited to the error code, upstream HTTP status and attempt count. Incident text, articles
  and model output are never logged.
- Next-PWA: `/api/**` is excluded from the "others" NetworkFirst rule, and Workbox runtime caching only
  handles GET requests. LLM POSTs are never cached.

### 3. Client side

- `lib/infrastructure/llm/llm-api-client.ts` calls the routes with `fetch` (same origin). If
  `navigator.onLine === false`, it does not make the request and returns `offline`.
- Retrieval stays on the client: `lib/infrastructure/llm/llm-assist-port.ts` runs the existing hybrid
  search over IndexedDB. It sends **only** the retrieved candidate articles (up to 8) plus a
  structured context (competition type, supervision regime, rules version, tournament id, category,
  subtype, description) to the server. Player names and other PII are not sent.
- After the response, the cited article IDs are re-read from IndexedDB (`db.rules.bulkGet`), so the
  validator can confirm they still exist.

### 4. Domain boundary (ADR-002 enforced in code)

- `DecisionEngine` depends on the `LlmAssistPort` interface (`lib/domain/llm/ports.ts`). It never imports
  the SDK or `fetch`. `processIncident` (synchronous) is unchanged. The new `evaluate` (async) calls the
  port **only** when no Decision Tree covers the incident (the former "manual-review" branch). Tree-covered
  incidents never reach the LLM, even when a description is present.
- `lib/domain/llm/output-validator.ts` is a pure, deterministic validator. It rejects a draft when:
  - the schema is invalid (enums, required fields, types);
  - a penalty has no source, or cites an article that is not among the citations;
  - a cited article ID is not among the articles sent, or is no longer stored in IndexedDB;
  - a quote does not match the stored article text (substring after NFKC / whitespace / quote
    normalisation; `…` fragments must appear in order);
  - the conclusion, actions or penalty descriptions use speculative wording (「おそらく」「と思われる」
    「可能性がある」「かもしれない」, "probably", "might", …);
  - the incident is fair-play and the draft proposes a penalty (§23: never automate cheating rulings).

  Confidence is capped at `medium` (never `high`). `low` confidence forces CA escalation, and escalation
  forces `consult-ca`.
- A rejected draft becomes a CA-escalation decision (`generatedBy: "llm"`, `validationPassed: false`,
  `validationErrors` listed, no penalties). Offline, a failed call or no retrieved articles fall back to
  the manual-review / CA message with the note 「オンライン時にAI参考情報を取得」.
- Classification output is only a **suggestion** that pre-fills the category and shows hints. The
  arbiter confirms the category, and the deterministic trees and their questions still decide every
  covered incident. When offline, or when the call or output check fails, a deterministic keyword
  classifier (`lib/domain/llm/keyword-classifier.ts`) is used instead.

### 5. UI

LLM decisions are marked with the badge 「AI参考」, a stronger disclaimer, a validation status, and cited
articles with source name, edition and page (from `RuleSource`). Offline or error states show a retry
action.

## Consequences

### Positive

- The API key never reaches the browser, and the provider can be changed on the server only.
- Hallucinated articles and quotes are rejected by deterministic code, which is unit tested without
  network access.
- Offline behaviour is unchanged for every Decision Tree (§31).

### Negative / Risks

- LLM features need a deployed Node server. A purely static export would have no `/api`.
- The in-memory rate limit is per instance (see §2).
- Quote matching is strict. Paraphrased quotes are rejected and lead to CA escalation. This is
  intentional (fail safe, §34) but may lower the share of accepted AI answers.
- Model aliases (`*-latest`) can change behaviour over time. Pin a version through the env vars for a
  tournament if reproducibility matters.

## Related

- [ADR-002](./ADR-002-decision-tree-llm-boundary.md) – Decision Tree / LLM boundary (still authoritative)
- [ADR-003](./ADR-003-offline-rule-search.md) – client-side rule storage and search
- `docs/design/ai-rag-design.md` §7, `docs/design/architecture.md` (Claude references superseded by this ADR)
