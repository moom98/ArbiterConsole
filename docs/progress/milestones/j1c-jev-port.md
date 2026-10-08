# J1c: Classify port, Jev client, calibrated parser, `/api/llm/facts`

**Status:** implemented on branch `feature/j1c-jev-port` (stacked on `docs/deploy-after-pr7`, i.e. `main` at `392cd61` plus the PR #8 handoff). Review verdict: **MERGE**, after which the minor findings were fixed (see "Review").

**Date:** 2026-10-09

**Design:** [jev-classifier-design.md](../../design/jev-classifier-design.md) §14 (new), §4–§6, §11; [fact-model.md](../../design/fact-model.md) §4–§5.

**Decision record:** [ADR-011](../../decisions/ADR-011-jev-for-incident-classification.md) (status updated). No new ADR: J1c implements ADR-011/013 without changing them.

## Completed work

- **Classify port** (`classify-port.ts`): `ClassifyIncidentFn` with the `gemini` adapter (today's prompt, schema and output) and the `jev` adapter. `provider.ts` `classifierProvider(config)` is the binding point; `LLM_CLASSIFIER_PROVIDER` defaults to `gemini`.
- **Jev client** (`jev-client.ts`): plain `fetch`, Bearer key, error bodies cancelled unread, `InvalidProviderOutput` for a bad shape (not retried).
- **Questions** (`jev-questions.ts`, `jev-presence.ts`): built only from domain constants and the fact catalogue. The state is `{ deidentified_incident: narrative }`.
- **Config:** `LLM_CLASSIFIER_PROVIDER`, `TYPESAFE_API_KEY`, `JEV_MODEL` (pinned `jev-1.13.0`), `LLM_RATE_LIMIT_FACTS_PER_MINUTE`.
- **Handler:** the per-route key check (`routeKeyConfigured`), the Jev deadline (3 s per attempt, 10 s total), and `createFactsRouteHandler`.
- **`/api/llm/facts`:** Jev only (provider `jev` and key, else 503). It takes `{ narrative, factIds }` with exact keys, at most 32 catalogue fact ids that are presence-checkable, plus the fair-play check and the L5 re-check (`"facts"`).
- **Domain:**
  - `INCIDENT_CATEGORY_DESCRIPTIONS`, shared with the Gemini prompt, which stays byte-identical (hash test);
  - the probabilistic branch of `parseLlmClassification(raw, { model })`;
  - `calibration/` (`JevCalibration`, registry **empty until J3** → uncalibrated mode);
  - `presence.ts` `parseFactPresence`.
- **Client:** `llm-classification.ts` passes the response `model` to the parser. `IncidentClassification` gets optional `provider`, `probability`, `alternatives` and `prefill`.
- **Docs and config:** design §14, ADR-011 status, fact-model status, README env table and deploy note, `.env.example`, the `wrangler.jsonc` secrets comment.

## Tests and verification

- `npx tsc --noEmit` is clean.
- eslint reports 0 problems. In this nested worktree run it as `npx eslint --no-eslintrc -c .eslintrc.json --ext .ts,.tsx app components lib __tests__`.
- `npx vitest run`: 78 files / 1547 tests pass. New files:
  - `__tests__/llm/jev-calibrated-parsing.test.ts`: thresholds, argmax, rejection rules, uncalibrated mode, registry, presence;
  - `__tests__/llm/jev-server.test.ts`: prompt hash, questions, client, provider switch, keys per route, deadline, hanging upstream, 408/429 retry, logs, facts route;
  - `__tests__/llm/jev-classification-flow.integration.test.ts`: guard → handler (Jev) → domain → decision tree.
- `ALLOW_MISSING_MODEL=1 npm run build` succeeds (`/api/llm/facts` listed).
- `npm run cf:build` (OpenNext) succeeds.
- No live API calls. The real Jev API was checked in J0 only.

## Review

A separate read-only reviewer gave **MERGE**, with no blocker or major findings. Minor findings and what was done:

1. The deadline test let the fake clock jump in `sleep` while the delay was 0, so it asserted an attempt after the deadline. **Fixed:** the clock advances inside the attempt, `sleep` adds only `ms`, and the test asserts that every attempt starts with ≥ 1 s left (Jev) or ≥ 3 s left (Gemini).
2. Handler tests were missing for a hanging upstream and for retrying 408. **Added** both. The "body not read" test now also spies on `json` and `arrayBuffer`.
3. The ±0.02 sum tolerance may be too tight if Jev rounds each label separately. **Recorded** as a J3 check in design §14.3.
4. The docs were not committed. **Done** in this commit.
- Nit: `/api/llm/facts` shares the daily cap. **Recorded** for J2 in §14.3.

## Known issues / not done

- The client does not call `/api/llm/facts` yet (J2: a guard function, confirmation, grouping in `FollowUpQuestions`).
- **The classification preview names "Gemini（Google）" even when the server uses Jev.** This must be fixed before production switches to `jev` (J2/J3 blocker).
- No calibration exists, so Jev classification is always low confidence with no prefill until J3.
- Carried over to J2, from the J1b handoff: wire `deriveTimeControlFacts` and `assessRecordingObligation`, and treat `game.record-state` as a non-blocking record fact. These are client and fact-plan work, not part of the server port.
