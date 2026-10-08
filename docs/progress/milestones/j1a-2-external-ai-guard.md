# J1a-2: External-AI guard on every client route, with the arbiter's confirmation

**Status:** Implemented on branch `feature/fact-catalog` (commit `8ad9caf` and the review fixes after it). Review: see "Review" below.

**Date:** 2026-10-09

**Design:** [external-ai-data-protection.md](../../design/external-ai-data-protection.md) §11 (new), §2, §3, §4.3, §4.4, §5.3, §5.5, §6, D13. **Decision record:** [ADR-012](../../decisions/ADR-012-external-ai-data-protection.md), "Implementation notes (J1a-2)". **Plan:** [next-j1a-2-plan.md](../next-j1a-2-plan.md).

## Completed work

- `lib/application/external-ai-guard.ts`: the only module that uses `callLlmApi` (enforced by a test). It provides `prepareClassification`, `prepareEmbeddingQuery`, `prepareReasoning` and `embedRuleDocuments`. It loads the known identifiers and fails closed if they cannot be loaded.
- Classification: `prepareIncidentClassification` → keyword result with the notice 「外部AIには送信していません（理由: …）」, or a preview with 「確認してAIで分類」 / 「送らない」. The body is `{ narrative }`.
- Reasoning:
  - The port moved to `lib/application/llm-assist.ts`. It returns `needs-confirmation` (preview plus `approvalKey`) before any search or send.
  - The engine stores a manual-review decision (`awaiting-confirmation`) in the meantime.
  - The store's `confirmExternalAiSend()` sends only an identical payload. `retryEvaluation` reuses the approval for the same incident.
  - `not-sent` (gate) goes to local manual review with the reason codes.
  - The request has no `tournamentId`. Tournament articles are redacted, and their `sourceName` is fixed to 「大会規定」 with no version.
- Re-identification in `buildLlmDecision` happens after validation. Unknown placeholders set `needsReview`, escalate to the CA and show 「要確認」. Citations use the local source name and version.
- Rule search screen: keyword results come first. Semantic search runs only after the de-identified query is confirmed (decided by Claude and approved by the user on 2026-10-09).
- Document embeddings: tournament regulations are de-identified first, and `EMBEDDING_MODEL.key` is now `gemini-embedding-001@768+deid1`.
- 「外部AIに送らない」 switch on the report screen (`Incident.externalAiOptOut`, gate L1).
- Server (minimal): classify takes `{ narrative }` (≤ 500), and `tournamentId` is no longer read. The prompt explains placeholders.

## Tests and verification

- New: `__tests__/privacy/external-ai-guard.test.ts` covers the only-importer check, no `/api/llm/` literals, classification and query bodies, local reasons (L0–L3v), fail closed, document redaction, reasoning payload and map, and `loadKnownIdentifiers` with fake-indexeddb.
- Extended:
  - engine outcome mapping (`engine-llm-routing`);
  - re-identification and needs-review (`output-validator`);
  - the store flow with confirmation, retry, names, unknown placeholders, opt-out and gate (`llm-incident-flow.integration`);
  - the classifier component confirmation (`incident-text-classifier.component`);
  - hybrid search without a confirmed query.
- tsc is clean, eslint reports 0 errors and 0 warnings, and `next build` succeeds. Totals after the review fixes are in `current.md`.

## Known issues / next

- J1a-3: the server L5 re-check, the pattern re-check, and 400 for unknown fields and `{ text }`. **Do not deploy before J1a-3.**
- Fact answers are not sent to `/reason` yet (§5.3 allows codes). This sends less, so it is safe.
- The rule search screen's semantic search needs one extra tap.
