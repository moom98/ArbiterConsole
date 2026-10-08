# ADR-011: TypeSafe AI Jev for Incident Classification (provider-switchable)

**Status:** Proposed. Waiting for user answers to Q1–Q4 in the design doc. Not implemented.

**Date:** 2026-10-08

**Amends:** [ADR-007](./ADR-007-gemini-llm-via-server-route.md), the classification part only. Reasoning (`/api/llm/reason`) and embeddings ([ADR-010](./ADR-010-gemini-embeddings-for-semantic-search.md)) stay on Gemini. The Decision Tree / LLM boundary in [ADR-002](./ADR-002-decision-tree-llm-boundary.md) is unchanged.

**Design:** [docs/design/jev-classifier-design.md](../design/jev-classifier-design.md)

---

## Context

- The user asked whether Gemini can be replaced by TypeSafe AI's **Jev**. Jev is a decision-only model: it returns typed answers (choice, yes/no, score) with calibrated probabilities. It does not generate text.
- Three features use Gemini today:
  - free-text incident classification (§11);
  - reasoning for incidents no Decision Tree covers (§13, §14), which produces a prose conclusion, actions and verbatim quotes;
  - embeddings for semantic search.
- Classification fits Jev's choice and yes/no questions well. Reasoning and embeddings do not fit: Jev cannot write text and has no embeddings.
- ADR-007 says a new provider should implement `GenerateJsonFn`. That interface assumes text generation, so Jev cannot implement it.
- Jev's Japanese support is not documented.

## Decision

1. **Add a task-level port `ClassifyIncidentFn`** for `/api/llm/classify`.
   - It has two adapters: `gemini` (today's prompt and schema over `GenerateJsonFn`) and `jev` (a plain `fetch` client for `POST /v1/systemone`, with no SDK, so it runs on Cloudflare Workers).
   - `provider.ts` stays the single binding point. It selects the adapter by `LLM_CLASSIFIER_PROVIDER`.
2. **The default stays `gemini`** until a measured Japanese evaluation passes (design §9). Production then switches by an env change only.
3. **Configuration:**
   - `TYPESAFE_API_KEY` is a server-only secret.
   - `JEV_MODEL` defaults to a **pinned version** (`jev-1.13.0`), because the thresholds depend on the model's calibration.
   - Any change to `JEV_MODEL` requires running the evaluation again.
   - The key check moves out of the shared `guard()` and becomes per route. Classify needs the selected provider's key. Reason and embed need the Gemini key.
   - Jev classify gets a shorter per-call deadline: 3 s per attempt and 10 s in total.
4. **The server returns the provider's raw probabilities. The client's domain validator applies fixed thresholds** and builds `IncidentClassification`. This keeps the ADR-007 principle that correctness is decided by deterministic domain code. The rules:
   - `confidence` is never `"high"`;
   - `needsTournamentRules` can only be added by a domain rule, never removed;
   - a low probability turns off prefill and shows alternatives.
5. **Missing information comes from a fixed, reviewed catalogue** in the domain, selected by Jev yes/no questions. Jev generates no text, and `followUpQuestions` is empty in Jev mode.
6. **These guarantees are unchanged:**
   - fair-play text is never sent;
   - a classification is a suggestion only;
   - Decision Trees take priority;
   - the client falls back to keywords on any failure;
   - the access token, rate limits and daily cap apply.

## Consequences

**Positive**

- Classification latency drops from seconds to about 100 ms (§33), at a much lower cost.
- Confidence becomes a calibrated number, so thresholds can be tested, instead of a model's own "medium/low".
- The missing-information wording is fixed and reviewed, never generated (§14).
- Switching is reversible by env, and deploying the code alone changes nothing.

**Negative and trade-offs**

- Two LLM vendors and two secrets to operate (Gemini stays for reasoning and embeddings).
- `followUpQuestions` is no longer produced in Jev mode. The Decision Tree questions and the catalogue cover it.
- Jev is a young vendor and API. It is mitigated by the pinned version, a thin client and the keyword fallback.
- Japanese quality is unproven until the evaluation.

**Future**

- Jev could later act as a **safety-only** check of Gemini reasoning drafts. It could escalate or lower confidence, never add or harden a penalty. That needs a separate ADR (design §8).
