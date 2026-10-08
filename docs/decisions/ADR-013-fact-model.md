# ADR-013: Fact Model — Decision Trees Decide Required Facts; Jev Only Checks Explicit Presence

**Status:** Accepted. The user reviewed it twice on 2026-10-08 and approved implementing the catalogue. Not implemented yet.

**Date:** 2026-10-08

**Amends:**

- [ADR-011](./ADR-011-jev-for-incident-classification.md): the missing-information part.
- [ADR-002](./ADR-002-decision-tree-llm-boundary.md): it is refined. The boundary is unchanged, and a model never supplies a Decision Tree input.

**Design:** [docs/design/fact-model.md](../design/fact-model.md). Catalogue: [docs/design/jev-missing-info-catalog.md](../design/jev-missing-info-catalog.md).

---

## Context

The first Jev design showed "the top 5 missing items of the category by probability", from a fixed list and a 0.5 threshold. In the catalogue review the user rejected this and set these rules:

- the Decision Tree decides the facts the current branch needs;
- Jev only answers "is it explicitly stated?";
- thresholds come from evaluation data, and the uncertain range counts as missing;
- every fact has a level (blocking, conditional or optional) and a condition;
- answers are yes / no / unknown, and the trees keep working on unknown;
- questions ask for observations, not judgments;
- `dr.claim-timing` is added;
- the remaining time is recorded and compared in code.

## Decision

1. **Facts** are catalogue data. A shared fact (`game.*`) has one definition, and one usage (level and condition) per category. Each fact has:
   - an observation question;
   - an answer spec, where `unknown` is always available;
   - a level and `appliesWhen`, as data;
   - an optional `dtQuestionId`;
   - `presenceCheckable`;
   - `derivedFrom` for facts from app settings;
   - its sources.
2. **The required facts:**
   - For DT categories, the Decision Tree's `needs-input` is the authority, mapped to facts.
   - For other categories, a pure `requiredFacts()` evaluates the fact plan.
   - An unknown answer never satisfies a condition.
3. **Unknown answers.** `unknown` never stops a tree. `resolveUnknown()` evaluates every possible value:
   - if the branches agree, that decision stands;
   - if they disagree, the result is `manual-review` / `consult-ca`, keeping the immediate actions all branches share;
   - no penalty is applied unless every branch gives the same penalty.
   - `undefined` (not yet answered) still returns `needs-input`.
   - A branch that needs more input counts as disagreeing.
   - Unknown count, duration and text facts, or more than 2 unknown facts, go straight to `manual-review`.
   - `parseBoolean` must keep `unknown`.
   - Draw claims (threefold and 50-move) are in DT-005, and automatic draws in DT-006. Touch move is in DT-007. See [ADR-014](./ADR-014-draw-dt-touch-move-game-history.md).
4. **Observations, not judgments.**
   - The existing judgment questions are reworded or replaced. `opponentCanCheckmate` is replaced by a position-based mate-possibility service (ADR-014 §5). Counts are never enough for "can-mate".
   - Comparisons are made in domain code with rule parameters: remaining time against the limit, minutes late against the default time.
5. **Presence check.**
   - Jev answers one `noul` per required, presence-checkable fact: "explicitly stated?". It goes through `/api/llm/facts`, with the questions built on the server from the catalogue, and through the ADR-012 guard.
   - Presence **only changes how questions are grouped**. It never fills an answer and never skips a question.
   - It is not used with Gemini, offline, for fair-play, or when the gate does not return `clear`. Then every required fact is missing.
6. **Calibrated thresholds.**
   - There are per-model calibration files with per-fact presence thresholds and the category thresholds. They are chosen by the evaluation script: lowest `t` with precision ≥ 0.97 and a Wilson lower bound ≥ 0.90, then confirmed on a held-out set.
   - A missing calibration or a missing fact entry means everything is missing (uncalibrated mode).

## Consequences

**Positive**

- No model output becomes a Decision Tree input. The arbiter always answers.
- The questions follow §12, and are limited to what changes the ruling on the current branch.
- `unknown` gives a safe, defined result instead of a stuck flow.

**Negative and trade-offs**

- Presence saves no taps: it only orders the questions. Value suggestion (Q-F1) is deliberately left out.
- Every DT question needs an `unknown` option, and DT-001…007 need `resolveUnknown` with tests. This is significant domain work.
- Calibration needs a labelled synthetic dataset per model version.
