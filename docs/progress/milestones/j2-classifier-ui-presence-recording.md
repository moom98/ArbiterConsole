# J2: Classifier UI, provider-named preview, fact presence check, DT-011 (FIDE 8.4)

**Status:** implemented on branch `feature/fact-catalog`, restarted from `main` at `56b0228` after PR #7 was merged. It is pushed, there is no PR yet, and it is not deployed.

**Date:** 2026-10-09

**Design:**
- [jev-classifier-design.md](../../design/jev-classifier-design.md) §15 (J2-1), §16 (J2-2), §17 (J2-3), and §14.3 (status);
- [fact-model.md](../../design/fact-model.md) §3.6, §3.9, §4.1;
- [ADR-014](../../decisions/ADR-014-draw-dt-touch-move-game-history.md) §7, with a J2-3 amendment that names the 8.4 tree DT-011.

## Slices and commits

| Slice | Commits | Content |
| --- | --- | --- |
| J2-1 | `a2439aa` | Classification UI (§7) and a preview that names the provider actually used |
| J2-2 | `9d41e82`, `e8c2d35` (review fixes), `9f66b2f` (reverts accidental doc formatting) | Optional fact-presence check and question ordering; J2-1 review follow-ups |
| J2-3 | `c2661c0` (merged in PR #10), review fixes in a follow-up PR | DT-011 recording obligation (8.4), record-only `game.record-state`, facts daily cap |

## Completed work

### J2-1: classification UI and the provider-named preview

- **`POST /api/llm/providers`** accepts only the body `{}` and returns `{ classify: "gemini"|"jev", facts: boolean }`.
  - It runs the same guard order as the other routes: content type, token, rate limit (its own bucket, sized like classify), key.
  - It never calls the upstream and never counts toward the daily cap.
  - The client call times out after 5 s (`PROVIDERS_TIMEOUT_MS`).
- **The preview names the real destination**, for example 「カテゴリの提案（Jev（TypeSafe））」.
  - The classify body is `{ narrative, provider }`. A mismatch with the server setting returns **409 `provider-changed`** before any upstream call or daily count.
  - The client then shows `PROVIDER_CHANGED_NOTICE` and falls back to keywords.
  - If the provider cannot be confirmed, nothing is sent.
- **UI (§7):**
  - `classificationView` shows the percentage (Jev only) and the probability hint;
  - candidate chips call `onPickCategory` in one tap;
  - 「このカテゴリで続ける」 is hidden when `prefill: false`;
  - the placeholder now says to use 白／黒 instead of names.

### J2-2: fact presence check (optional, D13)

- **Domain:**
  - `presenceTargets` maps each DT question to a presence-checkable fact. It skips facts that are `localOnly`, `derivedFrom` or `dtValues: "computed"`.
  - `groupQuestionsByPresence` sorts "missing / unjudged" first and "present" after. A `showWhen` child stays with its root. Nothing is skipped and no answer is filled in.
- **Guard:** `prepareFactPresence` runs protect, then providers; `facts: false` gives `unavailable`. The preview lists the narrative and each fact code with its question. The guard returns the exact ids it sends.
- **Application:** `prepareFactPresenceCheck` and `canOfferFactPresenceCheck`.
  - **Only a valid answer from a calibrated model reorders the questions.** Failure, malformed output and an uncalibrated model show a notice and change nothing.
  - **The offer is hidden until a calibration is registered (J3)**, so the card does not appear in production today. This is intentional: an uncalibrated answer cannot be used.
- **UI:**
  - `FactPresenceCheck` shows the card 「AIで報告文の記載を確認（任意）」. Nothing goes on the network until it is tapped; then the confirmation is shown, with 「送らない」.
  - `FollowUpQuestions` gets an optional `presence` prop and two headed sections.
  - The report page keys the result by incident id and question set, and clears it on 「新しい報告」.

### J2-3: time control, record facts, daily cap

- **DT-011, recording obligation** (`dt-011-recording-obligation.ts`). DT-008 to DT-010 are retired numbers.
  - Scoresheet incidents first ask `scoresheetIssue` (`ss.issue`).
  - 「記入していない」 and 「遅れている」 in **Standard** go to DT-011. Other issues, 「わからない」 and Rapid/Blitz stay outside the trees (AI reference / CA), as before.
  - The increment comes from the time control. No question is asked when every period agrees on "30 s or more". When periods differ, the arbiter picks the period from a list built from the profile. With no or an unconfirmed time control, the increment itself is asked.
  - An increment of 30 s or more gives "recording required" (`immediate`, 8.1.1, discretion under 12.9) without asking about the clock.
  - Under 5:00, or under 5:00 earlier in the period, with an increment under 30 s gives "exempt for the rest of the period" (8.4).
  - A delay, or any unknown answer, gives "consult the CA".
  - No automatic penalty.
- `assessRecordingObligation` also accepts the answer-based inputs `belowFiveNow` and `incrementAtLeast30`. Measured values win when present. New helpers: `recordingIncrement`, `timeControlPeriodOptions`, `recordingPeriodQuestion`.
- `Incident.scoresheetFacts` is new (no Dexie index, no migration).
- Scoresheet issue codes are reportable subtypes for the AI reasoning request (validated by the same function on the server).
- **`game.record-state`** is now `recordOnly` in `requiredFacts` (`RECORD_ONLY_FACTS`).
- **Daily cap for `/api/llm/facts`:** facts keeps the shared cap. It is sent only on an explicit, confirmed tap and has its own per-minute limit (§14.3).

## Important decisions

- **The presence check is not automatic** (fact-model §4.1 planned it per round). D13 requires the arbiter to confirm every external send, so it is an optional card.
- **The presence check is hidden until calibration exists**, so nothing is sent that cannot change the screen.
- **DT-011 asks coarse questions** (under 5:00?, 30 s or more?, which period?) instead of a duration and a move number. These are one tap each on a phone, and 8.4 needs only the comparisons. Only `ss.issue` is mapped to a DT question in the catalogue; the 8.4 facts keep their `appliesWhen` plan.

## Tests and verification

- `npx tsc --noEmit` is clean and `npm run lint` is clean.
- `npx vitest run`: 83 files / 1616 tests at `c2661c0`, and 1634 after the J2-3 review fixes. New files:
  - `__tests__/llm/providers.test.ts`;
  - `__tests__/llm/fact-presence.test.ts`;
  - `__tests__/facts/presence-ordering.test.ts`;
  - `__tests__/fact-presence-check.component.test.tsx`;
  - `__tests__/dt-011-recording-obligation.test.ts`.
- `npm run build` succeeds and lists `/api/llm/providers`.
- No live API calls.

## Review

- **J2-1:** a separate reviewer gave MERGE. Its should-fix items (providers timeout, the `provider-changed` notice, extra tests, nits) went into J2-2.
- **J2-2:**
  - The first pass was **FIX FIRST**:
    - a presence result could carry over to a new incident;
    - failed or uncalibrated answers were shown as "reordered / not in the report";
    - computed facts were checked;
    - the preview did not list the facts;
    - errors were unhandled.
  - All of these were fixed in `e8c2d35`, and the re-review gave **MERGE**.
- **J2-3:** **FIX FIRST**. PR #10 had already been merged, so the fixes are a follow-up on `feature/fact-catalog` (restarted from `main` at `1fc8f5b`).
  - **Must-fix:** "遅れている" ignored 8.1.3. Being one move behind is legal, but the tree said "intervene immediately". Fixed: DT-011 now asks 「記録していないのは、直前の手だけですか？」 first. "Yes" means no violation (8.1.3). "Unknown" plus "required" means consult the CA.
  - **Should-fix, all fixed:**
    - the exempt result names the 8.5.1 / 8.5.2 steps;
    - period and increment questions are no longer asked when the clock never went below 5:00;
    - the period answer is limited to `MAX_TIME_CONTROL_PERIODS`;
    - the permanent `unknown` issue is documented;
    - added tests: Blitz, 29/30 s, all periods under 30 s, delay plus 30 s, out-of-range period, stored incident without issue, the 8.1.3 cases.
  - New verbatim citations `FIDE_8_1_3`, `FIDE_8_5_1`, `FIDE_8_5_2` (Arbiters' Manual 2025, pp. 29–30), checked against the PDF.
  - Docs: ADR-014 §7 amendment wording, fact-model §3.6 and §3.9.
  - **Re-review: FIX FIRST**, for one wording problem. The option still read "my last move and the opponent's reply", but 8.1.3 allows a one-move lag in either order. It now reads 「双方の最新の手だけ（1手分の遅れ。どちらの手番でも）」.
  - The period and increment questions are now asked only when the clock was, or may have been, below 5:00. This needed a second round, or a condition on 「5分を下回ったか」.
  - The 8.5.1 / 8.5.2 action texts now follow the rules more closely.
  - New visibility-chain tests (36 DT-011 tests).
  - **Final re-review: MERGE.** The comment and doc nits about the old 8.1.3 wording are also fixed.

## Known issues

- The presence card stays hidden until J3 registers a calibration. When it appears, the offer only checks that *some* calibration exists. J3 should check the provider's resolved model, if possible, so an uncalibrated model is not sent text.
- The classifier card's missing-information list from required facts (fact-model §4.3) is not done.
- Scoresheet reports still need a description at report time (`usesStructuredQuestions` is false for scoresheet), even when DT-011 decides.
- `deriveTimeControlFacts` (move number → period) still has no caller. DT-011 asks the period instead.

## Next

J3: evaluation (`scripts/eval-classifier.mjs`, Japanese datasets), the first calibration, the ±0.02 sum tolerance check, and the production switch (`LLM_CLASSIFIER_PROVIDER=jev`, `TYPESAFE_API_KEY`). The user decides on deployment.
