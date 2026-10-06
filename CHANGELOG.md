# Changelog

All notable changes to Arbiter Console will be documented in this file.

## [Unreleased]

### Milestone 4-10 (Planned)
- Additional Decision Trees (DT-002, 003, 004, 005)
- LLM Integration for context-dependent incidents
- Tournament Management
- Round Checklist
- Voice Input
- Polish & UX improvements
- Comprehensive Testing
- Production Deployment

## [2024-10-06] - Milestone 0-3 Complete

### Milestone 3: Incident Log (2024-10-06)

#### Added
- Incident log display with card-based layout
- Category filtering (10 categories with counts)
- Penalty summary dashboard
  - Total incidents counter
  - Total penalties counter
  - Time adjustments counter
  - Game losses counter
- CSV export functionality
- Incident detail modal view
- Real-time IndexedDB integration
- Empty state handling

#### Technical Details
- Sort incidents by most recent first
- Mobile-responsive layout
- Japanese-formatted dates in CSV
- Automatic decision loading for each incident

### Milestone 2: Illegal Move Decision Tree (2024-10-06)

#### Added
- DT-001: Illegal Move (Standard) decision tree
  - 1st offense: 2 minutes to opponent
  - 2nd+ offense: Game loss
  - Clock pressed/opponent moved validation
- Decision Engine orchestrator
  - Incident routing to appropriate decision trees
  - Natural language parsing
  - Follow-up requirement handling
- Incident reporting UI
  - 10 category selection screen
  - Natural language description input
  - Real-time decision generation
  - 3-step workflow (category → description → result)
- DecisionDisplay component
  - Conclusion, actions, penalties display
  - Source citations (FIDE/JCF) with expandable view
  - Escalation warnings
  - Confidence level and generation method badges
- Zustand incident store
  - Create and process incidents
  - IndexedDB persistence
  - Player incident history tracking
- Comprehensive test suite for DT-001
  - 11 test cases covering all scenarios
  - Clock validation tests
  - Penalty calculation tests
  - Source validation tests

#### Technical Details
- End-to-end incident flow working
- Decision trees generate high-confidence rulings
- Offline-capable decision processing
- FIDE 7.5.4, 7.5.5 + JCF NA compliance

### Milestone 1: Rule Search MVP (2024-10-06)

#### Added
- PDF text extraction (pdfjs-dist)
- Embeddings generation service (Transformers.js)
  - Model: Xenova/all-MiniLM-L6-v2 (384-dim, 23MB)
  - Offline-capable via WebAssembly
- Vector search functionality
  - Cosine similarity calculation
  - Minimum score threshold filtering
- Full-text search (Lunr.js)
  - Japanese language support
  - Wildcard matching
- Hybrid search implementation
  - Vector search weight: 0.6
  - Full-text search weight: 0.4
  - Combined scoring
- Rule priority system
  - Tournament-specific rules: +1000
  - JCF rules: +100
  - FIDE rules: +10
  - Commentary: +1
- PDF upload UI in settings page
- Rule search UI with results display
- Rule ingestion service with progress tracking

#### Technical Details
- IndexedDB storage for rules and embeddings
- Automatic index building for full-text search
- Progress indicator during PDF import
- Mobile-first responsive design

### Milestone 0: Project Foundation (2024-10-06)

#### Added
- Next.js 14.2.x with TypeScript and App Router
- React 18.3.1 (locked for Digital Agency Design System compatibility)
- Tailwind CSS v3.4.1
- PWA support with next-pwa
- Dexie.js for IndexedDB with complete schema
  - Tables: tournaments, games, incidents, decisions, rules, embeddings
- ESLint, Prettier configuration
- Vitest for testing
- 4-layer architecture structure
  - Presentation Layer (Next.js + React)
  - Application Layer (Zustand stores)
  - Domain Layer (Decision Trees, Decision Engine)
  - Infrastructure Layer (IndexedDB, AI, Embeddings)
- Bottom tab navigation UI
  - Home, Report, Search, Log, Settings
- Domain entities
  - Tournament, Game, Incident, Decision, Rule, Embedding
- Project documentation structure

#### Technical Details
- Webpack configuration for Transformers.js browser compatibility
- Service Worker for offline caching
- Mobile-first design with 48px minimum touch targets
- Japanese language UI

## Repository Information

- **Repository**: https://github.com/moom98/ArbiterConsole
- **Branch**: main
- **Latest Commit**: 93f444b (Milestone 3: Incident Log)
- **Previous Commits**:
  - 32bb981 (Milestone 2: Illegal Move Decision Tree)
  - 9295ee3 (Milestone 0 & 1: Project Foundation and Rule Search MVP)
