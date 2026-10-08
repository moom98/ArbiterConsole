# Current Progress

**Last updated:** 2026-10-08
**Main line:** `main`. PR #1 (M0–M7 + Cloudflare config) was merged on 2026-10-08. New work branches from `main`.
- The deployment config (ADR-009) is in `main` via PR #1. The `account_id` arrived in a follow-up PR.

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
- **Deploy once (decided 2026-10-08):**
  - **Target:** Cloudflare Workers via OpenNext (ADR-009).
  - **AI protection:** `LLM_ACCESS_TOKEN`.
  - **Branch:** production comes from `main` after the user merges PR #1.
  - **First deploy without an embedding model** (keyword search only), because the 118 MB model exceeds the 25 MiB per-file limit on Workers. **Superseded by ADR-010 (Gemini Embedding), see below.**
  - **Deploy steps (README → Deploy):**
    1. The user runs `npx wrangler login`.
    2. `npx wrangler secret put GEMINI_API_KEY` and `npx wrangler secret put LLM_ACCESS_TOKEN`. The user enters the values.
    3. `npm run cf:deploy`. Since ADR-010 there is no model and no `ALLOW_MISSING_MODEL`.
  - Deploying is outward-facing. **Get the user's go-ahead before running `cf:deploy`.**
  - **Status: deployed 2026-10-08** to https://arbiter-console.arbiterconsole.workers.dev.
    - Cloudflare account `ArbiterConsole` (`account_id` in `wrangler.jsonc`), deployed from `main` at `274284e`.
    - The first version was `481a6ba0-…`.
    - **Latest deploy:** version `7221140b-…`, from `main` at `d943ae9` (PR #3, Gemini embeddings), on 2026-10-08.
      - Production checks: all pages return 200; all 48 precache URLs return 200; `/ort/` is gone; `/api/llm/{reason,classify,embed}` return 401 without the token.
      - Right after a deploy, Cloudflare can briefly serve the previous `sw.js`. Re-check after about 1 minute.
    - The secrets `GEMINI_API_KEY` and `LLM_ACCESS_TOKEN` were set by the user.
    - The workers.dev subdomain `arbiterconsole` is created automatically the first time the account opens the Workers & Pages dashboard.
  - **Build-time safety (ADR-009):**
    - `cf:build` aborts if any `.env*` file other than `.env.example` exists.
    - Local Workers values go in `.dev.vars`; production values are set with `wrangler secret put`.
    - Do not set `TRUST_PROXY` on Workers.
- **Semantic search via Gemini Embedding (decided 2026-10-08, ADR-010):**
  - The user chose option A, Gemini embeddings, over option B, hosting the model on R2.
  - Semantic search now needs the network and the access token; keyword search remains the offline fallback.
  - Merged via PR #3 and deployed (see above). See `milestones/gemini-embeddings.md`.
  - **Pending user verification on a real device** (needs the real token):
    - PDF import or 意味検索用データを作成 fills the per-source embedding count;
    - natural-language searches return vector hits.
    - Then tune `vectorMinSimilarity` (0.65, provisional) from the user's examples.
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
- **ADR-009:** Cloudflare Workers through OpenNext.
  - Next.js 14.2.35 with `@opennextjs/cloudflare@~1.15.1`. Do not bump to 1.16+ without moving to Next 15.5+/16.
  - Transformers.js and onnxruntime-node are aliased out of the server bundle.
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
- **API:** `app/api/llm/{reason,classify,embed}/route.ts`
- **Semantic search (ADR-010):**
  - `lib/infrastructure/embeddings/generator.ts` (Gemini client)
  - `lib/application/embedding-backfill.ts`
  - `EMBEDDING_MODEL` in `lib/infrastructure/llm/contract.ts`
- **UI:**
  - `app/(tabs)/{home,report,search,log,settings,tournament}/`
  - `app/(tabs)/tournament/[id]/rounds/[round]/page.tsx`
  - `components/features/`, `components/checklist/`, `components/log/`
- **Scripts:**
  - `scripts/copy-runtime-assets.mjs` (prebuild; the pdf.js worker only)
  - `scripts/check-cf-env.mjs` (`cf:build` env-file guard)

## Tests and verification performed

**Gemini embeddings (ADR-010, 2026-10-08):**

- tsc is clean.
- 50 files / 769 tests pass, including 25 new tests for the embed route, the client, the backfill, stats, search and the review fixes.
- eslint reports 0 errors.
- `npm run build` and `npm run cf:build` succeed with no model switch. Static assets are 3.1 MB.
- Not yet tested against the real Gemini API: the key is only in Cloudflare secrets.

**Deployment prep (ADR-009, 2026-10-08):**

- Next.js 14.2.35:
  - tsc is clean;
  - 48 files / 745 tests pass;
  - eslint reports 0 errors;
  - the Node build succeeds.
- `opennextjs-cloudflare build` succeeds. The worker is 1.28 MiB gzip.
- Checked locally with `wrangler dev`:
  - all pages and assets;
  - the AI routes: fail closed (503), 401 without the token, the Gemini SDK reached with the token, fair-play text rejected (400).

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
  - Thresholds have not been tuned on real PDFs. In particular, `vectorMinSimilarity` 0.65 for Gemini Embedding is provisional (ADR-010).
  - Semantic search needs the network and the access token. Each device creates its own embeddings at import, or later with 意味検索用データを作成.
  - English precision is weak.
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
- **Custom domain:** whether to use one, or the default `*.workers.dev` URL.

## Next steps

1. **Deployment (Milestone 10.1): done 2026-10-08.**
   - Production checks run by Claude:
     - all pages, including dynamic tournament routes, return 200 over HTTPS;
     - all 51 service-worker precache URLs return 200;
     - `/models/*` returns 404, as expected without the model;
     - `/api/llm/*` returns 401 without the token or with a wrong one.
   - The user still needs to check on a real device:
     - AI reference information with the real token (Settings → AI設定);
     - rule PDF import and keyword search;
     - PWA install.
   - **To redeploy**, run from `main` with no `.env*` files: `npm run cf:deploy`.
   - Plain `http://` is also served on workers.dev. Share the `https://` URL, since the PWA needs HTTPS.
2. **Follow-ups found during deployment prep:**
   - Semantic search: done with ADR-010. Next, tune `vectorMinSimilarity` on real PDFs.
   - Upgrade to Next.js 15.5+/16 and the current OpenNext adapter. Next 14 is EOL.
3. Later, if the user wants:
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
