# Current Progress

**Last updated:** 2026-10-07
**Working branch:** `feature/m4-and-review-fixes`. It is not merged to `main`. Pushed to `origin` only if a later note says so.

This file is the handoff for a fresh Claude session. Do not rely on conversation history.
`docs/IMPLEMENTATION_STATUS.md` is a stale 2024 snapshot. Use this file and `docs/progress/milestones/` instead.

## Completed work

- **Milestones 0–3:** foundation, rule search, DT-001, incident report, incident log.
  - A review found serious problems; they were fixed and re-reviewed. See `milestones/milestone-0-3-remediation.md`.
- **Milestone 4:** DT-002 to DT-005, mate-material check, repetition analysis. See `milestones/milestone-4.md`.
- **Milestone 5:** Google Gemini via Next.js server routes `/api/llm/{reason,classify}` (ADR-007). See `milestones/milestone-5.md`.
  - Decision trees keep priority over the LLM.
  - LLM output is checked by a deterministic validator (ADR-002); invalid output becomes "consult the CA".
  - AI decisions stay `pending` and are not counted as applied penalties.
  - Fair-play text is never sent, whether by category or by `mentionsFairPlay()`. The server enforces this too.
  - In production the routes fail closed without `LLM_ACCESS_TOKEN`, unless `LLM_ALLOW_UNAUTHENTICATED=1`.
  - Reviewed three times; final verdict MERGE.
- **Milestone 6:** tournament profile, rounds/games/players, ruleset snapshot, regulations, home screen (ADR-006). See `milestones/milestone-6.md`.
- **Milestone 7:** round checklist (§26), Dexie v7, guarded start/end round (ADR-008). See `milestones/milestone-7.md`.
  - Reviewed, fixed and re-reviewed; verdict MERGE.

## User decisions (2026-10-07)

- **Deferred for now (do not implement unless the user asks):**
  - **Voice input** (part of Milestone 8).
  - **Multilingual support.**
  - **Further tournament-management features.** Tournament management itself is already implemented in M6.
- **Deploy once:** the user wants to try a deployment once the work before those items is finished, i.e. now that M5–M7 are merged.
  - Deploying is outward-facing. **Confirm the target, account and env with the user before deploying.**
  - The LLM routes need a Node server. A static export would not work, so Vercel is the natural fit.
  - Build command: `npm run fetch-models && npm run build`. The prebuild step fails if the embedding model is missing.
  - Required env: `GEMINI_API_KEY`, plus either `LLM_ACCESS_TOKEN` or `LLM_ALLOW_UNAUTHENTICATED=1` behind platform authentication. See README and `.env.example`.
- **Model change (requested earlier):** the user will change the classification and reasoning models in a later task. Only `GEMINI_MODEL_CLASSIFIER` and `GEMINI_MODEL_REASONING` (env) and the defaults in `lib/infrastructure/llm/server/config.ts` need to change. See `milestones/milestone-5.md` → "Changing models later".

## Important implementation decisions

Full text is in `docs/decisions/`. Do not re-decide these in conversation.

- Decision support only: the arbiter makes the final ruling. The UI uses 判断支援/推奨 (decision support / recommendation) wording and a disclaimer.
- **ADR-001:** stack (Next.js 14, TypeScript, Dexie, PWA). ADR-007 supersedes it for the LLM provider: Gemini through the server.
- **ADR-002:** the decision tree / LLM boundary and LLM output validation.
- **ADR-003:** offline rule search.
  - Japanese tokenization.
  - A pinned, self-hosted multilingual embedding model.
  - The `RuleSource` entity.
- **ADR-004:** explicit ruleset, with no default competition type. `IncidentCounter` counts only incidents that received a penalty.
- **ADR-005:** Rapid/Blitz trees, a conservative mate-material check, and chess.js behind a port.
- **ADR-006:** tournament management, game ids `{t}:r{n}:b{board}`, sourced overrides, a ruleset snapshot on each incident.
- **ADR-007:** Gemini via server route, plus its access control, rate limit, daily cap, deadline and fair-play rules.
- **ADR-008:** the round checklist.
  - Templates are code, and customisation stores references to them.
  - Dexie v7. v6 is unused, and future schema versions must be ≥ 8.
- **Citations:** every citation is quoted verbatim from `docs/reference/rules/` PDFs and locked by `__tests__/citations.test.ts`. Never add a ruling without a verified source.
- **Development cycle** (`.claude/rules/development-cycle.md`):
  - Implement, then run checks, then a separate read-only reviewer agent, then fixes, then re-review.
  - Merge only after a MERGE verdict.
  - Run parallel units in worktrees.

## Relevant files

- **Domain:**
  - `lib/domain/decision-engine/index.ts`
  - `lib/domain/decision-trees/`
  - `lib/domain/llm/` (output validator, quote match, keyword classifier, ports)
  - `lib/domain/services/` (incident-counter, mate-material, fair-play, round-checklist, round-planning, game-context, …)
  - `lib/domain/rules/citations.ts`
- **Application:** `lib/application/` (rule-ingestion, rule-library, csv-export, llm-classification, round-checklist, tournament-management)
- **Infrastructure:**
  - `lib/infrastructure/db/schema.ts` (Dexie v1–v3, v5, v7)
  - `lib/infrastructure/llm/` (client, assist port, `server/` config, handler, rate limiter, Gemini client)
  - `lib/infrastructure/ai/`
  - `lib/infrastructure/chess/`
- **API:** `app/api/llm/{reason,classify}/route.ts`
- **UI:**
  - `app/(tabs)/{home,report,search,log,settings,tournament}/`
  - `app/(tabs)/tournament/[id]/rounds/[round]/page.tsx`
  - `components/features/`, `components/checklist/`, `components/log/`
- **Scripts:**
  - `scripts/fetch-model-assets.mjs` (`npm run fetch-models`)
  - `scripts/check-model-assets.mjs` (prebuild)

## Tests and verification performed

On the Milestone 7 branch after merging M5, which is the content merged into `feature/m4-and-review-fixes`:

- `npx tsc --noEmit` is clean.
- `npx vitest run`: 48 files, 745 tests passed, stable over repeated runs.
- eslint reports 0 errors.
- `ALLOW_MISSING_MODEL=1 npm run build` succeeds, including the `/api/llm/*` routes and the checklist page.
- In a nested worktree, eslint must run as `npx eslint --no-eslintrc -c .eslintrc.json --ext .ts,.tsx app components lib __tests__`.

## Known issues

- **Illegal-move count:** it follows the *suggested* decision. There is no "applied / not applied" confirmation yet (ADR-004). AI decisions stay `pending` until edited.
- **Ad-hoc game ids** contain the local date, so their history splits at midnight.
- **Blitz B.2 time penalty:** the literal reading is 2 minutes, and the app shows it as "要確認" (needs confirmation). Federation practice is unconfirmed.
- **Search:**
  - Thresholds have not been tuned on real PDFs.
  - English precision is weak.
  - Nothing warms the model cache offline.
- **LLM:**
  - It has not been tested against the real Gemini API.
  - The rate limit and daily cap are per instance. Set Google Cloud quotas and a billing budget.
  - Strict quote matching may reject usable answers.
- **Not implemented:**
  - 50-move claim (9.3);
  - dead position as its own incident type;
  - separate round-exclusion and point-deduction penalty types (§25);
  - a Game Detail screen;
  - restoring a single removed checklist item.
- `npm install` can drop platform-specific bindings (rolldown, lightningcss) from `package-lock.json`. Use `npm ci`.

## Unresolved questions

- Whether the user's federation applies 1 or 2 minutes for Blitz B.2 (adequate supervision).
- **Deployment:** target platform, account, domain, and how the AI routes are protected (access token or platform auth). Ask the user.

## Next steps

1. **Deployment (Milestone 10.1) once the user confirms the details.**
   - Add the platform config (e.g. `vercel.json` with the build command above) and set the env vars.
   - Deploy, then check HTTPS, PWA install and the AI routes in production.
2. Later, if the user wants:
   - **Milestone 8 without voice input:** clock guide, player Q&A mode, UX polish.
   - **Milestone 9:** Playwright E2E, performance.
   - **Milestone 10.2/10.3:** user and developer docs.

## Information a fresh Claude session needs to continue

1. Read `CLAUDE.md`, this file, `docs/progress/milestones/*`, then the design docs and ADRs for the next task.
2. Check `git log --oneline -15` on `feature/m4-and-review-fixes`, and `git worktree list`.
3. Do not edit `docs/requirements/product-requirements.md` for implementation convenience.
4. Keep chess rule judgment in `lib/domain/` only.
   - No LLM calls in deterministic code.
   - Competition type, regime and rules version are always explicit inputs.
5. Verify any new rule citation verbatim against `docs/reference/rules/` PDFs. Extract text with `pdfjs-dist/legacy/build/pdf.mjs`.
6. After each milestone, write `docs/progress/milestones/milestone-N.md` and update this file.
