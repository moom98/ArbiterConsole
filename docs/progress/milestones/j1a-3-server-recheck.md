# J1a-3: Server re-check (L5) and minimized shapes only

**Status:** implemented on branch `feature/fact-catalog`: commit `6759f68` plus review fixes `99b4438` and later. The review outcome is under "Review" below.

**Date:** 2026-10-09

**Design:** [external-ai-data-protection.md](../../design/external-ai-data-protection.md) §12 (new), §7, §2, §5.3, §5.5.

**Decision record:** [ADR-012](../../decisions/ADR-012-external-ai-data-protection.md), "Implementation notes (J1a-3)".

## Completed work

- **`lib/domain/privacy/server-recheck.ts`** (pure):
  - `recheckIncidentText(text, route)`:
    - the pattern rules with no identifiers must leave the text unchanged;
    - the gate L2–L4 with L3v must be clear;
    - the residual check must pass.
  - `recheckRegulationText(text)`: rules 1, 5 and 12 must leave the text unchanged.
- **The client runs the same check before sending:**
  - step E2 in `protectIncidentText`, giving `stage: "recheck"` and the local fallback;
  - `toSentArticles` drops an article whose id is not an identifier, or a tournament article that fails;
  - FIDE, JCF and commentary source labels that fail are left out;
  - the guard sends `subtype` only if `isReportableSubtype` accepts it;
  - every minimized text is trimmed after it is cut, so the preview, the check and the sent string are identical.
- **Server (`request-validation.ts`, `handler.ts`):**
  - **Exact key sets.** Anything else is a 400, including `tournamentId`. The old classify `{ text }` gets 400 with a reload hint.
  - **Code checks:**
    - `subtype` via `isReportableSubtype` (`follow-up.ts`);
    - `rulesVersion` in `SUPPORTED_RULES_VERSIONS`;
    - the article `id` form `ARTICLE_ID` (in the contract);
    - tournament articles have `sourceName` 「大会規定」 and no `sourceVersion`.
  - **Limits** equal the client's minimization limits: description 1,000, embed query 200 (`maxReasonDescriptionChars`, `maxEmbedQueryChars`).
  - **L5 runs on:**
    - the classify narrative, the reason description and each embed query;
    - tournament article number, title and content;
    - non-tournament `sourceName` and `sourceVersion`.
  - A failure gives the new code **`not-sendable`** (HTTP 400, fixed message). Nothing goes upstream, the daily cap is not used, and the log holds `{ route, code }` only.
- **Client handling of `not-sendable`:**
  - reasoning goes to `not-sent` (local handling, no retry);
  - classification falls back to keywords;
  - semantic search falls back to keyword search.

## Tests and verification

- **New:** `__tests__/privacy/server-recheck.test.ts`, 36 tests:
  - unit cases for both functions;
  - client/server agreement: on every fixture set and route, E2 stops nothing that A–E let through;
  - bodies the guard really builds pass the server validators: classify, query, reasoning with tournament and FIDE articles;
  - long inputs with forced truncation per route;
  - the whitespace cut, where preview = sent, and the 「三時」 end-of-text case, held locally;
  - the dropped tournament article (truncation creates a phone shape);
  - source labels;
  - the newline join (stage `recheck`, `pattern`);
  - limits equality.
- **Extended:**
  - `route-handler.test.ts`:
    - unknown fields at every level and `tournamentId`;
    - `__proto__` and `constructor`;
    - nulls;
    - subtype and rulesVersion codes;
    - the id form;
    - sourceName and sourceVersion;
    - `not-sendable` for names, dates, boards, phones and health in the description, and for tournament content and labels;
    - the regulation numbers and dates that must stay accepted;
    - the daily cap unused;
    - the log has codes only;
    - classify `{ text }` and the narrative L5 cases.
  - `embed-route.test.ts`: query L5, unknown fields, the query limit, documents not re-checked.
  - `llm-client.test.ts`: client handling of `not-sendable`.
- **Checks:**
  - `npx tsc --noEmit` is clean;
  - eslint reports 0 problems;
  - `npx vitest run`: 73 files / 1444 tests pass;
  - `npm run build` succeeds;
  - `npm run cf:build` succeeds. The server handler is about 1.1 MiB gzip.

## Review

- **First review: FIX REQUIRED.**
  - M1: the embed query was trimmed after E2 and the preview, so a cut ending in a space could get `not-sendable`, and the sent text differed from the preview.
  - S1: `not-sendable` was a retryable error.
  - S2: the server had no 200-character query limit.
  - S3: free text could ride in article ids and FIDE source labels.
  - S4: docs and ADR.
  - S5: test gaps.
  - All were fixed in `99b4438`. The nit (E2 failures report the reason `residual`, not the gate codes) was accepted.
- **Re-review:** see the follow-up commit.

## Known issues

- The server cannot tell a tournament article mislabelled as FIDE, or which source a document embedding comes from. Their text is not checked (rule text, §2). The client guard is the primary control.
- An E2 failure shows the generic reason `residual`, even when the finding was a gate code.
- Pre-existing: `generateEmbeddings` cuts documents with `slice(0, 2000)`, which can split a placeholder in a redacted tournament document. Use `truncate` from `minimization.ts` there.
- The incident log detail still has no "retry / confirm AI send" (J1a-2 known issue).

## Next

`feature/fact-catalog` is now complete for J1a.

- It can be merged into `main` and deployed after the user's go-ahead. Deploying is outward-facing.
- Candidates after that:
  - re-evaluate / confirm the AI send from the incident log detail;
  - J1c: the Jev port, adapter and `/api/llm/facts`, which must use `recheckIncidentText(…, "facts")` and the same exact-key validation.
