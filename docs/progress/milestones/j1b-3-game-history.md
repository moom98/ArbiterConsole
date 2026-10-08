# J1b-3: Local game history (`game.history`)

**Status:** Implemented and reviewed on branch `feature/fact-catalog`. The first review was FIX REQUIRED (2 must-fix, 3 should-fix, nits). Everything was fixed; the re-review verdict was APPROVE.

**Date:** 2026-10-08

**Design:** [fact-model.md](../../design/fact-model.md) §3.5, "Implementation (J1b-3)". **Decision record:** [ADR-014](../../decisions/ADR-014-draw-dt-touch-move-game-history.md) §4.

## Completed work

- **`lib/domain/services/game-history.ts`** (new, pure):
  - `GameHistory { startFen?, moves: SAN[] }`.
  - `parseGameHistoryText`: PGN or scoresheet text.
    - The start position comes only from `[FEN "…"]`.
    - FEN lists, or any FEN placement in the body, are rejected.
    - Full-width characters and the "…" ellipsis are normalized.
  - `validateGameHistory` replays through the port and returns `ValidatedGameHistory`, with `complete` true only for the standard start.
  - `trustedHalfmoveClock`, `summarizeGameHistory` (last move, move number, side to move, FEN).
- **Port** (`chess-js-position-port.ts`):
  - `replay(history)` and `play` use chess.js `strict: true`. The tokenizer moved to the domain parser.
  - Errors carry a hint for `0-0`, coordinates and `e.p.`.
  - `normalize` returns `fullmoveNumber`.
- **`position-analysis.ts`:**
  - `analyzeRepetition(port, validated, intendedMove?)`.
  - **The FEN-list mode and `detectPositionsFormat` are removed.**
  - New fields: `complete`, `history` (summary) and `seventyFiveCheckmateUncertain`.
  - For incomplete histories, clocks are counted inside the history.
- **DT-005** (minimal change; the restructure is J1b-5):
  - A new question `historyConfirmed` (match / position-only / mismatch / unknown). It is asked after the side-to-move check, with the final position in the conclusion.
  - A not-met outcome is decided only for a complete history with `match`. Otherwise it is inconclusive and goes to the manual check.
  - `mismatch` / `unknown` → the manual check.
  - 75 moves: uncertain checkmate precedence → the manual check.
- **`applyIncidentAnswers`** clears `historyConfirmed` when the move list changes (also in the same submission) or when "判定する" is chosen again.
- **`resolveUnknown`:** `ask-others` keeps a conclusion that all branches share. Without that, the confirmation appeared without its position.
- **Catalogue:** `game.history` (draw) maps to `positionsText` and `historyConfirmed`.
- **UI:**
  - The question texts changed: there is no "FEN（1行に1局面）" any more.
  - The `DecisionDisplay` conclusion wraps long FENs (`break-words`).

## Important implementation decisions

- **Parsing is in the domain; legality is in the port.** The text parser is pure string handling. SAN legality and strictness stay behind `ChessPositionPort` (ADR-005).
- **Strict SAN** is chess.js `strict: true`:
  - it rejects `Ngf3`, `e2e4`, `0-0` and ambiguous `Nd2`;
  - it accepts a wrong check suffix (`Rh8#` for a check), which does not change which move is meant.
- **Confirmation is a question, not UI state.** The arbiter's comparison is stored as `DrawClaimFacts.historyConfirmed`, so it is part of the incident record. It is tied to the move list it was given for.
- **`historyConfirmed` has its own `unknown`**, treated like `mismatch`. It is not enumerated by `resolveUnknown`.
- **No Dexie schema change.** The new fields are optional and not indexed.
- **Nothing is sent externally.** The LLM payload is a whitelist without draw facts, and a test locks this.

## Relevant files

- `lib/domain/services/game-history.ts`, `lib/domain/services/position-analysis.ts`
- `lib/infrastructure/chess/chess-js-position-port.ts`
- `lib/domain/decision-trees/dt-005-repetition.ts`, `lib/domain/decision-trees/tree-support.ts`
- `lib/domain/decision-engine/index.ts`, `lib/domain/follow-up.ts`, `lib/domain/entities/incident.ts`, `lib/domain/facts/catalog.ts`
- `components/features/DecisionDisplay.tsx`
- Tests:
  - `__tests__/game-history.test.ts` (new);
  - `__tests__/game-history.component.test.tsx` (new);
  - updated: `position-analysis`, `dt-005-repetition`, `decision-engine`, `incident-flow.integration`.

## Tests and verification

- **New tests cover:**
  - **Parser:** headers, comments, variations, NAGs, `[FEN]`, FEN-list rejection, duplicate or empty `[FEN]`.
  - **Strict SAN:** ambiguous, over-disambiguated, coordinates, `0-0`, an illegal move named with its ply, an invalid start FEN.
  - **`complete`;** the trusted halfmove clock (no reset, reset, complete).
  - **Summary;** repetition in an incomplete history; the 75-move clock not trusted from the start FEN.
  - **DT-005 through the engine:**
    - the confirmation prompt;
    - match / mismatch / unknown / position-only;
    - incomplete histories (met, inconclusive);
    - fivefold and 75 moves;
    - invalid input never decides;
    - confirmation invalidation;
    - the mis-tap recovery;
    - `claimMode` unknown keeps the summary;
    - side-to-move before confirmation;
    - uncertain 75-move checkmate precedence.
  - **The LLM payload has no move list.**
  - **The component:** the four options, no duplicated generic unknown, one-tap submit, the summary rendered and wrapped.
- **Results:**
  - `npx tsc --noEmit`: clean;
  - ESLint (`--no-eslintrc -c .eslintrc.json`): 0 problems;
  - `npx vitest run`: 56 files, 937 tests passed (889 before);
  - `npm run build`: succeeds.
- **Review:**
  - First review: FIX REQUIRED.
    - M1: a mis-tapped "一致しない" could not be undone.
    - M2: in the `ask-others` path, the confirmation was asked without its position.
    - S3: 75-move checkmate precedence was wrong in incomplete histories.
    - S4: test gaps.
    - S5: the summary did not lead with the move number.
    - Nits.
  - All were fixed, then re-reviewed: **APPROVE** (no must-fix or should-fix left).

## Known issues

- **`Game.pgn` is not used yet.** No UI sets it, so the history comes only from the pasted text. Wire it in when a move-entry or PGN-import UI exists.
- **No board diagram.** The arbiter compares a FEN and the last move with the board. A board view is J2 UI work.
- **The side to move still comes from the `claimantHasMove` question,** and the history only validates it. Deriving it from the history (and `dr.last-mover`) is part of J1b-5.
- **`dr.manual-reconstruction` is still the old `repetitionCheck` / `fivefoldCheck` / `seventyFiveCheck` questions.** J1b-5 restructures them.
- **The 50-move claim (9.3)** still has no tree (J1b-5). `FIFTY_MOVES_PLIES` is not defined yet.

## Next

- **J1b-4:** position-based mate possibility (`assessMatePossibility`, a Web Worker helpmate search; the ≥90% acceptance on ≥50 fixtures). It can use `validateGameHistory` for the position.
- Then:
  - J1b-5: DT-005 Draw Claim with 9.3, DT-006 Automatic Draw, side to move from the history;
  - J1b-6: DT-007 touch move and counting;
  - J1b-7: `TimeControl` periods.
