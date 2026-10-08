# J1b-1: Fact Catalogue (data, types, `requiredFacts`)

**Status:** Implemented and reviewed (FIX REQUIRED → fixed → re-reviewed: APPROVE). On branch `feature/fact-catalog`, stacked on `design/jev-classifier` (PR #5).

**Date:** 2026-10-08

**Decision records:** [ADR-013](../../decisions/ADR-013-fact-model.md), [ADR-014](../../decisions/ADR-014-draw-dt-touch-move-game-history.md)

**Design:** [fact-model.md](../../design/fact-model.md). Catalogue (source of truth): [jev-missing-info-catalog.md](../../design/jev-missing-info-catalog.md).

## Completed work

All of it is pure domain code (`lib/domain/facts/`). There is no React and no I/O, and **no existing Decision Tree changed**.

- **`types.ts`**
  - `FactDefinition`: one definition per fact. Shared `game.*` facts have one definition and several usages.
  - `FactUsage`: per category and subtype. It holds the level (B/C/O), `appliesWhen`, `dtQuestionIds`, `dtValues` (value conversion, or `"computed"`) and `dtUnhandled`.
  - `FactCondition`: the condition types `fact in`, `fact range`, `competitionType`, `arbiterObserved`, `notDerived`, `all`, `any`.
  - `FactContext.derivedValues`: values derived from settings and records.
- **`conditions.ts`**
  - `evaluateCondition` never lets an unknown or missing answer satisfy a condition.
  - Derived values take precedence over answers.
- **`catalog.ts`**
  - About 80 definitions and their usages, copied from the catalogue document, including every point of the 2026-10-08 re-review (1–15).
  - Every definition cites its sources.
  - Local-only (🔒) and derived facts are never presence-checked by Jev.
- **`required-facts.ts`**
  - `requiredFacts`:
    - blocking facts are always required;
    - DT-mapped conditionals only when the tree asks for them;
    - fact-plan conditionals through `appliesWhen`;
    - facts with no condition only through `requestedFactIds`;
    - optional facts never;
    - derived facts are skipped;
    - the illegal-move subtype is inferred from `im.action`.
  - `unansweredFacts`: `unknown` counts as answered.
  - `presenceCheckableFacts`: never returns local-only facts.

## Important implementation decisions

- **Fact values use the DT question values** where they map (`opponent-claim`, `white-first`, `threefold-repetition-claim`). `dtValues` converts the rest:
  - `game.end-event` → `gameEnded`;
  - `ct.ended-before-flag` → `gameEndedBeforeFlag`;
  - `dr.manual-reconstruction` → the condition checks;
  - the new draw kinds → `other`, until J1b-5.
- **`game.history`** answers the trees' position questions (`opponentCanCheckmate`, `positionFen`, `materialConfirmed`, `positionsText`) with `dtValues: "computed"`. `game.position` is requested only when there is no valid history.
- **`ct.period`** is split into `ct.last-period` and `ct.quickplay-guidelines` (yes/no, derived when possible).
- **Facts that are only derived** (`im.count`, `ss.current-period`, `pb.tournament-device-rule`) are `optional`. `ss.move-number` is asked only when the period cannot be derived (`notDerived`).
- `tch.claimed-by-opponent` was added, for the `tch.claim-timing` condition. It is also in the catalogue document.

## Tests and verification

- `__tests__/facts/catalog.test.ts` checks the catalogue itself:
  - structure, sources and option rules;
  - local-only facts and Jev;
  - condition references and values;
  - DT question mapping (at most one fact per question);
  - DT value compatibility;
  - `game.record-state` coverage;
  - derived-only facts;
  - each user review point.
- `__tests__/facts/required-facts.test.ts` checks the behaviour:
  - the condition semantics (unknown, multi-select, empty multi-select, ranges, `arbiterObserved`, competition type);
  - fact plans for player-behavior, scoresheet (FIDE 8.4 with derived values) and board-piece (7.3);
  - the DT authority;
  - the subtype inference;
  - explicit requests;
  - dedupe;
  - the DT-004 mapping.
- Results:
  - `npx vitest run __tests__/facts`: 53 passed;
  - `npx vitest run` (all): 52 files, 822 tests passed;
  - `npx tsc --noEmit`: clean;
  - ESLint (`--no-eslintrc -c .eslintrc.json`, because the worktree's parent config conflicts) and Prettier: clean.
- Reviews:
  - a separate reviewer: FIX REQUIRED, with 3 must-fix and 6 should-fix points;
  - all of them fixed;
  - then a re-review: APPROVE.
- The re-review's small follow-ups are done:
  - a derived `unknown` counts as not derived;
  - `ct.last-period` is derived only for single-period controls, or when the move number is known;
  - a doc type name is fixed.

## Known issues

- The catalogue is not wired into the UI or the Decision Trees yet. J1b-2 and later do that.
- `dtValues: "computed"` conversions (history → position answers, last mover → side to move) are implemented in later slices.
- An explicit `subtype` silently wins over a conflicting `im.action` answer. Decide how to handle this when the facts are wired into the Decision Trees (J1b-2).
- `ESLint` from the worktree needs `--no-eslintrc -c .eslintrc.json`, because the parent repository's `.eslintrc.json` loads the same plugin.

## Next

- **J1b-2:** `unknown` in every DT question, and `resolveUnknown` (fact-model §3.3).
- Then J1b-3 (`game.history`), J1b-4 (mate possibility), J1b-5 (DT-005/006), J1b-6 (DT-007 and counting), J1b-7 (`TimeControl` periods).
