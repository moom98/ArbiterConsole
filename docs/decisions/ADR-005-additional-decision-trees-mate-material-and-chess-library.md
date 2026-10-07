# ADR-005: Additional Decision Trees, Mate-Material Check and Chess Library

**Status:** Accepted

**Date:** 2026-10-07

---

## Context

Milestone 4 adds Decision Trees for Rapid/Blitz illegal moves (DT-002/DT-003), flag fall (DT-004)
and repetition / 75-move draws (DT-005). These rulings depend on:

- The FIDE Laws 2023 appendix regime (Rapid A.4/A.5, Blitz B.2/B.3), which changes penalty amounts
  and whether an illegal move can still be corrected.
- Whether the opponent "can checkmate by any possible series of legal moves" (6.9, 7.5.5, A.5.3).
- Position identity for repetition (9.2.3: side to move, piece placement, castling rights, en passant
  only where it was actually possible).

All rule text was checked against `docs/reference/rules/fide/Arbiters_Manual_2025.pdf` and the JCF NA
seminar PDF. Citations are verbatim and listed in `lib/domain/rules/citations.ts`.

## Decision

1. **Separate trees per regime.** DT-002 (A.4/B.2) follows 7.5.1–7.5.5. DT-003 (A.5/B.3) adds the
   A.5.2 conditions: the opponent has already moved (the illegal move stands, no penalty, and it is
   only corrected if the players agree without the arbiter; a pawn left on the last rank follows
   A.5.4), and who detected it (arbiter / opponent claim / other, where "other" means consult the CA).
   DT-001 (Standard) is unchanged.
2. **Time penalties (7.5.5 and 9.5.3).** Standard: 2 minutes. Rapid (any regime): 1 minute (A.3).
   Blitz B.3: 1 minute (B.3 applies A.3). **Blitz B.2: not verifiable.** B.2 only says
   "Competition Rules shall apply" and does not reference A.3. In this case the decision includes a
   time-addition penalty with no amount, medium confidence, and escalation to the CA. The tree does
   not guess between 1 and 2 minutes.
3. **Counting.** `IncidentCounter` counts penalised decisions from DT-001, DT-002 and DT-003. A.5.2
   applies 7.5.5 ("as it is in standard chess", Arbiters' Manual). An A.5 illegal move that stood
   (no penalty) is not counted, which is consistent with ADR-004.
4. **Mate-material check** (`lib/domain/services/mate-material.ts`, pure). Inputs are piece counts
   per side, with bishops split by square colour, or an optional FEN. Results:
   - **Definite cannot-mate:** the attacker has a lone king; or K+N or K+same-colour bishop(s)
     against a bare king; or the only pieces on the board are same-colour bishops.
   - **can-mate:** the attacker has a Q, R or P, or 2N / B+N / opposite-colour bishops. If any pawn
     is on the board, the result is marked position-dependent, and the arbiter must confirm the
     position is not blocked before a loss is suggested.
   - **unknown** for everything else (e.g. K+N vs K+N, K+B vs K+P, where a helpmate depends on the
     position). This leads to a consult-CA decision with no automatic result.
   - Counts are validated (pawns ≤ 8, promotions consistent). Stepper defaults of 0 are only used
     after an explicit "confirmed" answer.
5. **Flag fall (DT-004).** A result reached before the flag was noticed stands. A player who
   completed the required moves does not lose on time (6.4). For both flags, the first-fallen flag
   indicator decides. If the order is unknown: Guidelines III.3.1 applies (only when announced, no
   increment, not blitz); otherwise consult the CA. The arbiter-call vs claim wording differs per
   regime (6.8 vs A.5.3/A.5.5), but the outcome is the same under the 2023 Laws, so no extra question
   is asked.
6. **Chess library.** `chess.js` (BSD-2, 1.4.0) handles FEN validation, SAN replay, and legal
   en passant detection. It is used only in `lib/infrastructure/chess/chess-js-position-port.ts`,
   which implements the domain port `ChessPositionPort` (`lib/domain/services/position-analysis.ts`).
   `DecisionEngine` receives the port through injection. Trees only receive the computed analysis,
   so they stay pure and testable without the library. Position keys are: placement + side to move +
   castling rights (kept only when the king and rook are on their original squares) + en passant
   square (only if a legal en passant capture exists).
7. **Automatic repetition checks are advisory.** Results from a move list or FEN list carry medium
   confidence and a reminder to verify in the presence of both players (Manual 9.2). The 75-move
   check is only computed from a move list. A FEN-supplied halfmove clock is not trusted, so it leads
   to a consult-CA decision.

## Consequences

- A new runtime dependency (~50 KB gzip) is used only for the optional advanced input.
- The arbiter will see many minor-piece endings as "consult CA". This is deliberate: the system
  never claims certainty beyond what the counts prove.
- The Blitz B.2 penalty amount stays an open question until confirmed by FIDE/JCF material or
  tournament regulations. A tournament-level override can be added when tournament management
  exists (Milestone 6).
- Draw-claim incidents record the claimant as `Incident.playerColor`, so an incorrect-claim time
  addition appears in that player's penalty history. Fivefold/75-move incidents have no player and
  appear in the "unknown" bucket.
