# Incident log: retry and confirm the AI reference (J1a-2 follow-up)

**Status:** Implemented on branch `feature/fact-catalog` (commits `61602ca`, `9f968c0`).

**Date:** 2026-10-09

**Design:** [external-ai-data-protection.md](../../design/external-ai-data-protection.md) D13 (nothing is sent before the arbiter confirms the exact de-identified payload). No design or ADR change: the log uses the same store actions and the same approval rules as the report screen.

## Why

Since J1a-2, every incident that no decision tree covers starts as `awaiting-confirmation`. If the arbiter left the report screen without confirming, or the send was `offline` or `unavailable`, there was no way to get the AI reference for that incident afterwards. This was a known issue of J1a-2.

## Completed work

- **Store (`lib/stores/incident-store.ts`):**
  - `retryIncident(incidentId)` loads a stored incident and re-evaluates it, the same as `retryEvaluation`:
    - without a confirmed payload for that incident, nothing is sent and the preview is returned;
    - an approval is reused only for the same incident and the identical payload.
  - **Superseded runs:** `run()` keeps an epoch. `reset()` and every newer action advance it. A run that completes afterwards returns `{ ok: false, error: SUPERSEDED }` and writes nothing to the screen state: no incident, decision, confirmation, error or busy flag. Its decision is still saved in IndexedDB.
  - `confirmExternalAiSend` records the approval before its first `await`, so a `reset()` right after confirming clears it.
  - A second instance, `useIncidentLogStore`, is used by the log. An action still running on one screen cannot show up on the other.
- **Log detail (`components/log/IncidentDetail.tsx`, `IncidentLogView.tsx`):**
  - `awaiting-confirmation`: the button 「外部AIへ送る内容を確認する」 shows the preview. It sends nothing.
  - `offline` / `unavailable`: 「AI参考情報を再取得」 (in `DecisionDisplay`).
  - Preview: 「確認してAI参考情報を取得」. The preview is scrolled into view.
  - `unauthorized`: the access-token field, which retries after saving.
  - After each action the log is reloaded, so the detail shows the new decision.
  - Closing the dialog calls `reset()`, which discards the preview and the approval. Results and errors are shown only in the dialog of the incident that was acted on.

## Tests and verification

- New:
  - `__tests__/incident-log-ai-retry.component.test.tsx`:
    - confirm, then send;
    - closing discards the preview;
    - an offline retry shows the preview first;
    - the busy state;
    - the error for a missing incident.
  - `__tests__/incident-store-supersede.test.ts`:
    - a late result after `reset`;
    - a late result for X while Y's preview is pending;
    - `reset` right after confirming.
- Extended: `__tests__/llm/llm-incident-flow.integration.test.ts`:
  - `retryIncident` from a fresh store, using the real port and IndexedDB;
  - switching incidents;
  - an unknown id.
- tsc is clean, eslint reports 0 problems, 75 files / 1453 tests pass, and `next build` succeeds.

## Review

- **First review:** FIX REQUIRED.
  - **Must-fix:** the shared singleton store let a late result overwrite another incident's screen. Worst case, the report screen would show incident X's preview while the arbiter believes it is the new incident R's. Fixed with the epoch, the separate log store, and recording the approval early.
  - **Should-fix:**
    - docs (this file);
    - test gaps (added);
    - counting during re-evaluation (see Known issues).
  - **Nits:** fixed: selector with `useShallow`, scroll into view, a comment on the token re-run.
- **Re-review of `9f968c0`: MERGE.** No D13 leak found. Report-page flows (submit, follow-up, token retry, reset → submit) are unaffected by the epoch.

## Known issues

- Re-evaluating an older incident counts illegal moves and touch-move violations from **all** other records of the game, including incidents reported later.
  - Today only AI-reference decisions can be retried from the log. They never reach the counting trees.
  - If retry is widened to tree decisions, filter the records to those reported earlier. This is documented in the `retryIncident` JSDoc.
- Same incident, overlapping actions in the log: confirm X, close the dialog while the send is in flight, reopen X and tap retry. The new run shows the preview again. The old send then completes and saves its decision. Confirming the preview would send the same payload a second time: a duplicate send, not a D13 violation. Rare; a per-incident write lock would fix it.
- `reset()` does not clear `llmPending` / `mateSearchPending`; an indicator can show briefly after a remount until the earlier call settles.
- Approvals live in memory per store instance. An approval given on the report screen is not reused in the log, so the log shows the preview again. This is the safe direction.
