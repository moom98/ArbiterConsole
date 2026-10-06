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

Transformers.js is configured with `allowRemoteModels = false`,
`localModelPath = "/models/"` and `backends.onnx.wasm.wasmPaths = "/ort/"`.
Generated assets are git-ignored (large binaries are not committed). Large
files are excluded from the precache manifest (Workbox size limit) and cached on
first use instead.

pdf.js and Transformers.js are only loaded through dynamic `import()` in the
browser so that SSR/prerender never evaluates them.

The runtime cache rule for `api.anthropic.com` was removed: LLM responses must
never be served from cache.

### 4. Hybrid search scoring and resilience

- Vector (cosine, clamped to [0,1]) and full-text (Lunr score / max score)
  are normalised before weighting (0.6 / 0.4); weights are re-normalised to the
  methods that succeeded. `minScore` applies once, to the fused score.
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
- Importing a source of the same type (and same tournament) **replaces** the
  previous source, its rules and its embeddings in one transaction, so old and
  current editions are never mixed (§30). Keeping superseded editions for
  reference is future work; search already excludes non-`active` sources.

## Consequences

- Positive: Japanese and article-number search work offline; search results
  show document, edition and page and open to the full article text; rule
  search keeps working when the model is unavailable.
- Negative: first-time model download is ~120MB and must be done once while
  online; deployments must run `npm run fetch-models`. If the model files are
  missing, import still succeeds (full-text only) and a warning is shown.
- Bi-gram indexing increases index size roughly proportionally to Japanese
  character count; acceptable for the expected corpus (hundreds of articles).
- Embedding generation runs on the main thread in batches with yields to the
  event loop. Moving it to a Web Worker is a follow-up if import-time UI
  responsiveness proves insufficient on tablets.
