# ADR-001: Technology Stack Selection

**Status:** Accepted

**Date:** 2026-10-06

**Deciders:** Development Team

---

## Context

Arbiter Console is a Decision Support application for chess tournament arbiters, primarily used on mobile devices during tournaments. The application has several critical technical requirements:

### Functional Requirements

- **Mobile-first design** (§4, §32): Primary usage on smartphones in tournament venues
- **Offline capability** (§31): Must function with poor or no network connectivity
- **Performance** (§33): Instant response for deterministic decisions, <5s for rule search
- **Natural language input** (§10): Text and voice input support
- **RAG-based rule search** (§28-29): Vector search with citation support
- **Decision Trees** (§16-17): Deterministic logic for high-frequency incidents (e.g., Illegal Move)
- **Data persistence** (§24): Local storage of Incident Logs, Tournament Profiles

### Non-Functional Requirements

- **Usability**: One-handed operation, large buttons, minimal taps (§32)
- **Reliability**: Fail-safe behavior, no speculative rulings (§34)
- **Maintainability**: Separation of domain logic from UI (per `.claude/rules/domain.md`)
- **Extensibility**: Support for future features beyond MVP (§36-37)

### Constraints

- **Design System**: Must use [Digital Agency Design System](https://github.com/digital-go-jp/design-system-example-components-react)
  - React 18 + TypeScript
  - Tailwind CSS v3
  - Requires `@digital-go-jp/tailwind-theme-plugin`
  - React 19 not fully supported (may cause type errors)

---

## Decision

We will use the following technology stack:

### Frontend Framework

**Next.js 14.2.x (App Router) + React 18**

- **Rationale**:
  - Compatible with Digital Agency Design System (React 18 requirement)
  - App Router provides modern routing, server components, and improved performance
  - PWA support via `next-pwa`
  - Excellent TypeScript support
  - Server-side rendering not critical for this use case, but static generation useful for documentation

- **Alternative Considered**: Next.js 15 (React 19)
  - Rejected due to incompatibility with design system
  - May revisit when design system updates to React 19

### UI Framework

**Digital Agency Design System + Tailwind CSS v3**

- **Rationale**:
  - User requirement
  - Government-standard design for accessibility
  - Tailwind CSS enables rapid mobile-first development
  - Customizable for arbiter-specific UI needs (large buttons, high-contrast)

- **Customization Strategy**:
  - Extend Tailwind config for tournament-specific tokens (e.g., `text-arbiter-warning`, `bg-incident-critical`)
  - Create custom components for domain-specific UI (e.g., `DecisionCard`, `IncidentButton`, `PenaltyBadge`)

### State Management

**Zustand**

- **Rationale**:
  - Lightweight (§33: performance requirement)
  - Simple API, minimal boilerplate
  - TypeScript-first design
  - Supports persistence middleware for offline sync
  - No complex Redux overhead for this use case

- **Alternative Considered**: React Context
  - Rejected: Too many re-renders for complex state trees
  - Rejected: No built-in persistence middleware

### Data Persistence

**Dexie.js (IndexedDB wrapper)**

- **Rationale**:
  - Large storage capacity for rule documents, embeddings, incident logs
  - Offline-first architecture (§31)
  - Queryable (supports complex filtering for incident history)
  - Sync-friendly (can batch changes for later upload)
  - Well-maintained, excellent TypeScript support

- **Schema Design**:
  - `tournaments`, `rounds`, `games`, `players`
  - `incidents`, `penalties`
  - `ruleSources`, `articles`, `embeddings`
  - `tournamentRegulations`

- **Alternative Considered**: SQLite (sql.js)
  - Rejected: Larger bundle size, less browser-native

### AI/LLM Integration

> **Note (ADR-006):** The LLM provider is now **Google Gemini**, called only through the server Route Handlers `app/api/llm/*`. The API key is never sent to the browser. Claude/Anthropic references below are historical. See [ADR-006](./ADR-006-gemini-llm-via-server-route.md).


**Anthropic Claude API (Sonnet 4.5)**

- **Rationale**:
  - Excellent instruction-following for structured outputs (§13: Decision Support format)
  - Strong reasoning for complex rule interpretation
  - Citation support (§29: source references)
  - Long context window for large rule documents
  - Tool use for deterministic rule lookups

- **API Usage Strategy**:
  - **Incident classification** (§11): Extract category, subtype, missing info
  - **Follow-up questions** (§12): Generate clarification prompts
  - **RAG synthesis** (§28): Combine retrieved rules into actionable guidance
  - **Player explanations** (§15): Generate arbiter-to-player explanations

- **Cost Control**:
  - Use Haiku for simple classification tasks
  - Cache rule documents in system prompts
  - Local Decision Trees bypass LLM for deterministic cases (§35)

### Vector Search / RAG

**Local Vector Search (Transformers.js + FAISS-like algorithm)**

- **Rationale**:
  - **Offline requirement** (§31): Cannot rely on external vector DB
  - Transformers.js runs embedding models in browser via WebAssembly
  - Small models (e.g., `all-MiniLM-L6-v2`) sufficient for rule search
  - Embeddings pre-computed and stored in IndexedDB

- **Fallback**: Full-text search (Lunr.js) when embeddings unavailable

- **Alternative Considered**: Pinecone / Chroma (cloud-based)
  - Rejected: Requires internet connectivity

### Voice Input

**Web Speech API (SpeechRecognition)**

- **Rationale**:
  - Native browser API, no external dependencies
  - Offline support on modern browsers (varies by OS)
  - Japanese language support (§5.1: JCF resources in Japanese)
  - Free (no API costs)

- **Fallback**: Whisper API (OpenAI) when Web Speech API unavailable
  - Trade-off: Requires internet, adds cost
  - User selects mode in settings

### PWA Support

**next-pwa**

- **Rationale**:
  - Service Worker for offline caching
  - Installable on mobile home screen
  - Background sync for incident log upload
  - Pre-cache rule documents and embeddings

### Testing

**Vitest + React Testing Library + Playwright**

- **Rationale**:
  - Vitest: Fast, Vite-native, compatible with Next.js 14
  - React Testing Library: Component testing aligned with user behavior
  - Playwright: E2E testing for critical flows (incident reporting, decision support)
  - Per `.claude/rules/testing.md`: Decision Trees must be unit-testable

### Type Safety

**TypeScript 5.x (strict mode)**

- **Rationale**:
  - Per `.claude/rules/frontend.md`: TypeScript required
  - Strict mode prevents runtime errors in tournament scenarios
  - Zod for runtime validation of AI outputs and user inputs

### Code Quality

**ESLint + Prettier + Husky**

- **Rationale**:
  - ESLint: Enforce coding standards
  - Prettier: Consistent formatting
  - Husky: Pre-commit hooks for type-checking and linting

---

## Consequences

### Positive

1. **Offline-first**: IndexedDB + local embeddings enable full functionality without internet
2. **Performance**: Zustand and Dexie.js are lightweight; Decision Trees bypass LLM overhead
3. **Type Safety**: TypeScript + Zod reduce runtime errors during critical tournament moments
4. **Mobile Optimization**: Tailwind CSS + Digital Agency Design System support responsive, accessible UI
5. **Cost-effective AI**: Local Decision Trees + Claude API caching minimize LLM costs
6. **Developer Experience**: Modern stack with excellent tooling and documentation
7. **Compliance**: Digital Agency Design System aligns with government accessibility standards

### Negative

1. **React Version Constraint**: Locked to React 18 until design system updates
   - Mitigation: Monitor design system repository for React 19 compatibility
2. **Browser Compatibility**: Transformers.js requires modern browsers with WebAssembly support
   - Mitigation: Fallback to full-text search for older browsers
3. **Local Embedding Limitations**: Smaller models may have lower accuracy than cloud solutions
   - Mitigation: Hybrid search (vector + BM25) and manual rule indexing
4. **Service Worker Complexity**: PWA caching strategies can be tricky to debug
   - Mitigation: Use `next-pwa` defaults, extensive testing
5. **No Server-Side Logic**: Static/client-side only limits future backend features
   - Mitigation: Can add API routes in Next.js if needed (e.g., admin panel)

### Risks

1. **Design System Abandonment**: If Digital Agency stops maintaining the design system
   - Mitigation: Tailwind CSS is independent; can migrate to shadcn/ui if needed
2. **Web Speech API Inconsistency**: Browser support varies, especially offline
   - Mitigation: Provide text input as primary method, voice as enhancement
3. **IndexedDB Quota Limits**: Browsers may impose storage limits
   - Mitigation: Compress embeddings, allow users to manage cached data

### Future Considerations

1. **Multi-Arbiter Collaboration**: If multiple arbiters need to share data in real-time
   - Solution: Add backend sync service (e.g., Supabase, Firebase)
2. **Desktop Version**: If arbiters request laptop/tablet-optimized UI
   - Solution: Next.js responsive design already supports this
3. **AI Model Fine-Tuning**: If Claude API becomes too expensive or slow
   - Solution: Fine-tune smaller model on FIDE rules corpus (future ADR)

---

## Implementation Notes

### Folder Structure

```
src/
├── app/              # Next.js App Router pages
├── components/       # React components
│   ├── ui/          # Digital Agency Design System components
│   └── domain/      # Arbiter-specific components (DecisionCard, etc.)
├── domain/           # Domain logic (Rule Engine, Decision Trees)
│   ├── rules/       # Decision Tree implementations
│   ├── models/      # TypeScript types (Tournament, Incident, etc.)
│   └── services/    # Business logic (RuleEvaluator, IncidentClassifier)
├── infrastructure/   # External integrations
│   ├── db/          # Dexie.js schemas and repositories
│   ├── ai/          # Claude API client
│   ├── vector/      # Transformers.js embeddings
│   └── voice/       # Web Speech API wrapper
├── state/            # Zustand stores
└── utils/            # Shared utilities
```

### Next Steps

1. Initialize Next.js 14.2.x project with TypeScript
2. Install Digital Agency Design System and Tailwind plugin
3. Set up Dexie.js schemas for core entities
4. Implement MVP Decision Tree for Illegal Move (Standard)
5. Integrate Claude API for incident classification
6. Build incident reporting UI flow

---

## References

- [Product Requirements](../requirements/product-requirements.md)
- [Domain Rules](../../.claude/rules/domain.md)
- [Frontend Rules](../../.claude/rules/frontend.md)
- [Testing Rules](../../.claude/rules/testing.md)
- [Digital Agency Design System](https://github.com/digital-go-jp/design-system-example-components-react)
- [Next.js 14 Documentation](https://nextjs.org/docs)
- [Dexie.js Documentation](https://dexie.org/)
- [Zustand Documentation](https://zustand-demo.pmnd.rs/)
- [Transformers.js Documentation](https://huggingface.co/docs/transformers.js)
