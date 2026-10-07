# Milestone 4: Additional Decision Trees

**Completed:** 2026-10-07
**Branch:** `feature/m4-and-review-fixes`
**Merge commit:** `bb0f8ef`
**ADR:** `docs/decisions/ADR-005-additional-decision-trees-mate-material-and-chess-library.md`

## Completed work

| Tree | File | Scope |
|---|---|---|
| DT-002 | `lib/domain/decision-trees/dt-002-illegal-move-fast-competition.ts` | Illegal move in Rapid A.4 / Blitz B.2 (competition rules). Rapid adds 1 minute (A.3). Blitz B.2 shows "2分（文言上の解釈・要確認）" (2 min, literal reading, needs confirmation): escalated, not applied automatically. |
| DT-003 | `lib/domain/decision-trees/dt-003-illegal-move-fast-basic.ts` | Illegal move in Rapid A.5 / Blitz B.3 (basic rules). Once the opponent has moved, the illegal move stands (A.5.2). A.5.4 promotion case. Both-kings-in-check note (Manual p.41). |
| DT-004 | `lib/domain/decision-trees/dt-004-flag-fall.ts` | Flag fall: 6.9, 6.4 move count, both flags fallen (III.3.1 only when applicable), differences by regime. |
| DT-005 | `lib/domain/decision-trees/dt-005-repetition.ts` | Threefold claim (9.2, 9.4, incorrect-claim penalty by regime), fivefold (9.6.1), 75-move rule (9.6.2, where checkmate on the last move takes precedence). |

- **Mate material** (`lib/domain/services/mate-material.ts`) is pure. It returns
  "cannot mate" only for unambiguous material; helpmate-possible combinations
  return "unknown", which leads to "consult the CA".
- **Repetition analysis** (`lib/domain/services/position-analysis.ts`) uses
  chess.js 1.4.0, pinned exactly, behind a domain port in
  `lib/infrastructure/chess/`:
  - Positions are compared on placement, side to move, castling rights, and en
    passant only when a legal capture exists.
  - The 75-move check uses the maximum halfmove clock over the whole replay.
- **IncidentCounter** counts DT-001, DT-002 and DT-003 penalties together. An
  A.5 illegal move that stood is not counted.
- **Report UI:**
  - Quick tiles for flag fall, threefold, fivefold and 75-move.
  - Piece-count steppers.
  - Optional FEN / move-list fields that accept PGN.
  - Conditional questions via `showWhen`.
  - A required note when "other" is chosen.
- **Result outcomes** (draws, flag-fall results) are kept out of offender penalty
  history and summary penalty counts and are shown as "対局結果".

## Verification

- tsc is clean, lint has 0 errors, the build succeeds, and **403 tests pass**.
- Two separate reviewers checked the work:
  - The chess-rules reviewer verified all 67+ citations verbatim against the PDFs.
  - The engineering reviewer covered routing, the chess.js isolation and the
    lockfile.
- After two rounds of fixes, both verdicts were MERGE.

## Known issues / follow-ups

- **Blitz B.2 penalty amount:** the literal reading is 2 minutes. It needs
  confirmation by the CA or event regulations. Milestone 6 adds a tournament
  override.
- Not implemented: 50-move claims (9.3), and dead position or insufficient
  material as separate incident types.
- Fivefold and 75-move results have no player attached and appear under "対局結果".
- Repetition analysis runs synchronously. 600 plies take about 250 ms in jsdom, so
  it is acceptable but should be watched on phones.
