# J1b-5: DT-005 Draw Claim (threefold + 50 moves), DT-006 Automatic Draw, side to move without the clock

**Status:** Implemented and reviewed on branch `feature/fact-catalog`. Review verdict: FIX REQUIRED (1 must-fix, 3 should-fix) → fixed → re-review APPROVE.

**Date:** 2026-10-08

**Design:** [fact-model.md](../../design/fact-model.md) §3.5 "Implementation (J1b-5)". **Decision record:** [ADR-014](../../decisions/ADR-014-draw-dt-touch-move-game-history.md) §1 (draw trees) and §2 (side to move).

## Completed work

- **DT-005 Draw Claim** (`lib/domain/decision-trees/dt-005-draw-claim.ts`, replaces `dt-005-repetition.ts`):
  - `DrawClaimTree` with the claim basis from the subtype (`drawClaimBasisOf`): threefold (9.2) or **fifty-move (9.3, new)**.
  - Shared procedure: claimant, last mover, claim timing (9.x.1 / 9.x.2), written move ("Make your claim legal"), touched piece (9.4), check (manual or history), correct → draw (9.5.2), incorrect → 9.5.3 with the competition-type / tournament time, unknown → CA.
  - Fifty-move automatic check: halfmove clock of the target position ≥ 100 plies (`FIFTY_MOVES_PLIES`); the target is the final position or the position after the written move. Incomplete histories: "met" only (ADR-014 §4).
  - A claim whose history also shows 5 occurrences or 150 plies notes a possible 9.6 draw and recommends escalation.
  - The persisted id stays `DT-005-repetition`.
- **DT-006 Automatic Draw** (`dt-006-automatic-draw.ts`, new, id `DT-006-automatic-draw`): fivefold (9.6.1) and 75 moves (9.6.2), moved from the old DT-005. Checkmate precedence: from the history, or the new manual result `met-checkmate`.
- **Shared helpers** (`draw-shared.ts`, new): `DrawTreeInput`, `resolveCheck` (with `validate` before and `afterConfirmed` after the board confirmation), `confirmedHistory`, `confirmText`, `autoLine`, `automaticDrawNotes`, `unknownCheck`.
- **Side to move (ADR-014 §2):** question `claimantHasMove` ("自分の時計が動いている") removed; new question `lastMover` ("クレームの直前に、盤上で最後に手を指したのはどちらですか？"). The confirmed history's side to move is used when no `lastMover` was given; a disagreement between the two sends the case to the manual check and re-asks `lastMover`.
- **Entities:** `DrawSubtype` += `fifty-move-claim`, `agreement`, `stalemate`, `dead-position`; `DrawClaimBasis`, `drawClaimBasisOf`; `DrawClaimFacts.lastMover`; `ConditionCheck` += `met-checkmate`; `DecisionTreeId` += `DT-006-automatic-draw`. `claimantHasMove` and `lastMoveCheckmate` stay in the type as `@deprecated` for stored incidents only.
- **Questions:** `lastMover`, `fiftyMoveCheck` (new); `claimMode` labels basis-neutral (9.2.x / 9.3.x); `touchedPiece` reworded ("その手番で、動かす・取る意思で", help excludes adjusting and accidental contact); `seventyFiveCheck` gets `met-checkmate`; `lastMoveCheckmate` removed. `DRAW_SUBTYPE_LABELS` lists the 8 kinds of ADR-014 §1.
- **Answers:** changing `drawSubtype` clears `conditionCheck`, `historyConfirmed` and `lastMoveCheckmate` (before the answers are applied, so order-independent). `met-checkmate` is accepted only for `seventyFiveCheck`. Re-selecting 判定する on `fiftyMoveCheck` also restarts the board confirmation.
- **Engine:** threefold/fifty → DT-005, fivefold/75 → DT-006; the written move is replayed for both claim bases. `agreement`, `stalemate`, `dead-position`, `other` have no tree (situation note, non-DT path).
- **Catalogue:** `dr.kind` maps one to one; `dr.last-mover` → `lastMover`; `dr.manual-reconstruction` also covers `fiftyMoveCheck`.
- **Citations (verbatim, locked by tests):** FIDE 9.3 (p.33), FIDE 11.12 (p.37), JCF NA p.67 "前提: 自分の手番であること" and "三回同一局面のケースは4回目でも主張可能。50手ルールは51手目以降でも主張可能".
- **Other:** quick report "50手ルールのクレーム"; keyword classifier `50手` → `fifty-move-claim` (not `150手`).
- **Docs:** fact-model §3.5 "Implementation (J1b-5)", §3.4 rows; ADR-014 status; `incident-classification.md` §8.1 (subtypes and handlers aligned with ADR-014); `mvp-scope.md` DT table.

## Important implementation decisions

- **`lastMover` is asked in the first round**, because the history is entered later (in the check round). This keeps the quick "not your move" answer. When a history check is already pending, `lastMover` is not asked and the history decides.
- **Conflicting side-to-move sources never decide.** The history is dropped (manual check) and `lastMover` is re-asked.
- **The 75-move checkmate is part of the reconstruction result** (`met-checkmate`), not a separate judgment question. It is a DT-only value; the catalogue fact has no equivalent yet (J1c).
- **Legacy data:** stored `claimantHasMove` is ignored (the tree asks `lastMover`); stored `met` + `lastMoveCheckmate: true` keeps checkmate precedence; old fivefold/75 decisions keep `DT-005-repetition`.
- **No Dexie schema change:** the new fields are optional and not indexed.

## Relevant files

- `lib/domain/decision-trees/{draw-shared,dt-005-draw-claim,dt-006-automatic-draw}.ts`
- `lib/domain/decision-engine/index.ts`, `lib/domain/follow-up.ts`, `lib/domain/entities/{incident,decision}.ts`, `lib/domain/facts/catalog.ts`, `lib/domain/rules/citations.ts`, `lib/domain/llm/keyword-classifier.ts`
- Tests: `__tests__/dt-005-draw-claim.test.ts` (renamed from `dt-005-repetition.test.ts`), `__tests__/dt-006-automatic-draw.test.ts`, `__tests__/draw-claim.integration.test.ts` (new; 100 quiet plies through chess.js); updated engine, unknown-answers, game-history, citations, catalogue, classification and tournament tests.

## Tests and verification

- `npx tsc --noEmit`: clean.
- ESLint (`--no-eslintrc -c .eslintrc.json`): 0 problems.
- `npx vitest run`: 61 files, 1027 tests passed (968 before J1b-5).
- `npm run build`: succeeds.
- Citations: FIDE 9.3 / 11.12 and JCF p.67 extracted with pdfjs-dist and checked verbatim (also by the reviewer).

## Review

Separate read-only reviewer agent.

- **First pass: FIX REQUIRED.**
  - **M1:** a stored 75-move incident with "75手以上" and the old checkmate question unanswered or "わからない" became a draw. Fix: the new answer records `lastMoveCheckmate: false`; a manual `met` without it re-asks `seventyFiveCheck`; the stale unknown is removed.
  - **S1:** with a history pending, 9.4 / "Make your claim legal" were ruled before the side to move was known. Fix: the `sideKnown` gate; the history is confirmed first.
  - **S2:** "50手目にイリーガルムーブ" was suggested as a 50-move claim. Fix: `50\s*手(?!目)`.
  - **S3:** `current.md` was not updated. Done.
  - **Nits:** N1 dropped the manual's "whose clock is running" quote from "not your move"; N2 added JCF p.67 to a correct threefold claim. N4 (redundant `lastMover` after an inconclusive confirmed history) was left as is, because it is safe.
- **Re-review: APPROVE.** No new problems; every draw or penalty path goes through the side-to-move gate.

## Known issues

- **`lastMover` unknown** gives manual-review even if the arbiter could enter a history later; the arbiter has to answer the last mover (or change the answer) to continue.
- **`met-checkmate` has no catalogue fact value.** `dr.manual-reconstruction = met` maps to "75 moves, not checkmate". Revisit when facts answer DT questions (J1c).
- **9.3.1 with a checkmating written move** is not treated specially (the claimant would simply play the mate).
- **Dead position** as its own incident type is still not implemented (no tree, ADR-014 §1).
- `Game.pgn` is still not wired; the history comes from the pasted text.

## Next

- J1b-6: DT-007 touch move and separate counting (ADR-014 §6).
- J1b-7: `TimeControl` periods (ADR-014 §7).
- ADR-014 §3 (`game.end-event` replacing `gameEnded` / `gameEndedBeforeFlag`) is not assigned to a slice yet; do it with J2 (UI) or before J1c.
