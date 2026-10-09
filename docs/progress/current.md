# Current Progress

**Last updated:** 2026-10-10 (PR #11 merged and deployed; J3 in progress on `feature/j3-eval`)
**Main line:** `main`. PR #1 (M0–M7 + Cloudflare config) was merged on 2026-10-08. New work branches from `main`.

- The deployment config (ADR-009) is in `main` via PR #1. The `account_id` arrived in a follow-up PR.

This file is the handoff for a fresh Claude session. Do not rely on conversation history.

**Current state in one paragraph (2026-10-09):** all work up to the incident-log AI retry was merged into `main` via **PR #7** (`392cd61`) and **deployed** (version `c85907c7-…`). PR #7 holds:
- the fact catalogue and ADR-014 (J1b-1…J1b-8, all done);
- the pure privacy package (J1a-1, done);
- the external-AI guard on every client route with the arbiter's mandatory confirmation (J1a-2, done, review MERGE);
- the server re-check L5 and minimized shapes only (J1a-3, done; see `milestones/j1a-3-server-recheck.md`);
- retrying and confirming the AI reference from the incident log detail (done, review MERGE; see `milestones/log-ai-retry.md`).

**J1c (2026-10-09): done** on branch `feature/j1c-jev-port`, which is stacked on `docs/deploy-after-pr7` (PR #8, open). See `milestones/j1c-jev-port.md` and jev-classifier-design §14. It holds the classify port, the Jev client, the calibrated parser and `/api/llm/facts`. The default provider stays `gemini`, so deploying it changes nothing.
- Pushed. **PR #9** to `main` is open; it also contains the PR #8 docs commit until #8 is merged. Not deployed.

**J2 (2026-10-09): done** on branch `feature/fact-catalog` (restarted from `main` at `56b0228` after PRs #8/#9 were merged). See `milestones/j2-classifier-ui-presence-recording.md`. It holds:
- J2-1: the classification UI (§7) and `/api/llm/providers`, so the preview names the real destination (409 `provider-changed` on a mismatch);
- J2-2: the optional fact-presence check that only reorders DT questions. **It is hidden until J3 registers a calibration**;
- J2-3: **DT-011** (FIDE 8.4 recording obligation for scoresheet "記入していない／遅れている" in Standard), `game.record-state` as record-only, and facts keeping the shared daily cap.
- **Merged via PR #10** (`1fc8f5b`). The J2-3 review (FIX FIRST: "遅れている" ignored FIDE 8.1.3) is fixed in a follow-up PR from `feature/fact-catalog`. The user asked to deploy after merging; deploy once the follow-up is merged.

**Deployed 2026-10-10:** `main` at `466ae58` (PRs #8–#11), version `7263f6cc-fba3-4cc2-9ce6-d05938bba4d8`, from a clean worktree (`npm ci`, tsc clean, 83 files / 1634 tests). Production checks: all pages 200 (`/` → 307 `/home`), `sw.js` and `manifest.json` 200, `/api/llm/{reason,classify,facts,providers}` 401 without the token. Secrets present: `GEMINI_API_KEY`, `LLM_ACCESS_TOKEN` (no `TYPESAFE_API_KEY` yet).

**J3 (in progress, branch `feature/j3-eval`, worktree `.claude/worktrees/j3`):** see "J3 status" below.

## J3 status (2026-10-10)

Summary: `milestones/j3-classifier-evaluation.md`; design: jev-classifier-design §18.

- **Done:**
  - evaluation tooling (`npm run eval:classifier`, `EVAL_REUSE`, `EVAL_LIMIT`);
  - dataset v2 (405 synthetic items);
  - Jev runs;
  - calibration `jev-1.13.0`: medium 0.9, prefill 0.8, subtype 0.9, presence empty;
  - Wilson threshold rule with a floor at the target;
  - clarified category descriptions (**changes the Gemini prompt on the next deploy**);
  - the presence card needs a calibrated presence threshold.
- **Results:**
  - Jev held-out 90.4 %, top-2 99.3 %, p95 259 ms;
  - keyword 54.8 %;
  - sum drift ≤ 0.01.
- **Gate not passed:**
  - **Gemini not compared** (no local key; the user must create `~/.config/arbiter-console/gemini.key`, chmod 600);
  - player-behavior 60 % on held-out.
- **Production is not switched.** It still uses `gemini`. Steps for the switch: jev-classifier-design §18.6.
- Review: a separate reviewer agent was run on `origin/main...feature/j3-eval`. See the milestone file for the verdict and fixes.
- **Guard finding:** L3v blocks many plain reports, and team reports mentioning 主将/キャプテン/チーム/監督/メンバー.

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
- **On `feature/fact-catalog` (not merged):**
  - **J1b-1…J1b-8:** fact catalogue, `unknown` answers, `game.history`, mate possibility (ADR-015), draw trees DT-005/006, touch move DT-007, time-control periods (Dexie v8), game end. ADR-014 is fully implemented. See `milestones/j1b-*.md`.
  - **J1a-1:** `lib/domain/privacy/` (Sensitive Gate with the known-vocabulary layer, PII redaction, residual check, minimization, re-identification, `protectIncidentText`) and the synthetic evaluation fixtures. See `milestones/j1a-1-privacy-package.md`.
  - **J1a-2:** `lib/application/external-ai-guard.ts` (the only caller of `callLlmApi`).
    - Classification, AI reasoning and search queries are sent only after the arbiter confirms the de-identified preview (D13).
    - 「外部AIに送らない」 switch.
    - AI output is re-identified on the device.
    - Tournament regulations are de-identified for reasoning and embeddings; embedding key `+deid1`.
    - See `milestones/j1a-2-external-ai-guard.md` and design §11.

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
    - **Latest deploy:** version `c85907c7-2de8-4096-9fc5-49f54efc9e9e`, from `main` at `392cd61` (PR #7: ADR-014 J1b-4…8, ADR-012 J1a-1…3, log AI retry), on 2026-10-09.
      - Production checks: all pages, including dynamic tournament routes, return 200. All 51 precache URLs return 200, and `sw.js` has the new build id. `/api/llm/{reason,classify,embed}` return 401 without a token or with a wrong one. `/models/*` returns 404.
      - The user still has to do on a real device: run 「意味検索用データを作成」 once (key `+deid1`), and check that Dexie v8 opens with existing data.
    - Previous deploy: version `7221140b-…`, from `main` at `d943ae9` (PR #3), on 2026-10-08.
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
  - Dexie v7. v6 is unused. v8 (J1b-7) converts `tournaments.timeControl` to periods. Future schema versions must be ≥ 9.
- **ADR-014 §1/§2 (J1b-5):** DT-005 Draw Claim (threefold + 50 moves, id kept as `DT-005-repetition`), DT-006 Automatic Draw (`DT-006-automatic-draw`); the side to move from `lastMover` or the confirmed history, never the clock.
- **ADR-014 §6 (J1b-6):** DT-007 Touch Move (`DT-007-touch-move`).
  - Subtype `touch-move` in the illegal-move category, routed before DT-001/002/003.
  - Decides which piece must be moved or captured: 4.3 / 4.4 / 4.5, with the FEN through the port's `legalMoves`, otherwise steps to check on the board.
  - Never sets a penalty (12.9 discretion).
  - Violations (`Decision.touchMoveViolation`) are counted apart from 7.5 illegal moves (`IncidentCounter.touchMoveViolationsByColor`).
- **ADR-014 §7 (J1b-7):** `TimeControl.periods` (`lib/domain/services/time-control.ts`), Dexie v8, `RulesetSnapshot.timeControl`.
  - Every legacy `{ initialMinutes, incrementSeconds }` is `periodsIncomplete` until the arbiter confirms the periods in the profile form (the old form could not hold a second period).
  - DT-004 `lastPeriod`: an explicit answer wins; the setting only fills unanswered or unknown, and only for a confirmed single period.
  - FIDE 8.4 in `assessRecordingObligation`: three-valued; a delay never confirms the exemption.
- **ADR-014 §3 (J1b-8):** game end from the observed event.
  - Questions `gameEndEvent` (DT-001…003) and `endedBeforeFlag` (DT-004) replace the yes/no `gameEnded` / `gameEndedBeforeFlag`; the booleans are derived in `lib/domain/services/game-end.ts`. No handshake option.
  - Stored legacy booleans are stripped by the engine and asked again.
  - Optional record-only `gameRecordState`; it never changes the ruling.
  - Checkmate/stalemate "result stands" asks whether the producing move was legal (FIDE 5.1.1 / 5.2.1), confidence medium.
- **ADR-012 + amendments (J1a-1):** `lib/domain/privacy/` (pure).
  - **D12 (user):** a known-vocabulary allow-list layer (L3v) decides `clear`; the term lists only give `blocked` reasons.
  - **D13 (user):** the arbiter confirms **every** external send; the gate is a filter, not a guarantee. Release condition: held-out false-negative rate measured and minimized, 0 on the regression sets, no covered identifier in a sent payload.
  - `protectIncidentText` runs steps A–E; unregistered names and words swallowed by pattern rules always go local.
- **ADR-012 in the app (J1a-2, design §11):**
  - Reasoning: the port returns `needs-confirmation` (preview plus `approvalKey` = the de-identified payload) before any search or send.
    - The engine stores a manual-review decision `awaiting-confirmation` in the meantime.
    - `confirmExternalAiSend()` re-evaluates. The port sends only if the freshly prepared key is identical.
    - `retryEvaluation` reuses the approval only for the same incident.
  - Rule search: keyword results first. Semantic search runs only after the de-identified query is confirmed (user approved 2026-10-09).
  - Gate results `not-sent` → local manual review with reason codes (`Decision.llm.gateReasons`).
  - No `tournamentId` in any request. Tournament articles are redacted with `sourceName: "大会規定"` and no version. Citations show the local source name (`localSourceLabels`).
  - Unknown placeholders in AI output → `llm.needsReview`, escalation, 「要確認」.
  - Accepted exception: tournament regulation text attached to reasoning is not shown in the preview (chosen after confirmation; narrow redaction only).
- **ADR-015:** mate-possibility search in infrastructure (own 0x88 generator + best-first portfolio, Web Worker, 1.5 s), result stored on the incident and re-verified by the domain through `ChessPositionPort` every time. A search bug can only cause "unknown".
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
  - `lib/domain/decision-trees/` (draw: `draw-shared.ts`, `dt-005-draw-claim.ts`, `dt-006-automatic-draw.ts`; touch move: `dt-007-touch-move.ts`)
  - `lib/domain/llm/` (output validator, quote match, keyword classifier, ports)
  - `lib/domain/services/` (incident-counter, touch-move, mate-material, mate-possibility, game-history, time-control, position-analysis, fair-play, round-checklist, round-planning, game-context, …)
  - `lib/domain/rules/citations.ts`
- **Application:** `lib/application/` (rule-ingestion, rule-library, csv-export, llm-classification, round-checklist, tournament-management, **external-ai-guard**, **llm-assist** (the reasoning port, moved from infrastructure in J1a-2))
- **Infrastructure:**
  - `lib/infrastructure/db/schema.ts` (Dexie v1–v3, v5, v7, v8 on `feature/fact-catalog`)
  - `lib/infrastructure/llm/` (client, contract, `server/` config, handler, prompts, request validation, rate limiter, Gemini client)
  - `lib/infrastructure/ai/`
  - `lib/infrastructure/chess/` (chess.js port; `helpmate/` search, worker and port)
- **Privacy (J1a-1):**
  - `lib/domain/privacy/` (`normalize`, `sensitive-terms` (L2 + L3 registry), `known-vocabulary` (L3v), `sensitive-gate`, `placeholders`, `pii-redaction`, `residual-check`, `minimization`, `reidentify`, `protect`)
  - `lib/infrastructure/privacy/known-identifiers.ts` (tested in `__tests__/privacy/external-ai-guard.test.ts`)
  - J1a-2: `lib/application/external-ai-guard.ts`, `lib/domain/llm/external-ai.ts` (reason labels), `components/features/{ExternalAiSendConfirmation,ExternalAiOptOutSwitch}.tsx`
  - fixtures `__tests__/fixtures/privacy/*.json`, tests `__tests__/privacy/*.test.ts`
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

**J1c (2026-10-09, `feature/j1c-jev-port`):**

- tsc is clean.
- eslint reports 0 problems.
- 78 files / 1547 tests pass.
- `next build` and `npm run cf:build` succeed.
- Review: MERGE. The minor findings were fixed (deadline test, timeout and 408 tests, docs). Details are in `milestones/j1c-jev-port.md`.

**Incident log AI retry (2026-10-09, `feature/fact-catalog`):**

- tsc is clean.
- eslint reports 0 problems.
- 75 files / 1453 tests pass. New: `__tests__/incident-log-ai-retry.component.test.tsx` and `__tests__/incident-store-supersede.test.ts`.
- `next build` succeeds.
- Review: FIX REQUIRED (shared store race) → fixed (epoch, `useIncidentLogStore`) → re-review MERGE.

**J1a-3 server re-check (2026-10-09, `feature/fact-catalog`):**

- tsc is clean; eslint reports 0 problems; 73 files / 1444 tests pass; `npm run build` and `npm run cf:build` succeed.
- New: `__tests__/privacy/server-recheck.test.ts`, which includes the client/server agreement on all fixture sets and real guard bodies through the server validators.
- Extended: the route, embed and client tests.
- Review: FIX REQUIRED (1 must-fix, 5 should-fix) → fixed → re-review MERGE.

**J1a-2 external-AI guard (2026-10-09, `feature/fact-catalog`):**

- tsc is clean; eslint 0 errors / 0 warnings; 72 files / 1377 tests pass; `next build` succeeds.
- New and extended tests:
  - `__tests__/privacy/external-ai-guard.test.ts`: only-importer check, bodies, fail closed, document redaction, reasoning payload, `loadKnownIdentifiers`;
  - `__tests__/rule-search/search-semantic-confirmation.test.tsx`;
  - the store flow in `__tests__/llm/llm-incident-flow.integration.test.ts`: confirmation, approval scoping, names, unknown placeholders, opt-out, gate;
  - engine outcome mapping, re-identification in `buildLlmDecision`, classifier confirmation and stale responses.
- Independent read-only review: MERGE (no critical or major findings). Its minor findings and nits were fixed in `43b61e4`, then re-reviewed.

**J1a-1 privacy package (2026-10-08, `feature/fact-catalog`):**

- tsc is clean; eslint 0 errors; all tests pass (70 files); `npm run build` succeeds.
- 155 privacy tests, including evaluation of every synthetic fixture set through the gate and the whole pipeline.
- Four independent reviews, each FIX REQUIRED → fixed. Held-out false-negative rate went ~76% → ~43% → 10–17% → 0.47% (natural phrasing, 1/211). Usefulness: 10.4% of realistic benign reports held back. See `milestones/j1a-1-privacy-package.md`.

**J1b-8 game end (2026-10-08, `feature/fact-catalog`):**

- tsc is clean.
- eslint reports 0 errors.
- 66 files / 1184 tests pass, including the new `__tests__/game-end.test.ts` and `game-end.component.test.tsx`.
- `npm run build` succeeds.
- FIDE 5.1.1 and 5.2.1 citations were checked verbatim against the PDF (printed p.19).
- Review: MERGE with 3 should-fix (illegal mating move answered as checkmate, UI test, stale doc) → fixed → re-review MERGE. See `milestones/j1b-8-game-end.md`.

**J1b-7 time control periods (2026-10-08, `feature/fact-catalog`):**

- tsc is clean.
- eslint reports 0 problems.
- 64 files / 1146 tests pass, including the new `__tests__/time-control.test.ts` (it migrates a real v7 Dexie DB to v8).
- `npm run build` succeeds.
- FIDE 8.1.1 and 8.4 citations were checked verbatim against the PDF (printed p.29).
- Review: FIX REQUIRED (1 must-fix: legacy "90+30" became a single last period and could give a wrong III.3.1.2 draw; 6 should-fix) → fixed → re-review MERGE. See `milestones/j1b-7-time-control-periods.md`.

**J1b-6 touch move (2026-10-08, `feature/fact-catalog`):**

- tsc is clean.
- eslint reports 0 problems.
- 63 files / 1107 tests pass, including the new `dt-007-touch-move` and `touch-move-service` tests (real chess.js positions).
- `npm run build` succeeds.
- New citations (FIDE 4.2.1, 4.2.2, 4.4, 4.5, 4.8, 12.9; Manual 4.2.1 / accidental / 4.4.2; JCF p.20) were checked verbatim against the PDFs.
- Review: FIX REQUIRED (2 must-fix on castling detection, 4 should-fix) → fixed → re-review MERGE. See `milestones/j1b-6-touch-move.md`.

**J1b-5 draw trees (2026-10-08, `feature/fact-catalog`):**

- tsc is clean.
- eslint reports 0 problems.
- 61 files / 1027 tests pass, including the new `dt-005-draw-claim`, `dt-006-automatic-draw` and `draw-claim.integration` tests (100 quiet plies through chess.js).
- `npm run build` succeeds.
- Review: FIX REQUIRED (1 must-fix: legacy 75-move "met" became a draw; 3 should-fix) → fixed → re-review. See `milestones/j1b-5-draw-trees.md`.

**J1b-4 mate possibility (2026-10-08, `feature/fact-catalog`):**

- tsc is clean.
- eslint reports 0 problems.
- 59 files / 968 tests pass, including the new `helpmate-search`, `helpmate-port` and `mate-possibility` tests.
- Acceptance (ADR-014 §5): a chess.js-verified helpmate is found in 68/72 realistic fixtures (94 %); 18/20 (90 %) on the playouts not used for tuning. Laptop: median 18 ms, p90 246 ms, max 439 ms.
- `npm run build` and `npm run cf:build` succeed; the worker chunks are in the SW precache.
- Review: APPROVE (no must-fix) → the 3 should-fix items were fixed. See `milestones/j1b-4-mate-possibility.md`.

**J1b-3 `game.history` (2026-10-08, `feature/fact-catalog`):**

- tsc is clean.
- eslint reports 0 problems.
- 56 files / 937 tests pass, including the new `__tests__/game-history.test.ts` and `game-history.component.test.tsx`.
- `npm run build` succeeds.
- Review: FIX REQUIRED (2 must-fix, 3 should-fix) → fixed → re-review APPROVE. See `milestones/j1b-3-game-history.md`.

**J1b-2 `unknown` answers (2026-10-08, `feature/fact-catalog`):**

- tsc is clean.
- eslint reports 0 errors.
- 54 files / 889 tests pass, including 67 new tests in `__tests__/unknown-answers*.ts(x)`.
- `npm run build` succeeds.
- Review: FIX REQUIRED → fixed → APPROVE. Then the should-fix was done (a shared unanswered question across all branches is asked).

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

- **J1a-1:**
  - Sentences deliberately built from vocabulary words can still pass the gate; the arbiter's confirmation (D13, J1a-2) is the final defense. Every miss found must become a regression case in `__tests__/fixtures/privacy/`.
- **J1a-3:**
  - The server cannot tell a tournament article mislabelled as FIDE, or which source a document embedding comes from; their text is not checked (§2, accepted).
  - An E2 failure shows the generic reason `residual`.
  - FIDE/JCF labels such as 「FIDE 2023」 are matched by rule 5 and not sent. They are still shown on the device.
  - `generateEmbeddings` cuts documents with `slice(0, 2000)` and can split a placeholder (pre-existing; use `truncate`).
- **J1a-2:**
  - ~~The incident log detail has no retry / confirm AI send.~~ **Done 2026-10-09** (`milestones/log-ai-retry.md`). What remains:
    - re-evaluating an old incident counts later records too. It is unreachable for AI decisions today; see the `retryIncident` JSDoc;
    - overlapping actions on the same incident in the log can send the same confirmed payload twice.
  - Fact answers are not sent to `/reason` (§5.3 would allow codes).
  - Semantic search on the rule search screen needs one extra tap (by design).
  - The first 「意味検索用データを作成」 after deploying rebuilds every vector (key `+deid1`).
- **J1b-8:**
  - Whether the mating/stalemating move was legal is the arbiter's check; there is no automatic check from `game.history` yet (J2).
  - `game.record-state` is `conditional` in the catalogue while the DT question is optional; J1c must treat it as a non-blocking record fact.
- **J1b-7:**
  - The move number is not wired in, so multi-period DT-004 still asks `lastPeriod`.
  - The 8.4 service (`assessRecordingObligation`) is used by DT-011 (J2-3). `deriveTimeControlFacts` still has no caller.
  - Existing tournaments show a "confirm periods" banner in the profile form until the arbiter confirms them.
- **J1b-6:**
  - Switching the subtype away from touch-move leaves stale `touchMoveFacts` on the Incident (ignored by decisions, still stored).
  - These unknown answers give manual review, because the other branch needs an unanswered question (the J1b-2 limitation):
    - `touchClaimedByOpponent` (the claimed branch needs `touchClaimTiming`);
    - `touchReleased` (the released branch needs `touchChangedAfter`).
  - Touched pieces and the FEN are typed; a board input is J2.
  - "Opponent already made the next move" is not asked (the tree says to consult the CA).
  - Federation practice for touch move in A.5 / B.3 games is not covered by the sources; Article 4 is applied the same in every competition type.
- **J1b-5:**
  - `lastMover` unknown gives manual-review; the arbiter must answer the last mover to continue.
  - The 75-move result `met-checkmate` is a DT-only value; the catalogue fact `dr.manual-reconstruction` has no checkmate value yet (J1c must not map `met` without it).
  - Agreement, stalemate and dead position have no tree (ADR-014 §1); they use the situation note.
- **J1b-4:**
  - Typing a FEN on a phone is slow; there is no board editor and the position is not derived from `game.history` yet (J2). Many flag falls and second illegal moves end in "局面を確認／CAへ確認". Counts never give "can-mate" any more (K+Q vs K without a FEN is no longer an automatic loss).
  - Phone timing of the 1.5 s search is estimated, not measured. Check on a real device.
  - The acceptance margin on untuned positions is exactly 90 %; re-check with real flag-fall positions (J3).
- **J1b-3:**
  - `Game.pgn` is not wired in: no UI sets it, so the history comes only from the pasted text.
  - There is no board diagram; the arbiter compares the FEN and the last move with the board (J2).
  - The side to move is now `lastMover` or the confirmed history (done in J1b-5).
- **J1b-2:**
  - With an unknown answer, a branch that needs another unanswered question counts as disagreeing, unless every branch asks the same question. Example: `claimMode` unknown and `moveWritten` unanswered give manual-review.
  - The fact layer's `FactAnswer.unknown` is not yet linked to `Incident.unknownAnswers`. That happens when facts replace the follow-up questions.

- **Illegal-move count:** it follows the _suggested_ decision. There is no "applied / not applied" confirmation yet (ADR-004). AI decisions stay `pending` until edited.
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
  - dead position as its own incident type;
  - separate round-exclusion and point-deduction penalty types (§25);
  - a Game Detail screen;
  - restoring a single removed checklist item.
- `npm install` can drop platform-specific bindings (rolldown, lightningcss) from `package-lock.json`. Use `npm ci`.

## Unresolved questions

- **Jev (TypeSafe AI) for classification, and external-AI data protection (2026-10-08, design only).**
  - **Design and ADRs:**
    - `docs/design/jev-classifier-design.md` (ADR-011)
    - `docs/design/external-ai-data-protection.md` (ADR-012): Sensitive Gate and PII redaction for **all** external AI, Gemini included
    - `docs/design/fact-model.md` (ADR-013): the Decision Tree decides the required facts, Jev only checks "explicitly stated?", unknown answers, calibrated thresholds
    - ADR-014: DT-005 Draw Claim, DT-006 Automatic Draw, DT-007 Touch Move, local `game.history`, position-based mate possibility, `TimeControl` periods
    - catalogue: `docs/design/jev-missing-info-catalog.md`
  - **User decisions:**
    - Q1: classification only;
    - Q2: an API key exists;
    - Q3: de-identified minimal state, no sensitive data, no ZDR;
    - Q5: de-identify Gemini too;
    - the catalogue review: 12 points, all reflected.
  - **Still open:**
    - (done 2026-10-08) the catalogue re-review: 15 points reflected, ADR-014 added. **The user approved implementing the fact catalogue.**
    - Q-F1: value suggestion (not planned).
  - **Answered 2026-10-08:**
    - Q-DP1: sensitive incidents are not sent to external AI; they are handled by local trees and forms; on-device AI is not forbidden;
    - Q-DP2: a context-dependent expression registry with evaluation cases, where undecidable means local fallback;
    - Q-F2: present precision ≥ 0.99, and ≥ 0.995 for blocking facts.
  - The TypeSafe key is at `~/.config/arbiter-console/typesafe.key`. It is never in the repo or in `.env*`.
  - Code so far:
    - J1b-1: `lib/domain/facts/`, pure;
    - J1b-2: `unknown` answers and `resolveUnknown` in the engine. No Decision Tree body changed.
    - J1b-3: `lib/domain/services/game-history.ts`, strict replay in the port, and `historyConfirmed` in DT-005.
    - J1b-4: `lib/domain/services/mate-possibility.ts`, `lib/infrastructure/chess/helpmate/` (ADR-015).
  - The key must never go into `.env*` (`cf:deploy` refuses to run). Keep it in `~/.config/arbiter-console/typesafe.key` for J0 and J3.

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
3. **Jev classifier and data protection (ADR-011/012/013):** after the catalogue re-review, implement the steps in jev-classifier-design §10 in order (J0, J1a data protection, J1b fact model, J1c Jev, J2, J3):
   - J0: check the official API with a real key;
   - J0: **done 2026-10-08**. The real API was checked with synthetic text (`scripts/jev-probe.mjs`, jev-classifier-design §2.1). `noul` returns its probability in the field `noul`; pinned `jev-1.13.0` works; 422 errors echo the input.
   - J1a: data protection for all routes, in slices:
     - J1a-1: the pure privacy package and its evaluation. **Done 2026-10-08**, on `feature/fact-catalog`. See `milestones/j1a-1-privacy-package.md`.
     - J1a-2: **done 2026-10-09**, on `feature/fact-catalog`. See `milestones/j1a-2-external-ai-guard.md`.
     - J1a-3: **done 2026-10-09**, on `feature/fact-catalog`. See `milestones/j1a-3-server-recheck.md` (design §12).
       - `server-recheck.ts` runs on both sides (client E2). The new code `not-sendable` is a 400 and gives the local handling on the client.
       - The server accepts exact key sets only.
   - J1b: the fact model and ADR-014, in slices:
     - J1b-1: the catalogue data, types and `requiredFacts` (pure, no tree changes). **Done 2026-10-08**, on branch `feature/fact-catalog` (stacked on `design/jev-classifier`). See `milestones/j1b-1-fact-catalogue.md`;
     - J1b-2: `unknown` and `resolveUnknown`. **Done 2026-10-08**, on `feature/fact-catalog`. See `milestones/j1b-2-unknown-answers.md`.
       - Every incident-scope choice question offers "わからない・確認できない".
       - Unknown answers are kept in `Incident.unknownAnswers`.
       - `DecisionEngine.routeResolvingUnknown` enumerates them with the pure `resolveUnknown` (`tree-support.ts`) for every tree. The trees did not change (ADR-013 amendment).
       - The decision lists `unconfirmedFacts`.
     - J1b-3: `game.history`. **Done 2026-10-08**, on `feature/fact-catalog`. See `milestones/j1b-3-game-history.md`.
       - PGN or scoresheet text is parsed in the domain (start position only via `[FEN]`, FEN lists rejected), then replayed with chess.js `strict: true`.
       - In an incomplete history, "not met" is inconclusive and the start FEN's clock is not trusted.
       - DT-005 asks `historyConfirmed`: the arbiter compares the final position and the move count with the board.
     - J1b-4: mate possibility. **Done 2026-10-08**, on `feature/fact-catalog`. See `milestones/j1b-4-mate-possibility.md` and ADR-015.
       - Questions `matePosition` (FEN を入力 / 入力できない) + `reinstatedFen` (DT-001…003) or `positionFen` (DT-004). `opponentCanCheckmate`, the material counts, `materialConfirmed` and `positionBlocked` are removed.
       - "cannot-mate" only from the three provable material cases; "can-mate" only from a helpmate line found by the local search (Web Worker, own 0x88 move generator) **and** re-verified by chess.js (strict) on every evaluation; otherwise "局面を確認し、CAへ確認".
       - The store searches before evaluation and saves `Incident.mateSearch`.
     - J1b-5: DT-005/006 restructure. **Done 2026-10-08**, on `feature/fact-catalog`. See `milestones/j1b-5-draw-trees.md`.
       - DT-005 Draw Claim: threefold (9.2) and the new 50-move claim (9.3, ≥ 100 plies at the target position); DT-006 Automatic Draw: fivefold and 75 moves.
       - `claimantHasMove` (clock) replaced by `lastMover`; `lastMoveCheckmate` folded into the 75-move result (`met-checkmate`).
       - Draw subtypes: the 8 kinds of ADR-014 §1. Changing the kind clears the stored check.
     - J1b-8: ADR-014 §3 game end (`game.end-event`, `ct.ended-before-flag`, `game.record-state`). **Done 2026-10-08**, on `feature/fact-catalog`. See `milestones/j1b-8-game-end.md`. ADR-014 is now fully implemented;
     - J1b-6: DT-007 touch move and counting. **Done 2026-10-08**, on `feature/fact-catalog`. See `milestones/j1b-6-touch-move.md`.
       - Quick report "タッチムーブ（触れた駒）" and the 7.5 `subtype` option 「触れた駒の規則（タッチムーブ）」 (not enumerated on unknown).
       - Catalogue: `tch.touched` and `tch.claimed-by-opponent` became conditional; new `tch.changed-after`.
     - J1b-7: `TimeControl` periods. **Done 2026-10-08**, on `feature/fact-catalog`. See `milestones/j1b-7-time-control-periods.md`.
   - J1c: **done 2026-10-09** on `feature/j1c-jev-port`. See `milestones/j1c-jev-port.md` and jev-classifier-design §14.
   - **J2: done 2026-10-09** on `feature/fact-catalog`. See `milestones/j2-classifier-ui-presence-recording.md`. Original scope:
     - the UI of design §7 (percentage, candidate chips, `onPickCategory`);
     - a guard function for `/api/llm/facts` in `external-ai-guard.ts`, with its confirmation (D13), and the grouping in `FollowUpQuestions` (fact-model §4.3);
     - **the classification preview must name the provider actually used** (it says Gemini today);
     - wire `deriveTimeControlFacts` and `assessRecordingObligation`;
     - treat `game.record-state` as a non-blocking record fact;
     - decide whether facts needs its own daily cap.
   - **J3: done except the Gemini comparison and the production switch (2026-10-10).** See `milestones/j3-classifier-evaluation.md`. Original scope:
     - the Japanese evaluation (`scripts/eval-classifier.mjs`, datasets) and the first calibration in `lib/domain/llm/calibration/`;
     - check the ±0.02 probability-sum tolerance against real responses;
     - then switch production by env: `LLM_CLASSIFIER_PROVIDER=jev` and `wrangler secret put TYPESAFE_API_KEY`.
4. Later, if the user wants:
   - **Milestone 8 without voice input:** clock guide, player Q&A mode, UX polish.
   - **Milestone 9:** Playwright E2E, performance.
   - **Milestone 10.2/10.3:** user and developer docs.

## Information a fresh Claude session needs to continue

1. Read `CLAUDE.md`, this file, `docs/progress/milestones/*`, then the design docs and ADRs for the next task.
2. The current work branch is `feature/fact-catalog` (pushed to `origin`, latest J1a-1 at `52d7ebb` or later; `main` has the deployed app). Check `git log --oneline -15` on it, and `git worktree list`.
   - PR #7 (`feature/fact-catalog`) is merged and deployed.
   - J1c is on `feature/j1c-jev-port`. Worktree: `.claude/worktrees/j1c`.
   - PR #8, #9 and #10 (J2) are merged. The J2-3 review fixes are in a follow-up PR from `feature/fact-catalog`.
   - **Next task:** J3 (see Next steps). Before that, the user may want a PR for J2 and a deploy (ask first).
   - The privacy package's reviews used independent reviewer agents that wrote their own synthetic sensitive phrases; keep doing that for any change to `lib/domain/privacy/` (the author's own fixtures say little).
   - Follow `.claude/rules/development-cycle.md`: implement, run checks, have a separate read-only reviewer agent review, fix, re-review, then write `milestones/<slice>-*.md` and update this file.
   - Checks: `npx tsc --noEmit`, `npx eslint --ext .ts,.tsx app components lib __tests__`, `npx vitest run` (83 files / 1634 tests after the J2-3 review fixes; the full run takes about 2 minutes, run it with a longer timeout), `npm run build`. Use `npm ci`, not `npm install`.
   - The project tsconfig has no `target` (tsc treats it as ES5): avoid regex-literal flags such as `/u` or `/s` and `matchAll`; use `new RegExp(source, flags)` and `exec` loops, as `lib/domain/privacy/` does.
   - In a nested worktree, run eslint as `npx eslint --no-eslintrc -c .eslintrc.json --ext .ts,.tsx app components lib __tests__`.
3. Do not edit `docs/requirements/product-requirements.md` for implementation convenience.
4. Keep chess rule judgment in `lib/domain/` only.
   - No LLM calls in deterministic code.
   - Competition type, regime and rules version are always explicit inputs.
5. Verify any new rule citation verbatim against `docs/reference/rules/` PDFs. Extract text with `pdfjs-dist/legacy/build/pdf.mjs`.
6. After each milestone, write `docs/progress/milestones/milestone-N.md` and update this file.
