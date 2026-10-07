# Milestone 6: Tournament Management — Progress Summary

**Branch/worktree base:** `feature/m4-and-review-fixes` (bb0f8ef). Decision record: ADR-006.

## Completed work

- **6.1 Tournament profile.** Create/edit form (`components/tournament/TournamentProfileForm.tsx`)
  with name, dates, venue, chief arbiter, total rounds, competition type, supervision regime
  (Rapid/Blitz), rules version, time control (initial, increment, delay) and an optional, sourced
  Blitz B.2 time-penalty override. Validation and building are pure domain
  (`lib/domain/services/tournament-profile.ts`). Active tournament stored in `appState`
  (`activeTournamentId`).
- **6.2 Rounds, games, players.** `Round` (pending/active/completed), `PlayerProfile`,
  `Game.roundId` / `Player.id`. Deterministic IDs (`{t}:r{n}`, `{t}:r{n}:b{board}`). Bulk
  "Round N, boards a–b" creation that only adds missing games (`round-planning.ts`,
  `TournamentService`). Per-board white/black assignment that links or registers players.
- **Report flow.** With an active tournament the game-context step is round chips + board grid
  (1–2 taps), with the ruleset derived from the tournament (`deriveRulesetFromTournament`, no
  defaults). The ad-hoc date-based context (ADR-004) remains as fallback. The incident store accepts
  `gameId` (tournament game) or `context` (ad-hoc).
- **Override in trees.** `RulesetContext.tournamentOverrides` → DT-002 first offence and DT-005
  incorrect threefold claim. With an override for Blitz B.2: amount applied, tournament regulation
  cited first, "大会規定: N分（出典: 大会規定 …）", no escalation. Without: ADR-005 behaviour unchanged.
- **6.3 Regulations.** Settings tournament-regulations upload enabled for the active tournament;
  search passes the active tournament id (tournament > JCF > FIDE).
- **6.4 Home.** Report button first, active tournament card with round status and CA-escalation
  count, switcher, quick actions 報告/検索/ログ, recent incidents of the active tournament,
  decision-support notice.
- **Pages:** `/tournament`, `/tournament/new`, `/tournament/[id]`.
- **Schema:** Dexie `version(5)` (rounds, players, games `[tournamentId+round]`). v4 unused; v6
  reserved for Milestone 5.

## Important decisions (ADR-006)

- Overrides must be explicit and sourced (document required); only consumed where a tree documents
  it; accepted only for Blitz + competition-rules.
- Tournament game IDs contain no date → ADR-004 midnight-split follow-up resolved for tournament
  games (ad-hoc path unchanged).
- Tournaments with recorded incidents cannot be deleted; deleting removes rounds, players and
  tournament rule sources, keeps games.
- Uploaded tournament regulations are `RuleSource`/`Rule` rows with `tournamentId`; the
  `Tournament.regulations` array stays empty.

## Relevant files

- Domain: `lib/domain/entities/{tournament,game,round}.ts`, `lib/domain/repositories.ts`,
  `lib/domain/services/{tournament-profile,round-planning,game-context}.ts`,
  `lib/domain/rules/time-penalty.ts`, `lib/domain/decision-trees/{illegal-move-fast-shared,dt-002-*,dt-005-*}.ts`,
  `lib/domain/decision-engine/index.ts` (one field + pass-through only)
- Infra/app: `lib/infrastructure/db/{schema,tournament-repository}.ts`,
  `lib/application/{tournament-management,home-summary,rule-library}.ts`,
  `lib/stores/{tournament-store,incident-store}.ts`
- UI: `app/(tabs)/{home,report,search,settings,tournament}/**`, `components/tournament/*`
- Tests: `__tests__/tournament/*` (9 files)

## Tests / verification

- `npx tsc --noEmit`, eslint (0 warnings), `npx vitest run` (32 files, 462 tests),
  `ALLOW_MISSING_MODEL=1 npm run build` — all pass.
- New tests: repository CRUD + active store + v3→v5 migration (fake-indexeddb), round/board bulk
  creation and transitions, TournamentService, profile validation, ruleset derivation (no
  defaults), B.2 override in DT-002/DT-005/engine/store, report context step (1 tap, 2 taps,
  inline board, ad-hoc fallback, incomplete ruleset), search with active tournament, settings
  upload with tournamentId, home page, profile form.
- An independent reviewer subagent was launched but was cut off by a rate limit; no review
  findings were received. The coordinator will run the review.

## Known issues / limitations

- Migration test starts from v3 (the latest schema on the base branch); there was no v4.
- Ad-hoc reports still use date-based IDs (midnight split remains there).
- Changing a tournament's ruleset affects later re-evaluations of its pending incidents.
- Not implemented from §7 / domain-model: team format, FBO, board count, default time, clock
  model, tournament status; player rating/FIDE ID editing UI (only name in the UI).
- Home recent-incidents loads the whole incident log and filters (fine at tournament scale).
- ADR number 006 may collide with an ADR created concurrently by the Milestone 5 work.

## Unresolved questions

- Should the B.2 override also be accepted for other tournament-specific amounts (for example,
  Rapid organiser overrides)? Currently it is not, by design.
- Should completing a round be blocked while incidents are pending/escalated (Milestone 7)?

## For a fresh session

- The report flow's tournament path: `app/(tabs)/report/page.tsx` (context step) +
  `components/tournament/TournamentGamePicker.tsx`; submission passes `{ gameId }`.
- To add an override: extend `TournamentOverrides`, validate in `tournament-profile.ts`, consume
  in the tree via `RulesetContext.tournamentOverrides`, cite with `tournamentCitation`.
- Milestone 7 checklist: attach to `Round.id`; use `TournamentService.changeRoundStatus`.
