# J3: Classifier evaluation and the first Jev calibration

**Date:** 2026-10-10. **Branch:** `feature/j3-eval` (worktree `.claude/worktrees/j3`). Design: jev-classifier-design §18.

## Done

- Evaluation tooling: `lib/evaluation/classifier-eval.ts` (pure, unit-tested), the live runner `scripts/eval/classifier.eval.ts` with `vitest.eval.config.ts`, and `npm run eval:classifier`. The launcher runs the privacy tests and the dataset test before any API call.
- Dataset `__tests__/fixtures/classification-eval.ja.json` v2: 405 synthetic items (v1's 270 as tuning, 135 fresh held-out). Every item passes `protectIncidentText`.
- Two Jev runs (`docs/progress/evaluations/classifier-v1-run1`, `classifier-v2-run1`) and one rescoring (`classifier-v2-run1-rescored`).
- Calibration `jev-1.13.0`: medium 0.9, prefill 0.8, subtype 0.9, presence empty. It is registered with a test that it equals the JSON output.
- Threshold rule: Wilson lower bound, and never below the target (§18.3).
- Category descriptions clarified from tuning errors (the Gemini prompt changes too).
- `canOfferFactPresenceCheck` needs a calibrated presence threshold for a target fact.
- Production was deployed from `main` (PRs #8–#11) before J3 started: version `7263f6cc-…`.

## Results

- Jev held-out: 90.4 %, top-2 99.3 %, p95 259 ms.
- Keyword baseline: 54.8 %.
- Probability-sum drift ≤ 0.01, so ±0.02 stays.
- Gate not passed:
  - Gemini was not compared (no local key);
  - player-behavior held-out accuracy is 60 %.

## Verification

- `npx tsc --noEmit` is clean.
- `npx vitest run`: 86 files, 2077 tests.
- eslint (worktree form) reports 0 problems.
- `npm run build` succeeds.

## Known issues / open

- Gemini comparison (user must provide `~/.config/arbiter-console/gemini.key`).
- player-behavior vs clock-time confusion. The decision is open: accept the weakness, or improve and evaluate on a new held-out set v3.
- Presence dataset is not built, so the presence check stays hidden.
- The guard blocks many plain reports (L3v), and most team reports with 主将/キャプテン/チーム.
- The live run of 405 items took more than 10 minutes, although Jev latency is about 170 ms each. Not investigated (rate limiting or retries are possible).

## Next

See jev-classifier-design §18.6.
