# ADR-015: Local Helpmate Search for Mate Possibility (own move generator, Web Worker, verified evidence)

**Status:** Accepted. Implemented in J1b-4 (2026-10-08).

**Date:** 2026-10-08

**Implements:** [ADR-014](./ADR-014-draw-dt-touch-move-game-history.md) §5 (position-based mate possibility).
**Amends:** [ADR-005](./ADR-005-additional-decision-trees-mate-material-and-chess-library.md) ("chess.js behind a port" — one exception, below).

---

## Context

ADR-014 §5 requires that "can-mate" (FIDE 6.9, 7.5.5, A.5.3) is decided only when an actual sequence of legal moves ending in the attacker's checkmate has been found in the position, and that the search works in real middlegame flag falls within about 1.5 s on a phone. The acceptance target is ≥ 90 % on ≥ 50 realistic positions.

Measured on a laptop, chess.js 1.4 makes about 9,000 make/undo moves and 19,000 move generations per second (`move()` re-generates moves to validate). A phone is several times slower. That is too slow for a search of tens of thousands of positions.

The Decision Trees are synchronous and deterministic; a 1.5 s search must not block the UI.

## Decision

1. **Search in infrastructure, with its own move generator.** `lib/infrastructure/chess/helpmate/`:
   - `board.ts`: a 0x88 board with make/unmake, Zobrist keys and legal-move generation (en passant and all promotions; **no castling**, since castling can never answer a check and omitting moves only loses completeness, never soundness). It is checked against chess.js by perft tests.
   - `search.ts` (`findHelpmate`): the helpmate is a single-agent path search (both sides cooperate):
     1. exhaustive iterative deepening up to 3 plies;
     2. a guided strategy: when the attacker has no mating force but has pawns, first reach a position where a pawn has promoted, then search for the mate from there;
     3. best-first search with a heuristic (defender king's flight squares, check, distance to the edge / a corner of the bishop's colour, attacker pieces near the king, promotion distance, lost material), run with three weight settings in turn (a portfolio), sharing one expansion budget.
   - Limits: 20,000 expansions in total, 300,000 stored nodes per stage, and a **1.5 s deadline**. Hitting a limit gives "not found", never "cannot mate".
   - `run.ts` turns the found UCI line into SAN with chess.js and builds the `MateSearchRecord`.
   - `helpmate.worker.ts` + `port.ts` (`createHelpmateSearchPort`): the search runs in a **Web Worker**. Without `Worker` (tests, SSR) the same search runs in place. If the worker does not answer within 5 s (for example it was stopped in the background on a phone), the search fails and the worker is recreated next time; after a worker error, later searches run in place.
2. **The search result is evidence, verified every time by the domain.** `Incident.mateSearch` stores `{ fen, attacker, status, moves (SAN), engine }`. `assessMatePossibility` (`lib/domain/services/mate-possibility.ts`, pure) replays the line through `ChessPositionPort.replay` (chess.js, `strict: true`) on every evaluation, and accepts it only if:
   - every move is legal;
   - the final position is checkmate with the defender to move;
   - no position before the final one reaches 150 halfmoves (9.6.2: the game would already have ended; a mate on the 150th ply still counts).
   A bug in the search can therefore only cause a miss ("unknown"), never a wrong "can-mate".
3. **The application layer runs the search.** `incident-store.ts` asks `mateSearchNeeded(port, incident)` before evaluation. It returns the request only when the position is valid, the material does not already prove "cannot mate", and no usable record exists (a record for another FEN or attacker is ignored; a "not found" record from an older `HELPMATE_ENGINE_VERSION` is searched again). Search errors are not stored, so the next evaluation retries. A "not found" caused by the 1.5 s **deadline** depends on the device's speed: it is used for the current decision (unknown) but searched again at the next evaluation; a "not found" from the expansion limit is deterministic and is kept.
4. **The trees stay synchronous.** `DecisionEngine` computes `MatePossibility` with `assessMatePossibility` and passes it to DT-001…004 as `mate`. The trees never search.
5. **Position input.** The trees ask `matePosition` ("局面（FEN）を入力して判定する" / "局面を入力できない（CAへ確認）", tree-specific `unknown`) and then the FEN: `reinstatedFen` for 7.5.5 (the position before the illegal move, offender to move — checked) and `positionFen` for a flag fall. An invalid FEN, a position where the side not to move is in check, or (7.5.5) the wrong side to move is asked again with the reason. FENs and lines stay on the device (not in any LLM payload).
   - **Why the side to move is not enforced for a flag fall.** The flagged player is normally to move, but a player can make a move and have the flag fall before pressing the clock, so either side may be to move in the position "when the flag is established". The arbiter's FEN decides it, and DT-004 asks the arbiter to check that the position, including the side to move, matches the board.

## Consequences

**Positive**

- "Can-mate" is backed by a concrete, re-verified move sequence shown to the arbiter ("メイトまでの手順の例").
- Acceptance: on 72 fixtures (10 opening positions, 40 deterministic playouts from them in two seed sets — one not used for tuning — and 22 endgames) the search finds a verified mate in 68 (94 %). Median 18 ms, p90 246 ms, max 439 ms on a laptop. On the 20 playout positions that were **not** used for tuning, it finds 18 (90 %), just at the target; most fixtures are capture-biased random playouts, not recorded games, so the margin should be re-checked with real flag-fall positions (J3).
- The UI stays responsive (Web Worker), and the worker chunks are in the PWA precache, so it works offline.

**Negative and trade-offs**

- A second move generator to maintain. Mitigated by perft tests against chess.js and by the chess.js verification of every line.
- Phone timing is estimated, not measured: a phone that is 3× slower than the laptop hits the 1.5 s deadline only in the slowest few percent, which gives "unknown" (consult the CA).
- Typing a FEN on a phone is slow. Until a board editor or the game-history input exists (J2), many flag falls end in "局面を確認／CAへ確認". This is the stricter behaviour ADR-014 §5 accepted.
- Positions where mate is impossible because of a pawn fortress are never proven "cannot mate" by the search; they stay "unknown".
