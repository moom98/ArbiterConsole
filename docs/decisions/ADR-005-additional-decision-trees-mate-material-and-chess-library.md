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
   Blitz B.3: 1 minute (B.3 applies A.3). **Blitz B.2:** B.2 brings in the Competition Rules
   (7.5.5 / 9.5.3: two minutes). Only B.3 applies A.3's one-minute rule, so the literal reading for
   B.2 is **2 minutes**. Because this reading is not stated explicitly, the decision shows
   "2分（文言上の解釈・要確認）" as the suggested amount with medium confidence, so the arbiter can
   act quickly. It does not auto-apply the amount (no `timeAdjustmentSeconds`) and it escalates for
   confirmation with the CA or the event regulations.
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
6. **Chess library.** `chess.js` (BSD-2, pinned to exactly 1.4.0) handles FEN validation, SAN replay, and legal
   en passant detection. It is used only in `lib/infrastructure/chess/chess-js-position-port.ts`,
   which implements the domain port `ChessPositionPort` (`lib/domain/services/position-analysis.ts`).
   `DecisionEngine` receives the port through injection. Trees only receive the computed analysis,
   so they stay pure and testable without the library. Position keys are: placement + side to move +
   castling rights (kept only when the king and rook are on their original squares) + en passant
   square (only if a legal en passant capture exists).
7. **Automatic repetition checks are advisory.** For a 9.2.1 claim, the automatic check needs the
   written move. If it is left blank, the app asks for it and never judges the current position
   instead. The history must end with the claimant to move. The 75-move check uses the **maximum**
   halfmove clock over the whole replay, not only the last position. "Checkmate takes precedence"
   is taken from the position where 150 plies were first reached. Results from a move list or FEN list carry medium
   confidence and a reminder to verify in the presence of both players (Manual 9.2). The 75-move
   check is only computed from a move list. A FEN-supplied halfmove clock is not trusted, so it leads
   to a consult-CA decision.

## Consequences

- A new runtime dependency (~50 KB gzip) is used only for the optional advanced input.
- The arbiter will see many minor-piece endings as "consult CA". This is deliberate: the system
  never claims certainty beyond what the counts prove.
- The Blitz B.2 penalty amount stays an open question until confirmed by FIDE/JCF material or
  tournament regulations. A sourced tournament-level override was added in Milestone 6 (ADR-006);
  without it the behaviour above is unchanged.
- Draw-claim incidents record the claimant as `Incident.playerColor`, so an incorrect-claim time
  addition appears in that player's penalty history.
- Result outcomes are not offences and are shown in a separate "対局結果" section of the penalty
  history: draws (from any tree) and all flag-fall (DT-004) outcomes. They never appear in an
  offender's list or in the legacy "違反者不明" bucket. `Penalty.playerColor` is optional and is
  left out for draws.
- Frequent trees (flag fall, threefold, fivefold, 75-move) can be reported from quick tiles that
  carry the subtype. Common flows then need 2–3 answer rounds. Incidents outside the trees
  (e.g. "other") require a short situation note.
- In A.5 / B.3, if the opponent has already moved after an uncorrected promotion, the decision is
  "wait for the next move" (A.5.4). An illegal move that stood carries a note on the A.5.4
  both-kings-in-check procedure.
