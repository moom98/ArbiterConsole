# J1b-8: Game end from the observed event (ADR-014 §3)

**Status:** Implemented and reviewed on branch `feature/fact-catalog`. Review verdict: MERGE with 3 should-fix items → fixed → re-review MERGE.

**Date:** 2026-10-08

**Design:** [fact-model.md](../../design/fact-model.md) §3.9 "Implementation (J1b-8)". **Decision record:** [ADR-014](../../decisions/ADR-014-draw-dt-touch-move-game-history.md) §3 and its J1b-8 amendment.

## Completed work

- **Questions** (`lib/domain/follow-up.ts`):
  - `gameEnded` (yes/no) → **`gameEndEvent`** (DT-001/002/003): まだ対局中・チェックメイト・投了の発言や動作・ステイルメイト・ドローの合意・時間切れの確定・その他, plus the generic unknown (enumerated).
  - `gameEndedBeforeFlag` (yes/no) → **`endedBeforeFlag`** (DT-004): なし・チェックメイト・投了・ドローの合意・ステイルメイト・その他, plus unknown.
  - New optional **`gameRecordState`** (`game.record-state`): asked in the same round, shown only when the event is not "in progress". Record only.
  - No handshake option. The help texts say that a handshake alone does not end the game, and that an illegal mating or stalemating move does not end it either (FIDE 5.1.1 / 5.2.1).
- **Service** `lib/domain/services/game-end.ts`: labels and values, `gameEndedFromEvent`, `endedBeforeFlagFromEvent`, `recordStateAction`.
- **Entities:** `GameEndEvent`, `EndedBeforeFlag`, `GameRecordState`; `IllegalMoveFacts.endEvent` / `recordState`; `FlagFallFacts.endedBeforeFlag`. `gameEnded` / `gameEndedBeforeFlag` are now optional and `@deprecated`.
- **Trees:**
  - DT-001/002/003 read only `endEvent`. The shared `gameEndedFields` names the event in the conclusion and adds "check signatures" from the record state. Checkmate and stalemate add "was the move that produced it legal?" (`endEventCheck`, cites 5.1.1 / 5.2.1) with confidence medium; "other" also gives medium.
  - DT-004 reads only `endedBeforeFlag`, with the same rules.
- **Engine:** strips the legacy booleans before evaluating (`currentIllegalMoveFacts`, `currentFlagFallFacts`), so old answers are asked again.
- **`resolveUnknown`:** "ask-others" no longer returns a question whose `showWhen` parent was answered unknown.
- **Catalogue:** `game.end-event` → `gameEndEvent` and `ct.ended-before-flag` → `endedBeforeFlag` now map one to one (`toBoolean` removed). `game.record-state` stays `appliesWhen`-only.
- **Citations (verbatim, locked by tests):** FIDE 5.1.1 and 5.2.1 (Arbiters' Manual 2025, printed p.19).

## Important implementation decisions

- **Legacy answers are re-asked, including "no".** An old "yes" may rest on a handshake, so it cannot decide "game over". "No" is re-asked too, to keep one rule.
- **DT-004 uses `ct.ended-before-flag`, not `game.end-event`**, because the time-out itself is not an earlier end.
- **The record state never changes the ruling.** Its "unknown" clears the stored value. In the catalogue it stays `conditional`, so J1c must treat it as a record fact that never blocks.
- **Checkmate/stalemate are not trusted blindly.** The ruling still says "result stands", but confidence is medium, and it asks the arbiter to check that the final move was legal.

## Relevant files

- `lib/domain/services/game-end.ts` (new)
- `lib/domain/follow-up.ts`, `lib/domain/entities/incident.ts`
- `lib/domain/decision-trees/{dt-001-illegal-move-standard,illegal-move-fast-shared,dt-004-flag-fall,tree-support}.ts`
- `lib/domain/decision-engine/index.ts`, `lib/domain/facts/catalog.ts`, `lib/domain/rules/citations.ts`
- Tests: `__tests__/game-end.test.ts`, `__tests__/game-end.component.test.tsx` (new). The DT, engine, unknown-answer, integration and store tests were renamed to the new questions.

## Tests and verification

- `npx tsc --noEmit`: clean.
- ESLint: 0 errors.
- `npx vitest run`: 66 files, 1184 tests passed (1146 before J1b-8).
- `npm run build`: succeeds.
- FIDE 5.1.1 / 5.2.1 were extracted with pdfjs-dist and checked verbatim.

## Review

Separate read-only reviewer agent.

- **First pass: MERGE, with should-fix items.**
  - **S1:** an illegal move that looks like mate or stalemate could be answered "チェックメイト" and give "result stands" with confidence high. Fix: help texts, the `endEventCheck` action and citation, and confidence medium.
  - **S2:** no UI test for the optional choice with `showWhen`. Fix: `game-end.component.test.tsx`.
  - **S3:** the branch-count statement in fact-model §3.3(d) was stale. Fixed.
  - **Nits:** N1 (legacy "no" also re-asked) and N3 (record-state `conditional`) are documented. N2 (record-state unknown kept the old value) is fixed. N4 (no-fact table) is updated. N5 (helper location) is left as is.
- **Re-review: MERGE.** Citations re-checked verbatim against the PDF; no new problems. Nit: the `gameEndEvent` help text was shortened.

## Known issues

- The arbiter still has to judge whether the mating move was legal; there is no automatic check from `game.history` yet (J2).
- `game.record-state` for the game-result category is still derived from `gr.recorded-result` / `gr.signatures` only on paper (fact plan, no code yet).

## Next

- J1c: Jev port, adapter, calibrated parser and `/api/llm/facts`; wire `deriveTimeControlFacts` and `assessRecordingObligation`.
