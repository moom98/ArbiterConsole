# ADR-006: Tournament Management, Tournament Game IDs and Sourced Tournament Overrides

**Status:** Accepted

**Date:** 2026-10-07

---

## Context

Milestone 6 adds tournament management (requirements §7, §8, §6; implementation plan Milestone 6).
Before it, the report flow asked for competition type, regime, rules version, round and board on
every report and stored an ad-hoc tournament/game whose IDs contained the local date (ADR-004).
Two follow-ups were left open:

- ADR-004: a game spanning midnight splits its illegal-move history (date in the game ID).
- ADR-005: the Blitz B.2 time penalty (7.5.5 / 9.5.3) cannot be confirmed from the sources; the
  tree shows "2分（文言上の解釈・要確認）" and escalates. A tournament-level value was deferred.

`.claude/rules/domain.md` rule 5 requires tournament rules and rule versions to be explicit inputs.

## Decision

1. **Tournament profile.** `Tournament` keeps its required ruleset fields (`competitionType`,
   `rulesVersion`, `supervisionRegime` for Rapid/Blitz) and gains optional profile fields (venue,
   chief arbiter, total rounds, delay). `validateTournamentProfile` (pure domain) requires every
   ruleset field and the time control to be entered; the competition type is never inferred from
   the time control (§7).
2. **Repositories.** Pure interfaces in `lib/domain/repositories.ts` (Tournament, Round, Game,
   Player, ActiveTournamentStore); Dexie implementations in
   `lib/infrastructure/db/tournament-repository.ts`. The active tournament id is stored in
   `appState` (`activeTournamentId`). Use cases live in `TournamentService`
   (`lib/application/tournament-management.ts`).
3. **Rounds and games.** `Round` has `pending → active → completed` (Milestone 7's checklist will
   attach to `Round.id`). Round and game IDs are deterministic: `{tournamentId}:r{n}` and
   `{tournamentId}:r{n}:b{board}`. "Round N, boards a–b" bulk creation only adds missing games, so
   re-running it never overwrites player assignments or history. Players are stored as
   `PlayerProfile`; a game keeps a snapshot (`Player.id`, name, rating).
4. **Report flow.** When a tournament is active, the game-context step shows its rounds (current
   round preselected) and boards: one tap on a board (two when changing the round). The ruleset is
   derived from the tournament with `deriveRulesetFromTournament`; a missing regime or rules
   version blocks the step with an error and is never defaulted. Unknown boards can be created
   inline. The ad-hoc date-based path (ADR-004) remains the fallback when no tournament exists or
   the arbiter explicitly chooses it.
5. **Sourced overrides.** `Tournament.overrides` holds values the trees consume explicitly. Each
   value carries its source (`TournamentRuleReference`: document, optional article and verbatim
   quote); an override without a source document is ignored. The only override now is
   `blitzCompetitionTimePenaltySeconds` (ADR-005). It is only accepted for Blitz +
   competition-rules (B.2) tournaments. When set, DT-002 (first illegal move) and DT-005 (incorrect
   threefold claim) apply that amount (`timeAdjustmentSeconds`), cite the tournament regulation
   first (`source: "tournament"`) followed by FIDE B.2, show
   "大会規定: N分（出典: 大会規定 …）", and do not escalate. Without an override the ADR-005
   behaviour is unchanged. The engine receives overrides via `RulesetContext.tournamentOverrides`.
6. **Tournament regulations.** The Settings upload for tournament regulations is enabled for the
   active tournament (rule ingestion already requires `tournamentId`). Rule search passes the active
   tournament id, so its regulations are searched and ranked first (Tournament > JCF > FIDE); other
   tournaments' regulations are never included.
7. **Schema.** Dexie `version(5)` adds `rounds`, `players` and the `games` index
   `[tournamentId+round]`. Existing data needs no transformation (all new fields are optional);
   version 4 is unused and version 6 is reserved for Milestone 5.

## Consequences

- Tournament game IDs contain no date: the ADR-004 midnight-split follow-up is resolved for
  tournament games. Ad-hoc reports still use date-based IDs.
- Ad-hoc tournaments (`adhoc:*`) remain in the database for history but are hidden from the
  tournament list.
- A tournament with recorded incidents cannot be deleted (history must stay attributable).
  Deleting a tournament removes its rounds, players and tournament regulation sources.
- Editing a tournament's ruleset affects later evaluations of its games (including re-evaluation of
  pending follow-ups). Decisions already stored keep the rulesVersion they were made with.
- Further overrides (e.g. default time, draw-offer rules) must follow the same pattern: explicit,
  sourced, consumed only where a tree documents it.
