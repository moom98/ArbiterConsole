# J1b-2: `unknown` answers and `resolveUnknown`

**Status:** Implemented and reviewed. The first review was FIX REQUIRED (1 must-fix, 3 should-fix); all were fixed and re-reviewed. On branch `feature/fact-catalog`.

**Date:** 2026-10-08

**Design:** [fact-model.md](../../design/fact-model.md) §3.3, including the new "Implementation (J1b-2)" part. **Decision record:** [ADR-013](../../decisions/ADR-013-fact-model.md), "Amendment (J1b-2)".

## Completed work

- **Every incident-scope choice question offers "わからない・確認できない"** (`UNKNOWN_OPTION`, value `unknown`, `lib/domain/follow-up.ts`).
  - The option is the last one, as one tap like the others.
  - `onUnknown: "enumerate"` for most questions. `materialConfirmed` uses `"manual-review"`, because it cannot be enumerated.
  - Questions that already had their own unknown value keep it, and their tree's own manual-review path: `opponentCanCheckmate`, `bothFlagsOrder`, `movesNotCompleted`, `positionBlocked`, and the repetition, fivefold and 75-move checks.
  - No generic unknown on count, text and game-context questions (see fact-model §3.3).
- **`applyIncidentAnswers` keeps the unknown answer** (§3.3 e).
  - It goes into `Incident.unknownAnswers` (question ids). The fact value is cleared, including derived values: `playerColor` from `flagFallen` or `claimant`, and `Incident.subtype`.
  - A later concrete answer removes it.
  - So `unknown` (answered) and `undefined` (not answered) stay different.
- **`resolveUnknown`** (pure, `lib/domain/decision-trees/tree-support.ts`).
  - Lazy discovery, enumeration of at most 2 facts, comparison of kind, intervention and penalties.
  - A `needs-input` branch or a branch outside the trees counts as disagreeing.
  - Facts that cannot be enumerated go to manual-review before any other question.
- **`unknownResolutionFields`** merges the branches into one decision.
  - **Agreed:**
    - it keeps the shared penalty;
    - the confidence is at most `medium`;
    - the shared actions come first, then one line per branch for that branch's own steps (branches with the same steps share a line);
    - escalation reasons are labelled with their branch.
  - **Disagreed:**
    - manual-review and `consult-ca`, with no penalty;
    - only the actions that every branch shares, then "確認する: …" and "CAへ確認する".
  - **Both:** `Decision.unconfirmedFacts`.
- **`DecisionEngine.routeResolvingUnknown`** wraps the routing in both `processIncident` and `evaluate`. The Decision Trees DT-001…005 did not change.
- **UI (display only):**
  - `DecisionDisplay` shows "確認できなかった事実";
  - the conclusion keeps its line breaks (`whitespace-pre-line`).
  - `FollowUpQuestions` needed no change: it renders the domain's options.

## Important implementation decisions

- **`unknown` is handled in the engine, not in each tree** (ADR-013 amendment).
  - There is one implementation for every tree.
  - Facts outside a tree's input are enumerated the same way: the offending player, which selects the illegal-move history, and the draw or clock subtype, which selects the tree.
- **On a disagreed path, actions from a single decided branch are never shown.** Example: "ドローを宣言する" must not appear when the other branch is undecided.
- **The Dexie schema did not change.** `unknownAnswers` and `unconfirmedFacts` are optional and not indexed.
- **The LLM payload did not change.** It never contains `unknownAnswers`.

## Relevant files

- `lib/domain/follow-up.ts`: `UNKNOWN_OPTION`, `UNKNOWN_VALUE`, `onUnknown`, `enumerableValues`, `isGenericUnknownAnswer`, `applyIncidentAnswers`.
- `lib/domain/decision-trees/tree-support.ts`: `resolveUnknown`, `unknownResolutionFields`, `decisionSignature`, `describeAssignment`, `MAX_ENUMERATED_UNKNOWN_FACTS`.
- `lib/domain/decision-engine/index.ts`: `routeResolvingUnknown`.
- `lib/domain/entities/incident.ts` (`unknownAnswers`) and `decision.ts` (`unconfirmedFacts`).
- `components/features/DecisionDisplay.tsx`.
- Tests:
  - `__tests__/unknown-answers.test.ts`;
  - `__tests__/unknown-answers.component.test.tsx`.

## Tests and verification

- `__tests__/unknown-answers.test.ts` covers the following:
  - **Questions:**
    - every incident-scope choice question has `unknown`;
    - the generic unknown is last and never enumerated;
    - tree-specific unknowns are unchanged.
  - **`applyIncidentAnswers`:**
    - record, clear (including derived player and subtype), remove;
    - tree-specific unknown values are kept.
  - **`resolveUnknown` (pure):**
    - not-needed, ask-others, agreed, disagreed (penalty type, side, time);
    - a `needs-input` branch, a branch outside the trees;
    - discovery of a second unknown fact;
    - more than 2 facts, a fact that cannot be enumerated, hidden questions.
  - **`unknownResolutionFields`:** shared actions, penalties, confidence, grouping, reasons.
  - **Each generic-unknown fact of each tree, through the engine:**
    - DT-001: `playerColor`, `subtype` (first and second offence), `gameEnded` (agreeing and disagreeing), `clockPressed` (including not needed for 7.5.3), two facts, three facts, ask-others;
    - DT-002: `subtype`, `gameEnded`, `clockPressed`, `playerColor`;
    - DT-003: `opponentMadeNextMove`, `detectedBy` (needed, and agreeing after the next move), `playerColor`, `subtype` (before and after the next move), `gameEnded`, `clockPressed`;
    - DT-004: `flagFallen`, `gameEndedBeforeFlag`, `materialConfirmed` (manual-review, never re-asks the counts), `lastPeriod`, `quickplayGuidelinesApply` (including not needed in Blitz), `clockTimeSubtype`;
    - DT-005: `claimant` (agreeing and disagreeing), `claimantHasMove`, `touchedPiece`, `claimMode` (with and without `moveWritten`), `moveWritten`, `lastMoveCheckmate` (met and not met), `drawSubtype`.
  - **IncidentCounter:** an agreed decision with a 7.5.5 penalty is counted. Manual-review decisions on unknown paths are not counted.
- `__tests__/unknown-answers.component.test.tsx`:
  - the unknown option is one tap and is submitted;
  - the decision card shows the unconfirmed facts.
- **Results:**
  - `npx tsc --noEmit`: clean;
  - ESLint (`--no-eslintrc -c .eslintrc.json`): 0 errors;
  - `npx vitest run`: 54 files, 889 tests passed (822 before);
  - `npm run build`: succeeds.
- **Review:**
  - The first review was FIX REQUIRED:
    - M1: an unknown illegal-move subtype left the old `Incident.subtype`;
    - S1: the escalation reason came from the first branch only;
    - S2: the branch-specific actions were too long;
    - S5: test gaps.
  - All of them were fixed, then re-reviewed: APPROVE.
  - Then the re-review's should-fix was also done:
    - a second offence with the subtype unknown now asks for mate possibility instead of ending in manual-review;
    - two Blitz B.2 tests were added.
  - Final counts: 54 files, 889 tests.

## Known issues

- **A branch that needs another unanswered answer counts as disagreeing** (§3.3 a), unless every branch asks the same questions (then they are asked). For example, `claimMode` unknown with `moveWritten` unanswered gives manual-review, even though the arbiter could still answer `moveWritten`, because only the 9.2.1 branch needs it.
- **On disagreed paths, `sources` include the articles of every decided branch**, including those of a loss or draw branch. They are references only; the decision itself is manual-review with no penalty.
- **Shared actions are matched as exact text.** Branches whose actions differ only in wording do not share them.
- **Count inputs have no unknown option.** The material counts are removed with ADR-014 §5 (J1b-4). Until then, `materialConfirmed` = unknown gives manual-review.
- **An explicit `subtype` still wins silently over a conflicting `im.action`** (from J1b-1). This slice did not wire the fact catalogue into the trees. The fact layer's `unknown` (`FactAnswer`) and `Incident.unknownAnswers` are linked when the facts replace the follow-up questions (J1b-3 and later, or J2).

## Next

- **J1b-3:** `game.history`. After it come J1b-4 (mate possibility), J1b-5 (DT-005/006), J1b-6 (DT-007 and counting) and J1b-7 (`TimeControl` periods).
- New trees and questions get `unknown` automatically through the engine. A new choice question needs `onUnknown` in `follow-up.ts`. The question test fails if it has no unknown.
