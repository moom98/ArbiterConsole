# J1b-4: Position-based mate possibility (FIDE 6.9 / 7.5.5 / A.5.3)

**Status:** Implemented and reviewed on branch `feature/fact-catalog`. Review verdict: APPROVE (no must-fix); the 3 should-fix items and the relevant nits were fixed.

**Date:** 2026-10-08

**Design:** [fact-model.md](../../design/fact-model.md) §3.7 "Implementation (J1b-4)". **Decision records:** [ADR-014](../../decisions/ADR-014-draw-dt-touch-move-game-history.md) §5, [ADR-015](../../decisions/ADR-015-local-helpmate-search.md).

## Completed work

- **Helpmate search** (`lib/infrastructure/chess/helpmate/`, new):
  - `board.ts`: 0x88 board, make/unmake with typed-array undo stack, Zobrist keys, legal moves (en passant, all promotions, no castling).
  - `search.ts` `findHelpmate(fen, attacker, limits)`: 3-ply exhaustive → promotion sub-goal (when the attacker has no mating force but has pawns) → best-first portfolio of three heuristic weightings. Limits: 20,000 expansions, 300,000 nodes per stage, optional deadline.
  - `run.ts` `runHelpmateSearch(request)`: 1.5 s deadline, UCI → SAN with chess.js, builds `MateSearchRecord` (`engine: "helpmate-1"`).
  - `helpmate.worker.ts` + `port.ts` `createHelpmateSearchPort()`: Web Worker; in-place fallback without `Worker`.
- **Domain:**
  - `lib/domain/services/mate-material.ts`: now only `materialCannotMate(material, attacker)` (the three provable cases) and `materialFromFen`. `assessMatingPossibility` and `validateSideMaterial` are removed.
  - `lib/domain/services/mate-possibility.ts` (new, pure): `matePositionRequest`, `assessMatePossibility`, `verifyHelpmateLine` (strict replay, final checkmate of the defender, 150-halfmove check), `searchMatches`, `mateSearchNeeded`, `HelpmateSearchPort`.
  - `ChessPositionPort.normalize` returns `opponentInCheck` (impossible positions are rejected).
  - Entities: `IllegalMoveFacts.matePosition` / `positionFen`, `FlagFallFacts.matePosition`, `Incident.mateSearch`, `MatePositionInput = "fen" | "unknown"`, `MateSearchRecord`. Removed: `opponentCanCheckmate`, `material`, `materialConfirmed`, `positionBlocked`.
  - Questions: `matePosition`, `reinstatedFen`, `positionFen` (now required when shown). Removed: `opponentCanCheckmate`, the material counts, `materialConfirmed`, `positionBlocked`.
  - `lib/domain/decision-trees/mate-position.ts` (new): `mateStep` shared by DT-001…003.
  - DT-001/002/003 (second offence) and DT-004 use `mate`; the loss conclusion shows the verified line; the draw conclusion shows the material reason; unknown → "局面を確認し、CAへ確認".
  - `DecisionEngine.mateFor` passes `MatePossibility` to the trees (using the `positions` port).
  - Catalogue: `game.position` maps `matePosition` + `reinstatedFen` / `positionFen`.
  - `isQuestionVisible(q, answers, round)` checks the condition question's own visibility.
- **Application / UI:** `incident-store.ts` runs the search before evaluation (`mateSearchPending` state; the report page shows "局面からメイトの手順を探しています...（端末内）").

## Important implementation decisions

- **Search in infrastructure, verification in the domain** (ADR-015). Any search bug gives "unknown", never a wrong "can-mate".
- **Counts never decide "can-mate".** K+Q vs K with no FEN is now "局面を確認／CAへ確認" (ADR-014 §5 accepted this).
- **"局面を入力できない" is the tree-specific `unknown`** of `matePosition` (R5: every choice question has `unknown`), not enumerated by `resolveUnknown`.
- **7.5.5 position side to move = offender**, enforced. Flag-fall side to move is the arbiter's input (shown in the evidence line).
- **Search errors are not stored**, so the next evaluation retries; "not found" is stored with the engine version and re-searched when the version changes.
- **No Dexie schema change**: the new fields are optional and not indexed.

## Relevant files

- `lib/infrastructure/chess/helpmate/{board,search,run,port,helpmate.worker}.ts`
- `lib/domain/services/{mate-possibility,mate-material,position-analysis}.ts`
- `lib/domain/decision-trees/{mate-position,dt-001-illegal-move-standard,illegal-move-fast-shared,dt-002-illegal-move-fast-competition,dt-003-illegal-move-fast-basic,dt-004-flag-fall}.ts`
- `lib/domain/decision-engine/index.ts`, `lib/domain/follow-up.ts`, `lib/domain/entities/incident.ts`, `lib/domain/facts/catalog.ts`
- `lib/infrastructure/chess/chess-js-position-port.ts`, `lib/stores/incident-store.ts`
- `components/features/FollowUpQuestions.tsx`, `app/(tabs)/report/page.tsx`
- Tests: `__tests__/helpmate-search.test.ts`, `__tests__/mate-possibility.test.ts`, `__tests__/fixtures/mate-possibility-positions.ts` (new); updated DT-001…004, engine, unknown-answers, required-facts, component, integration and tournament-store tests.

## Tests and verification

- **Acceptance (ADR-014 §5):** 72 fixtures (10 opening positions replayed strictly with chess.js, 40 deterministic capture-biased playouts in two seed sets — seeds i+101 were not used for tuning — and 22 hand-made endgames). Found and chess.js-verified: **68/72 (94.4 %)**. Laptop timing: median 18 ms, p90 246 ms, max 439 ms. Misses: two crowded middlegames, one K+P vs everything, and K+B vs K+P needing a 25-ply corner manoeuvre. On the 20 playouts **not** used for tuning (seeds i+101): 18/20 (90 %), just at the target. Most fixtures are capture-biased random playouts, not recorded games.
- **perft** of the 0x88 board equals chess.js (without castling) on 6 positions incl. promotions, en passant and pins.
- `npx tsc --noEmit`: clean.
- ESLint (`--no-eslintrc -c .eslintrc.json`): 0 problems.
- `npx vitest run`: 59 files, 968 tests passed (937 before).
- `npm run build`: succeeds; the worker chunk (990) and the chunks it imports (443, 546) are in the service-worker precache.
- `npm run cf:build`: succeeds.

## Review

Separate read-only reviewer agent. Verdict: **APPROVE** (no must-fix). It found no path to a wrong loss or draw: can-mate needs a strict replay to the defender's checkmate, cannot-mate only the three material cases, colours and side to move are right, stale records are ignored, unknown answers fall to consult-CA, and FENs stay local. Its own run: 68/72 found, desktop median 14 ms, max 273 ms.

Fixed after the review:

- **S1 Worker without a reply** could leave the spinner forever: the port now times out after 5 s (`HELPMATE_WORKER_TIMEOUT_MS`), terminates and recreates the worker; `onmessageerror` also fails the search.
- **S2 a deadline miss was reused forever:** it is still used for the current decision ("時間内に…見つけられませんでした"), but `mateSearchNeeded` searches again at the next evaluation. Expansion-limit misses are kept.
- **S3 tests:** store failure path (consult-CA, no record, retried), port tests with a fake Worker (success, error reply, worker error → in place, timeout → recreate), deadline handling. The held-out 18/20 is documented.
- Nits: the bishop square-colour comment in `materialFromFen`; the already-mated wording now cites 5.1.1; ADR-015 explains why the flag-fall side to move is not enforced.
- Not changed: the store and the engine use the same chess.js port (the store creates the engine), so there is no mismatch; the search's position key can collide only into a missed search, never a wrong result; pre-filling the previous FEN when asking again is J2 UI work.

## Known issues

- **Typing a FEN on a phone is slow.** A board editor or the `game.history` input (J2) is needed; until then many flag falls end in "局面を確認／CAへ確認".
- **The position is not yet derived from `game.history`** (no history input for illegal moves or flag falls yet).
- **Phone timing is estimated** (laptop × ~3). A deadline hit gives "unknown". Confirm on a real device.
- **Re-entering a FEN** after an error starts from an empty field (J2 UI).
- **Fortress positions** are never proven "cannot mate" by the search (stay "unknown").
- **Fivefold repetition with earlier positions** is not checked along the evidence line (positions before the FEN are unknown); the line itself has no repeated positions.

## Next

- J1b-5: DT-005 Draw Claim with 9.3, DT-006 Automatic Draw, side to move from the history.
- J1b-6: DT-007 touch move and counting. J1b-7: `TimeControl` periods.
