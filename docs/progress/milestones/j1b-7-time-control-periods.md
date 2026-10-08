# J1b-7: `TimeControl` periods (FIDE 8.4, III.3.1)

**Status:** Implemented and reviewed on branch `feature/fact-catalog`. Review verdict: FIX REQUIRED (1 must-fix, 6 should-fix) → fixed → re-review: MERGE.

**Date:** 2026-10-08

**Design:** [fact-model.md](../../design/fact-model.md) §3.6 "Implementation (J1b-7)". **Decision record:** [ADR-014](../../decisions/ADR-014-draw-dt-touch-move-game-history.md) §7 and its J1b-7 amendment. **Catalogue:** `ct.last-period`, `ss.remaining-time`, `ss.below-five-in-period`, `ss.increment`, `ss.current-period`, `ss.move-number`.

## Completed work

- **Entity:** `TimeControl` is now `{ periods: TimeControlPeriod[], delaySeconds?, periodsIncomplete?, additionalTimeAfterMove? }`, where `TimeControlPeriod = { moves?, minutes, incrementSeconds }`. Only the last period has no `moves` (all remaining moves). `RulesetSnapshot.timeControl` was added.
- **Service** `lib/domain/services/time-control.ts` (pure):
  - validation, build and normalization;
  - `currentPeriod`, `deriveTimeControlFacts`, `lastPeriodFromTimeControl`;
  - `assessRecordingObligation`, the FIDE 8.4 assessment.
- **Migration:** Dexie `version(8)` with `stores({})` and an upgrade that normalizes `tournaments.timeControl`.
  - Values it cannot interpret are left untouched.
  - Every reader also normalizes: `formatTimeControl`, `toProfileInput`, `deriveRulesetFromTournament`.
- **Decision engine:** for DT-004, `lastPeriod` is the explicit answer if there is one; otherwise the value derived from the settings (a confirmed single period counts as the last period).
- **Profile form:**
  - several periods (add and delete; "手数" on every period except the last);
  - a "confirm periods" banner for legacy or incomplete values;
  - `formatTimeControl` shows e.g. "40手90分+30秒 → 30分+30秒".
- **Citations:** FIDE 8.1.1 and 8.4 (printed p.29), checked verbatim against the PDF and locked by `__tests__/citations.test.ts`.

## Important implementation decisions

- **Legacy values are unconfirmed** (review M1).
  - The old form had no field for a second period, so "40/90 → 30" events were stored as "90+30".
  - Every legacy value becomes one period marked `periodsIncomplete`. `lastPeriod` is asked until the arbiter confirms the periods in the profile.
- **An explicit answer beats the settings** (review S1). The settings never turn an answered "not the last period" into a draw.
- **Delay is not "added time"** (review S3). With a delay, 8.4 gives unknown (`delayTreatment`) instead of "exempt".
- **8.4 boundaries:**
  - exactly 5:00 is not "less than five";
  - an increment of exactly 30 s means recording is required;
  - "below five in the period" keeps the exemption for the rest of the period;
  - only Standard games are assessed.
- **Move N belongs to period k while N ≤ the cumulative move count.** Move 40 of "40 moves / 90 min" is still period 1.

## Relevant files

- `lib/domain/services/time-control.ts` (new)
- `lib/domain/entities/{tournament,incident}.ts`, `lib/domain/services/{tournament-profile,game-context}.ts`, `lib/domain/decision-engine/index.ts`, `lib/domain/rules/citations.ts`
- `lib/infrastructure/db/schema.ts` (v8)
- `components/tournament/TournamentProfileForm.tsx`
- Tests:
  - new: `__tests__/time-control.test.ts` (service, 8.4, profile, snapshot, DT-004, real v7 → v8 Dexie migration);
  - updated: `__tests__/tournament/*`, `__tests__/checklist/*`, `__tests__/citations.test.ts`.

## Tests and verification

- `npx tsc --noEmit`: clean.
- eslint (`--no-eslintrc -c .eslintrc.json`): 0 problems.
- `npx vitest run`: 64 files / 1146 tests pass.
- `npm run build`: succeeds.
- Review by a separate read-only agent: FIX REQUIRED → fixes in `84eb37c` → re-review MERGE.

## Known issues

- **Not wired yet:**
  - `deriveTimeControlFacts` with a move number (from `game.history` or `ss.move-number`): multi-period DT-004 still asks `lastPeriod`.
  - `assessRecordingObligation`: the scoresheet category has no tree. It will feed the fact plan or the reasoning request in J1c/J2.
- A single period confirmed by the arbiter is always treated as the last period. If the profile is wrong, an unanswered `lastPeriod` can be derived wrongly. An explicit answer still overrides it.
- The form uses index keys for the period rows. This is fine because the inputs are controlled.
- **Other legacy fields:** the meaning of a legacy `additionalTimeAfterMove` is unknown. It is kept and shown in the banner until the arbiter confirms the periods.
