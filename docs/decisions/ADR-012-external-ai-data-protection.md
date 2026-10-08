# ADR-012: Sensitive Gate and PII Redaction for Every External AI Send

**Status:** Accepted. The user decided it on 2026-10-08, and answered Q-DP1 and Q-DP2 the same day. Partly implemented: the pure privacy package and its evaluation (J1a-1, design §10). The guard on every route (J1a-2) and the server re-check (J1a-3) are not implemented yet.

**Date:** 2026-10-08

**Amends:**

- [ADR-007](./ADR-007-gemini-llm-via-server-route.md): what the routes accept and send.
- [ADR-010](./ADR-010-gemini-embeddings-for-semantic-search.md): tournament regulations are de-identified before embedding, and the **global** embedding key is bumped to `gemini-embedding-001@768+deid1`. Every vector is rebuilt once, because backfill, search and the generator only accept one key.

**Design:** [docs/design/external-ai-data-protection.md](../design/external-ai-data-protection.md)

---

## Context

Today the incident description, the article text and search queries go to Gemini nearly as they are. Only fair play is blocked. Adding TypeSafe (ADR-011) led the user to set rules for all external AI on 2026-10-08:

- send only de-identified, minimal data;
- never send identifiers, fair-play or sensitive reports;
- do not rely on Zero Data Retention;
- apply the same to Gemini;
- run the gate before any send;
- do not trust regexes alone;
- keep PII redaction separate from the gate;
- measure false negatives first.

## Decision

1. **One guard for all external AI.** `lib/application/external-ai-guard.ts` is the only caller of `callLlmApi`, and a test enforces it. Every route runs these steps:
   - A. the Sensitive Gate on the raw input;
   - B. PII redaction;
   - C. minimization per route;
   - D. a residual check with independent detectors;
   - E. the Sensitive Gate again on the payload;
   - F. a preview before sending.
2. **The Sensitive Gate is three-state, and applies to incident-derived text only.** Rule text and structured codes are not gated. The verdict is `clear`, `uncertain` or `blocked`, and only `clear` is sent. It has several layers:
   - L0: the fair-play category, with no condition;
   - L1: explicit flags and the arbiter's "外部AIに送らない" switch;
   - L2: contextual regexes;
   - L3: a **registry of context-dependent expressions** (スマホ, 疑い, 倒れた, 薬, サイン, 外部, 離席 …). Each has context patterns and evaluation cases, and it is not a word list. Undecidable occurrences go to the local fallback (Q-DP2);
   - L4: unanalyzable input;
   - L5: the server re-check.
3. **PII redaction is a separate module**, with a fixed rule order and protected `〈…〉` placeholders, so it is idempotent. It uses known identifiers from `PlayerProfile`, `Game.white`/`Game.black` and `Tournament`. The board and round numbers are never sent: the case-by-case check found no decision that needs them.
4. **Gemini:**
   - The reasoning route sends a de-identified description, which includes `situationNote`, and coded observations. It never sends text-kind facts. It sends no `tournamentId`, in the context or in articles.
   - Tournament regulation text gets a narrower redaction: contacts, registered identifiers, labelled IDs and names with an honorific. FIDE and JCF text is unchanged and is not gated.
   - Quotes are validated, and their context extracted, on the sent text. They are then re-identified on the device through **indexed** placeholders (`〈日時1〉` …).
   - Embedding queries are de-identified. This includes the incident description that the reasoning flow uses as its article search query.
   - FIDE and JCF text is unchanged.
5. **The server** accepts only the minimized shapes. It runs the gate and the pattern rules again, and **rejects** (400) any payload either would act on. It never rewrites, and it logs no payload text.
6. **Evaluation:**
   - Gate false negatives must be 0 on at least 180 synthetic sensitive reports, and every false negative is severity 1.
   - False positives are tracked as a secondary metric.
   - PII leaks must be 0 on the covered identifier types.
   - Only synthetic data is used.

## Amendment (2026-10-08, user decision after the J1a-1 review)

- **A known-vocabulary layer (L3v) decides `clear`.** Incident-derived text is sent only when every content word is explained by known chess and incident vocabulary; otherwise it is handled locally. L2 and L3 remain for the `blocked` reasons and the benign phrases.
- **Why:** an independent review found that the term lists let about 115 of 151 independently written sensitive reports through. A list of sensitive words cannot reach 0 false negatives.
- **Accepted trade-off:** free-text reports with words outside the vocabulary get no external AI help. The vocabulary grows only through review, like the term lists, and must never contain sensitive words or single kanji that combine into them.
- Details: design §4.2 (L3v), §10.

## Consequences

**Positive**

- No identifier and no sensitive report leaves the device, for either provider.
- Safety does not depend on one regex list.
- The server cannot be used to send arbitrary text.

**Negative and trade-offs**

- Sensitive incidents (health, harassment and so on) are **not sent to external AI services**. They are handled by the local Decision Trees, the rule engine and fixed forms, with "CAへ確認してください" where no local tree decides (Q-DP1). Future on-device AI is not forbidden, and would need its own ADR.
- The broad L3 vocabulary causes false positives that cost AI help.
- Changing the reasoning payload and re-embedding tournament regulations is extra work.
- Unregistered names without an honorific, and romaji spellings, remain residual risks. They are measured and mitigated, not eliminated.
