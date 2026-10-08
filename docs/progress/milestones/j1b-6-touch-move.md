# J1b-6: DT-007 Touch Move (Article 4) and separate counting

**Status:** Implemented and reviewed on branch `feature/fact-catalog`. Review verdict: FIX REQUIRED (2 must-fix, 4 should-fix) → fixed → re-review MERGE.

**Date:** 2026-10-08

**Design:** [fact-model.md](../../design/fact-model.md) §3.8 "Implementation (J1b-6)". **Decision record:** [ADR-014](../../decisions/ADR-014-draw-dt-touch-move-game-history.md) §6. **Catalogue:** [jev-missing-info-catalog.md](../../design/jev-missing-info-catalog.md) §2.

## Completed work

- **DT-007 Touch Move** (`lib/domain/decision-trees/dt-007-touch-move.ts`, id `DT-007-touch-move`).
  - **No obligation:**
    - clearly accidental contact (4.2.2);
    - not on move (4.3 applies only to the player having the move);
    - adjusting declared on move (4.2.1, confidence medium).
  - **4.8 forfeited claim:** asked only when the arbiter did not observe the touch.
  - **Touched piece moved:**
    - not final → no violation;
    - final (released, 4.7, or promotion piece placed, 4.4.4), then changed → restore it; recorded as a violation;
    - final and not changed → no violation.
  - **Not moved yet / moved another piece:** which piece must be moved or captured. "Moved another piece" is recorded as a violation.
  - **Never sets a penalty.** It lists the 12.9 options and JCF p.20 practice (warning; time to the opponent if the clock was pressed) as discretionary.
  - **Separate count:** "今回を含めて n 回", with the JCF note that some tournaments forfeit on the third violation.
  - **Weaker basis:** not observed and not claimed (e.g. a spectator's report) → "check the facts first", confidence medium.
- **Obligation service** (`lib/domain/services/touch-move.ts`, pure). `parseTouchedText` reads input such as "Pe2 Qd1" (white upper case, black lower case) or "e2 d1" with a FEN. `touchObligation` decides:
  - 4.3.1 (own pieces), 4.3.2 (opponent's pieces, en passant included), 4.3.3 (both colours, with fallback in touched order), 4.5 (none can move: any legal move);
  - 4.4.1 / 4.4.3 / 4.4.2, only when the first two own pieces touched are the king and a rook on its castling square;
  - **with a FEN** (side to move = the toucher): the allowed SAN moves come from `ChessPositionPort.legalMoves`;
  - **without a FEN:** ordered steps to check on the board.
- **Port:** `ChessPositionPort.legalMoves(fen)` (pieces + verbose legal moves, `capturedSquare`, castling side, promotion), implemented in the chess.js adapter.
- **Routing:** `illegal-move` + subtype `touch-move` → DT-007 before DT-001/002/003, in every competition type; the ruleset is still required.
  - Entry points: the quick report "タッチムーブ（触れた駒）" and the 7.5 `subtype` question option 「触れた駒の規則（タッチムーブ）」 (`enumerate: false`, so an unknown 7.5 type never enumerates touch move).
  - `isKnownSubtype("illegal-move", "touch-move")` is true; the 7.5 subtypes are still not set at report time.
- **Entities:**
  - `TOUCH_MOVE_SUBTYPE` and `TouchMoveFacts` (incl. `changedAfter`);
  - `Incident.touchMoveFacts`;
  - `DecisionTreeId` += `DT-007-touch-move`;
  - `Decision.touchMoveViolation`.
- **Questions:** `touchPlayer`, `touchHow`, `touchAdjustDeclared`, `touchOnMove`, `touchClaimedByOpponent`, `touchClaimTiming`, `touchWhatNext`, `touchPromotion`, `touchReleased`, `touchChangedAfter`, `touchedPieces`, `touchFen`. All the choice questions have the common "わからない" (resolveUnknown).
- **Counting** (`IncidentCounter`):
  - `isPenalisedIllegalMove` explicitly excludes `touch-move`;
  - new `isTouchMoveViolation` and `touchMoveViolationsByColor`, passed to the engine as `touchMoveViolations`;
  - an agreed unknown resolution keeps `touchMoveViolation` only if every branch is a violation.
- **Catalogue:**
  - tch.* mapped to the DT-007 questions;
  - `tch.touched` B → C;
  - `tch.claimed-by-opponent` O → C (asked only when the arbiter did not observe the touch);
  - new `tch.changed-after`;
  - `tch.special` → `touchPromotion` (castling computed from the touched order);
  - `im.action` no longer marks touch-move as unhandled.
- **Citations** (verbatim, checked against the PDFs with pdfjs-dist, locked by `__tests__/citations.test.ts`):
  - FIDE 4.2.1, 4.2.2, 4.4, 4.5, 4.8 and 12.9 (printed p.39);
  - Arbiters' Manual notes on 4.2.1 (displaced pieces only), the accidental touch, and 4.4.2 (rook first);
  - JCF NA p.20 (※2 change after release, ① warning, ② clock pressed, ※ third violation).
- **Other:**
  - keyword suggestion タッチムーブ / touch move / j'adoube (weight 3) and 触れた駒 (weight 1);
  - the classifier label for the touch-move suggestion.

## Important implementation decisions

- **Castling (4.4) only for the first two own pieces.**
  - A piece touched before the king and rook keeps the 4.3.1 order.
  - A rook off its castling square is never castling.
- **Only definite violations are counted:** moving another piece, or changing a final move or promotion piece. "Not moved yet" is enforcement only.
- **The 4.8 question is skipped when the arbiter observed the touch.** The Manual requires intervention for an observed Article 4 violation.
- **The FEN is optional.** Without it the result is the order of checks on the board (confidence medium), because typing a FEN on a phone is slow (same trade-off as J1b-4).
- **No Dexie schema change:** the new fields are optional and not indexed.

## Relevant files

- `lib/domain/decision-trees/dt-007-touch-move.ts`, `lib/domain/services/touch-move.ts`
- `lib/domain/decision-engine/index.ts`, `lib/domain/follow-up.ts`, `lib/domain/entities/{incident,decision}.ts`, `lib/domain/services/{incident-counter,position-analysis}.ts`, `lib/domain/decision-trees/tree-support.ts`, `lib/domain/facts/{catalog,required-facts}.ts`, `lib/domain/rules/citations.ts`, `lib/domain/llm/keyword-classifier.ts`
- `lib/infrastructure/chess/chess-js-position-port.ts`, `lib/stores/incident-store.ts`, `components/features/IncidentTextClassifier.tsx`
- Tests:
  - new: `__tests__/dt-007-touch-move.test.ts`, `__tests__/touch-move-service.test.ts` (real chess.js positions);
  - updated: `__tests__/citations.test.ts`, `__tests__/facts/required-facts.test.ts`.

## Tests and verification

- `npx tsc --noEmit`: clean.
- ESLint (`--no-eslintrc -c .eslintrc.json`): 0 problems.
- `npx vitest run`: 63 files, 1107 tests passed (1027 before J1b-6).
- `npm run build`: succeeds.

## Review

Separate read-only reviewer agent.

- **First pass: FIX REQUIRED.**
  - **M1:** king, then a rook off its castling square, with the king boxed in → "any legal move" instead of the rook (4.3.1).
  - **M2:** another own piece touched before the king and rook still gave 4.4.1.
  - **S3:** "released" always said intervene, but release alone is not a violation; changes after release were never counted. Fix: `touchChangedAfter`.
  - **S4:** the "no" label of the claim question said "the arbiter saw it". Fix: relabelled, plus the weaker-basis note.
  - **S5:** the adjust question was hidden when `touchHow` was unknown. Fix: removed its display condition.
  - **S6:** missing tests. Fix: added.
  - **Nits:** the agreed resolution dropped `touchMoveViolation`; the keyword weight of 触れた駒; document the competition-type invariance. All done.
- **Re-review: MERGE.** Every item is fixed with tests.
  - Nit 1 fixed afterwards: when the piece was released **and** the promotion piece placed, the conclusion now covers both restorations.
  - Nit 2 documented in fact-model §3.8: `touchReleased` unknown gives manual review.
  - Nit 3 is the known stale-facts issue below.

## Known issues

- **`touchClaimedByOpponent` unknown:** the "claimed" branch needs `touchClaimTiming`, so the result is manual review (the J1b-2 limitation).
- **Stale facts:** switching the subtype away from touch-move leaves the old `touchMoveFacts` on the Incident. Decisions ignore them, but they are kept in the stored data.
- **No board editor:** touched pieces and the FEN are typed. A tap-on-board input is J2.
- **"Opponent already made the next move"** is not asked; the tree tells the arbiter to consult the CA.
- **Federation practice for touch move in A.5 / B.3 games** is not covered by the sources. The tree applies Article 4 the same in every competition type.

## Next

- J1b-7: `TimeControl` periods (ADR-014 §7).
- ADR-014 §3 (`game.end-event` replacing `gameEnded` / `gameEndedBeforeFlag`), with J2 or before J1c.
