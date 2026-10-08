# Plan for J1a-2: the external-AI guard on every client route

**Status:** Done 2026-10-09 (see `milestones/j1a-2-external-ai-guard.md` and design §11). Kept for reference. Originally: Written at the end of J1a-1 so that a fresh session can start without redoing the code survey. Read it together with [external-ai-data-protection.md](../design/external-ai-data-protection.md) (§2, §3, §4.3, §5.3, §6, D12, D13) and [ADR-012](../decisions/ADR-012-external-ai-data-protection.md) with both amendments.

**Branch:** `feature/fact-catalog`. **Do not deploy it** until J1a-2 and J1a-3 are done: today the app still sends the raw incident description to Gemini.

## 1. What already exists

- `lib/domain/privacy/` (J1a-1, pure, reviewed): `protectIncidentText` (steps A–E for one incident-derived text and a route: `classify`, `facts`, `reason-description`, `embed-query`), `redactPii(text, ids, map, "regulation")` for tournament regulation text (§5.5), `PlaceholderMap`, `reidentify`, `evaluateSensitivity`. See `milestones/j1a-1-privacy-package.md`.
- `lib/infrastructure/privacy/known-identifiers.ts`: `loadKnownIdentifiers(db, { players })` reads `PlayerProfile`, every `Game.white/black`, `Tournament.name/venue/chiefArbiter`. **No test yet**; add one (fake-indexeddb is already used by other store tests).

## 2. Code survey: every place that reaches `/api/llm/*` today

| Caller | File | What it sends today | Current protection |
| --- | --- | --- | --- |
| Classification (button 「カテゴリを提案」) | `lib/application/llm-classification.ts` → `callLlmApi("classify", { text })`; UI `components/features/IncidentTextClassifier.tsx` | the raw typed text (≤ 2,000 chars) | `classifyByKeywords` fair-play and `mentionsFairPlay` only |
| AI reasoning (automatic, for incidents no tree covers) | `lib/infrastructure/llm/llm-assist-port.ts` (`createLlmAssistPort`), called by `DecisionEngine.evaluate` through `lib/stores/incident-store.ts` (`deps.llm`, line ~112) | `incident` {category, subtype, playerColor, **raw description**, arbiterObserved}, `context` with **`tournamentId`**, up to 8 articles **with `tournamentId`** and `sourceName`/`sourceVersion` | fair-play category / `mentionsFairPlay` |
| Article search query embedding inside reasoning | `llm-assist-port.ts` `defaultSearch` → `hybridSearch(incident.description)` → `generateQueryEmbedding` | the raw description as an embedding query | `mentionsFairPlay` in `generateQueryEmbedding` |
| Rule search screen query | `lib/infrastructure/ai/hybrid-search.ts:383` → `generateQueryEmbedding(query)` | the typed query | `mentionsFairPlay` |
| Document embeddings | `lib/infrastructure/embeddings/generator.ts` `generateEmbeddings` ← `lib/application/rule-ingestion.ts:84`, `lib/application/embedding-backfill.ts:31` | rule text, **tournament regulations unchanged** | none |

`callLlmApi` (`lib/infrastructure/llm/llm-api-client.ts`) is imported by `llm-classification.ts`, `llm-assist-port.ts` and `generator.ts`.

## 3. Work items

1. **`lib/application/external-ai-guard.ts`** — the only importer of `callLlmApi` (add a test that greps `lib`, `app`, `components` for other importers).
   - Loads identifiers with `loadKnownIdentifiers` (inject for tests), creates one `PlaceholderMap` per request, runs `protectIncidentText` per incident-derived field, and returns either `{ status: "needs-confirmation", payload, preview, send() }` or `{ status: "local", gate }` (reason codes only, never text).
   - Never serializes the map (its `toJSON()` is empty; keep it out of request bodies and logs).
2. **Classification:** body becomes `{ narrative }` (minimized, ≤ 500). Local fallback = `classifyByKeywords` with the notice 「外部AIには送信していません（理由: …）」. Show the preview and send only after the arbiter's confirmation (D13).
3. **Reasoning (`llm-assist-port.ts`):**
   - description → `protectIncidentText({ route: "reason-description" })`; category/subtype/playerColor/arbiterObserved stay as codes; **no `tournamentId`** in the context or in any article; tournament articles: `redactPii(content, ids, sameMap, "regulation")` and `sourceName: "大会規定"`, no `sourceVersion`; FIDE/JCF articles unchanged (§5.3).
   - The article search keeps using the raw description **locally** (keyword search) but the embedding query must go through the guard (`embed-query`).
   - Confirmation (D13): reasoning is automatic today (engine → store). Add an explicit confirmation step: the store returns a pending "AIに送る内容の確認" state with the preview, and only calls the port after the arbiter confirms. Keep it to one tap; the decision tree path is unchanged.
   - Re-identification: extend `LlmAssistOutcome` (ok) with an in-memory `reidentify(text)` function (not serialized). `buildLlmDecision` (`lib/domain/llm/llm-decision.ts`) applies it to `conclusion`, `actions`, penalty `description`, `escalationReason`, citation `text` and `quoteContext` **after** validation and quote matching on the sent text (§6.1). Keep `llmRaw` in placeholder form. Unknown placeholders → mark the decision `needs-review` (check the existing `Decision.llm` status values first).
   - Gate result `local` → the existing manual-review path with the notice; never call the server.
4. **Embedding queries (`generateQueryEmbedding`):** through the guard (`embed-query`, ≤ 200). A non-clear query → `EmbeddingUnavailableError` with a new code (for example `not-sent`) so the search shows keyword results only. No confirmation tap for search queries? **Decide and record it:** D13 says "every external send"; the simplest compliant option is to show the de-identified query and require one tap before semantic search, or to fall back to keyword search unless confirmed. Ask the user if unsure, since it changes the search UX.
5. **Document embeddings:** FIDE/JCF unchanged; `source.type === "tournament"` → `redactPii(..., "regulation")`. `generateEmbeddings` needs the source type from `rule-ingestion.ts` and `embedding-backfill.ts`. Bump `EMBEDDING_MODEL.key` to `gemini-embedding-001@768+deid1` (`lib/infrastructure/llm/contract.ts`); the server echoes the key, and backfill deletes vectors with other keys, so 「意味検索用データを作成」 rebuilds everything once (ADR-010 / ADR-012).
6. **「外部AIに送らない」 switch** on the report screen next to the free-text field (`app/(tabs)/report/page.tsx`, description step ~line 621). Store it on the incident (for example `Incident.externalAiOptOut?: boolean`, not indexed, no Dexie schema change) and pass it as `doNotSend` to the gate (L1).
7. **Server shapes (coordinate with J1a-3):** the client will send `{ narrative }` for classify and the reduced reasoning shape. Update `lib/infrastructure/llm/server/request-validation.ts` in the same slice so the routes accept the new shapes (J1a-3 then adds the L5 gate re-check, the pattern re-check and the rejection of old shapes such as `{ text }`).
8. **Tests:** guard unit tests (each route goes through A–E; local fallback paths; map never in a request body; tournament article redaction; no `tournamentId`), re-identification in `llm-decision`, the only-importer test, the confirmation flow in the store/UI (component tests), `known-identifiers` with fake-indexeddb.

## 4. Rules to keep

- Development cycle (`.claude/rules/development-cycle.md`): implement → tsc/eslint/vitest/build → **separate read-only reviewer agent** → fix → re-review → milestone summary `docs/progress/milestones/j1a-2-*.md` → update `current.md`.
- Any change to `lib/domain/privacy/` needs an independent reviewer who writes **their own** synthetic sensitive phrases; every miss becomes a regression case in `__tests__/fixtures/privacy/`. Never weaken L2/L3/L3v to reduce false positives; add vocabulary only after checking it cannot compose a sensitive meaning (see the audit list in `known-vocabulary.ts`).
- Only synthetic data in tests and fixtures. Never send real reports anywhere for evaluation.
