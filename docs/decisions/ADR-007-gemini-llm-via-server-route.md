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
- **Access control (open paid proxy risk).** If `LLM_ACCESS_TOKEN` is set, every request must send
  a matching `X-Arbiter-Access-Token` header, otherwise the route returns 401 `unauthorized`. The
  comparison is constant time (SHA-256 + `timingSafeEqual`). This token is not the Gemini key. Never
  put it in a `NEXT_PUBLIC_*` variable, because that would ship it in the bundle. Deployment options:
  - **(a) Recommended:** put platform protection or authentication in front of the whole app (for
    example Vercel Deployment Protection, Cloudflare Access, or a reverse proxy with auth).
  - **(b)** Set `LLM_ACCESS_TOKEN` and give the token to arbiters. They enter it once (the
    `LlmAccessTokenField`, shown when a request is unauthorized; it can also be mounted in Settings),
    and it is kept in the device's `localStorage`. Trade-off: anyone with the device or the token can use
    the AI routes. The cost is still bounded by the caps below, and changing `LLM_ACCESS_TOKEN` revokes
    the token.
  - **Fail closed in production (re-review SF-1).** With `NODE_ENV=production` and no `LLM_ACCESS_TOKEN`,
    both routes return 503 `not-configured`. Only `LLM_ALLOW_UNAUTHENTICATED=1` (meaning "option (a) is
    in place") lifts this. Development builds stay open for local use.
  - The token is checked **before** the rate limit, so requests without it cannot use up the
    shared bucket and lock arbiters out (re-review SF-2).
- **Rate limits.** Each route has its own in-memory token bucket:
  `LLM_RATE_LIMIT_REASON_PER_MINUTE` and `LLM_RATE_LIMIT_CLASSIFY_PER_MINUTE` (default 10 each). Over the
  limit the route returns 429 with `Retry-After`.
  - The client key is the first `X-Forwarded-For` (or `X-Real-IP`) only when `TRUST_PROXY=1`, that is,
    behind a proxy that overwrites the header. Otherwise the header could be spoofed, so all callers
    share **one per-process bucket**, and the limit is on the total.
  - **Limitation:** buckets are per instance and are lost on a cold start. This is an abuse guard, not a
    quota.
- **Daily cap.** `LLM_DAILY_REQUEST_LIMIT` (default 500, `0` = unlimited) caps the requests per process
  per UTC day that reach Gemini. Over the cap the route returns 429 `quota-exceeded`. This is also
  per instance.
- **Hard cost limit (operations):** set it in Google Cloud / AI Studio with API quota limits on the
  project (requests per minute / per day) and a billing budget with alerts. Use a dedicated project or
  key for this app. The in-process caps are not a substitute.
- **Timeouts and retries.** The total deadline is 30 s, before the client aborts at 35 s; the routes
  export `maxDuration = 35`.
  - Each attempt's timeout is `min(20 s reasoning / 8 s classification, time remaining)`.
  - Up to 3 attempts, with exponential backoff and jitter, only on transient errors: 408, 429, 5xx,
    known transport errors (fetch failed, ECONNRESET, …) and timeouts. Unknown exceptions are not
    retried. No retry starts with less than 3 s remaining.
  - The SDK's own retry is turned off.
- **Thinking.** `thinkingConfig.thinkingLevel` comes from `GEMINI_THINKING_LEVEL` (default `low`; `off`
  sends nothing, for models without thinking). The reasoning output budget is 6,000 tokens and the
  classification budget 1,024. Thinking tokens count against this budget.
- **Body size.** The request body is read as a stream and reading stops at 160 KB (413), whether or not
  a `Content-Length` is present.
- Errors are mapped to typed codes: `not-configured` (503, key missing; the response never contains the
  key or its presence details), `upstream-timeout` (504), `upstream-unavailable` (503),
  `upstream-error` (502), `invalid-model-output` (502), `blocked` (422, safety block / no text),
  `unauthorized` (401), `rate-limited` / `quota-exceeded` (429).
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
  - **Amended by ADR-012 (J1a-2, 2026-10-09):** the port is now `lib/application/llm-assist.ts` and
    goes through `lib/application/external-ai-guard.ts`, the only caller of `callLlmApi`. The
    description is de-identified, the tournament id is no longer sent (context or articles),
    tournament regulation text is redacted, and nothing is sent until the arbiter confirms the
    payload (D13).
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
  - a quote does not match the article text that was sent. The quote is compared after NFKC,
    whitespace removal and quote/dash normalisation, and ellipsis variants are unified to `…` before
    splitting. To prevent stitching quotes that invert the meaning:
    - a contiguous quote needs at least 20 normalised characters (10 if Japanese);
    - at most one `…` is allowed, and each fragment needs at least 15 characters (8 if Japanese);
    - the omitted text must be at most 200 characters and must not contain negation or exception words
      (not / never / except / unless / however / ない / ず / 禁止 / ただし / 除く / 例外 …);
    - a quote immediately followed by a Japanese negation (「所持」→「所持してはならない」) is rejected;
  - any free-text field (conclusion, actions, penalty descriptions, citation relevance,
    missingInformation, escalationReason) uses speculative wording: 「おそらく」「と思われる」
    「可能性がある」「かもしれない」「恐れがある」「と見られる」「ようだ」, "probably", "might", "may",
    "could", "appears", …;
  - the incident is fair-play and the draft proposes a penalty (defence in depth; fair-play never
    reaches the LLM, see below).

  Automatic adjustments:
  - Confidence is capped at `medium` (never `high`).
  - A **severe penalty** (`game-loss`, `both-lose`, `expulsion`) forces CA escalation.
  - `low` confidence forces CA escalation, and escalation forces `consult-ca`.
- **Tension with §14 ("state uncertainty explicitly").** Requirement §14 asks for explicit uncertainty,
  while the validator forbids hedged prose. We resolve this by putting uncertainty in **structured
  fields**: `confidence`, `escalationRecommended` / `escalationReason`, and `missingInformation`, which
  lists missing facts. Hedging words inside sentences are rejected, so a penalty can never be justified
  by 「たぶん」 (§14 prohibition).
- **Deviation from ADR-002 (noted):** ADR-002 §7.3 rejects low-confidence drafts that do not escalate.
  Here such drafts are auto-fixed to escalate instead. The draft is still shown only as AI reference
  with CA escalation, so the outcome stays fail-safe.
- **Fair-play (§23)** is never sent to the LLM. The engine returns a deterministic CA-escalation decision
  with a fact-recording checklist (`lib/domain/services/fair-play.ts`). Free text that the local
  keyword classifier flags as fair-play is not sent to the classifier route either; nobody's
  accusations are passed to a third party.
- **AI decisions are never shown as applied.**
  - An incident whose decision has `generatedBy: "llm"` stays `pending` until an arbiter confirms
    (`incidentStatusAfterDecision`).
  - AI penalties are excluded from the penalty summary and per-player history. They appear separately
    as 「AI参考（未確定）」.
  - The CSV has a 生成元 column.
  - On re-evaluation, the previous decision is marked `supersededBy`.
- A rejected draft becomes a CA-escalation decision (`generatedBy: "llm"`, `validationPassed: false`,
  `validationErrors` listed, no penalties). Offline, a failed call or no retrieved articles fall back to
  the manual-review / CA message with the note 「オンライン時にAI参考情報を取得」.
- Classification output is only a **suggestion** that pre-fills the category and description, and
  shows hints. The subtype is not pre-filled; the tree asks for it. The
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
- The in-memory rate limit and daily cap are per instance (see §2). Without `TRUST_PROXY=1` all
  callers share one bucket. Configure Google Cloud quotas and budgets for a hard limit.
- A production deployment must set `LLM_ACCESS_TOKEN` or explicitly set `LLM_ALLOW_UNAUTHENTICATED=1`
  behind platform authentication; otherwise the AI features are off (503).
- **Fair-play text is never sent (re-review SF-3).** `mentionsFairPlay()` (domain keyword patterns,
  Japanese and English) is checked in three places:
  - the engine routes any incident whose description mentions fair-play to the fixed CA checklist;
  - the classification service keeps such text on the device;
  - the assist port refuses it as a second guard.
  The server also rejects `category: "fair-play"` (400).
- Quote matching is strict. Paraphrased quotes are rejected and lead to CA escalation. This is
  intentional (fail safe, §34) but may lower the share of accepted AI answers.
- Model aliases (`*-latest`) can change behaviour over time. Pin a version through the env vars for a
  tournament if reproducibility matters.

## Related

- [ADR-002](./ADR-002-decision-tree-llm-boundary.md) – Decision Tree / LLM boundary (still authoritative)
- [ADR-003](./ADR-003-offline-rule-search.md) – client-side rule storage and search
- `docs/design/ai-rag-design.md` §7, `docs/design/architecture.md` (Claude references superseded by this ADR)
