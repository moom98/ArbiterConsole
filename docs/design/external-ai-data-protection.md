# Design: Data Protection for External AI (Gemini and TypeSafe)

**Status:** Accepted design, based on the user's decisions of 2026-10-08. Partly implemented: the pure package `lib/domain/privacy/` and the evaluation fixtures in J1a-1 (§10). The guard on every route (J1a-2) and the server re-check (J1a-3) are not implemented yet. Decision record: [ADR-012](../decisions/ADR-012-external-ai-data-protection.md).

**Date:** 2026-10-08

**Related:**

- [jev-classifier-design.md](./jev-classifier-design.md)
- [fact-model.md](./fact-model.md)
- ADR-007 (Gemini routes), ADR-010 (embeddings), ADR-011 (Jev)
- requirements §23 (fair play), §34 (fail safe)

---

## 1. User decisions

From 2026-10-08:

- **D1.** Do not send the report text to TypeSafe as it is. Send only an extracted, de-identified state with the minimum information the decision needs.
- **D2.** Never send identifiers the decision does not need:
  - player names, Player IDs and member IDs;
  - the tournament name, board and round;
  - dates and times;
  - contact details.
  - Board or round is sent only if a decision needs it, after a case-by-case check.
- **D3.** Never send to TypeSafe anything about fair play, suspected cheating, health or medical matters, or other sensitive topics.
- **D4.** Do not rely on Zero Data Retention. Treat everything sent as possibly retained.
- **D5.** **Apply the same de-identification to Gemini.**
- **D6.** Run the Sensitive Gate **before any external send.**
  - Input that the arbiter explicitly entered in the fair-play category is **never** sent, without condition.
- **D7.** Do not treat the sensitive regexes alone as proof of safety.
  - False negatives matter most: sensitive data sent out is the worst error.
  - When the gate cannot decide, or the text looks doubtful, use the local fallback.
- **D8.** The PII redaction and minimization are **separate** from the Sensitive Gate.
- **D9.** The gate evaluation must measure **false-negative rates**, not only false positives. Any false negative is a more serious error than a false positive.
- **D10 (Q-DP1, 2026-10-08).** The rule is "**sensitive incidents are not sent to external AI services**". It is not "no AI is ever used for them".
  - The first implementation handles them with the local Decision Trees, the rule engine and fixed forms.
  - On-device AI in the future is **not** forbidden by this requirement. It would need its own ADR.
  - Fair play stays unconditionally blocked from external sends.
- **D11 (Q-DP2, 2026-10-08).** The doubtful vocabulary is **not a word allow/block list**.
  - Expressions such as スマホ, 疑い, 倒れた, 薬, サイン, 外部 and 離席 are managed as **context-dependent expressions**, each with patterns that include the surrounding words, and with evaluation cases.
  - When the gate cannot tell whether a report is sensitive, it is **not** treated as safe: it goes to the local fallback.

- **D12 (2026-10-08, after the J1a-1 review).** The gate uses a **known-vocabulary (allow-list) layer**: incident-derived text is `clear` only when every content word is explained by known chess and incident vocabulary. Anything else is handled locally.
  - Reason: an independent review found that the term lists (L2, L3) let about 115 of 151 independently written sensitive reports through as `clear`. Adding words cannot reach 0 false negatives, because every new paraphrase is another miss.
  - Trade-off accepted by the user: free-text reports that use words outside the vocabulary get no external AI help (classification falls back to keywords, reasoning to the local handling of §4.3).
  - L2 and L3 stay: they give the `blocked` reasons, and the L3 benign contexts mark safe phrases (for example スマホが鳴った) as known.

- **D13 (2026-10-08, after the second J1a-1 review).** **The arbiter confirms every external send.** Even when the gate gives `clear`, the de-identified payload is shown and nothing is sent until the arbiter confirms that it contains nothing sensitive (one tap, only when AI is used). Step F (§3) is therefore a mandatory confirmation, not just a preview.
  - Reason: the second independent review found that 117 of 270 new sensitive phrases passed the known-vocabulary gate. Sentences about what people do to each other can be written with ordinary chess words (相手を強く押した, 観戦者が助言した), so no lexical gate can guarantee 0 false negatives on free text.
  - **The release condition changes accordingly:** the gate's false-negative rate is measured on held-out sets written by someone other than its author, reported, and kept as low as possible (every miss found is fixed and added as a regression case). It is a filter. The arbiter's confirmation is the final defense. "0 false negatives" is still required on the regression sets.

## 2. Scope: every external AI send

| Route | Provider | What is sent today | After this design |
| --- | --- | --- | --- |
| `/api/llm/classify` | Gemini or Jev (ADR-011) | the report text | gate, then a de-identified narrative (§5) |
| `/api/llm/facts` (new, [fact-model.md](./fact-model.md)) | Jev | (new) | gate, then the de-identified narrative and the IDs of the required facts |
| `/api/llm/reason` | Gemini | description (with `situationNote` appended by `applyIncidentAnswers`), category and subtype, context with `tournamentId`, up to 6 articles (with `tournamentId`) | gate, then the de-identified description and the coded observations; no `tournamentId` anywhere; tournament article text de-identified with a narrower rule set (§5.5, §6) |
| `/api/llm/embed` (query) | Gemini | (a) the search text the arbiter typed on the rule search screen; (b) **the incident description**, because `llm-assist-port` calls `hybridSearch(incident.description)`, which calls `generateQueryEmbedding` | gate, then the de-identified query, for both (a) and (b) (§6) |
| `/api/llm/embed` (document) | Gemini | rule text, including tournament regulations | FIDE and JCF text unchanged (public, no PII); tournament regulations de-identified with the narrower rule set (§5.5) |
| (J4, optional) Jev reasoning check | Jev | (not built) | gate and de-identification required before it can be built |

**Rule:** every call through `callLlmApi` goes through `ExternalAiGuard` (§3). It is the only way to reach `/api/llm/*`. A unit test enforces this: no module except the guard imports `callLlmApi`. `lib/infrastructure/embeddings/generator.ts` and `llm-assist-port.ts` call the guard, not `callLlmApi`.

**Which fields the gate and checks apply to.**

- The Sensitive Gate (§4), the residual check (§5.4) and the server re-check (§7) apply **only to incident-derived text**: the classify and facts narrative, the reasoning description, and embedding queries.
- **Rule text is not gated.** FIDE and JCF articles would always trip them, because of dates, article numbers, "Chief Arbiter", 医 and so on. Rule text is not incident data. Tournament regulations get only the narrower redaction in §5.5.
- **Structured codes** (category, subtype, fact ids, enum answers, numbers) are validated against the catalogue on the server and are not run through text checks.

## 3. Architecture

Everything sits in a new domain package, `lib/domain/privacy/`. It is pure, with no React, no network and no IndexedDB:

```
lib/domain/privacy/
  sensitive-gate.ts      Sensitive Gate (§4): decide whether anything may be sent at all
  pii-redaction.ts       PII redaction (§5.2): replace identifiers with placeholders
  minimization.ts        minimization (§5.3): keep only what the decision needs
  residual-check.ts      independent detectors after redaction (§5.4)
  reidentify.ts          put real names back on the device, for display only (§6.2)
  sensitive-terms.ts     reviewed term data (Appendix A)
lib/application/external-ai-guard.ts
  loads known identifiers (repository), runs gate → redaction → minimization → residual check,
  builds the request; the ONLY caller of callLlmApi
```

**Order for every send.** Each step fails closed, and the original text never leaves the device:

```
input (raw text + structured fields)
  │ A. Sensitive Gate on the RAW text and the category        → BLOCK / UNCERTAIN → local fallback
  │ B. PII redaction (placeholders; mapping stays on device)
  │ C. minimization (only the fields the route needs; length caps)
  │ D. residual check (independent detectors)                  → any hit → local fallback
  │ E. Sensitive Gate again on the redacted incident-derived text → BLOCK / UNCERTAIN → local fallback
  │ F. mandatory confirmation (D13): the arbiter sees the payload and confirms before anything is sent
  ▼
request ─▶ server re-check: the gate and the pattern rules again; reject (400) if either would act
```

The gate (A, E) and the redaction (B) are separate modules with separate tests and separate evaluation metrics (D8). The redaction never decides whether something is sensitive. The gate never changes text.

## 4. Sensitive Gate

### 4.1 Result

`evaluateSensitivity(input) → { verdict: "clear" | "uncertain" | "blocked", reasons: GateReason[] }`

- **Only `clear` may be sent.** `uncertain` and `blocked` both use the local fallback (D7).
- `reasons` are codes, such as `explicit-fair-play`, `health` and `unanalyzable`. They are shown to the arbiter. They are never sent and never logged with text.

### 4.2 Layers

Regexes are only one layer, so no single layer is trusted alone (D7).

| Layer | Check | Verdict |
| --- | --- | --- |
| L0 Explicit category | The arbiter **selected** fair-play, or the incident already has category fair-play. | `blocked`, without condition (D6). This check runs before any text is looked at. |
| L1 Explicit flags | The incident or the arbiter's answers carry a sensitive marker: the "外部AIに送らない" switch (§4.4), or a fair-play flag set earlier in the flow. | `blocked` |
| L2 Known sensitive expressions | High-precision, contextual regexes per class (Appendix A.1): the existing `mentionsFairPlay`, health or medical, harassment or violence or sexual misconduct or discrimination, crime or police, religion or belief, family or minors. The keyword classifier's `fair-play` result also counts. | `blocked` |
| L3 Context-dependent expressions | A registry of ambiguous expressions (Appendix A.2, D11). Each occurrence is judged in its surrounding context: a sensitive context gives `blocked`; a benign context that covers the occurrence and its surroundings gives `clear`; **anything else gives `uncertain`** (local fallback). It is not a word list. | `blocked` / `clear` / `uncertain` per occurrence; the report takes the most severe |
| L3v Known vocabulary (D12) | After redaction (step E) and on the server (L5): every content word must be known. The text is split into runs of kanji, katakana, hiragana and Latin letters; each run must be split completely into vocabulary words (kanji and katakana chess and incident words, SAN moves, a few English rule terms, hiragana grammar: particles, inflections and auxiliaries). A one-kana ending is allowed only right after a stem. Placeholders, digits, punctuation and L3 benign spans are known. It is skipped on the raw text (step A), where names would always be unknown. | `uncertain` when any run is unknown |
| L4 Unanalyzable input | Any of these: more than 10% of characters outside Japanese, Latin, digits and common punctuation; **text that is mostly Latin letters (more than 50% of its letters)**, because the English term lists are small; text over the route's input limit before truncation; a failed residual check (§5.4). | `uncertain` |
| L5 Server re-check | The server runs L2–L4 again on the redacted payload. For `/reason` it also runs L0 on the category it receives. | 400, nothing sent |

**Why L3 exists.** L2 alone would let through paraphrases it does not know, for example "ぐったりしていた" or "トイレから戻らない". L3 accepts many false positives, so that sensitive reports go to the local fallback. A false positive only costs AI help on one report. A false negative leaks sensitive data (D9).

### 4.3 What the local fallback means

Sensitive incidents are not sent to external AI services (D10). The local fallback is the local Decision Trees, the rule engine and fixed forms. It is not a rule against AI in general: on-device AI could later be added through its own ADR.

| Route | Local fallback |
| --- | --- |
| classify | the on-device keyword classifier (as today), with the notice "外部AIには送信していません（理由: …）" |
| facts | none: every required fact is treated as missing and asked ([fact-model.md](./fact-model.md)) |
| reason | **Local handling only:** the Decision Tree where one exists; otherwise the fact plan's fixed form (the observed facts are recorded), the keyword rule search on the device, and a `manual-review` decision "CAへ確認してください". This matches the existing offline path. |
| embed query | keyword search only (as offline) |
| embed document | the document is stored without a vector. It is still found by keyword search. |

### 4.4 Arbiter control

- The report screen has a "外部AIに送らない" switch next to the free-text field. It is off by default, so it adds no tap in the normal case.
- When it is on, L1 blocks every send for this incident.
- This is a non-regex control (D7), for cases the arbiter recognises and the gate does not.

## 5. PII redaction and minimization

### 5.1 Known identifiers

They are loaded on the device by a repository:

- `PlayerProfile.name`, `fideId` and `title` (every tournament);
- `Game.white` and `Game.black` (`name`, `fideId`) of every saved game. Provisional tournaments (ADR-004) type names straight into the game;
- the game currently selected, even if it is not saved yet;
- `Tournament.name`, `venue` and `chiefArbiter`.

Names are matched after these normalizations:

- NFKC;
- folding katakana to hiragana;
- removing spaces and the middle dot `・`.

Family and given names are matched on their own only when the stored name has a space and the part is 2 or more characters.

### 5.2 Rules, in this exact order

Placeholders use `〈…〉` and are **indexed per request**: `〈選手A〉`, `〈選手B〉`, `〈日時1〉`, `〈日時2〉`, `〈ID1〉`, `〈連絡先1〉`, and so on. The same original text gets the same placeholder within one request. Because each placeholder stands for exactly one original, the mapping can be reversed (§6.2).

**Every rule skips text inside `〈…〉`.** This makes the pass idempotent: running it again on its own output changes nothing.

| # | Identifier | Detection (examples) | Replaced with |
| --- | --- | --- | --- |
| 1 | Contact details | email, URL, phone (`0\d{1,4}-\d{1,4}-\d{3,4}`, `\+81…`) | `〈連絡先N〉` |
| 2 | Dates | `YYYY-MM-DD`, `YYYY/MM/DD`, `YYYY年M月D日`, `M/D`, `M月D日`; kanji numerals (`十月八日`); day of the week | `〈日時〉` |
| 3 | Times of day | `H時(M分)?(頃)?`, `午前`/`午後` plus a time; `H:MM` **when it is not a clock reading** (§5.2.1) | `〈日時〉` |
| 4 | Registered identifiers (§5.1) | names, FIDE IDs, titles, tournament name, venue, Chief Arbiter | `〈選手A〉`, `〈選手B〉` … (same name, same letter), `〈ID〉`, `〈大会〉`, `〈会場〉`, `〈人物〉` |
| 5 | Member and player IDs with a label | `(会員\|登録\|JCF\|FIDE\|ID\|番号\|No\.?)\s*[:：]?\s*[A-Za-z0-9-]{3,}`, `[A-Z]{1,4}-?\d{3,}` | `〈ID〉` |
| 6 | Unregistered tournament names | `第N回…(大会\|選手権\|杯\|オープン\|リーグ)`, `…杯`, `…選手権` | `〈大会〉` |
| 7 | Team, school and club names | `…(高校\|中学\|小学校\|大学\|クラブ\|チーム\|支部\|道場\|教室\|同好会)` | `〈団体〉` |
| 8 | Board, table, round, seat | `第?N(回戦\|ラウンド\|R\|局)`, `(第?N番?\|N番)(ボード\|盤\|テーブル\|卓\|席)`, `(ボード\|盤\|テーブル\|席)N`, `(Round\|Rd\|Board\|Bd\|Table\|B\|R)\s?N`. N may be Arabic or kanji numerals. `N台` is not a board pattern ("スマホ2台"). | `〈盤〉`, `〈ラウンド〉` |
| 9 | IDs | any run of 5 or more digits | `〈ID〉` |
| 10 | Other 4-digit numbers (ratings and so on) | `\d{4}` | `〈数値〉` |
| 11 | Quasi-identifiers | age (`N歳`), school year (`小学N年`, `N年生`), titles (`GM`, `IM`, `FM`, `CM`, `WGM` …) | `〈属性〉` |
| 12 | Unregistered names with an honorific | The run of kanji, katakana or Latin letters directly before さん, 君, くん, ちゃん, 選手, 氏, 様, 先生. It is **not** replaced when the run is a role noun or ends with one: 白, 黒, 白番, 黒番, 相手, 両, 対戦, 当該, 隣, 本人, 女子, 男子, 若手, 年配, 高齢, 子供, ジュニア, シニア, 各, 全, 同, 違反, 該当. Hiragana such as その and の end the run. | `〈人物〉` |
| 13 | Unregistered Latin names | `(Mr\|Ms\|Mrs\|Miss\|Dr)\.? Word`, or two capitalised words in a row that are not in the chess-term allowlist | `〈人物〉` |

**5.2.1 Kept**, because they carry meaning and identify nobody:

- **Clock readings.** `H:MM` or `H:MM:SS` within 6 characters after 残り, 持ち時間, 時計, 表示 or 秒読み, or before 残 — **except** an hour of 3 or more followed by に, から, まで, 頃 or 過ぎ, which is a time of day (時計を14:20に止めた). Near 白, 黒 or フラッグ only readings up to 2:59 count as clock readings (J1a-1 reviews 2 and 3).
- Durations: `30秒`, `5分`, `90分+30秒`.
- Counts: `50手`, `2回目`.
- The colours 白 and 黒, chess terms, and "相手選手".

**5.2.2 Board and round (the case-by-case check, D2).** No current decision needs the board or round numbers.

- Team-order problems are recognised from words like "ボード順".
- The arbiter's own answers about the board order stay on the device, because the decision is made by the arbiter.
- If a future decision needs them, add them through a new ADR.

### 5.3 Minimization, per route

| Route | What is sent | Limit |
| --- | --- | --- |
| classify | `narrative` only. Sentences made only of placeholders and connectives are dropped. | 500 characters |
| facts | `narrative` and the IDs of the facts being checked (the IDs are fixed codes) | 500 characters |
| reason | **Description:** the de-identified description, which includes any `situationNote` text, because `applyIncidentAnswers` appends it. **Category and subtype.** **Fact answers:** codes only. Enum values are codes (for example `pb.device-observed: rang`). Durations are integer seconds (`ss.remaining-time: 299`), so that no `H:MM` text appears. Counts are integers. **`text`-kind facts (`dr.positions` and free observations) are never sent.** **Context:** `competitionType`, `supervisionRegime`, `rulesVersion`. **Articles:** `id`, `source`, `article`, `title`, `page`, `priority`, `content`. FIDE and JCF content is unchanged; tournament content is redacted as in §5.5. Articles keep `sourceName` and `sourceVersion` only for FIDE and JCF; a tournament source gets the fixed `sourceName` "大会規定". **`tournamentId` is removed from both the context and every article.** | today's limits; description at most 1,000 characters |
| embed query | the de-identified query | 200 characters |
| embed document | FIDE and JCF unchanged; tournament regulations de-identified | unchanged |

**IDs that stay internal.** Article `id`s and `tournamentId`s are random identifiers inside the app. The article `id` stays, because the server needs it to check citations. `tournamentId` is removed: no route needs it.

### 5.4 Residual check (fail closed)

The residual check uses detectors that are **independent** of §5.2, because checking exact matches again after exact replacement would always pass. Nothing is sent if any of these finds something:

- a registered identifier found by a looser match: kana-folded, with spaces and `・` removed, or by the family name alone even when the name was stored without a space;
- any run of 3 or more digits, unless it is followed by 手, 秒, 分, 回 or 目;
- any date, time, board or ID pattern from §5.2 left outside placeholders;
- a Latin title followed by a capitalised word;
- (classify and facts) fewer than 8 characters outside placeholders.

A failed residual check makes the gate's L4 `uncertain`, so the local fallback is used.

### 5.5 Tournament regulation text (narrower rules)

Tournament regulations hold content that rules depend on: rating limits ("1600以下"), ages ("12歳以下"), round numbers, start times and dates. The full rule set would erase it. Tournament regulation text, in reasoning articles and embedding documents, therefore gets **only** these rules:

- rule 1 (contact details);
- rule 4 (registered identifiers);
- rule 5 (labelled member and player IDs);
- rule 12 (unregistered names with an honorific).

FIDE and JCF texts get no redaction at all. The residual check and the gate do not run on rule text (§2).

## 6. Gemini specifics (D5)

### 6.1 Reasoning (`/api/llm/reason`)

- The **incident description** and the **observation answers** are de-identified as in §5.
- **Article content** goes through the same pass with the same mapping, so a player name inside a tournament regulation becomes the same placeholder.
- **Quote validation still works.** `output-validator` / `quote-match` compare each quote with the article content that was **sent**: de-identified for tournament regulations, unchanged for FIDE and JCF. They already compare with the sent (truncated) content today.
- **Quote context**, as today: `citationFromArticle` (`llm-decision.ts`) runs `extractQuoteContext(quote, article.content)` on the **sent** `LlmArticle`. This does not change, so the match position is found in the sent text.
- **Then re-identification:** the quote and its before and after context are passed through `reidentify()` with the request's mapping (§6.2). The indexed placeholders make the mapping one to one.
- **Stored form:**
  - `RuleCitation.text` and `quoteContext` store the **re-identified** (original) text. They are local data on the device.
  - `llmRaw` keeps the placeholder form.

### 6.2 Re-identification on the device

- The mapping (indexed placeholder → original) is created per request. It is kept only in memory, on the device, and never sent. Because every placeholder is indexed (§5.2), each one maps back to exactly one original.
- `conclusion` and `actions` from Gemini may contain placeholders. Before display, `reidentify()` replaces them with the original text.
- A placeholder the mapping does not know, for example one invented by the model, is shown as it is. Its decision is marked `validation: needs-review`.
- Stored AI decisions keep the **placeholder** form in `llmRaw`, and the re-identified form only in the displayed fields. A re-sync never sends names back out.

### 6.3 Embeddings

- **Queries** use the gate and the de-identification. A blocked query uses keyword search only.
- **Documents:**
  - FIDE and JCF texts are public and contain no PII, so they are unchanged and are not embedded again.
  - Tournament regulations are de-identified before embedding.
- **Re-embedding.** There is **one global key** today (`EMBEDDING_MODEL.key`):
  - `embedding-backfill.ts` deletes every vector whose `model` differs from it;
  - search and the rule library read only that key;
  - `generator.ts` rejects a response with any other key.
- A per-source key would therefore be deleted or ignored. So the **global key is bumped** to `gemini-embedding-001@768+deid1`.
- "意味検索用データを作成" then rebuilds **every** vector, FIDE and JCF included. That is a one-time cost of a few hundred embedding requests. FIDE and JCF text is still sent unchanged.
- `EMBEDDING_MODEL.id` and `dimensions` stay the same. Only `key` changes, and the server's response check uses the new key.

### 6.4 Sensitive Gate for Gemini

- The gate applies to **every** external route, Gemini included (D6 says "before any external send").
- So a health-related incident is **not sent to Gemini** (D10). It is handled locally, as in §4.3: the Decision Tree or fixed form, the rule search on the device, and "CAへ確認してください" where no local tree decides.
- This is stricter than today, where only fair play is blocked. It follows §34 (fail safe) and D9.
- The user confirmed this on 2026-10-08 (Q-DP1).

## 7. Server side

- The routes accept only the minimized shapes in §5.3. Unknown fields get 400, and old cached clients' `{ text }` gets 400.
- **On incident-derived text only (§2),** the server runs gate layers L2–L4 and the pattern rules (§5.2 rules 1–3 and 5–13) again. For tournament article text it runs only rules 1, 5 and 12 (§5.5). FIDE and JCF text and structured codes are not re-checked. For a correct client the pass is idempotent. **If the gate's verdict is not `clear`, or the pattern pass would change anything, the server returns 400 and sends nothing.** It never rewrites silently, so what is sent is exactly what the arbiter saw in the preview.
- Logs contain codes only: the route, the error code, the upstream status, attempts, the model and token counts. They never contain payload text or upstream error bodies.

## 8. Evaluation (release gate)

Only synthetic data is used. Real tournament reports are never sent to any provider for evaluation.

### 8.1 Sensitive Gate: false negatives first (D9)

**Dataset.** `__tests__/fixtures/privacy/sensitive.ja.json` holds **at least 30 reports for each sensitive class**: fair play, health or medical, harassment or violence, crime or police, religion, family or minors. It includes:

- paraphrases and indirect wording ("ぐったり", "トイレから戻らない", "様子がおかしい");
- hiragana, katakana and kanji variants;
- English (L4 makes mostly-English text `uncertain`, so it must not reach `clear`);
- mixed reports, where a normal clock or illegal-move report also mentions a sensitive matter.

**Metric: the false-negative rate** is the share of sensitive reports that reach `clear`.

- **Release requires 0 false negatives** on the whole set. With at least 180 reports, the 95% upper bound is then under 1.7% (rule of three). Per class, with 30 reports, the bound is about 10%. Increase a class to 100 or more reports if a tighter bound per class is needed.
- Every false negative found later, in any test or in use, is a **severity-1 defect**. Its fix must add the missed wording to the fixtures.

**Secondary metric: the false-positive rate** is the share of the non-sensitive set (the classification evaluation set) that becomes `uncertain` or `blocked`, per category.

- It is reported and tracked, with a target of at most 15% per category. It never outweighs a false negative.
- Reducing false positives is allowed only by adding a benign context to a registry entry, with evaluation cases (Appendix A.3). Weakening L2 or L3 is not allowed.

**Registry evaluation (D11).** `__tests__/fixtures/privacy/context-expressions.ja.json` holds, for every entry in Appendix A.2, at least 3 cases that must be `blocked`, 3 that must be `clear`, and 3 that must be `uncertain` (entries without a benign context have none that are `clear`).

- **Release requires every case to give its expected verdict.**
- A sensitive case that comes out `clear` is a severity-1 false negative.

### 8.2 PII redaction (separate metric)

**Dataset.** `__tests__/fixtures/privacy/pii.ja.json` holds at least 100 reports with identifiers in many forms:

- names: registered, ad-hoc game, unregistered with an honorific, kana variants, a single-kanji surname;
- IDs and member numbers;
- board and round in Arabic and kanji numerals;
- dates and times in every listed format;
- phone numbers, email and URLs;
- team and school names, ages.

**Metric: identifiers left in the output after redaction + minimization + residual check.**

- **Release requires 0** on the identifier types the design covers.
- The known residual risks are reported separately, with their own counts: an unregistered name without an honorific, a romaji spelling.

**Utility.** The classification and fact-presence evaluations run on redacted text, so their accuracy already includes the cost of redaction.

### 8.3 Unit tests

- Gate:
  - each layer and each class;
  - the exception phrases apply only to a full span;
  - L0 blocks fair-play even with harmless text;
  - katakana patterns (カンニング, チート, エンジン, スマホ, トイレ) still match after normalization (A, matching rules);
  - mostly-English text is `uncertain`;
  - L4 cases.
- Redaction:
  - each rule;
  - the order (a phone number or an ISO date is never split);
  - placeholder protection and idempotence;
  - names from ad-hoc games;
  - the kept items (clock readings, "スマホ2台", "相手選手").
- Guard:
  - the only importer of `callLlmApi`;
  - every route goes through A–E;
  - the mapping is never serialized into a request.
- Server: rejects a non-clear gate verdict, a payload that would change, unknown fields, and `{ text }`.
- Reasoning:
  - quotes are checked against the sent content, and their context is extracted there and then re-identified;
  - a `text`-kind fact is never in the request, and durations are sent as seconds;
  - the incident description used for the article search query goes through the gate and redaction;
  - placeholders are re-identified for display;
  - an unknown placeholder is marked `needs-review`.

## 9. Open questions

- **Q-DP1 (answered 2026-10-08).** Sensitive incidents are not sent to external AI services. They are handled locally by Decision Trees, the rule engine and fixed forms. Future on-device AI is not forbidden. Fair play stays unconditionally blocked. See D10.
- **Q-DP2 (answered 2026-10-08).** The list may exist, but not as a word list. It is a registry of context-dependent expressions with context patterns and evaluation cases. Undecidable means local fallback. See D11 and Appendix A.2. 抗議 and 苦情 are now an entry (`protest`) with benign contexts, such as "裁定に抗議".

## 10. Implementation (J1a-1, 2026-10-08)

The pure package exists and is tested; nothing calls it yet (J1a-2 wires it into every route, J1a-3 adds the server re-check).

- **Files** (`lib/domain/privacy/`):
  - `normalize.ts`: NFKC, kana folding (length-preserving, so match positions agree), `DualPattern` (the NFKC pass and the folded pass of Appendix A), name normalization with the original positions.
  - `sensitive-terms.ts`: Appendix A.1 (`SENSITIVE_EXPRESSIONS`) and the A.2 registry (`CONTEXT_EXPRESSIONS`, including one entry per "other doubtful term").
  - `sensitive-gate.ts`: `evaluateSensitivity` with L0–L4. L5 (server) will call the same function.
  - `placeholders.ts`: `PlaceholderMap` (indexed placeholders; `toJSON()` is empty so the map cannot be serialized by mistake), placeholder-protected replacement.
  - `pii-redaction.ts`: `redactPii` with the §5.2 rule order; `mode: "regulation"` applies only rules 1, 4, 5 and 12 (§5.5).
  - `residual-check.ts`, `minimization.ts`, `reidentify.ts`.
  - `protect.ts`: `protectIncidentText`, steps A–E for one incident-derived text and a route (`classify`, `facts`, `reason-description`, `embed-query`). It never returns the original text when it stops.
- **Decisions made while implementing:**
  - **Existing placeholders are reserved.** A `〈…〉` already in the input (typed, or from another map) keeps its number, and new placeholders skip it, so the mapping stays one to one.
  - **Re-identification restores the registered form** of a name (`田中 太郎`), because a family-name-only mention shares the placeholder.
  - **A title followed by a Latin name** (`IM Smith`) replaces both: the title as `〈属性N〉` and the name as `〈人物N〉`.
  - **Chess notation is protected from the board and round rules:** lower-case `b4` is a square; `Bd3` / `Rd1` are moves, so `Bd` / `Rd` need a space or a dot before the number; `1/2-1/2` is not a date.
  - **Raw input limits (L4 `too-long`):** 2,000 characters for classify, facts and the reasoning description, 1,000 for an embedding query. Longer input goes to the local fallback instead of being silently truncated.
  - **Residual check, "family name alone":** for a name stored without a space and starting with two kanji, the first two characters are also checked.
- **Term additions from the evaluation** (Appendix A.3 allows only strengthening):
  - L2 fair play: `フェア\s*プレ`, `ボディ\s*チェック`, `(身体|所持品|持ち物|手荷物)(の)?(検査|チェック)` (false negatives "ボディチェックを断った", "フェアプレーに関する申し立て");
  - L3 terms without a benign context: 家庭, 離婚, 親権 (false negative "家庭のことで集中できない");
  - L3 `smartphone`, sensitive context: also 見た and 使った.
- **First review (2026-10-08): FIX REQUIRED.** The list-based gate missed about 115 of 151 sensitive reports written independently by the reviewer; the 0 false negatives on the author's own fixtures said little. This led to D12 (the known-vocabulary layer, `known-vocabulary.ts`).
- **The known-vocabulary layer** (`unknownVocabulary`):
  - Kanji, katakana and Latin words are listed; hiragana is limited to grammar. Mixed words (負け, 時間切れ, 間違い, 表示が消え …) are listed as whole words, so that general endings such as け or い are not allowed (けが, いたい).
  - Single kanji that combine into sensitive words are excluded (audit): 切 (手を切った), 出 (手を出した), 引 (置き引き), 外 (外来), 合 (押し合った), 揉 (揉み合った), 目 (目を回した; 回目 and similar are words), 起 (起きない), 弱 (弱っていた), 消 (白が消えた).
  - A new registry entry `not-moving`: a person who does not move is sensitive, a clock that does not move is benign.
  - Adding vocabulary needs review and evaluation cases, like the term lists.
- **Other fixes from the first review:** patterns match across line breaks (`s` flag); 「ばかり」 is not abuse, 馬鹿 is; the `sign` benign context requires a document noun (M2); only well-formed placeholders are skipped, any other 〈…〉 is processed as text (M3); `(に|から)(押|触|…)(さ|ら|か)れ` is blocked; redaction of single-kanji surnames (not inside longer kanji words), ラウンド5, kanji-numeral times (not 一時停止), partial dates and eras, 小6/中2, LINE ID; clock readings next to 白, 黒 or フラッグ are kept; a leading role noun (黒番) is kept; 1局目 and English rule terms are kept.
- **Evaluation results (synthetic data, `__tests__/fixtures/privacy/`):**
  - Sensitive Gate: 0 false negatives on the author's 192 reports and on the reviewer's 108 reports (`sensitive-review1.ja.json`, now a regression set, no longer held out). A new held-out set from a second independent review is the release check. 336 registry cases, all with the expected verdict. False positives: 1 of 76 non-sensitive reports, at most 12.5% per category; this set is short and close to the vocabulary, so real free-text reports will have more.
  - PII: 117 reports, **0 identifiers left** in a payload that would be sent, for the covered types. Known residual risks, counted separately: unregistered names without an honorific (3 cases) and **the kana reading of a name registered in kanji** (2 cases, a new class like romaji: the reading cannot be derived without a stored reading).
  - The known PII residual risks (unregistered names without an honorific, kana readings) are not sent: the known-vocabulary layer makes them `uncertain`.
- **Second review (2026-10-08): FIX REQUIRED.** 117 of 270 new sensitive phrases passed the known-vocabulary gate. This led to D13 (mandatory confirmation). Fixes:
  - a benign context marks only its trigger as known, never its `.{0,N}` text (it hid 酒・母 …);
  - characters outside the scripts (emoji) are unknown content;
  - hiragana grammar is split into verbal endings (only after a stem or another ending) and function words (anywhere), and particles are no longer one-kana endings (よっていた, ないていた, はいた);
  - content words removed from the grammar (おかしい, うるさい, やめ…); 助言 removed from the vocabulary;
  - L2 additions: physical contact with a person (except タッチムーブ), third-party advice, pre-arranged results, refusing an inspection, 119 and 110, disability wording, 酔;
  - registry additions: `third-party` (観戦者, 監督, キャプテン, 隣の選手 …: never `clear`), and terms without a benign context: 何か, 大声, 何度も, taking things away (持って帰 …), following (付いて行 …), 帰れない, 呼び止め, 待っている;
  - PII: placeholders have a fixed shape (`〈選手A〉`…`〈選手ZZZ〉`, others 1–999), so typed look-alikes are text; a wall-clock H:MM next to 白/黒/フラッグ is redacted (only up to 2:59 counts as a clock reading there); single-kanji name parts are matched only for the surname and not before a verb ending (田中 勝 must not break 白の勝ち).
- **Results after the second review:** 0 false negatives on all three sets used so far (192 own, 108 from review 1, 117 from review 2, the last two now regression sets). False positives on the 76-report benign set: 6 (7.9%); third parties (キャプテン, 観戦者) are always held back. The second reviewer measured 11 of 80 (13.75%) on its own benign set before the fixes; the fixes added restrictions, so expect more.
- **Third review (2026-10-08): FIX REQUIRED.** Held-out measurement on 208 new phrases: the gate alone let 21 through (10.1%), the whole pipeline sent 35 (16.8%). Fixes:
  - **M1: placeholders from pattern rules hid content words** (妊婦さん → 〈人物1〉さん, リハビリクラブ → 〈団体1〉). `PlaceholderMap` now marks placeholders from rules 6, 7, 12 and 13 (and a name after a title) as *unverified*; step E runs the gate on the text with those restored (`restoreUnverified`, on the device only). Unregistered names therefore always go to the local fallback; registered names stay usable.
  - **M2: wall-clock times after 時計** (§5.2.1 above).
  - kanji numerals inside a word are not round or board numbers (同一局面 was damaged);
  - registry: `third-party` also covers 主将, メンバー, チーム, 他の/別の選手 and 対局者; new `bag` entry (only putting a phone away is benign); new `cannot` entry (押せない, 持てない …); terms 待って, 強く言, 受け取, 次はない; 変 and 指示 removed from the vocabulary;
  - grammar: two one-kana particles in a row cannot build a word (はは, かね); ない and だ are also function words (加算がなかった, 違法だが), while ない still cannot carry a verb ending (ないていた);
  - vocabulary: 間違え, 盤の外, 抜け, 手を離, 指し方, 放置, 撤回, 質問, 段目; `protest` benign context widened (ペアリングの結果に…苦情);
  - a registered one-character name (林) is redacted and checked.
- **Results after the third review:** 0 false negatives, through the gate and through the whole pipeline, on all four sets (192 own, 108 + 269 + 208 from the three reviews; all are now regression sets, so they no longer measure held-out performance). Usefulness: 5 of the reviewers' 80 realistic non-sensitive reports are held back (6.25%).
- **Held-out false-negative rates so far** (each measured before the fixes that followed): list-based gate ~76% (115/151); known vocabulary ~43% (117/270); after review-2 fixes 10.1% gate / 16.8% pipeline (208). The arbiter's confirmation (D13) remains the final defense.
- **Tests:** `__tests__/privacy/{sensitive-gate,gate-evaluation,pii-redaction,protect}.test.ts`. `gate-evaluation` also runs every sensitive set through `protectIncidentText`.

## Appendix A. Sensitive terms (for review)

How the terms are applied:

- **Matching runs twice, and a hit on either counts:**
  - the terms as written, on the **NFKC text** (unfolded), so katakana patterns such as カンニング, チート, エンジン and スマホ in the existing `mentionsFairPlay` keep working;
  - the same terms folded to hiragana, on the text folded to hiragana, to catch spelling variants.
- A term marked *(unfolded only)* runs only on the NFKC text, to avoid false positives created by folding.
- A.1 lists regexes that **block**.
- A.2 is the registry of context-dependent expressions (L3). Each occurrence is `blocked`, `clear` or `uncertain` depending on its context.
- A.3 says how false positives may be reduced.

### A.1 Known sensitive expressions (L2, `blocked`)

| Class | Regex (draft) |
| --- | --- |
| Fair play (existing) | the existing `mentionsFairPlay` (`lib/domain/llm/keyword-classifier.ts`): 不正 (except 不正確 and 不正な手 …), カンニング, チート, refusing an inspection, 金属探知, outside information, help or assistance, using an engine, fair play, cheat |
| Fair play (added) | `(不正\|カンニング\|ソフト\|エンジン\|外部\|スマホ\|スマートフォン\|機器).{0,8}(疑\|うたが\|怪し\|あやし\|不審)`, `(疑\|うたが\|怪し\|あやし\|不審).{0,8}(不正\|カンニング\|ソフト\|エンジン)`, `サインを?(送\|出)\|合図を?(送\|出)\|カンペ\|ずる\|ズル\|イヤホン\|イヤフォン` |
| Health or medical | `体調\|体の具合\|(気分\|体\|お腹\|おなか\|頭)が?.{0,2}(悪\|わる\|痛\|いた)`, `病気\|病院\|医務\|救急\|救護\|発作\|持病\|アレルギー\|妊娠\|診断`, `怪我\|ケガ\|けが(を\|し\|人\|で)` *(unfolded only; plain けが would match 負けが and 見かけが)*, `出血\|嘔吐\|吐いた\|吐き気\|気持ち悪\|めまい\|発熱\|熱が(ある\|出)\|顔色\|意識\|失神\|過呼吸\|けいれん\|痙攣`, `服薬\|薬を(飲\|の)\|薬の(服用\|副作用)`, `障害(者\|が(ある\|あり))\|障がい\|車椅子\|車いす\|補聴器`, `(人\|選手\|プレーヤー\|観客\|子ども\|子供\|方)(が\|は)?.{0,4}倒れ` |
| Harassment, violence, sexual misconduct, discrimination | `ハラスメント\|セクハラ\|パワハラ\|暴力\|暴言\|差別\|いじめ\|痴漢\|盗撮\|つきまと\|脅(迫\|さ\|し)\|バカ\|ばか\|死ね\|体を触\|(相手\|人\|選手)を(押\|突)`, `(人\|選手\|相手\|プレーヤー\|観客\|子ども\|子供\|顔\|頭\|体\|肩)を?.{0,3}(叩\|たた\|殴\|なぐ\|蹴\|け[っら])` |
| Crime or police | `警察\|110番\|盗難\|盗ま\|窃盗\|被害届\|(財布\|スマホ\|携帯\|かばん\|バッグ\|荷物).{0,6}(取られ\|とられ\|なくなっ\|無くなっ)` |
| Religion or belief | `宗教\|礼拝\|お祈り\|信仰` |
| Family or minors | `家庭の事情\|虐待\|保護者.{0,6}(トラブル\|抗議\|口論)` |
| English (for mixed text; mostly-English text is already `uncertain` by L4) | `\b(sick\|ill\|injur\w*\|faint\w*\|collaps\w*\|bleed\w*\|vomit\w*\|ambulance\|medic\w*\|hospital\|harass\w*\|assault\w*\|hit\|punch\w*\|threat\w*\|police\|stol\w*\|theft\|relig\w*\|pray\w*\|abuse\w*)\b` |

### A.2 Context-dependent expressions (L3; user decision Q-DP2, 2026-10-08)

**This is not a word allow/block list.**

- Each expression below is ambiguous on its own. It is managed as an entry in a registry (`CONTEXT_EXPRESSIONS` in `lib/domain/privacy/sensitive-terms.ts`).
- Each entry has:
  - **triggers**: the expression and its spelling variants;
  - **sensitive contexts**: patterns that include the surrounding words, and make the occurrence `blocked`;
  - **benign contexts**: patterns that must cover the trigger occurrence **and** its surroundings, and make that occurrence `clear`;
  - **evaluation cases**: at least 3 each for blocked, clear and uncertain, kept in `__tests__/fixtures/privacy/context-expressions.ja.json`.
- **Every occurrence is judged separately:**
  - a sensitive context makes it `blocked`;
  - a benign context covering it makes it `clear`;
  - **anything else makes it `uncertain`, which means local fallback.** It is never treated as safe.
- The report's verdict is the most severe verdict of any occurrence and of the L2 expressions in A.1.
- Matching uses the rule above: the NFKC text and the hiragana-folded text.

| ID | Triggers | Sensitive context → `blocked` | Benign context → `clear` (must cover the occurrence) | Evaluation cases (blocked / clear / uncertain) |
| --- | --- | --- | --- | --- |
| `smartphone` | スマホ, スマートフォン, 携帯, 電話 | `(スマホ\|携帯).{0,10}(見て\|操作\|画面を\|使って\|調べ\|疑\|怪し)` (possible outside help), `(スマホ\|携帯).{0,6}(取られ\|盗ま\|なくなっ)` (theft) | `(スマホ\|携帯\|電話)(が\|の)?(音\|着信音\|アラーム)?.{0,3}(鳴っ\|鳴り)`, `(スマホ\|携帯)を?(バッグ\|鞄\|指定の場所)に(入れ\|しまっ\|置い)`, `(スマホ\|携帯)の電源(を切\|が切れ\|オフ)` | blocked: 「白がスマホを見ていた」「対局中にスマホで調べていた」「スマホを取られた」 / clear: 「黒のスマホが鳴った」「スマホをバッグに入れていた」「スマホの電源を切っていた」 / uncertain: 「スマホを持っていた」「スマホについて相手が抗議」「スマホがポケットにあった」 |
| `suspicion` | 疑, うたが, 怪し, あやし, 不審 | the A.1 fair-play expressions; `(疑\|怪し\|不審).{0,10}(行動\|動き\|離席\|様子\|人物)` | `(違法手\|反則\|イリーガル\|時間切れ\|フラッグ\|ドロー\|同一局面\|50手\|75手\|タッチ\|触れた駒)(の\|が)(疑\|うたが)` | blocked: 「エンジン使用の疑い」「怪しい行動をしていた」「不審な人物が近くにいた」 / clear: 「違法手の疑いがある」「同一局面の疑いでクレーム」「時間切れの疑い」 / uncertain: 「相手が疑っている」「怪しいと言われた」「疑いをかけられた」 |
| `fell` | 倒れ, 倒し, たおれ | `(人\|選手\|プレーヤー\|観客\|子ども\|子供\|方\|白\|黒)(が\|は)?.{0,4}倒れ` (A.1) | `(駒\|キング\|クイーン\|ルーク\|ビショップ\|ナイト\|ポーン\|時計\|盤)(が\|を)(倒れ\|倒し\|たおれ\|たおし)`, `キングを倒して投了` | blocked: 「選手が倒れた」「観客が倒れている」「白が椅子から倒れた」 / clear: 「駒が倒れた」「キングを倒して投了」「時計が倒れた」 / uncertain: 「倒れそうになった」「倒れていた」「急に倒れた」 |
| `medicine` | 薬, くすり | `服薬\|薬を(飲\|の)\|薬の(服用\|副作用)` (A.1), `(薬\|くすり).{0,6}(必要\|持って\|時間)` | `薬指` | blocked: 「薬を飲む時間だと言った」「薬の副作用で眠い」「服薬のため離席」「薬を持っていた」 / clear: 「薬指で駒を動かした」「薬指が触れた」「左手の薬指で時計を押した」 / uncertain: 「薬と書かれた袋があった」「くすりについて質問された」「薬局へ行った」 |
| `sign` | サイン | `サインを?(送\|出)\|(手\|目\|指)で(サイン\|合図)` (A.1, signals to a player) | `(結果用紙\|棋譜\|スコアシート\|記録用紙)?.{0,8}サイン(漏れ\|忘れ\|がない\|していない\|をしていない\|した\|済み)`, `両者(が\|の)サイン` | blocked: 「観客がサインを送っていた」「仲間が手でサインを出した」「目でサインしていた」 / clear: 「サイン漏れ」「棋譜にサインしていない」「両者のサインがない」 / uncertain: 「サインについてもめた」「サインを求められた」「サインがおかしい」 |
| `outside` | 外部, 外から, 外の人 | `外部.{0,4}(情報\|助言\|援助\|機器\|と連絡)` (A.1) | `外(部)?から(の)?(騒音\|音\|声\|雑音)` | blocked: 「外部から助言を受けていた」「外部と連絡を取っていた」「外部の情報を見た」 / clear: 「外部からの騒音で集中できない」「外部から雑音が聞こえた」「外からの声がうるさい」 / uncertain: 「外部の人が近くにいた」「外の人と話した」「外部に出た」 |
| `left-seat` | 離席, 席を外, 席を離 | `(何度も\|頻繁\|繰り返し\|長時間\|たびたび\|しょっちゅう).{0,8}(離席\|席を外\|席を離\|トイレ)`, `(離席\|席を外).{0,12}(疑\|スマホ\|携帯\|戻らな)` (§23: unusual absences) | `(離席(し)?\|席を外し\|席を離れ)(た\|ていた\|中)(間\|ため\|ので\|に)?.{0,10}(時計\|手番\|時間\|フラッグ\|相手が(指\|手を))` | blocked: 「何度も離席していた」「離席してスマホを触っていた」「離席後なかなか戻らない」 / clear: 「離席中に時計が0になった」「離席していた間に相手が指した」「席を離れたので時計を止めた」 / uncertain: 「白が離席した」「離席を注意した」「席を外していた」 |
| `toilet` | トイレ, 手洗い | `(何度も\|頻繁\|繰り返し\|長時間).{0,6}トイレ`, `トイレ.{0,10}(戻らな\|疑\|スマホ)` | (none: always `uncertain` unless sensitive) | blocked: 「何度もトイレに行く」「トイレから戻らない」「トイレでスマホ」 / clear: — / uncertain: 「トイレに行った」「トイレの場所を聞かれた」「手洗いに行った」 |
| `hit` | 叩, たたい, 殴, 蹴 | the A.1 violence expressions | `時計を(叩\|たたい)`, `(相手の)?時計を強く(叩\|押)` | blocked: 「相手を叩いた」「顔を殴った」「足を蹴った」 / clear: 「時計を叩いた」「相手の時計を叩いた」「時計を強く叩いた」 / uncertain: 「机を叩いた」「手を叩いた」「叩くような音」 |
| `condition` | 具合, 調子 | `体の具合\|(気分\|体\|お腹\|頭)(が\|の)?.{0,2}(悪\|わる\|痛)` (A.1) | `(時計\|盤\|駒\|照明\|椅子\|机)の(具合\|調子)` | blocked: 「体の具合が悪い」「気分が悪いと言う」「お腹が痛い」 / clear: 「時計の具合が悪い」「盤の調子がおかしい」「照明の具合」 / uncertain: 「具合が悪そう」「調子が悪い」「具合を聞いた」 |
| `heat` | 熱 | `発熱\|熱が(ある\|出)` (A.1) | `熱戦`, `熱心` | blocked: 「熱がある」「発熱している」「熱が出た」 / clear: 「熱戦の末に時間切れ」「熱心に観戦」「熱戦が続いた」 / uncertain: 「熱っぽい」「熱い」「熱中症」 |
| `protest` | 抗議, 苦情, 訴え, 異議 | `保護者.{0,6}(抗議\|苦情\|トラブル)`, `(差別\|ハラスメント\|暴言).{0,8}(抗議\|苦情\|訴え)` | `(裁定\|判定\|結果\|クレーム\|時計\|ペアリング\|違法手)(に\|へ)(の)?(抗議\|異議\|苦情)` | blocked: 「保護者が抗議してきた」「暴言について訴えがあった」「保護者から苦情」 / clear: 「裁定に抗議した」「結果に異議を申し立てた」「ペアリングに苦情」 / uncertain: 「相手が抗議した」「苦情があった」「訴えを聞いた」 |
| `minor` | 子ども, 子供, こども, 未成年, 小学生, 中学生, 親, 保護者 | `虐待\|家庭の事情\|保護者.{0,6}(トラブル\|抗議\|口論)` (A.1) | `親指`, `(子ども\|子供\|小学生\|中学生)(の部\|大会\|クラス\|の対局)` | blocked: 「保護者とトラブル」「家庭の事情で」「虐待の話」 / clear: 「親指で駒を押さえた」「子どもの部の対局」「小学生大会」 / uncertain: 「子どもが泣いている」「保護者が呼びに来た」「親が来た」 |

**Other doubtful terms with no benign context.** These are always `uncertain`, unless an A.1 expression makes them `blocked`:

吐, 気持ち, 顔色, 意識, ずる, イヤホン, 戻らな, 様子がおかし, ぐったり, 押しのけ, 突き飛ば, 痛, 血, 医, 病, 救, 障害, 障が, 泣, 怒鳴, 叫, 脅, 威圧, 家族, 性的, 性別, 宗, 祈, 盗, 失くし, 紛失, 警察, 警備, 弁護, 通報

- Each of these is also a registry entry, with an empty benign context and its own evaluation cases.
- A benign context is added only through review, with evaluation cases.

These are deliberately **not** triggers, because they occur in ordinary reports and say nothing sensitive:

- `押した` ("時計を押した")
- `性` ("可能性")
- `警` ("警告")
- `たた` ("ふたたび")
- `いた` ("置いた")

### A.3 How false positives may be reduced

- **Only by adding a benign context to an entry.** It must be a pattern that includes the surrounding words, together with at least 3 clear and 3 uncertain evaluation cases.
- Removing a trigger, or weakening an L2 expression, is not allowed.
- Every change must keep the sensitive evaluation set at **0 false negatives** (§8.1).

### A.4 Regression phrases

These must be `clear`. They are taken from the benign contexts above:

駒が倒れた, 時計を叩いた, 相手の時計を叩いた, 時計の具合が悪い, 違法手の疑いがある, サイン漏れ, 熱戦の末に時間切れ, 薬指で駒を動かした, スマホが鳴った, 手を指さずに時計を押した, 2回目の違法手で警告, メイトの可能性がある, ふたたび同じ局面, 離席中に時計が0になった, 裁定に抗議した

These must be `uncertain`, which means local fallback. They are ambiguous, and not safe:

白が離席した, スマホを持っていた, 相手が抗議した, 手を叩いた, 倒れそうになった, 子どもが泣いている
