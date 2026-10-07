# Arbiter Console System Architecture

**Version:** 1.0
**Last Updated:** 2026-10-06
**Status:** Draft

---

## 1. Overview

Arbiter Console is an **offline-first, mobile-optimized Decision Support system** for chess tournament arbiters. The architecture prioritizes:

1. **Offline capability**: Core functionality works without internet
2. **Performance**: Instant response for deterministic decisions
3. **Separation of concerns**: Domain logic independent of UI framework
4. **Fail-safe behavior**: No speculative rulings, explicit CA escalation
5. **Maintainability**: Clear separation between LLM and rule-based logic

---

> **Note (ADR-006):** The LLM provider is now **Google Gemini**, called only through the server Route Handlers `app/api/llm/*`. The API key is never sent to the browser. Claude/Anthropic references in this document are historical. See [ADR-006](../decisions/ADR-006-gemini-llm-via-server-route.md).

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Presentation Layer                       │
│  (Next.js 14 + React 18 + Digital Agency Design System)         │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Incident   │  │    Round     │  │     Rule     │           │
│  │   Reporting  │  │  Checklist   │  │    Search    │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Application Layer                         │
│                    (Zustand State Management)                    │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Tournament  │  │   Incident   │  │   Decision   │           │
│  │    Store     │  │    Store     │  │    Store     │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Domain Layer                            │
│             (Framework-agnostic TypeScript modules)              │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐        │
│  │              Decision Engine (Orchestrator)          │        │
│  │  • Incident classification                           │        │
│  │  • Route to Decision Tree or LLM                     │        │
│  │  • Generate follow-up questions                      │        │
│  │  • Assemble Decision Support output                  │        │
│  └──────────────────────────────────────────────────────┘        │
│                              │                                    │
│         ┌────────────────────┼────────────────────┐              │
│         ▼                    ▼                    ▼              │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐          │
│  │  Decision   │   │  LLM-based   │   │     Rule     │          │
│  │    Trees    │   │   Reasoning  │   │   Retrieval  │          │
│  │             │   │              │   │              │          │
│  │  • Illegal  │   │  • Classify  │   │  • Vector    │          │
│  │    Move     │   │  • Generate  │   │    search    │          │
│  │  • Flag Fall│   │    questions │   │  • Full-text │          │
│  │  • Draw     │   │  • Explain   │   │    search    │          │
│  │    Claim    │   │    to player │   │  • Priority  │          │
│  └─────────────┘   └──────────────┘   └──────────────┘          │
│                                                                   │
│  Domain Models: Tournament, Incident, Penalty, RuleSource        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Infrastructure Layer                        │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  IndexedDB   │  │  Claude API  │  │  Web Speech  │           │
│  │  (Dexie.js)  │  │   (Sonnet)   │  │     API      │           │
│  │              │  │              │  │              │           │
│  │  • Rules     │  │  • Classify  │  │  • Voice     │           │
│  │  • Incidents │  │  • Reason    │  │    input     │           │
│  │  • Embeddings│  │  • Explain   │  │              │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐                              │
│  │ Transformers │  │     PWA      │                              │
│  │     .js      │  │Service Worker│                              │
│  │              │  │              │                              │
│  │  • Embedding │  │  • Offline   │                              │
│  │    generation│  │    cache     │                              │
│  │  • Vector    │  │  • Sync      │                              │
│  │    search    │  │              │                              │
│  └──────────────┘  └──────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Layer Responsibilities

### 3.1 Presentation Layer

**Technology:** Next.js 14 App Router + React 18 + Digital Agency Design System

**Responsibilities:**
- Render UI components (buttons, forms, cards)
- Handle user interactions (taps, voice input)
- Display Decision Support results
- Navigate between screens
- Show loading states and errors

**Constraints:**
- **NO business logic** in React components (per `.claude/rules/frontend.md`)
- **NO direct API calls** (use Application Layer services)
- **NO chess rule evaluation** (delegate to Domain Layer)

**Key Components:**
- `IncidentReportForm`: Capture incident details
- `DecisionSupportCard`: Display ruling recommendations
- `RoundChecklistView`: Arbiter's pre/post-round tasks
- `RuleSearchPanel`: Search and browse rules
- `PenaltyHistoryList`: Show player penalty records

### 3.2 Application Layer

**Technology:** Zustand (state management)

**Responsibilities:**
- Manage global application state
- Coordinate between UI and Domain Layer
- Handle async operations (API calls, DB queries)
- Persist state to IndexedDB (via Zustand middleware)

**Key Stores:**
- `useTournamentStore`: Current tournament, rounds, games
- `useIncidentStore`: Active incident, history
- `useDecisionStore`: Current decision support output
- `useRuleStore`: Rule sources, articles
- `useSettingsStore`: User preferences, clock model

**State Flow Example:**
```typescript
// User reports incident
1. UI calls: incidentStore.reportIncident(description, gameId)
2. Store calls: DecisionEngine.classifyIncident(description)
3. DecisionEngine routes to LLM or Decision Tree
4. Store updates: decisionStore.setDecision(result)
5. UI re-renders with decision support
```

### 3.3 Domain Layer

**Technology:** Pure TypeScript (framework-agnostic)

**Responsibilities:**
- Implement chess arbitration rules
- Execute Decision Trees
- Coordinate LLM-based reasoning
- Manage rule retrieval and priority
- Generate structured outputs (§13: Decision Support format)

**Core Modules:**

#### DecisionEngine (Orchestrator)
```typescript
class DecisionEngine {
  async processIncident(
    incident: IncidentInput,
    context: GameContext
  ): Promise<DecisionOutput> {
    // 1. Classify incident (LLM or keyword matching)
    const classification = await this.classifyIncident(incident);

    // 2. Route to Decision Tree or LLM
    if (this.hasDeterministicTree(classification.category)) {
      return this.executeDecisionTree(classification, context);
    } else {
      return this.llmReasoning(classification, context);
    }
  }

  private hasDeterministicTree(category: IncidentCategory): boolean {
    // Per §35: High-frequency, high-risk incidents use Decision Trees
    return [
      'illegal-move',
      'flag-fall',
      'draw-claim-threefold',
      'draw-claim-50move'
    ].includes(category);
  }
}
```

#### Decision Trees
```typescript
// Example: Illegal Move Decision Tree (Standard)
class IllegalMoveStandardTree {
  evaluate(input: IllegalMoveInput): DecisionOutput {
    // 1. Check if clock was pressed
    if (!input.clockPressed) {
      return this.notAnIllegalMove();
    }

    // 2. Check if opponent moved
    if (input.opponentMoved) {
      return this.tooLateToCorrect();
    }

    // 3. Check incident count for this player
    const count = input.playerIncidentCount + 1;

    if (count === 1) {
      return this.firstIllegalMove(input);
    } else if (count >= 2) {
      return this.secondIllegalMove(input);
    }
  }

  private firstIllegalMove(input: IllegalMoveInput): DecisionOutput {
    return {
      conclusion: `${input.playerColor}の1回目のIllegal Move。`,
      actions: [
        '時計を止める',
        '局面をIllegal Move直前へ戻す',
        `${input.opponentColor}に2分追加`,
        `${input.playerColor}に正しい手を指させる`
      ],
      intervention: 'immediate',
      penalties: [{
        type: 'time-addition',
        player: input.opponentColor,
        timeSeconds: 120
      }],
      sources: [
        { article: 'FIDE Laws 7.5.4', page: null },
        { article: 'JCF NA Seminar p.48', page: 48 }
      ]
    };
  }
}
```

#### LLM-based Reasoning
```typescript
class LLMReasoner {
  async analyzeIncident(
    incident: IncidentClassification,
    context: GameContext,
    retrievedRules: RuleArticle[]
  ): Promise<DecisionOutput> {
    const prompt = this.buildPrompt(incident, context, retrievedRules);

    const response = await claudeAPI.messages.create({
      model: 'claude-sonnet-4.5',
      messages: [{ role: 'user', content: prompt }],
      tools: [this.ruleLookupTool],
      // Per §14: AI constraints
      system: `
        You are a chess arbiter assistant. CRITICAL RULES:
        - Base all rulings on provided rule sources (FIDE, JCF, Tournament)
        - If information is missing, ask clarifying questions
        - If uncertain, recommend CA escalation
        - Never speculate or use "probably"
        - Cite article numbers for all rulings
      `
    });

    return this.parseStructuredOutput(response);
  }
}
```

#### Rule Retrieval
```typescript
class RuleRetrieval {
  async search(query: string, context: GameContext): Promise<RuleArticle[]> {
    // Hybrid search: vector + full-text
    const vectorResults = await this.vectorSearch(query);
    const textResults = await this.fullTextSearch(query);
    const combined = this.mergeResults(vectorResults, textResults);

    // Per §6: Apply rule priority
    return this.applyPriority(combined, context.tournamentId);
  }

  private applyPriority(
    articles: RuleArticle[],
    tournamentId: string
  ): RuleArticle[] {
    // Priority: Tournament > JCF > FIDE > Commentary
    return articles.sort((a, b) => {
      const priorityA = this.getPriority(a, tournamentId);
      const priorityB = this.getPriority(b, tournamentId);
      return priorityB - priorityA; // Higher priority first
    });
  }

  private getPriority(article: RuleArticle, tournamentId: string): number {
    if (article.sourceType === 'tournament' && article.tournamentId === tournamentId) {
      return 4;
    } else if (article.sourceType === 'jcf') {
      return 3;
    } else if (article.sourceType === 'fide') {
      return 2;
    } else {
      return 1; // Commentary
    }
  }
}
```

**Domain Constraints:**
- Per `.claude/rules/domain.md`:
  - NO React dependencies
  - ALL rulings must cite sources
  - NO LLM calls from Decision Trees
  - Tournament rules and versions are explicit inputs

### 3.4 Infrastructure Layer

**Technology:** Dexie.js, Claude API, Transformers.js, Web Speech API, Service Worker

**Responsibilities:**
- Persist data to IndexedDB
- Call external APIs (Claude)
- Generate embeddings (Transformers.js)
- Capture voice input
- Manage offline caching

**Key Modules:**

#### Database (Dexie.js)
```typescript
// Schema defined in ADR-001
class ArbiterDatabase extends Dexie {
  tournaments!: Table<Tournament>;
  rounds!: Table<Round>;
  games!: Table<Game>;
  players!: Table<Player>;
  incidents!: Table<Incident>;
  penalties!: Table<Penalty>;
  ruleSources!: Table<RuleSource>;
  articles!: Table<Article>;
  embeddings!: Table<ArticleEmbedding>;
  tournamentRegulations!: Table<TournamentRegulation>;
}
```

#### AI Client
```typescript
class ClaudeClient {
  async classifyIncident(description: string): Promise<Classification> {
    // Use Haiku for cost efficiency
    return this.call('claude-haiku-4', { ... });
  }

  async generateExplanation(ruling: Ruling): Promise<string> {
    // Per §15: Explain to player
    return this.call('claude-sonnet-4.5', { ... });
  }
}
```

#### Vector Search (Offline)
```typescript
class LocalVectorSearch {
  private model: TransformersModel;

  async initialize() {
    // Load embedding model (runs in browser via WebAssembly)
    this.model = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }

  async search(query: string, topK: number): Promise<ScoredArticle[]> {
    const queryEmbedding = await this.model(query);
    const allEmbeddings = await db.embeddings.toArray();

    // Cosine similarity
    const scored = allEmbeddings.map(e => ({
      article: e,
      score: this.cosineSimilarity(queryEmbedding, e.embedding)
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
```

---

## 4. Offline Strategy

### 4.1 Service Worker Caching

**Cached Assets:**
- Next.js static files (HTML, CSS, JS)
- Digital Agency Design System fonts
- Rule documents (PDFs stored as blobs in IndexedDB)
- Pre-computed embeddings
- Decision Tree logic

**Cache Strategy:**
```javascript
// next.config.js with next-pwa
module.exports = withPWA({
  pwa: {
    dest: 'public',
    register: true,
    skipWaiting: true,
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/api\.anthropic\.com\/.*/i,
        handler: 'NetworkOnly', // Never cache AI API calls
      },
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
        handler: 'CacheFirst',
      },
    ],
  },
});
```

### 4.2 Data Synchronization

**Offline-First Pattern:**
1. All writes go to IndexedDB immediately
2. Background sync queue uploads changes when online
3. Conflict resolution: Last-write-wins (arbiters rarely collaborate on same incident)

**Sync Flow:**
```typescript
class SyncService {
  async syncIncidentLogs() {
    if (!navigator.onLine) return;

    const unsyncedIncidents = await db.incidents
      .where('syncStatus')
      .equals('pending')
      .toArray();

    for (const incident of unsyncedIncidents) {
      await this.uploadIncident(incident);
      await db.incidents.update(incident.id, { syncStatus: 'synced' });
    }
  }
}
```

**Per §31: Offline-capable features:**
- ✅ Tournament Profile (stored locally)
- ✅ Rule search (vector + full-text, both local)
- ✅ Incident Log (local DB)
- ✅ Round Checklist (local templates)
- ✅ Decision Trees (pure TypeScript logic)
- ❌ LLM-based reasoning (requires Claude API)

**Graceful Degradation:**
- If offline and incident requires LLM:
  - Show: "この事象は詳細な分析が必要です。インターネット接続を確認するか、CAへ相談してください。"
  - Allow: Manual rule search and incident logging

---

## 5. Decision Tree vs. LLM Routing

**Per §35: High-frequency, high-risk → Decision Tree**

| Incident Category       | Handler         | Rationale                                    |
|-------------------------|-----------------|----------------------------------------------|
| Illegal Move (Standard) | Decision Tree   | Deterministic (§16), high-frequency          |
| Illegal Move (Rapid)    | Decision Tree   | Deterministic but different rules (§17)      |
| Flag Fall               | Decision Tree   | Clear rules (mate material check)            |
| Threefold Repetition    | Decision Tree   | Position comparison is algorithmic           |
| 50-move Rule            | Decision Tree   | Countable, deterministic                     |
| Clock Malfunction       | LLM + RAG       | Context-dependent, many edge cases           |
| Electronic Device       | LLM + RAG       | Tournament rules vary (§21)                  |
| Player Behavior         | LLM + RAG       | Subjective, context-dependent                |
| Team Captain Issue      | LLM + RAG       | Tournament-specific rules (§22)              |
| Fair Play / Cheating    | LLM + RAG       | Never automate (§23), only assist escalation |

**Hybrid Cases:**
- **Draw Offer**: Decision Tree validates claim conditions, LLM helps if ambiguous
- **Scoresheet Issues**: Decision Tree checks basic errors, LLM interprets handwriting issues

---

## 6. Data Flow Examples

### 6.1 Incident Reporting Flow

```
1. User taps "トラブル報告" button
2. UI shows category selection (10 categories from §9)
3. User selects "違法手・着手"
4. UI shows voice/text input
5. User says "黒が両手でキャスリングした"
6. Web Speech API → text transcription
7. UI calls: incidentStore.reportIncident(text, gameId)
8. Store calls: DecisionEngine.processIncident(...)
9. DecisionEngine:
   a. Classifies as "illegal-move" (keyword match or LLM)
   b. Checks if Standard/Rapid (from game context)
   c. Routes to IllegalMoveStandardTree
   d. Tree asks: "時計を押しましたか？"
10. UI shows follow-up question
11. User answers "はい"
12. Tree asks: "相手は次の手を指しましたか？"
13. User answers "いいえ"
14. Tree asks: "この選手の今回の対局での違法手は何回目ですか？"
15. User answers "1回目"
16. Tree executes: firstIllegalMove()
17. Returns DecisionOutput with actions, penalties, sources
18. Store updates: decisionStore.setDecision(output)
19. UI renders DecisionSupportCard:
    - 結論: "Blackの1回目のIllegal Move"
    - 今すぐ行うこと: [時計を止める, 局面を戻す, ...]
    - 介入: "今すぐ介入"
    - Penalty: "Whiteに2分追加"
    - 根拠: FIDE 7.5.4, JCF NA p.48
20. User confirms action, system logs incident to IndexedDB
```

### 6.2 Rule Search Flow

```
1. User taps "ルール検索" tab
2. UI shows search input
3. User types "三回同一局面"
4. Application Layer:
   a. Calls: ruleStore.search(query)
   b. Store calls: RuleRetrieval.search(query, context)
5. RuleRetrieval:
   a. Generates query embedding (Transformers.js)
   b. Searches IndexedDB embeddings (vector search)
   c. Also runs full-text search on article content
   d. Merges results, applies priority (Tournament > JCF > FIDE)
6. Returns: [
     { article: "FIDE 9.2.2", content: "...", source: "FIDE Laws" },
     { article: "JCF NA Seminar p.72", content: "...", source: "JCF" }
   ]
7. UI renders RuleSearchResults with expandable citations
8. User taps article → shows full text + page reference
```

---

## 7. Security & Privacy

### 7.1 Data Privacy

- **No player PII transmitted to Claude API**: Only incident descriptions (anonymized)
- **Local-only storage**: Incident logs stay on arbiter's device unless explicitly synced
- **Encrypted sync** (if backend added): TLS + encrypted IndexedDB backup

### 7.2 AI Safety

- **Per §14: AI Constraints:**
  - System prompts enforce citation requirements
  - Output validation (Zod schemas) rejects uncited rulings
  - "Uncertainty" flag triggers CA escalation recommendation

---

## 8. Performance Targets

| Metric                          | Target      | Measurement Point                     |
|---------------------------------|-------------|---------------------------------------|
| Decision Tree execution         | <100ms      | From input complete to output ready   |
| Rule search (local vector)      | <3s         | Query to results displayed            |
| LLM classification (Haiku)      | <5s         | Incident text to category + questions |
| LLM reasoning (Sonnet)          | <10s        | Full context to decision output       |
| Page load (cached)              | <1s         | Tap to interactive                    |
| Offline incident logging        | <500ms      | Tap "保存" to confirmed save          |

---

## 9. Deployment Architecture

### 9.1 MVP Deployment (Static Hosting)

```
┌─────────────────────────────────────┐
│   Vercel / Netlify / Cloudflare     │
│   (Static Next.js App + PWA)        │
└─────────────────────────────────────┘
                │
                │ (HTTPS)
                ▼
┌─────────────────────────────────────┐
│        User's Browser / Device      │
│                                     │
│  ┌───────────────────────────────┐  │
│  │     Service Worker (Cache)    │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │   IndexedDB (Local Storage)   │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  Transformers.js (Embeddings) │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
                │
                │ (API Calls)
                ▼
┌─────────────────────────────────────┐
│       Anthropic Claude API          │
│       (Sonnet 4.5 / Haiku 4)        │
└─────────────────────────────────────┘
```

**Notes:**
- No backend server required for MVP
- All data stored locally (IndexedDB)
- Claude API called directly from browser (API key in env, rate-limited)

> **Note (ADR-006, Milestone 5):** The notes above are superseded for LLM features. The app now needs a Node server for `app/api/llm/{classify,reason}` (Next.js Route Handlers, `runtime = "nodejs"`). These call Google Gemini with the server-only `GEMINI_API_KEY`. The browser never calls the provider or holds the key. Rule data stays in the client's IndexedDB. The client sends only retrieved candidate articles and structured context. Without the key or a server, the app falls back to Decision Trees, manual review / CA and keyword classification. See [ADR-006](../decisions/ADR-006-gemini-llm-via-server-route.md).

### 9.2 Future: Backend-Enabled Architecture

```
┌─────────────────────────────────────┐
│   Frontend (Vercel / Netlify)       │
└─────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│   Backend API (Next.js API Routes)  │
│   - Multi-arbiter sync              │
│   - Admin panel                     │
│   - Analytics                       │
└─────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│   Database (PostgreSQL / Supabase)  │
│   - Centralized incident logs       │
│   - Tournament data sharing         │
└─────────────────────────────────────┘
```

---

## 10. Extensibility & Future Considerations

### 10.1 Beyond MVP (§36)

Features **NOT** in MVP but architecture supports:
- Swiss Pairing Engine integration (via API or local library)
- FIDE Rating calculation (add domain service)
- Tie-break calculation (extend Tournament model)
- Multi-arbiter collaboration (add sync backend)

### 10.2 Architectural Evolution

**Current:** Offline-first, client-only, LLM-assisted
**Phase 2:** Add optional backend for data sharing
**Phase 3:** Fine-tune custom model on FIDE corpus (reduce API costs)
**Phase 4:** Real-time collaboration (WebSockets for multi-arbiter tournaments)

---

## 11. References

- [ADR-001: Technology Stack](../decisions/ADR-001-technology-stack.md)
- [Product Requirements](../requirements/product-requirements.md)
- [Domain Rules](../../.claude/rules/domain.md)
- [Frontend Rules](../../.claude/rules/frontend.md)
- [Testing Rules](../../.claude/rules/testing.md)

---

## Appendix: Folder Structure (Detailed)

```
src/
├── app/                          # Next.js App Router
│   ├── (tournament)/            # Tournament-scoped routes
│   │   ├── incident/            # Incident reporting
│   │   ├── checklist/           # Round checklist
│   │   └── history/             # Incident log
│   ├── rules/                   # Rule search
│   ├── settings/                # Settings & clock guides
│   └── layout.tsx
│
├── components/
│   ├── ui/                      # Digital Agency Design System
│   │   ├── Button/
│   │   ├── Card/
│   │   ├── Input/
│   │   └── ...
│   └── domain/                  # Arbiter-specific components
│       ├── DecisionSupportCard/
│       ├── IncidentCategoryButton/
│       ├── PenaltyBadge/
│       ├── RuleCitation/
│       └── VoiceInputButton/
│
├── domain/                      # Core business logic
│   ├── engine/
│   │   ├── DecisionEngine.ts   # Main orchestrator
│   │   ├── IncidentClassifier.ts
│   │   └── QuestionGenerator.ts
│   ├── trees/                   # Decision Tree implementations
│   │   ├── IllegalMoveStandardTree.ts
│   │   ├── IllegalMoveRapidTree.ts
│   │   ├── FlagFallTree.ts
│   │   ├── ThreefoldRepetitionTree.ts
│   │   └── index.ts
│   ├── llm/
│   │   ├── LLMReasoner.ts
│   │   └── PromptBuilder.ts
│   ├── rules/
│   │   ├── RuleRetrieval.ts
│   │   ├── RulePriority.ts
│   │   └── CitationFormatter.ts
│   ├── models/                  # TypeScript types & interfaces
│   │   ├── Tournament.ts
│   │   ├── Incident.ts
│   │   ├── Decision.ts
│   │   ├── Penalty.ts
│   │   ├── RuleSource.ts
│   │   └── index.ts
│   └── validators/              # Zod schemas
│       └── schemas.ts
│
├── infrastructure/
│   ├── db/
│   │   ├── ArbiterDatabase.ts  # Dexie schema
│   │   ├── repositories/        # Data access layer
│   │   │   ├── TournamentRepository.ts
│   │   │   ├── IncidentRepository.ts
│   │   │   └── RuleRepository.ts
│   │   └── migrations/
│   ├── ai/
│   │   ├── ClaudeClient.ts
│   │   └── config.ts
│   ├── vector/
│   │   ├── LocalVectorSearch.ts
│   │   ├── EmbeddingGenerator.ts
│   │   └── FullTextSearch.ts   # Lunr.js wrapper
│   ├── voice/
│   │   ├── WebSpeechAPI.ts
│   │   └── WhisperFallback.ts  # Future
│   └── sync/
│       └── SyncService.ts       # Background sync
│
├── state/                       # Zustand stores
│   ├── useTournamentStore.ts
│   ├── useIncidentStore.ts
│   ├── useDecisionStore.ts
│   ├── useRuleStore.ts
│   └── useSettingsStore.ts
│
└── utils/
    ├── datetime.ts
    ├── validation.ts
    └── constants.ts
```
