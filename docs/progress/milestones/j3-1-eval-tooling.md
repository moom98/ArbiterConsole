# J3-1: Classifier evaluation tooling and datasets

**Status:** implemented on `feature/fact-catalog` (restarted from `main` at `466ae58` after PR #11 was merged). Pushed, no PR yet, not deployed. Nothing in the app changes: the tooling is only used by the script.

**Date:** 2026-10-09

**Design:** [jev-classifier-design.md](../../design/jev-classifier-design.md) §18 (and §9, §5.4), [fact-model.md](../../design/fact-model.md) §5.2.

## Why J3 is split

This container has no TypeSafe or Gemini key; they live only on the user's machine (`~/.config/arbiter-console/`) and in Cloudflare secrets. So:

- **J3-1 (this slice):** everything that runs without a key.
- **J3-2:** the presence dataset (≥ 250 explicit reports per blocking fact, ≥ 160 for the others, 80/20 split).
- **J3-3 (user's machine):** run with keys, review the report, register the calibration, then switch production.

## Completed work

- **`lib/domain/llm/calibration/fit.ts` (pure):**
  - Wilson lower bound, nearest-rank percentile;
  - `chooseThreshold`: the lowest observed `p` (never 0) whose `p ≥ t` set meets precision, support and Wilson; every candidate is checked;
  - `fitThreshold`: tuning → held-out;
  - `toClassificationObservation`: the domain's own `parseLlmClassification` (uncalibrated) decides validity, and invalid output is a miss. The probability sum is recorded before validation;
  - `summarizeClassification`, `fitCategory` (medium 0.90 / prefill 0.80, min. support 20 / 10; subtype 0.90), `fitPresence` (blocking 0.995 + Wilson 0.98, others 0.99 + 0.97; held-out precision only), `buildJevCalibration`, `evaluateAcceptance`.
- **`lib/application/classifier-evaluation.ts`:** dataset types and validation; `deidentifyEvalText` (production `protectIncidentText`); runners with injected ports. Presence cases of the same text go in one request.
- **`scripts/eval-classifier.mjs`** bundles **`scripts/eval/eval-classifier.ts`** with esbuild and runs:
  - `check`: datasets and guard counts, no network;
  - `run --provider jev|gemini [--set presence]`: runs `vitest run __tests__/privacy` first and sends nothing if it fails;
  - `fit --jev … [--gemini …] [--presence …]`: writes the report `docs/progress/eval/classifier-eval-<model>.md` and, if medium and prefill are confirmed, `lib/domain/llm/calibration/<model>.json`. **It does not register the calibration.**
- **Datasets:**
  - `__tests__/fixtures/classification-eval.ja.json`: 180 synthetic reports, 20 per category, 10/10 split, with subtypes for clock-time and draw;
  - `__tests__/fixtures/presence-eval.ja.json`: a 22-report seed for `im.clock-pressed`.
  - All of them pass the production guard (tested).

## Important decisions

See design §18.2. In short:

- results files never contain report text;
- `needsTournamentRules` is not calibrated (no label);
- the acceptance gate fails without a Gemini run;
- presence is not a gate.

## Finding: the gate holds back core wording (design §18.3)

- 60–75 % of the first drafts were held back. The committed dataset is reworded to the gate's vocabulary, so it overstates how many real reports reach Jev.
- チーム / キャプテン (gate-raw), 席を離れて会場の外に出た (gate-raw), スマートウォッチ, 黒が駒に触れた (gate-redacted) are never sent.
- Captain incidents and leaving the playing area therefore always use keywords, and the evaluation cannot measure them. **Question for the user** (see current.md).

## Tests and verification

- `npx tsc --noEmit`: clean.
- eslint (`app components lib __tests__ scripts`): 0 problems.
- `npx vitest run`: 85 files / 1671 tests pass. New: `__tests__/llm/calibration-fit.test.ts` (24) and `__tests__/llm/classifier-evaluation.test.ts` (13), including a `run → fit` pass through `main` with a fake Jev `fetch` in a temporary root.
- `npm run build`: succeeds.
- `node scripts/eval-classifier.mjs check`: 180 + 22 reports, 0 held back, no errors.
- Not done: any live call (no keys here).

## Review

See the "Review" section below. It is filled in after the independent review.

## How to run J3-3 (user's machine)

1. Put the keys in `~/.config/arbiter-console/typesafe.key` and `gemini.key` (`chmod 600`). Never put them in `.env*`.
2. `npm ci`, then `node scripts/eval-classifier.mjs check`.
3. `node scripts/eval-classifier.mjs run --provider jev` and `run --provider gemini` (optional `JEV_MODEL`, `GEMINI_MODEL_CLASSIFIER` env vars to override the defaults).
4. `node scripts/eval-classifier.mjs fit --jev docs/progress/eval/results/classification-jev-….json --gemini docs/progress/eval/results/classification-gemini-….json`.
5. Commit the results and the report. If the gate is PASS, register the JSON in `JEV_CALIBRATIONS` with a test that compares them (design §18.2). Then, with the user's go-ahead: `wrangler secret put TYPESAFE_API_KEY`, set `LLM_CLASSIFIER_PROVIDER=jev`, deploy.
