# J1a-1: Pure privacy package (Sensitive Gate, PII redaction) with synthetic evaluation

**Status:** Implemented on branch `feature/fact-catalog`. Four separate reviews, each FIX REQUIRED → fixed. Two user decisions on the way (D12 known vocabulary, D13 mandatory confirmation). A final targeted re-review is recorded below.

**Date:** 2026-10-08

**Design:** [external-ai-data-protection.md](../../design/external-ai-data-protection.md) §1 (D12, D13), §4.2 (L3v), §5.2.1, §10. **Decision record:** [ADR-012](../../decisions/ADR-012-external-ai-data-protection.md) with Amendment (D12) and Amendment 2 (D13).

## Completed work

- `lib/domain/privacy/` (pure; nothing calls it yet — J1a-2 wires it into every route, J1a-3 adds the server re-check):
  - `normalize.ts` — NFKC, length-preserving kana folding, `DualPattern` (NFKC + folded pass, `s` flag).
  - `sensitive-terms.ts` — Appendix A.1 expressions (L2) and the A.2 registry (L3), extended by the reviews (third-party, bag, cannot, not-moving, many terms without a benign context).
  - `known-vocabulary.ts` — **L3v** (D12): every content word must be chess/incident vocabulary; hiragana grammar is a state DP (verbal endings only after a stem, function words anywhere, blocked particle pairs); mixed kanji–kana words listed whole; single kanji that compose sensitive words are excluded (audit list in the file header).
  - `sensitive-gate.ts` — `evaluateSensitivity` L0–L4 + L3v (`vocabulary: false` only for the raw text in step A). Benign contexts mark only their trigger as known.
  - `placeholders.ts` — `PlaceholderMap` (fixed placeholder shape, reserve, unverified marks, `restoreUnverified`, empty `toJSON`), `neutralizeBrackets`.
  - `pii-redaction.ts` — §5.2 rules in order, regulation mode (§5.5), single-kanji surnames, kanji times, eras, wall-clock vs clock-reading rules.
  - `residual-check.ts`, `minimization.ts`, `reidentify.ts`, `protect.ts` (`protectIncidentText`, steps A–E; E re-checks unverified placeholders restored).
- `lib/infrastructure/privacy/known-identifiers.ts` — loads registered identifiers from Dexie (J1a-2 groundwork, no test yet).
- Fixtures (`__tests__/fixtures/privacy/`, synthetic only): `sensitive.ja.json` (192), `sensitive-review1..4.ja.json` (108, 269, 208, 252), `context-expressions.ja.json` (registry cases), `benign.ja.json` (76), `benign-review.ja.json` (140), `pii.ja.json` (117 + keep items).
- Tests: `__tests__/privacy/{sensitive-gate,gate-evaluation,pii-redaction,protect}.test.ts` (155). `gate-evaluation` runs every sensitive set through the gate **and** the whole pipeline.

## Important implementation decisions

- **D12 (user, after review 1):** a known-vocabulary allow-list decides `clear`; the term lists only explain `blocked`.
- **D13 (user, after review 2):** the arbiter confirms every external send; the gate is a filter. Release condition: held-out FN rate measured and minimized; 0 FN on regression sets; no covered identifier in a sent payload.
- Unregistered names (and anything a pattern rule swallows) always go to the local fallback (step E restores unverified placeholders before L3v). Registered names stay usable.
- Clock readings: kept after 残り/時計/表示… unless an hour ≥ 3 is followed by に/から/頃…; near 白/黒/フラッグ only ≤ 2:59 and not followed by に/から….

## Tests and verification

- `npx tsc --noEmit` clean; ESLint 0 errors; `npx vitest run` all pass (see current.md for the count); `npm run build` succeeds.
- Held-out FN history: ~76% (list gate) → ~43% (vocabulary) → 10.1% gate / 16.8% pipeline → 0.47% natural (1/211), 29/41 on deliberately composed phrases → those holes fixed. 0 FN on all five regression sets through gate and pipeline.
- Usefulness: 15/144 realistic benign reports held back (10.4%).
- PII: 0 covered identifiers in sent payloads on 117 fixture reports and the reviewers' probes; known residual risks (unregistered names without honorific, kana readings) are stopped by L3v.

## Final targeted re-review

- **FIX REQUIRED:** the usefulness additions after review 4 opened holes (つけた, あれをされた, 手をかけた, 付け回された, はか/でか). Reverted to an allow-list of particle pairs and narrow collocations, added terms; see design §10. 0 false negatives on all regression sets afterwards; 15/144 benign reports held back (10.4%).
- **Second pass:** earlier holes confirmed closed; two more found (手元/指先 in the contact rule, の代わりに出場) and fixed with regression cases.

## Known issues

- Phrases deliberately composed from vocabulary words are the weak spot (review 4: 29/41 before fixes). D13 confirmation is the final defense; each found miss must become a regression case.
- Free-text reports with words outside the vocabulary get no external AI help (by design).
- `known-identifiers.ts` has no test yet (J1a-2).
- Nits left: URL rule swallows following Japanese text (utility only); `KANJI_TIME` has no kanji lookbehind; a typed placeholder already issued in another field re-identifies to that field's original (display only).

## Next

- J1a-2: `external-ai-guard.ts` as the only caller of `callLlmApi`; classify / reason / embed-query / embed-document through `protectIncidentText` and the regulation redaction; the mandatory confirmation UI (D13); the 外部AIに送らない switch; embedding key bump to `+deid1`; re-identification of AI output.
- J1a-3: server re-check (minimized shapes only, gate + pattern rules, 400 on any change).
