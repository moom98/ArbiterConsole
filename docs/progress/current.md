# Current Progress

**Last updated:** 2026-10-07
**Working branch:** `feature/m4-and-review-fixes` (not merged to `main`, not pushed)

This file is the handoff for a fresh Claude session. Do not rely on conversation history.
`docs/IMPLEMENTATION_STATUS.md` is a stale 2024 snapshot. Use this file and `docs/progress/milestones/` instead.

## Completed work

- **Milestones 0–3:** foundation, rule search, DT-001, incident report, incident log.
  - A review found serious problems; they were fixed and re-reviewed. See `milestones/milestone-0-3-remediation.md`.
- **Milestone 4:** DT-002 to DT-005, mate-material check, repetition analysis. See `milestones/milestone-4.md`.

## In progress

Each is being built by a separate agent in a git worktree under `.claude/worktrees/`; nothing has been merged yet.

- **Milestone 5: LLM integration.**
  - **User decision:** use the **Google Gemini API**, called **only through a Next.js server route**. The API key stays in a server env var. This will be recorded as ADR-006.
  - Trees keep priority over the LLM.
  - LLM output is checked by a deterministic validator (ADR-002); invalid output becomes "consult the CA".
- **Milestone 6: Tournament management.**
  - Tournament profile, rounds and games, uploading tournament regulations, home screen.
  - Tournament overrides, such as the Blitz B.2 penalty amount, are explicit inputs that carry their source.
  - Dexie `version(5)`; Milestone 5 reserves `version(6)`.

## Important implementation decisions

Full text is in `docs/decisions/`. Do not re-decide these in conversation.

- Decision support only: the arbiter makes the final ruling. The UI uses 判断支援/推奨 (decision support / recommendation) wording and a disclaimer.
- **ADR-001:** stack (Next.js 14, TypeScript, Dexie, PWA). For the LLM provider, Milestone 5 / ADR-006 supersedes it: Gemini through the server.
- **ADR-002:** the decision tree / LLM boundary and LLM output validation.
- **ADR-003:** offline rule search.
  - Japanese tokenization and the main/related result split.
  - Multilingual embedding model, self-hosted and pinned.
  - `RuleSource` entity, and an explicit supersede or keep-both choice when importing a new edition.
- **ADR-004:** explicit ruleset, with no default competition type.
  - Structured incident facts.
  - `IncidentCounter` counts only incidents that received a penalty.
- **ADR-005:** Rapid/Blitz trees, a conservative mate-material check, and chess.js behind a port.
- **Citations:** every citation is quoted verbatim from `docs/reference/rules/` PDFs and locked by `__tests__/citations.test.ts`. Never add a ruling without a verified source.
- **Development cycle** (`.claude/rules/development-cycle.md`):
  - Implement, then run checks, then a separate reviewer agent (read-only), then fixes, then re-review. Merge only after a MERGE verdict.
  - Parallel units use worktrees with explicit file ownership.

## Relevant files

- **Domain:**
  - `lib/domain/decision-engine/index.ts`
  - `lib/domain/decision-trees/dt-00{1..5}-*.ts`
  - `lib/domain/rules/citations.ts`
  - `lib/domain/rules/time-penalty.ts`
  - `lib/domain/follow-up.ts`
  - `lib/domain/services/` (incident-counter, mate-material, position-analysis, penalty-history, game-context, rule-priority)
- **Application:** `lib/application/` (rule-ingestion, rule-library, csv-export, incident-labels)
- **Infrastructure:**
  - `lib/infrastructure/db/schema.ts` (Dexie v1–v3)
  - `lib/infrastructure/db/incident-repository.ts`
  - `lib/infrastructure/ai/` (tokenizer, fulltext, vector, hybrid search)
  - `lib/infrastructure/chess/`
  - `lib/infrastructure/pdf/`
  - `lib/infrastructure/embeddings/`
- **State:** `lib/stores/incident-store.ts` (injectable via `createIncidentStore`)
- **UI:**
  - `app/(tabs)/{home,report,search,log,settings}/page.tsx`
  - `components/features/DecisionDisplay.tsx`
  - `components/features/FollowUpQuestions.tsx`
  - `components/log/`
  - `components/ui/`
- **Scripts:**
  - `scripts/fetch-model-assets.mjs` (`npm run fetch-models`)
  - `scripts/check-model-assets.mjs` (runs as prebuild)
  - `scripts/copy-runtime-assets.mjs`

## Tests and verification performed

On `feature/m4-and-review-fixes` at `bb0f8ef`:

- `npx tsc --noEmit` is clean.
- `npx vitest run`: 22 files, 403 tests passed.
- `npm run lint`: 0 errors; only prettier warnings remain.
- `ALLOW_MISSING_MODEL=1 npm run build` succeeds.

## Known issues

- The illegal-move count follows the *suggested* decision, not the arbiter's actual ruling. There is no "applied / not applied" confirmation yet (ADR-004).
- Ad-hoc game ids contain the local date, so a game's history splits at midnight. Tournament games in Milestone 6 address this.
- **Blitz B.2 time penalty:** the literal reading is 2 minutes, and the app shows it as "要確認" (needs confirmation). The user has not confirmed federation practice.
- **Search:**
  - Thresholds have not been tuned on real PDFs.
  - English precision is weak.
  - The empty-state message still shows when only related hits exist.
  - Nothing warms the model cache offline.
- **Not implemented:** 50-move claim (9.3), dead position as its own incident type, separate round exclusion and point-deduction penalty types (§25), and a Game Detail screen.
- **`npm install` can drop platform-specific bindings** (rolldown, lightningcss) from `package-lock.json`. Use `npm ci`, and check the lockfile diff after adding dependencies.
- `npm run build` needs the embedding model (`npm run fetch-models`) or `ALLOW_MISSING_MODEL=1`.

## Unresolved questions

- **Model change (requested 2026-10-07):** the user will change the classification and reasoning models in a later task. Milestone 5 must keep the model ids in one server-side config, read from env, so the change only touches config and infrastructure.

- Whether the user's federation applies 1 or 2 minutes for Blitz B.2 (adequate supervision): illegal moves and incorrect draw claims.
- **Milestone 10 deployment:** the target and the timing of any public deployment must be confirmed with the user. It is an outward-facing, irreversible action.

## Next milestone

After Milestones 5 and 6 are reviewed and merged:

- **Milestone 7:** round checklist. The `Round` model from Milestone 6 must stay compatible.
- **Milestone 8:** voice input, clock guide, player Q&A mode, UX polish.
- **Milestone 9:** E2E (Playwright), performance, bug fixes.
- **Milestone 10:** deployment and docs. **Ask the user before deploying.**

## Information a fresh Claude session needs to continue

1. Read `CLAUDE.md`, this file, `docs/progress/milestones/*`, then the design docs and ADRs for the next milestone.
2. Check `git log --oneline -15` on `feature/m4-and-review-fixes`, and `git worktree list` for unmerged agent branches.
3. Do not edit `docs/requirements/product-requirements.md` for implementation convenience.
4. Keep chess rule judgment in `lib/domain/` only.
   - No LLM calls in deterministic code.
   - Competition type, regime and rules version are always explicit inputs.
5. Verify any new rule citation verbatim against `docs/reference/rules/` PDFs. Extract text with `pdfjs-dist/legacy/build/pdf.mjs`.
6. After each milestone, write `docs/progress/milestones/milestone-N.md` and update this file.
