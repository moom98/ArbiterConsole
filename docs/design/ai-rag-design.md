# AI and RAG (Retrieval-Augmented Generation) Design

**Version:** 1.0
**Last Updated:** 2026-10-06
**Status:** Draft

---

## 1. Overview

This document specifies the **AI and RAG architecture** for Arbiter Console. The design prioritizes:

1. **Safety**: Never generate rulings without proper sources (§14, §34)
2. **Offline capability**: Core search works without internet (§31)
3. **Rule priority**: Tournament > JCF > FIDE (§6)
4. **Citation accuracy**: Every ruling must reference articles (§29)
5. **Performance**: Rule search <3s, LLM reasoning <10s (§33)

---

## 2. Requirements Summary

### From Product Requirements

**§5.1: Rule Sources**
- A. JCF NA Seminar Materials
- B. FIDE Laws of Chess (current version only)
- C. Tournament-specific regulations

**§6: Rule Priority**
```
大会固有規定 > JCF規則 > FIDE Laws > 補足資料
```
**Critical**: AI cannot override registered rules with general knowledge.

**§14: AI Constraints**
- **Must**: Cite sources, ask clarifying questions, state uncertainty
- **Must NOT**: Invent rules, speculate, use "たぶん" without sources

**§28: Rule Search**
- Full-text search OR natural language search
- Results include: article number, content, source, page, related articles

**§29: Source Display**
- Format: `FIDE Laws of Chess 7.5.4`
- User can open source to view full text

**§30: Version Management**
- Old rules must not mix with current rules
- Track: name, version, published date, effective date, status

**§31: Offline Requirements**
- Rule本文検索 must work offline
- AI自然言語解析 may require internet, but basic search must be offline

### From ADR-002

- **Decision Trees**: Handle 10 deterministic incidents (offline-capable)
- **LLM+RAG**: Handle 15-20 context-dependent incidents
- **Hybrid**: LLM classifies → Decision Tree rules

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      User Query (Text/Voice)                     │
│                "黒が両手でキャスリングした"                        │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┴────────────────────┐
         │                                         │
         ▼                                         ▼
┌──────────────────────┐              ┌──────────────────────────┐
│   Incident Flow      │              │   Manual Rule Search     │
│   (Decision Support) │              │   (Arbiter-initiated)    │
└──────────────────────┘              └──────────────────────────┘
         │                                         │
         ▼                                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Query Understanding                        │
│  • Extract keywords (違法手, 両手, キャスリング)                   │
│  • Identify competition type from context (Standard/Rapid)       │
│  • Detect article references (e.g., "7.5.5")                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Retrieval Layer (RAG)                       │
│                                                                   │
│  ┌────────────────┐         ┌────────────────┐                  │
│  │ Vector Search  │         │ Full-Text      │                  │
│  │ (Embeddings)   │         │ Search (Lunr)  │                  │
│  │                │         │                │                  │
│  │ • Semantic     │         │ • Keyword      │                  │
│  │   similarity   │         │   matching     │                  │
│  │ • Top-K=10     │         │ • Article #    │                  │
│  │ • Offline-     │         │ • Exact match  │                  │
│  │   capable*     │         │ • Offline      │                  │
│  └────────────────┘         └────────────────┘                  │
│         │                           │                            │
│         └───────────┬───────────────┘                            │
│                     ▼                                            │
│         ┌──────────────────────┐                                 │
│         │  Result Merger       │                                 │
│         │  • Deduplicate       │                                 │
│         │  • Re-rank by score  │                                 │
│         │  • Apply priority    │                                 │
│         └──────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Rule Priority Filter (§6)                     │
│  • Group by source type (tournament/jcf/fide/commentary)         │
│  • Sort by: Tournament > JCF > FIDE > Commentary                │
│  • Within same source: sort by relevance score                   │
│  • Filter out superseded versions (§30)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Conflict Detection (§6)                        │
│  IF multiple sources give conflicting rulings:                   │
│    → Flag for CA escalation                                      │
│    → "複数の規定が関係するためCAへの確認が必要です"               │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┴────────────────────┐
         │                                         │
         ▼ (Manual Search)                         ▼ (Incident Flow)
┌──────────────────────┐              ┌──────────────────────────┐
│  Display Results     │              │   LLM Reasoning          │
│  • Article list      │              │   (Claude Sonnet)        │
│  • Citations         │              │                          │
│  • Expandable text   │              │ • Synthesize articles    │
│                      │              │ • Generate decision      │
│                      │              │ • Cite sources (§29)     │
│                      │              │ • Output validation      │
└──────────────────────┘              └──────────────────────────┘
                                                   │
                                                   ▼
                                      ┌──────────────────────────┐
                                      │  Decision Output (§13)   │
                                      │  • 結論                  │
                                      │  • 今すぐ行うこと        │
                                      │  • 根拠 (citations)      │
                                      └──────────────────────────┘
```

**Note**: *Vector search is offline-capable with pre-computed embeddings and local search algorithm.

---

## 4. Data Ingestion & Preparation

### 4.1 Rule Document Processing

**Input**: PDF or text files (FIDE Laws, JCF materials, tournament regulations)

**Processing Pipeline**:
```
1. Document Upload
   → User uploads PDF/text via admin interface
   → Store in IndexedDB as blob

2. Text Extraction
   → Extract text from PDF (pdf.js or server-side)
   → Detect language (ja/en)

3. Article Chunking
   → Split into articles/sections
   → Heuristics:
     - FIDE: "Article X.Y" markers
     - JCF: Page breaks + section headers
     - Tournament: Custom delimiters (e.g., "§", "規則")
   → Store as Article entities (per domain-model.md)

4. Metadata Extraction
   → Article number (e.g., "7.5.4")
   → Page number
   → Source reference
   → Keywords extraction (TF-IDF or keyword spotting)

5. Embedding Generation (Offline-capable)
   → Generate embeddings for each article
   → Model: all-MiniLM-L6-v2 (multilingual, 384-dim)
   → Run in browser via Transformers.js
   → Store embeddings in IndexedDB

6. Indexing
   → Full-text index (Lunr.js)
   → Vector index (in-memory for fast search)
```

**Storage Schema** (IndexedDB via Dexie.js):
```typescript
// Per domain-model.md
interface RuleSource {
  id: string;
  name: string;
  version: string;
  publishedDate: Date;
  effectiveDate: Date;
  status: 'active' | 'superseded' | 'draft';
  sourceType: 'tournament' | 'jcf' | 'fide' | 'commentary';
  priority: number;  // Derived from sourceType + tournamentId
  tournamentId?: string;  // If tournament-specific
  language: 'ja' | 'en';
  sourceUrl?: string;
  // Blob storage
  documentBlob?: Blob;  // Original PDF
}

interface Article {
  id: string;
  sourceId: string;
  articleNumber: string;  // e.g., "7.5.4"
  page?: number;
  title?: string;
  content: string;  // Full text
  keywords: string[];
  language: string;
}

interface ArticleEmbedding {
  id: string;
  articleId: string;
  embedding: number[];  // 384-dim vector
  model: string;  // "all-MiniLM-L6-v2"
  generatedAt: Date;
}
```

### 4.2 Embedding Model Selection

**Chosen Model**: `Xenova/all-MiniLM-L6-v2`

**Rationale**:
- ✅ **Multilingual**: Supports Japanese and English
- ✅ **Small size**: ~23MB, loads quickly in browser
- ✅ **Fast inference**: ~50-100ms per query on modern devices
- ✅ **Offline-capable**: Runs via Transformers.js (WebAssembly)
- ✅ **Good quality**: Semantic similarity performs well for rule matching

**Alternative Considered**: `intfloat/multilingual-e5-small`
- Slightly better quality, but slower inference
- Rejected for performance reasons (§33)

**Embedding Dimensions**: 384
- Small enough for fast search (cosine similarity on 384-dim vectors is ~0.1ms)
- IndexedDB storage: ~1.5KB per article

### 4.3 Rule Version Management (§30)

**Problem**: FIDE publishes new versions of Laws of Chess. Old tournaments may use old rules.

**Solution**:
```typescript
interface RuleSourceVersion {
  sourceId: string;
  version: string;  // "2023", "2025", etc.
  effectiveDate: Date;
  status: 'active' | 'superseded';
}

// When searching, filter by status
function getActiveRules(tournamentDate: Date): RuleSource[] {
  return ruleSources.filter(source => {
    if (source.status === 'superseded') return false;
    if (source.effectiveDate > tournamentDate) return false;
    return true;
  });
}
```

**UI**:
- Admin interface shows all versions with status badges
- Active rules: Green badge "現行"
- Superseded rules: Gray badge "旧版"
- Users can view old rules for reference, but cannot cite in new tournaments

---

## 5. Retrieval Strategies

### 5.1 Vector Search (Semantic Similarity)

**Algorithm**: Cosine similarity between query embedding and article embeddings

**Process**:
```typescript
class VectorSearch {
  private model: TransformersModel;
  private articleEmbeddings: ArticleEmbedding[];

  async initialize() {
    // Load model (cached in browser after first load)
    this.model = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );

    // Load all embeddings from IndexedDB
    this.articleEmbeddings = await db.embeddings.toArray();
  }

  async search(
    query: string,
    topK: number = 10,
    filters?: SearchFilters
  ): Promise<ScoredArticle[]> {
    // 1. Generate query embedding
    const queryEmbedding = await this.model(query, {
      pooling: 'mean',
      normalize: true
    });

    // 2. Apply filters (source type, tournament, competition type)
    let candidates = this.articleEmbeddings;
    if (filters?.sourceTypes) {
      candidates = await this.filterBySourceType(candidates, filters.sourceTypes);
    }
    if (filters?.tournamentId) {
      candidates = await this.filterByTournament(candidates, filters.tournamentId);
    }

    // 3. Compute cosine similarity
    const scored = candidates.map(embedding => ({
      articleId: embedding.articleId,
      score: this.cosineSimilarity(
        queryEmbedding.data,
        embedding.embedding
      )
    }));

    // 4. Sort by score and take top-K
    const topResults = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // 5. Fetch full articles
    return await this.hydrateArticles(topResults);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

**Performance**:
- Query embedding generation: ~100ms
- Cosine similarity (1000 articles): ~10ms
- Total: <200ms (well under §33's 3s target)

### 5.2 Full-Text Search (Keyword Matching)

**Library**: Lunr.js (lightweight, offline-capable)

**Index Fields**:
- `articleNumber` (boost: 3.0) - Highest priority
- `title` (boost: 2.0)
- `content` (boost: 1.0)
- `keywords` (boost: 1.5)

**Process**:
```typescript
class FullTextSearch {
  private index: lunr.Index;

  async initialize() {
    const articles = await db.articles.toArray();

    this.index = lunr(function() {
      this.ref('id');
      this.field('articleNumber', { boost: 3 });
      this.field('title', { boost: 2 });
      this.field('content', { boost: 1 });
      this.field('keywords', { boost: 1.5 });

      articles.forEach(article => {
        this.add({
          id: article.id,
          articleNumber: article.articleNumber,
          title: article.title,
          content: article.content,
          keywords: article.keywords.join(' ')
        });
      });
    });
  }

  search(query: string, topK: number = 10): ScoredArticle[] {
    const results = this.index.search(query);
    return results.slice(0, topK).map(result => ({
      articleId: result.ref,
      score: result.score,
      matchedKeywords: Object.keys(result.matchData.metadata)
    }));
  }
}
```

**Special Handling**:
- Article number queries (e.g., "7.5.5") → exact match, highest priority
- Japanese tokenization: Use built-in Lunr stemmer (basic support)
- English tokenization: Standard Lunr pipeline

### 5.3 Hybrid Search (Best of Both Worlds)

**Strategy**: Combine vector and full-text results with weighted scoring

```typescript
class HybridSearch {
  constructor(
    private vectorSearch: VectorSearch,
    private fullTextSearch: FullTextSearch
  ) {}

  async search(
    query: string,
    topK: number = 10,
    filters?: SearchFilters
  ): Promise<ScoredArticle[]> {
    // Run both searches in parallel
    const [vectorResults, textResults] = await Promise.all([
      this.vectorSearch.search(query, topK * 2, filters),
      this.fullTextSearch.search(query, topK * 2)
    ]);

    // Merge and re-score
    const merged = this.mergeResults(vectorResults, textResults);

    // Sort by combined score
    return merged
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, topK);
  }

  private mergeResults(
    vectorResults: ScoredArticle[],
    textResults: ScoredArticle[]
  ): ScoredArticle[] {
    const scoreMap = new Map<string, ScoredArticle>();

    // Add vector results (weight: 0.6)
    vectorResults.forEach(result => {
      scoreMap.set(result.articleId, {
        ...result,
        vectorScore: result.score,
        textScore: 0,
        combinedScore: result.score * 0.6
      });
    });

    // Add/merge text results (weight: 0.4)
    textResults.forEach(result => {
      const existing = scoreMap.get(result.articleId);
      if (existing) {
        existing.textScore = result.score;
        existing.combinedScore += result.score * 0.4;
        existing.matchedKeywords = result.matchedKeywords;
      } else {
        scoreMap.set(result.articleId, {
          ...result,
          vectorScore: 0,
          textScore: result.score,
          combinedScore: result.score * 0.4
        });
      }
    });

    return Array.from(scoreMap.values());
  }
}
```

**Rationale for Weights**:
- Vector (0.6): Better for semantic queries ("違法手のペナルティは？")
- Text (0.4): Better for article lookups ("7.5.5") and exact keywords

**Adaptive Strategy**:
- If query matches article number pattern → boost text weight to 0.8
- If query is long natural language → boost vector weight to 0.8

---

## 6. Rule Priority Application (§6)

**Requirement**: `Tournament > JCF > FIDE > Commentary`

**Implementation**:
```typescript
class RulePriorityResolver {
  applyPriority(
    articles: ScoredArticle[],
    tournamentId: string
  ): ScoredArticle[] {
    // 1. Assign priority scores
    const withPriority = articles.map(article => {
      const source = article.source;
      let priorityBoost = 0;

      if (source.sourceType === 'tournament' && source.tournamentId === tournamentId) {
        priorityBoost = 1000;  // Highest
      } else if (source.sourceType === 'jcf') {
        priorityBoost = 100;
      } else if (source.sourceType === 'fide') {
        priorityBoost = 10;
      } else {
        priorityBoost = 1;  // Commentary
      }

      return {
        ...article,
        priorityScore: article.combinedScore + priorityBoost
      };
    });

    // 2. Re-sort by priority score
    return withPriority.sort((a, b) => b.priorityScore - a.priorityScore);
  }

  detectConflicts(articles: ScoredArticle[]): ConflictDetection {
    // Group by article topic (heuristic: similar article numbers or keywords)
    const groups = this.groupBySimilarity(articles);

    for (const group of groups) {
      const sources = new Set(group.map(a => a.source.sourceType));

      // If multiple source types in same topic group → potential conflict
      if (sources.size > 1) {
        // Check if rulings differ
        const rulingsMatch = this.compareRulings(group);
        if (!rulingsMatch) {
          return {
            hasConflict: true,
            conflictingArticles: group,
            recommendation: 'consult-ca',
            reason: '複数の規定が関係するためCAへの確認が必要です。'
          };
        }
      }
    }

    return { hasConflict: false };
  }
}
```

**Edge Case Handling**:
- **No tournament rules**: Use JCF > FIDE
- **Tournament rules override FIDE**: Explicitly show "大会規則により異なる処置" in decision
- **JCF and FIDE agree**: Cite both for stronger justification

---

## 7. LLM Integration

> **Note (ADR-006):** The LLM provider is now **Google Gemini**, called only through the server Route Handlers `app/api/llm/*`. The API key is never sent to the browser. Claude/Anthropic references below are historical. See [ADR-006](../decisions/ADR-006-gemini-llm-via-server-route.md).
>
> **As implemented (Milestone 5):**
> - Models: `GEMINI_MODEL_REASONING` (default `gemini-flash-latest`) and `GEMINI_MODEL_CLASSIFIER` (default `gemini-flash-lite-latest`), with structured output via `responseJsonSchema`. Citation `articleId` is restricted to the IDs of the articles that were sent.
> - Retrieval (§5) runs on the client (`lib/infrastructure/llm/llm-assist-port.ts`). Up to 8 articles, each truncated to 4,000 characters, are sent to `/api/llm/reason`.
> - Output validation (§7.3) is `lib/domain/llm/output-validator.ts` (pure). Citations use the Rule.id instead of sourceName and articleNumber. Quotes must match the article text that was sent. Confidence `high` is capped to `medium`.
> - Prompt caching (§7.4) is not used.


### 7.1 Model Selection

**Primary Model**: Claude Sonnet 4.5 (claude-sonnet-4-5-20250929)

**Rationale**:
- ✅ Long context window (200K tokens) - can include many articles
- ✅ Excellent instruction-following - respects citation requirements
- ✅ Structured outputs - JSON mode for Decision schema
- ✅ Tool use - can call rule lookup during reasoning
- ✅ Japanese language support

**Secondary Model (for classification)**: Claude Haiku 4 (claude-haiku-4-20250514)

**Rationale**:
- ✅ Faster (~2-3s vs. 5-10s)
- ✅ Cheaper (~1/10 cost of Sonnet)
- ✅ Sufficient for simple classification tasks

### 7.2 Prompt Engineering

**System Prompt Template** (for LLM Reasoner):
```
あなたはチェス大会のアービター支援システムです。あなたの役割は：

1. 提供されたルール資料を検索し、引用する
2. 適用される規則を明確に説明する
3. 不確実な場合はCAへの確認を推奨する

重要な制約：
- すべての裁定にArticle番号を引用すること（必須）
- 存在しない規則を作り出したり、存在しないArticleを引用してはいけない
- 適用される規則が見つからない場合は「該当する規則が見つかりませんでした。CAへ確認してください。」と答えること
- 複数の規則が競合する場合は「複数の規定が関係するためCAへの確認が必要です。」と答えること
- 「たぶん」「一般的には」「通常」だけを根拠にPenaltyを確定してはいけない
- チェスの助言（「この手が良い」など）をしてはいけない
- 大会固有規則はFIDEルールより優先される

検索された資料：
{retrieved_articles}

大会情報：
- 大会名: {tournament_name}
- 競技形式: {competition_type}
- Rapid規則: {rapid_rules_type}
- 大会固有規則: {tournament_regulations}

Incident情報：
- カテゴリ: {category}
- 説明: {description}
- 対局情報: {game_context}

出力形式（必ずJSON形式で返すこと）：
{
  "conclusion": "裁定の結論（1文）",
  "actions": ["今すぐ行うこと（箇条書き）"],
  "intervention": "immediate | wait-for-claim | consult-ca | undetermined",
  "penalties": [
    {
      "type": "warning | time-addition-opponent | ...",
      "description": "説明"
    }
  ],
  "sources": [
    {
      "sourceName": "資料名",
      "articleNumber": "Article番号",
      "text": "該当箇所の引用",
      "relevance": "この規則が適用される理由"
    }
  ],
  "confidence": "high | medium | low | none",
  "escalationRecommended": true/false,
  "escalationReason": "CAへの確認が必要な理由（該当する場合）"
}

注意：
- 必ず検索された資料から引用すること
- sourcesフィールドは必須（空配列は不可）
- confidenceがlow/noneの場合、escalationRecommendedをtrueにすること
```

**Few-Shot Examples** (included in prompt):
```json
// Good example
{
  "conclusion": "Blackの1回目のIllegal Move。",
  "actions": ["時計を止める", "局面を戻す", "Whiteに2分追加"],
  "intervention": "immediate",
  "penalties": [{
    "type": "time-addition-opponent",
    "description": "Whiteに2分追加"
  }],
  "sources": [
    {
      "sourceName": "FIDE Laws of Chess",
      "articleNumber": "7.5.5",
      "text": "If during a game it is found that an illegal move has been completed, the position immediately before the irregularity shall be reinstated...",
      "relevance": "違法手の処置を規定"
    }
  ],
  "confidence": "high",
  "escalationRecommended": false
}

// Bad example (will be rejected by validation)
{
  "conclusion": "たぶん違法手だと思います。",  // ❌ Speculative
  "actions": ["CAに聞いてください"],
  "intervention": "consult-ca",
  "penalties": [],
  "sources": [],  // ❌ No sources cited
  "confidence": "low",
  "escalationRecommended": true
}
```

### 7.3 Output Validation (Critical Safety Layer)

**Per ADR-002**, all LLM outputs must pass validation:

```typescript
interface ValidationResult {
  valid: boolean;
  reason?: string;
  fixes?: Partial<Decision>;  // Auto-corrections if possible
}

class LLMOutputValidator {
  async validate(
    decision: Decision,
    retrievedArticles: Article[]
  ): Promise<ValidationResult> {
    // Rule 1: Must have sources if penalties exist
    if (decision.penalties.length > 0 && decision.sources.length === 0) {
      return {
        valid: false,
        reason: "Penalties without sources"
      };
    }

    // Rule 2: All cited articles must exist in database
    for (const source of decision.sources) {
      const article = await this.findArticle(
        source.sourceName,
        source.articleNumber
      );
      if (!article) {
        return {
          valid: false,
          reason: `Article ${source.articleNumber} not found in ${source.sourceName}`
        };
      }

      // Rule 2b: Cited article must be in retrieved set (prevent hallucination)
      const wasRetrieved = retrievedArticles.some(a =>
        a.articleNumber === source.articleNumber
      );
      if (!wasRetrieved) {
        return {
          valid: false,
          reason: `Article ${source.articleNumber} was not in retrieved context`
        };
      }
    }

    // Rule 3: Low confidence must trigger CA escalation
    if (['low', 'none'].includes(decision.confidence)) {
      if (!decision.escalationRecommended) {
        // Auto-fix: Enable escalation
        return {
          valid: true,
          fixes: {
            escalationRecommended: true,
            escalationReason: 'Low confidence in ruling'
          }
        };
      }
    }

    // Rule 4: No speculative language
    const speculativeWords = [
      'たぶん', 'おそらく', 'と思われる', 'かもしれない',
      'probably', 'likely', 'seems', 'appears'
    ];
    const allText = [
      decision.conclusion,
      ...decision.actions,
      decision.escalationReason || ''
    ].join(' ');

    if (speculativeWords.some(word => allText.includes(word))) {
      return {
        valid: false,
        reason: "Speculative language detected (たぶん, probably, etc.)"
      };
    }

    // Rule 5: Intervention must match escalation
    if (decision.escalationRecommended && decision.intervention !== 'consult-ca') {
      return {
        valid: true,
        fixes: {
          intervention: 'consult-ca'
        }
      };
    }

    return { valid: true };
  }

  private async findArticle(
    sourceName: string,
    articleNumber: string
  ): Promise<Article | null> {
    const sources = await db.ruleSources
      .where('name').equals(sourceName)
      .and(s => s.status === 'active')
      .toArray();

    for (const source of sources) {
      const article = await db.articles
        .where({ sourceId: source.id, articleNumber })
        .first();
      if (article) return article;
    }

    return null;
  }
}
```

**Fallback on Validation Failure**:
```typescript
async function llmReasoningWithValidation(
  incident: Incident,
  context: GameContext,
  articles: Article[]
): Promise<Decision> {
  const rawOutput = await callClaudeAPI(incident, context, articles);

  const validation = await validator.validate(rawOutput, articles);

  if (!validation.valid) {
    // Validation failed → Force CA escalation
    return {
      conclusion: "裁定を確定できません。",
      actions: ["CAへ確認してください。"],
      intervention: 'consult-ca',
      penalties: [],
      sources: [],
      confidence: 'none',
      escalationRecommended: true,
      escalationReason: `LLM出力検証失敗: ${validation.reason}`,
      generatedBy: 'llm'
    };
  }

  // Apply auto-fixes if any
  return { ...rawOutput, ...validation.fixes };
}
```

### 7.4 Cost & Performance Optimization

**Estimated Costs** (per incident):
- Haiku classification: ~$0.001 (1K input + 200 output tokens)
- Sonnet reasoning: ~$0.02 (10K input + 1K output tokens)
- Average per incident: ~$0.015

**Optimization Strategies**:
1. **Prompt Caching** (Claude feature):
   - Cache system prompt + rule articles (changes rarely)
   - Only pay for new incident descriptions
   - Reduces cost by ~50-70%

2. **Decision Tree Routing** (per ADR-002):
   - ~40% of incidents routed to Decision Trees (no LLM cost)
   - Only complex incidents use LLM

3. **Haiku for Classification**:
   - Use cheaper model for initial classification
   - Only use Sonnet for final reasoning

4. **Rate Limiting**:
   - Max 10 requests/minute per user (prevent abuse)
   - Queue requests if limit exceeded

**Performance Targets** (per §33):
- LLM classification (Haiku): <5s
- LLM reasoning (Sonnet): <10s
- Total end-to-end (with RAG): <12s

---

## 8. Citation Generation (§29)

**Requirement**: Display sources as `FIDE Laws of Chess 7.5.4`

**Implementation**:
```typescript
class CitationFormatter {
  format(citation: RuleCitation): string {
    let result = citation.sourceName;

    if (citation.articleNumber) {
      result += ` ${citation.articleNumber}`;
    }

    if (citation.page) {
      result += ` p.${citation.page}`;
    }

    return result;
  }

  // Example outputs:
  // "FIDE Laws of Chess 7.5.4"
  // "JCF NA Seminar 2025 p.48"
  // "大会要項 §4.2"
}
```

**UI Display**:
```tsx
// In DecisionSupportCard component
<div className="sources">
  <h4>根拠</h4>
  {decision.sources.map(source => (
    <div key={source.articleId} className="citation">
      <button onClick={() => openArticle(source.articleId)}>
        {formatCitation(source)}
      </button>
      {source.text && (
        <details>
          <summary>引用箇所</summary>
          <blockquote>{source.text}</blockquote>
          <p className="relevance">{source.relevance}</p>
        </details>
      )}
    </div>
  ))}
</div>
```

**User Can Open Source** (§29):
- Click citation → modal with full article text
- Highlight cited portion
- Show article context (previous/next articles)

---

## 9. Offline Capability (§31)

### 9.1 What Works Offline

✅ **Full-text search** (Lunr.js, fully local)
✅ **Vector search** (pre-computed embeddings, local cosine similarity)
✅ **Decision Trees** (pure TypeScript logic)
✅ **Rule browsing** (IndexedDB)
✅ **Incident logging** (IndexedDB)

❌ **LLM reasoning** (requires Claude API)
❌ **Embedding generation** (Transformers.js works offline, but slow initial load)

### 9.2 Graceful Degradation

**When offline and incident requires LLM**:
```typescript
async function handleIncidentOffline(incident: Incident): Promise<Decision> {
  // Try to route to Decision Tree
  if (canUseDecisionTree(incident.category)) {
    return await executeDecisionTree(incident);
  }

  // Cannot process without LLM → show manual rule search + CA recommendation
  return {
    conclusion: "この事象は詳細な分析が必要です。",
    actions: [
      "「ルール検索」タブで関連規則を確認してください。",
      "インターネット接続を確認するか、CAへ相談してください。"
    ],
    intervention: 'consult-ca',
    penalties: [],
    sources: [],
    confidence: 'none',
    escalationRecommended: true,
    escalationReason: 'オフライン環境のため詳細分析ができません',
    generatedBy: 'offline-fallback'
  };
}
```

**Network Status Detection**:
```typescript
class NetworkStatus {
  isOnline(): boolean {
    return navigator.onLine;
  }

  async testAPIAccess(): Promise<boolean> {
    try {
      await fetch('https://api.anthropic.com/v1/health', {
        method: 'HEAD',
        timeout: 3000
      });
      return true;
    } catch {
      return false;
    }
  }
}
```

**UI Indicator**:
- Status bar shows: "オンライン" (green) or "オフライン" (yellow)
- If offline: "一部機能（AI分析）が制限されています"

---

## 10. Testing Strategy

### 10.1 RAG Testing

**Unit Tests**:
```typescript
describe('VectorSearch', () => {
  it('should return articles with high semantic similarity', async () => {
    const query = '違法手のペナルティ';
    const results = await vectorSearch.search(query, 5);

    expect(results[0].article.articleNumber).toBe('7.5.5');
    expect(results[0].score).toBeGreaterThan(0.7);
  });

  it('should filter by source type', async () => {
    const results = await vectorSearch.search(
      'illegal move',
      5,
      { sourceTypes: ['fide'] }
    );

    expect(results.every(r => r.source.sourceType === 'fide')).toBe(true);
  });
});

describe('FullTextSearch', () => {
  it('should prioritize exact article number matches', async () => {
    const results = await fullTextSearch.search('7.5.5', 5);

    expect(results[0].article.articleNumber).toBe('7.5.5');
    expect(results[0].score).toBeGreaterThan(5.0);  // High boost
  });
});

describe('RulePriorityResolver', () => {
  it('should prioritize tournament rules over FIDE', async () => {
    const articles = [
      { source: { sourceType: 'fide' }, score: 0.9 },
      { source: { sourceType: 'tournament', tournamentId: 'T1' }, score: 0.6 }
    ];

    const sorted = resolver.applyPriority(articles, 'T1');

    expect(sorted[0].source.sourceType).toBe('tournament');
  });

  it('should detect conflicting rules', () => {
    const articles = [
      { articleNumber: '11.1', content: 'Use is prohibited', source: { sourceType: 'fide' } },
      { articleNumber: '§3', content: 'Use is permitted', source: { sourceType: 'tournament' } }
    ];

    const conflict = resolver.detectConflicts(articles);

    expect(conflict.hasConflict).toBe(true);
  });
});
```

### 10.2 LLM Testing

**Mock Tests** (no actual API calls):
```typescript
describe('LLMReasoner', () => {
  it('should cite all sources in output', async () => {
    const mockArticles = [
      { id: '1', articleNumber: '7.5.5', content: '...' }
    ];

    const decision = await reasoner.analyze(incident, context, mockArticles);

    expect(decision.sources.length).toBeGreaterThan(0);
    expect(decision.sources[0].articleNumber).toBe('7.5.5');
  });
});

describe('LLMOutputValidator', () => {
  it('should reject output without sources', async () => {
    const invalidDecision = {
      conclusion: 'Game Loss',
      penalties: [{ type: 'game-loss' }],
      sources: []  // ❌ Invalid
    };

    const result = await validator.validate(invalidDecision, []);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('without sources');
  });

  it('should reject output citing non-existent articles', async () => {
    const invalidDecision = {
      sources: [
        { articleNumber: '99.99.99', sourceName: 'FIDE Laws' }  // ❌ Doesn't exist
      ]
    };

    const result = await validator.validate(invalidDecision, []);

    expect(result.valid).toBe(false);
  });

  it('should auto-fix low confidence without escalation', async () => {
    const decision = {
      confidence: 'low',
      escalationRecommended: false  // Should be true
    };

    const result = await validator.validate(decision, []);

    expect(result.valid).toBe(true);
    expect(result.fixes.escalationRecommended).toBe(true);
  });
});
```

### 10.3 Integration Tests

```typescript
describe('End-to-End RAG Flow', () => {
  it('should process illegal move incident correctly', async () => {
    const incident = {
      description: '黒が両手でキャスリングした',
      category: 'illegal-move'
    };

    const decision = await decisionEngine.processIncident(incident, context);

    expect(decision.conclusion).toContain('Illegal Move');
    expect(decision.penalties.length).toBeGreaterThan(0);
    expect(decision.sources.length).toBeGreaterThan(0);
    expect(decision.sources.some(s => s.articleNumber === '7.5.5')).toBe(true);
  });
});
```

---

## 11. Open Questions & Risks

### Open Questions

1. **Q**: How to handle multilingual rules (FIDE English + JCF Japanese)?
   - **Option A**: Generate separate embeddings for each language
   - **Option B**: Translate JCF to English, single embedding space
   - **Recommendation**: Option A (preserve original language, avoid translation errors)
   - **Status**: To be decided during implementation

2. **Q**: How many articles to include in LLM context?
   - **Trade-off**: More articles = better coverage, but slower + more expensive
   - **Current Plan**: Top 10 articles (fits in ~5K tokens)
   - **Status**: Will tune based on initial testing

3. **Q**: Should we cache LLM responses for identical incidents?
   - **Pro**: Faster, cheaper, consistent
   - **Con**: May miss tournament-specific context changes
   - **Recommendation**: Cache for 1 hour, keyed by (incident + tournament + game context)
   - **Status**: Implement as optimization after MVP

### Risks

1. **Risk**: Embedding model quality insufficient for Japanese chess rules
   - **Likelihood**: Medium
   - **Impact**: High (poor search results)
   - **Mitigation**: Benchmark with real JCF materials; prepare fallback to full-text only
   - **Contingency**: Use larger model (e.g., multilingual-e5-base) if needed

2. **Risk**: LLM hallucinates articles despite validation
   - **Likelihood**: Low (validation checks against DB)
   - **Impact**: Critical (wrong rulings)
   - **Mitigation**: Validation layer + human review + incident log
   - **Contingency**: Add stricter validation (require exact text match from retrieved articles)

3. **Risk**: IndexedDB quota limits (especially with embeddings)
   - **Likelihood**: Medium (mobile browsers have strict limits)
   - **Impact**: Medium (cannot store all rules)
   - **Mitigation**: Compress embeddings (float32 → int8), allow user to manage cache
   - **Contingency**: Server-side storage option for large tournaments

4. **Risk**: Transformers.js performance poor on low-end devices
   - **Likelihood**: Medium
   - **Impact**: Medium (slow search)
   - **Mitigation**: Fallback to full-text search only
   - **Contingency**: Offer server-side embedding generation

---

## 12. Future Enhancements (Post-MVP)

1. **Fine-tuned Embedding Model**
   - Train on FIDE + JCF corpus for better domain-specific embeddings

2. **Semantic Chunking**
   - Instead of article-based chunks, use semantic chunking (langchain)
   - May improve retrieval for complex queries

3. **Query Expansion**
   - Expand user query with synonyms (e.g., "違法手" → "illegal move", "不正な手")

4. **Personalized Search**
   - Learn from arbiter's past queries (click-through rate)

5. **Multi-hop Reasoning**
   - LLM can retrieve additional articles during reasoning (tool use)

6. **Cross-lingual Search**
   - Search Japanese rules with English query (and vice versa)

---

## 13. References

- [Product Requirements](../requirements/product-requirements.md) - §5, §6, §14, §28-31
- [ADR-001: Technology Stack](../decisions/ADR-001-technology-stack.md) - Transformers.js, Claude API
- [ADR-002: Decision Tree & LLM Boundary](../decisions/ADR-002-decision-tree-llm-boundary.md) - Routing logic
- [Architecture](./architecture.md) - Overall system design
- [Domain Model](./domain-model.md) - RuleSource, Article entities

---

## Revision History

- 2026-10-06: Initial version
