# ADR-014: Draw Claim and Automatic Draw Trees, Touch-Move Tree, Local Game History, Position-Based Mate Possibility

**Status:** Accepted. The user approved it in the catalogue re-review on 2026-10-08. Partly implemented, all on 2026-10-08: §4 (game history) in J1b-3, §5 (mate possibility) in J1b-4, §1 (draw trees) and §2 (side to move) in J1b-5. See fact-model §3.5 "Implementation (J1b-3)" and "Implementation (J1b-5)", §3.7 "Implementation (J1b-4)" and [ADR-015](./ADR-015-local-helpmate-search.md). §3, §6 and §7 are not implemented yet.

**Date:** 2026-10-08

**Amends:**

- [ADR-005](./ADR-005-additional-decision-trees-mate-material-and-chess-library.md): mate possibility. Counts can no longer decide "can-mate". The new service replaces `assessMatingPossibility(attacker, defender)`.
- [ADR-002](./ADR-002-decision-tree-llm-boundary.md) and `docs/design/mvp-scope.md`: the DT numbering. They reserved DT-006 for the 50-move rule and DT-007 for fivefold. **This ADR replaces that numbering**, and those documents are updated.
- [ADR-013](./ADR-013-fact-model.md): the facts.
- DT-001…005.

**Catalogue:** [docs/design/jev-missing-info-catalog.md](../design/jev-missing-info-catalog.md). **Design:** [docs/design/fact-model.md](../design/fact-model.md) §3.5–§3.8.

---

## Context

The user's re-review of the fact catalogue (2026-10-08, points 1–15) found that several rulings were being decided from inputs that cannot support them:

- mate possibility from piece counts;
- the side to move from the clock;
- repetition from free text;
- game end from a handshake.

There were also gaps:

- the 50-move claim had no tree;
- touch move (Article 4) had no tree, and could have been counted with Article 7.5 illegal moves;
- the time control has no periods, which FIDE 8.4 needs.

A code survey confirmed these points:

- `mate-material.ts` decides "can-mate" from counts, used by DT-004. DT-001/002/003 ask `opponentCanCheckmate` directly.
- `Game.pgn` is never used.
- Repetition uses `positionsText`. It is replayed by chess.js, which builds full keys (placement, side to move, castling rights, en passant). The weak points are the input:
  - a FEN-list mode, which does not prove that the positions followed each other;
  - non-strict notation;
  - no confirmation of the final position by the arbiter.
- There is no 50-move (100-ply) logic.
- There is no touch-move tree.
- `TimeControl` has no periods.

## Decision

### 1. Draw trees

- **DT-005 Draw Claim.** A single tree for claims, with the parameter `claimBasis: "threefold" | "fifty-move"` (FIDE 9.2 and 9.3). It shares these parts:
  - the claimant;
  - `dr.claim-timing` (already established, or by the intended move);
  - the side to move;
  - the written intended move (9.2.1 / 9.3.1 only);
  - the touched piece (9.4);
  - the condition check from `game.history`, or the manual reconstruction;
  - the result: correct claim → draw; incorrect claim → the 9.5 consequence (as today); unknown → consult-CA.
- **DT-006 Automatic Draw.** Fivefold repetition (9.6.1) and 75 moves (9.6.2). For 9.6.2, checkmate on the last move takes precedence. It is a separate flow, because there is no claimant.
- **IDs.** The persisted tree id `DT-005-repetition` (`DT_005_ID`) is kept for DT-005, so stored decisions stay valid. The new ids are `DT-006-automatic-draw` and `DT-007-touch-move`. Old fivefold or 75-move decisions stored under DT-005 stay as they are.
- **Agreement, stalemate, dead position and other** have no tree. They use a fact plan.
- `DRAW_SUBTYPE_LABELS` changes to: threefold claim, fifty-move claim, fivefold, 75-move, agreement, stalemate, dead position, other.

### 2. Side to move

The side to move is derived only in these ways:

- from `game.history`, as the side to move in the final position;
- otherwise from the observation `dr.last-mover` (who last made a move on the board).

The clock state (`dr.clock-state`) is recorded, but **never** used to derive the side to move: a move is completed on the board, and pressing the clock is a separate event.

### 3. Game end

- `game.end-event` records the observed event that ended the game: in progress, checkmate, resignation, stalemate, draw agreement, flag, other.
- `game.record-state` records whether the result is written and signed.
- **A handshake alone never ends the game.**
- `gameEnded` (DT-001…003) and `gameEndedBeforeFlag` (DT-004) are derived from `game.end-event`.

### 4. Local game history (`game.history`)

- A structured, **local-only** fact: `{ startFen?: string, moves: SAN[] }`. Its sources:
  - `Game.pgn`;
  - a pasted PGN or scoresheet;
  - a future move-entry UI.
- It is validated on the device with chess.js (`ChessPositionPort.replay`), using **`strict: true`**.
  - Every move must be legal.
  - Ambiguous or non-standard notation is rejected, with tests for ambiguous SAN.
  - The FEN-list mode of `detectPositionsFormat` is removed.
  - The final position and the move count are shown to the arbiter, who checks them against the board.
- **An incomplete history** (one that starts from `startFen`) cannot see positions before the start, and its halfmove clock is typed by the user. From such a history:
  - "met" can be decided, because a repetition that was found is proof;
  - "not met" is **inconclusive** and goes to `dr.manual-reconstruction`.
  - The same applies when the arbiter does not confirm the move count.
- **It is used for:**
  - threefold and fivefold repetition, with keys that include side to move, castling rights and en passant (the port's existing `normalize`);
  - the 50-move rule (100 plies) and the 75-move rule (150 plies);
  - checkmate precedence on the last move;
  - the side to move;
  - the move number for FIDE 7.3 and 8.4;
  - the position for mate possibility.
- **Free text is never used for automatic decisions.** `positionsText` is accepted only as PGN or SAN input that passes the same validation. A FEN list is not enough, because it does not show that the positions occurred in sequence.
- When no valid history exists, the trees use `dr.manual-reconstruction`: the arbiter replays the game on the board and records what was found.
- **It is never sent externally**, not even as codes (ADR-012).

### 5. Mate possibility (FIDE 6.9, 7.5.5, A.5.3)

A new domain service, `assessMatePossibility(position)`, replaces both the count-based "can-mate" and the direct question `opponentCanCheckmate`.

**Which position.**

- **For 7.5.5 (DT-001…003)** it is the position **reinstated** under 7.5.1–7.5.4, the one immediately before the irregularity. It is not the position with the illegal move on the board.
- **For a flag fall (DT-004)** it is the position when the flag is established, with the correct side to move.

**The verdicts:**

- **"cannot-mate", decided from material alone.** Only cases that are provably impossible for any series of legal moves:
  - the attacker has only the king;
  - the attacker has only K+N, or K and bishops all on one colour, **and** the defender has only the king;
  - the only pieces on the board are the two kings and bishops all on one colour.
- **"can-mate", decided only with a position.** A cooperative search **finds an actual sequence of legal moves** that ends in the attacker checkmating. The sequence is shown as evidence. The search must work in real middlegame flag falls, not only in endgames:
  - **guided strategies first:** drive the defending king to an edge or a corner, promote a pawn, then mate with the strongest piece;
  - then iterative deepening;
  - in a **Web Worker**, with a time budget (about 1.5 s on a phone) and a node limit.
  - **Acceptance for J1b-4:** on a fixture set of at least 50 realistic flag-fall positions where mate is possible, the search finds a mate in at least 90% of them within the budget. A miss gives "unknown", which is safe but slow.
- **Entering the position without a history.** On a phone, typing a FEN is impractical. Until a board editor exists, the arbiter can paste a FEN, or the result is "局面を確認してください／CAへ確認".
- **Everything else is "unknown".** That includes no position, a search that ran out of its limits, and every material-only "can-mate". The result is "局面を確認してください／CAへ確認", as in the existing `mateUnknown` paths.
- `insufficientMaterial` or other generic draw detection is **never** used as the FIDE 6.9 decision.
- **This changes DT-004's behaviour.** A flag fall with, for example, K+Q vs K and no position given is no longer an automatic loss. It asks for the position. That is stricter and safer.

### 6. Touch move (Article 4)

- A new subtype `touch-move` in the illegal-move category, decided by the new **DT-007**.
- **Engine routing.** Today `decision-engine/index.ts` sends every illegal-move incident to DT-001/002/003 by competition type, whatever the subtype. It now routes `touch-move` to DT-007 **first**.
- **Its own facts.** It gets its own `TouchMoveFacts`, because `IllegalMoveFacts` requires `clockPressed`, `gameEnded` and `opponentCanCheckmate`, which do not fit touch move. Its inputs:
  - the `tch.*` facts, including the local-only ordered `tch.touched` squares (4.3.1–4.3.3: the first piece touched);
  - castling and promotion (4.4);
  - release (4.7);
  - claim timing (4.8);
  - the position, for the legal-move check (4.5).
- It decides **which piece must be moved or captured**. It applies no penalty automatically: any penalty is at the arbiter's discretion under Article 12.
- **The counts are separate.** `IncidentCounter` counts only Article 7.5 completed illegal moves: the illegal-move category, a subtype that is not `touch-move`, and DT-001/002/003. Touch-move incidents are counted separately, if at all. A test enforces this.

### 7. Time control periods (FIDE 8.4)

- `TimeControl` gains `periods: { moves?: number; minutes: number; incrementSeconds: number }[]`. The existing fields become a single period.
- The current period comes from the move number: from `game.history`, or the fact `ss.move-number`.
- The increment of the current period decides whether 8.4 applies (30 seconds or more).
- 8.4 says "at some stage in a period", so the exemption lasts for the rest of the period, even after an increment takes the clock above 5:00 again. The tree uses `ss.remaining-time < 5:00` **or** `ss.below-five-in-period = yes`.
- 8.4 applies only where 8.1.1 requires recording (Standard).
- **Migration.** `timeControl` is not an index, so the Dexie `stores()` definition does not change. A `version(8).upgrade()` (or a normalizer at read time) converts each stored value:
  - `initialMinutes` and `incrementSeconds` become one period;
  - when the legacy `additionalTimeAfterMove` is present, its meaning (after which move?) is unknown. It is kept, and the time control is marked `periodsIncomplete: true`. Then the current period and the increment are **asked**.
  - Provisional tournaments (ADR-004) have no `timeControl`, so they also ask.
- The tournament profile form, its validation and `formatTimeControl` are updated.

## Consequences

**Positive**

- No ruling depends on an input that cannot prove it.
- Repetition, 50 and 75 moves, and checkmate precedence use one verified game history.
- Touch move is handled, and never inflates the illegal-move count.

**Negative and trade-offs**

- More "please check the position" outcomes until arbiters enter game histories. Requiring a position for "can-mate" makes some flag-fall decisions slower.
- DT-005 is restructured and DT-006 and DT-007 are new, which is significant domain work with regression tests.
- The helpmate search needs depth and node limits tuned for phones. When a limit is hit, the result is "unknown", which is safe.
- The `TimeControl` schema changes (Dexie migration).
