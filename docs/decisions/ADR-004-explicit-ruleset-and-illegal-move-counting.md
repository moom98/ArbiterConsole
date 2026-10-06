# ADR-004: Explicit Ruleset Context and Illegal-Move Counting

**Status:** Accepted

**Date:** 2026-10-06

---

## Context

Review of Milestones 2–3 found that:

- `DecisionEngine` defaulted to `"standard"` when no competition type was known, violating
  `.claude/rules/domain.md` rule 5 (rulesets must be explicit inputs).
- Facts that change the ruling (offending colour, clock pressed, …) were parsed from free text by
  substring matching, so wording decided penalties.
- The illegal-move count used for 7.5.5 counted every illegal-move report in the game, including
  reports that resulted in no penalty (clock not pressed, game already over, pending questions).
- Citations quoted pre-2023 wording ("first two … third illegal move") and non-existent text.

## Decision

1. **Explicit ruleset.** The engine requires `competitionType`, `rulesVersion` and, for Rapid/Blitz,
   a `SupervisionRegime`. Missing values return a `context-required` result; nothing is assumed.
   - `SupervisionRegime` maps to FIDE Laws 2023: Rapid `competition-rules` = A.4, `basic-rules` = A.5;
     Blitz `competition-rules` = B.2, `basic-rules` = B.3. (Requirements §17's "A.4 / A.5" match the
     2023 Rapid numbering; Blitz uses B.2 / B.3, so a neutral name is used.)
   - Only `FIDE-2023` is supported. Rapid/Blitz illegal moves return `not-supported` (consult CA)
     until their own trees exist; the Standard tree is never applied to them (§17).
2. **Structured facts only.** `Incident.playerColor` and `Incident.illegalMoveFacts` (subtype,
   clockPressed, gameEnded, opponentCanCheckmate) come from domain-defined follow-up questions.
   The free-text description is a memo and is never parsed for decisions.
3. **Counting.** `IncidentCounter` (pure domain) counts, per `gameId` × `playerColor`, only incidents
   whose DT-001 decision applied an illegal-move penalty (`time-addition-opponent` or `game-loss`).
4. **Standard tree (DT-001).** "Opponent already moved" is not a Standard branch (it belongs to Rapid
   A.5.2). Discovery after the game ends → result stands. Second offence → loss, unless the opponent
   cannot checkmate (draw, 7.5.5); if the arbiter cannot tell, a final consult-CA decision with no
   automatic penalty. The second-offence output lists the previously counted incidents (time +
   subtype) so the arbiter can verify the count. Subtypes 7.5.2/7.5.3/7.5.4 are explicit inputs;
   7.5.3 carries medium confidence (clock started in error: illegal move vs distraction).
5. **Citations** live in `lib/domain/rules/citations.ts` as verbatim quotes with edition and printed
   page, checked by `__tests__/citations.test.ts`. FIDE page numbers are Arbiters' Manual 2025
   printed pages (`pageDocument`), not pages of a standalone Laws edition.
6. **Ad-hoc game context.** Until tournament management (Milestone 6), the report flow collects
   competition type (+ regime), rules version, round and board; an ad-hoc `Tournament`/`Game` is
   persisted with deterministic IDs (date × ruleset × round × board) so history is keyed correctly.
   Every new report starts at the context step (pre-filled with the last values) so the arbiter
   confirms round/board with one tap or changes them.

## Consequences

- Reports need one extra tap to confirm the (remembered) game context.

### Known follow-ups

- **Count follows the suggested ruling.** The count reflects the app's *suggested* decision. If the
  arbiter rules differently, history will not reflect it until an "arbiter override / final ruling"
  is recorded on the incident.
- **Midnight game IDs.** Ad-hoc game IDs include the local date; a game spanning midnight would split
  its history. Resolved once tournament/round management (Milestone 6) supplies real game IDs.
