# Milestone 0–3 Remediation (Review Fixes)

**Completed:** 2026-10-07
**Branch:** `feature/m4-and-review-fixes`
**Merge commits:** `ce755e0` (domain/incident), `4b64753` (rule search), `05e9652` (UI/log)

## Why

A multi-agent review of the Milestone 0–3 code found ruling errors and missing
requirements. The most serious problems:

- DT-001 had an "opponent already moved → no correction" branch, which applies
  only to Rapid/Blitz, and its citations were fabricated or wrong.
- Incident history was counted across all games under the fixed id `demo-game-1`,
  and the offending colour was guessed from the free text.
- The engine silently fell back to the standard rules.
- Japanese full-text search returned nothing.
- Rule search depended on CDNs, so it failed offline.

## Completed work

### Decision logic and incidents (ADR-004)

- **DT-001** was rewritten against the FIDE Laws 2023 / Arbiters' Manual 2025:
  - The game-ended case, the draw exception for a second illegal move when the
    opponent cannot checkmate (with a "わからない → CA" exit), the 7.5.2–7.5.4
    subtypes, the touch-move obligation, the 7.5.3 clock-in-error note, and
    validation of the incident count.
  - Every citation is verbatim, carries edition, page and `pageDocument`, and is
    locked by `__tests__/citations.test.ts`.
- **Explicit ruleset:** competition type, supervision regime and rules version are
  required inputs. The engine never defaults to the standard rules.
- **Structured inputs:** `Incident.playerColor` and `illegalMoveFacts` replace
  free-text parsing.
- **`IncidentCounter`** (`lib/domain/services/incident-counter.ts`) counts only
  incidents that received a penalty, per game and colour. The second-offence
  decision lists the earlier counted incidents.
- **Report flow:** an explicit game-context step that must be confirmed on every
  report, follow-up questions defined in the domain, and a decision-support
  disclaimer.

### Rule search (ADR-003)

- Japanese tokenization: CJK bi-grams, article numbers kept whole, and NFKC
  normalisation.
- Full-text scoring is IDF-weighted. Results are split into "main" hits and
  "関連する可能性のある条文" (possibly related).
- **Offline:**
  - The pdfjs legacy worker, ONNX wasm and multilingual embedding model are
    self-hosted.
  - The model revision is pinned and hash-verified.
  - `prebuild` fails if the model is missing, unless `ALLOW_MISSING_MODEL=1` is
    set.
- **Source traceability:** a `RuleSource` entity and `Rule.sourceId`/`page`
  (Dexie v3). There is an article detail view, and importing a new edition
  requires an explicit supersede or keep-both choice.
- `rule-ingestion.ts` moved to `lib/application/`.

### Incident log / UI

- **Filters** by game, player colour and category, with summary cards that follow
  the active filter.
- **Penalty history:**
  - Per game and offender, with a "違反者不明（旧データ）" bucket for legacy
    records that have no offender colour.
  - Results such as draws and flag-fall outcomes are listed separately as
    "対局結果".
- **CSV export:** follows RFC 4180, adds a BOM and guards against spreadsheet
  formulas.
- **Accessibility:** accessible dialog, `aria-current` on the tab bar, safe-area
  insets, and zoom is no longer blocked.

### Tooling

- `package-lock.json` was regenerated so the rolldown darwin-arm64 binding is
  present. **`npm install` may drop platform bindings — check the lockfile diff
  after installing.**
- `.claude/worktrees/` is excluded from vitest, tsc, eslint and git.

## Verification

- tsc is clean, lint has 0 errors, and `ALLOW_MISSING_MODEL=1 npm run build`
  succeeds. 205 tests passed after the remediation merges.
- Each unit was reviewed by a separate read-only reviewer agent, then fixed and
  re-reviewed until the verdict was MERGE.

## Known issues / follow-ups

- The illegal-move count follows the *suggested* decision, not the arbiter's
  actual ruling (ADR-004).
- Ad-hoc game ids include the local date, so a game's history splits at midnight.
  Milestone 6 addresses this with tournament games (ADR-004).
- Search thresholds are initial values; tune them with real PDFs. English
  precision is weak (ADR-003).
- If main results are empty but related results exist, the search page still
  shows the "見つかりませんでした" (not found) message.
- Nothing warms the model cache offline, and a superseded rule source cannot be
  reactivated (ADR-003).
