# Milestone 7: Round Checklist

**Status:** Implemented, reviewed (FIX REQUIRED → fixed → re-reviewed), merged into `feature/m4-and-review-fixes`.
**Date:** 2026-10-07
**Decision record:** [ADR-008](../../decisions/ADR-008-round-checklist.md)

## Completed work

- **Domain** (`lib/domain/services/round-checklist.ts`, `lib/domain/entities/checklist.ts`)
  - Default template for the four §26 phases (`pre | start | during | post`) with stable item ids.
  - Citations only where verified verbatim:
    - Laws 6.5, 6.6, 6.7.1, 8.7 and 11.3.2;
    - the Arbiters' Manual General Duties and the Manual's commentary on 6.6;
    - JCF NA slides p.11–12.
  - All are locked by `__tests__/citations.test.ts`.
  - Stage follows the round status: `pending` → pre, `active` → start + during, `completed` → post. Any stage can still be opened.
  - Progress, per-item notes (max 500 chars), and customisation ops (add / remove / move / reset).
  - `assessRoundTransition`:
    - start: warns about incomplete pre-round items;
    - end: warns about pending incidents of the round, which includes AI decisions that stay `pending` (M5).
  - `warningsAcknowledged` re-asks when the warnings grew after they were shown.
- **Persistence**
  - Dexie `version(7)` adds `roundChecklists` (`id = roundId`) and `checklistTemplates` (per tournament).
  - v6 is unused. Future schema changes must use v8 or higher.
  - `DexieChecklistRepository`.
  - `RoundChecklistService` (`lib/application/round-checklist.ts`):
    - writes are serialised;
    - start/end are guarded and need `confirmed` plus the `acknowledged` warnings.
  - Tournament deletion removes checklists and the template in the same transaction.
- **UI**
  - `/tournament/[id]/rounds/[round]`: stage tabs, progress bar, 48px+ rows, notes, sources on demand, pending-incident banner, per-tournament editor.
  - `RoundTransitionControl`: in-page warning and explicit confirmation. It is also used by the tournament detail page.
  - The home "current round" card links to the checklist.

## Review fixes

- The editor is keyed by stage, so an item added after switching stage goes to the visible stage.
- The confirmation passes the warnings that were shown. More pending incidents, more incomplete items, or a new warning kind cause a re-ask.
- The note textarea has `maxLength`. Keys in the incomplete-items list are unique.
- `pre-devices` is relabelled 「電子機器の持ち込み禁止の周知」 to match FIDE 11.3.2, which is a prohibition.
- ADR-008 and the schema comment say v6 is unused, not reserved.

## Fixed during the M5 merge

- **Report page:** the "current round" auto-select could use rounds left from the previous tournament in the zustand store, which caused flaky `report-context` tests. It now waits until all rounds belong to the active tournament, and never overrides the user's choice.
- **Tests:** `vitest.setup.ts` sets the Testing Library `asyncUtilTimeout` to 5 s.

## Tests / verification

- `__tests__/checklist/`: domain, service (fake-indexeddb, including a v5 → v7 migration and stale-confirmation cases) and page component tests.
- After merging M5, on the M7 branch:
  - `npx tsc --noEmit` is clean;
  - `npx vitest run` gives 48 files / 742 tests, stable over 4 consecutive runs;
  - eslint reports 0 errors;
  - `ALLOW_MISSING_MODEL=1 npm run build` succeeds.

## Known issues / not included

- A removed built-in item can only come back through "reset", which also deletes custom items. A per-item restore is not implemented.
- No checklist history or audit across template edits, and no per-board checklist.
- Template edits apply to past rounds too, by design (ADR-008).
