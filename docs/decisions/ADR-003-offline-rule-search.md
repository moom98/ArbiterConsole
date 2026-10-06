# ADR-003: Offline Rule Search — Japanese Tokenization, Multilingual Embeddings, Self-hosted Assets

## Status

Accepted (2026-10-06)

Supersedes the embedding model choice in `docs/design/ai-rag-design.md` §4.2 and
the runtime model loading in ADR-001 (Transformers.js section).

## Context

Review of Milestone 1 (Rule Search) found:

1. **Japanese full-text search returned nothing.** Lunr's default `trimmer`
   strips every non-`\w` character (all Japanese text) and its tokenizer splits
   only on whitespace, so Japanese documents produced no usable tokens.
2. **Rule search did not work offline**, contrary to requirement §31
   ("基本的なルール検索と定型Decision Treeは通信不能でも利用できること"):
   - the pdf.js worker was loaded from cdnjs (and as `.js`, which pdfjs-dist v6 no longer ships),
   - Transformers.js fetched the model from the Hugging Face Hub and the ONNX
     runtime WASM from jsDelivr at runtime.
3. **`Xenova/all-MiniLM-L6-v2` is English-only.** The design doc described it
   as multilingual, but it was trained on English data only; Japanese queries
   and the JCF NA seminar material (§5.1 A) are poorly represented.
4. Search results could not be traced back to a source document, edition or
   page (§28, §29, §30).

## Decision

### 1. Japanese tokenization: character bi-grams (no dictionary)

`lib/infrastructure/ai/tokenizer.ts` is applied identically at index and
query time; Lunr's built-in pipeline (trimmer, stemmer, stop-word filter) is
removed on both sides.

- NFKC normalisation + lowercase (full-width digits/letters become ASCII).
- Article numbers (`7.5.4`, `A.4.2`) are kept as a single token; a query for
  `7.5` also prefix-matches `7.5.x`.
- Latin/digit words are single tokens (≥3 chars also prefix-matched).
- Runs of Kanji/Hiragana/Katakana are split into character bi-grams.

Alternatives: TinySegmenter / kuromoji. Rejected for MVP — kuromoji needs a
~20MB dictionary (offline storage, load time); TinySegmenter segmentation
errors on rule terminology (e.g. 違法手, 三回同一局面) cause misses, while
bi-grams give high recall for short arbiter queries without any dictionary.

### 2. Embedding model: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`

- Multilingual (50+ languages incl. Japanese), 384 dimensions, available as a
  quantized ONNX model for Transformers.js v2.
- No query/passage prefixes needed (unlike `multilingual-e5-small`).
- Cost: ~120MB quantized download (vs ~23MB), slower embedding generation.
- Each `Embedding` row stores the model id; vector search ignores embeddings of
  any other model, so data created with the previous model is never compared
  against new query vectors. Re-importing the PDF regenerates them.

### 3. Self-hosted runtime assets (same origin, no CDN at runtime)

| Asset | Location | Produced by | Cached by service worker |
| --- | --- | --- | --- |
| pdf.js worker (legacy build) | `/pdfjs/pdf.worker.min.mjs` | `scripts/copy-runtime-assets.mjs` (runs before `dev`/`build`) | precache |
| ONNX runtime WASM | `/ort/*.wasm` | `scripts/copy-runtime-assets.mjs` | runtime `CacheFirst` |
| Embedding model | `/models/Xenova/...` | `npm run fetch-models` (manual, needs network) | runtime `CacheFirst` |

The model download is pinned to Hugging Face commit
`2c4055b12046f11709e9df2c122e59ffbdc2f900`, and each file is verified after
download (SHA-256 for LFS files, git blob SHA-1 for small JSON files) before it
is installed (`scripts/model-assets.mjs`). `prebuild` runs
`scripts/check-model-assets.mjs`, which **fails the build** when the model is
missing, so a deployment cannot silently ship without semantic search.
Development/CI builds without the model must opt out explicitly with
`ALLOW_MISSING_MODEL=1`.

Transformers.js is configured with `allowRemoteModels = false`,
`localModelPath = "/models/"` and `backends.onnx.wasm.wasmPaths = "/ort/"`.
Transformers.js' own Cache API storage is disabled (`useBrowserCache = false`)
because the service worker already caches `/models/` — otherwise the ~120MB
model would be stored twice. Generated assets are git-ignored (large binaries are not committed). Large
files are excluded from the precache manifest (Workbox size limit) and cached on
first use instead.

pdf.js and Transformers.js are only loaded through dynamic `import()` in the
browser so that SSR/prerender never evaluates them.

The runtime cache rule for `api.anthropic.com` was removed: LLM responses must
never be served from cache.

### 4. Hybrid search scoring and resilience

- Vector (cosine, clamped to [0,1]; similarities below `vectorMinSimilarity`
  = 0.5 contribute 0, because unrelated in-domain articles still score
  ~0.3–0.5) and full-text (Lunr score / max score, dampened by the fraction of
  query tokens matched — at most halved, because long Japanese questions yield
  many bi-grams and therefore low coverage) are normalised before weighting
  (0.6 / 0.4); weights are re-normalised to the methods that succeeded.
- Full-text **coverage** is IDF-weighted over the query's content tokens:
  hiragana-only bi-grams (ます, どう, …) are ignored, bi-grams frequent in the
  corpus (場合, 対局, …) weigh little, and query terms absent from the corpus
  (e.g. 食事) weigh most. A full-text hit is **substantive** when coverage ≥ 0.3.
- Results are split into two groups:
  - **main** (`results`): fused score ≥ `minScore` (0.25) with vector support or
    a substantive full-text match, plus substantive top-3 full-text hits even
    below `minScore` (long Japanese questions). When only full-text search
    succeeded (model missing / not yet cached offline), `minScore` is not
    applied and substantive hits with ≥ 10% of the best score are main.
    Only this group is ordered by source priority.
  - **related** (`related`, max 3): non-substantive top full-text hits (only
    generic words matched). Shown separately as 「関連する可能性のある条文」 in
    relevance order, never mixed into the priority-ordered main results.
- These thresholds are initial values to be tuned with real documents.
- The in-memory Lunr index is rebuilt when a data stamp (rule count + source
  ids) changes, so an import in another tab is picked up.
- Both searches run with `Promise.allSettled`; if one fails the other's results
  are returned with a notice. Only if both fail is an error shown.
- Precedence Tournament > JCF > FIDE > commentary (§6) is an explicit stable
  grouping of the top results, not a score tweak.
- `tournamentId` is an explicit search input. Tournament regulations are only
  searched when their `tournamentId` matches; with no tournament selected they
  are excluded.

### 5. Source traceability (§28–§30)

- New `RuleSource` entity (Dexie table `ruleSources`, schema version 3):
  name, file name, source type, version, published/effective dates, status,
  language, tournamentId, page count.
- `Rule` gains `sourceId` and `page`. The PDF extractor rebuilds lines from
  pdf.js `hasEOL` / y-position and records the page of each article heading.
- When a source type already has an active source (tournament regulations:
  per tournament), the import requires an explicit choice, made in Settings
  via an in-page confirmation (§30: old and current rules must not be mixed
  unconditionally):
  - **supersede**: the existing sources become `superseded`; their rules are
    kept for reference but excluded from search;
  - **keep-both**: both stay active (for different documents of one type,
    e.g. JCF regulations and the NA seminar material).
  The check runs before PDF extraction and again inside the save transaction.
  Matching on the free-text document name was rejected because a typo would
  silently leave two editions active.
- Settings lists every source with a current/old badge and a delete control
  (in-page confirmation) that removes the source, its rules and embeddings.
- Legacy rules imported before schema v3 (no `sourceId`, no edition info) are
  deleted by the next import of the same type. They count as existing data:
  Settings shows 「出典情報のない旧データN件を削除します」 and the import
  requires explicit confirmation.
- Japanese `第N条のM` is parsed as its own article `N-M` (not merged into
  `第N条`), and the tokenizer maps `第N条のM` / `第N条` in text and queries to
  the same `N-M` / `N` tokens.
- Article headings are recognised only at line start and only when the
  previous line does not continue a paragraph (long line without a sentence
  terminator), to avoid wrapped cross-references becoming headings.

## Consequences

- Positive: Japanese and article-number search work offline; search results
  show document, edition and page and open to the full article text; rule
  search keeps working when the model is unavailable.
- Negative: first-time model download is ~120MB and must be done once while
  online; deployments must run `npm run fetch-models`. If the model files are
  missing, import still succeeds (full-text only) and a warning is shown.
- Bi-gram indexing increases index size roughly proportionally to Japanese
  character count; acceptable for the expected corpus (hundreds of articles).
- The model's maximum sequence length is 128 tokens and input is truncated,
  so long articles are embedded from their opening text only (heading, title
  and first sentences). Full-text search still covers the whole article.
  Chunked embeddings (max over chunks) are a possible follow-up.
- Embedding generation runs on the main thread in batches with yields to the
  event loop. Moving it to a Web Worker is a follow-up if import-time UI
  responsiveness proves insufficient on tablets.

## Follow-ups

- **Offline model warm-up**: the model and WASM are cached by the service
  worker only on first use. A "prepare for offline use" action in Settings
  (fetch `/models/**` and `/ort/*.wasm` while online and report cache status)
  is needed so a device is guaranteed to work offline at the venue.
- **Single-CJK-character wildcard noise**: a single kanji/kana query token is
  searched with leading+trailing wildcards, so e.g. a stray 「第」 or 「条」
  matches every bi-gram containing that character. 「第N条」 itself is
  normalised to `N` and unaffected, but single characters left over in a query
  add noise. Acceptable for now: such hits are mostly non-substantive and land
  in the `related` group.
- **No way to reactivate a superseded source**: once superseded, a source can
  only be deleted (or re-imported). A "make current" action in Settings is
  needed for rolling back an edition.
- Web Worker for embedding generation; chunked embeddings for long articles;
  tuning of the score thresholds with real FIDE/JCF documents.
