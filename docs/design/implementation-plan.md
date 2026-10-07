# Implementation Plan and Sequence

**Version:** 1.0
**Last Updated:** 2026-10-06
**Status:** Draft

---

## 1. Overview

This document defines the **implementation sequence** for Arbiter Console MVP. The plan is designed to:

1. **De-risk early**: Tackle hardest technical challenges first (RAG, Decision Trees)
2. **Build incrementally**: Working features at each milestone
3. **Enable testing**: Early prototypes for user feedback
4. **Maintain quality**: Testing integrated from day 1

---

## 2. Implementation Principles

### 2.1 Vertical Slices

Each milestone delivers **end-to-end functionality**, not just infrastructure.

**Good** ✅:
```
Milestone 1: User can report illegal move → get decision → save to log
```

**Bad** ❌:
```
Milestone 1: Build entire database layer (no user-facing features)
```

### 2.2 Core-First Approach

Implement **core value proposition** before nice-to-have features.

**Priority**:
1. Illegal Move Decision Tree (most common incident)
2. Rule Search (foundational)
3. Incident Log (record-keeping)
4. Other Decision Trees
5. LLM integration (complex incidents)
6. Polish and enhancements

### 2.3 Test-Driven Development

Write tests **alongside** implementation, not after.

**For Decision Trees**: Unit tests required (per `.claude/rules/testing.md`)
**For LLM**: Validation tests required (per ADR-002)
**For UI**: E2E tests for critical flows

---

## 3. Milestone Plan

### Milestone 0: Project Foundation (Week 1)

**Goal**: Set up development environment and core infrastructure

**Tasks**:
1. ✅ Initialize Next.js 14.2.x project
2. ✅ Configure TypeScript (strict mode)
3. ✅ Install Digital Agency Design System
4. ✅ Set up Dexie.js with schema
5. ✅ Configure ESLint + Prettier
6. ✅ Set up Vitest for testing
7. ✅ Create project folder structure
8. ✅ Configure next-pwa for PWA support

**Deliverable**: Empty app with design system, DB schema, and build pipeline

**Acceptance Criteria**:
- `npm run dev` starts app
- `npm run build` succeeds
- `npm run test` runs (no tests yet, but framework works)
- Design system components render

---

### Milestone 1: Rule Search MVP (Week 2-3)

**Goal**: Arbiter can search FIDE rules and view articles

**Why First**:
- Validates RAG architecture
- Provides immediate value (rule lookup)
- Foundation for Decision Support citations

**Tasks**:

#### 1.1 Domain Models (2 days)
- [ ] Define TypeScript interfaces for RuleSource, Article
- [ ] Create Zod schemas for validation
- [ ] Implement RuleRepository (Dexie.js)

#### 1.2 Rule Upload (3 days)
- [ ] Admin UI: Upload PDF
- [ ] Extract text from PDF (pdf.js)
- [ ] Parse FIDE Laws into articles (regex for "Article X.Y")
- [ ] Store in IndexedDB

#### 1.3 Embedding Generation (4 days)
- [ ] Load Transformers.js model (`all-MiniLM-L6-v2`)
- [ ] Generate embeddings for each article
- [ ] Store embeddings in IndexedDB
- [ ] Show progress indicator during generation

#### 1.4 Search Implementation (5 days)
- [ ] Implement Vector Search (cosine similarity)
- [ ] Implement Full-text Search (Lunr.js)
- [ ] Implement Hybrid Search (merge + re-rank)
- [ ] Apply Rule Priority (tournament > JCF > FIDE)

#### 1.5 Search UI (3 days)
- [ ] Rule Search screen with search input
- [ ] Search results list (sorted by relevance)
- [ ] Article Detail view
- [ ] Source badges (FIDE/JCF/Tournament)

**Deliverable**: Working rule search from home screen

**Acceptance Criteria**:
- ✅ User uploads FIDE Laws PDF
- ✅ App generates embeddings (500 articles in <5min)
- ✅ User searches "illegal move" → sees FIDE 7.5.x articles
- ✅ User taps article → sees full text
- ✅ Search works offline
- ✅ Vector + full-text results merged correctly

**Test Coverage**:
- Unit tests: Vector search, full-text search, hybrid merge
- E2E test: Upload PDF → search → view article

---

### Milestone 2: Illegal Move Decision Tree (Week 4)

**Goal**: Arbiter can report illegal move (Standard) and get decision

**Why Second**:
- Highest frequency incident
- Validates Decision Tree architecture
- Proves end-to-end incident flow

**Tasks**:

#### 2.1 Domain Models (2 days)
- [ ] Define Incident, Decision, Penalty interfaces
- [ ] Create IncidentRepository, PenaltyRepository
- [ ] Implement Game context (tournament, round, board, players)

#### 2.2 Decision Tree Implementation (4 days)
- [ ] Implement IllegalMoveStandardTree class
- [ ] Implement all branches (clock pressed, opponent moved, offense count)
- [ ] Add source citations (FIDE 7.5.4, 7.5.5, JCF NA p.48)
- [ ] Unit tests for all branches (8 test cases)

#### 2.3 Incident Report UI (5 days)
- [ ] Category selection screen
- [ ] Natural language input (text only for now)
- [ ] Follow-up questions UI (multi-step form)
- [ ] Decision Support display card
- [ ] Source citations (expandable)

#### 2.4 Incident Flow Integration (3 days)
- [ ] Decision Engine: Route illegal-move → IllegalMoveStandardTree
- [ ] Question Generator: Generate follow-up questions
- [ ] Save incident + decision to IndexedDB
- [ ] Show confirmation

**Deliverable**: End-to-end illegal move reporting

**Acceptance Criteria**:
- ✅ User selects "違法手・着手" category
- ✅ User inputs "黒が両手でキャスリングした"
- ✅ System asks follow-up questions (4 questions)
- ✅ System displays decision (結論, 今すぐ行うこと, Penalty, 根拠)
- ✅ Incident saved to log
- ✅ Works offline
- ✅ All branches tested (unit tests pass)

**Test Coverage**:
- Unit tests: IllegalMoveStandardTree (all 4+ branches)
- Integration test: Full incident flow
- E2E test: Report illegal move → see decision

---

### Milestone 3: Incident Log & History (Week 5)

**Goal**: Arbiter can view incident history filtered by game/player

**Why Third**:
- Enables tracking of repeat offenders (illegal move count)
- Required for Penalty History (§25)
- Completes basic incident management loop

**Tasks**:

#### 3.1 Incident Log UI (3 days)
- [ ] Incident Log screen (list view)
- [ ] Filter by game, player, category
- [ ] Tap incident → view Decision Detail
- [ ] Penalty History display (per player/game)

#### 3.2 Incident Counter (2 days)
- [ ] IncidentCounter service (count illegal moves per player/game)
- [ ] Integrate with Decision Tree (pass `playerIncidentCount`)
- [ ] Update count after saving incident

#### 3.3 Penalty Tracking (2 days)
- [ ] PenaltyRepository queries (by player, by game)
- [ ] Display penalty summary on Game Detail screen
- [ ] Show "Illegal Move回数" badge

**Deliverable**: Functional incident log with filtering

**Acceptance Criteria**:
- ✅ User views incident log (all incidents listed)
- ✅ User filters by Board 12 → sees only Board 12 incidents
- ✅ User taps incident → sees decision detail
- ✅ User reports 2nd illegal move for same player → decision says "2回目" → Game Loss
- ✅ Penalty history shows correctly

**Test Coverage**:
- Unit tests: IncidentCounter logic
- E2E test: Report 2 illegal moves → verify 2nd is Game Loss

---

### Milestone 4: Additional Decision Trees (Week 6-7)

**Goal**: Implement P0 and P1 Decision Trees

**Why Fourth**:
- Extends offline capability to more incidents
- Reuses existing Decision Tree architecture
- Lower risk (proven pattern)

**Tasks**:

#### 4.1 Flag Fall (DT-004) (2 days)
- [ ] Implement FlagFallTree
- [ ] Mate material check algorithm
- [ ] Unit tests (10 material combinations)

#### 4.2 Illegal Move Rapid A4 (DT-002) (3 days)
- [ ] Implement IllegalMoveRapidA4Tree
- [ ] Separate from Standard (different penalties)
- [ ] Unit tests

#### 4.3 Illegal Move Rapid A5 (DT-003) (4 days)
- [ ] Implement IllegalMoveRapidA5Tree
- [ ] Handle "opponent moved" condition
- [ ] Unit tests

#### 4.4 Threefold Repetition (DT-005) (5 days)
- [ ] Implement ThreefoldRepetitionTree
- [ ] FEN position comparison logic
- [ ] Unit tests (5 scenarios)
- [ ] Note: Most complex tree

**Deliverable**: 5 working Decision Trees

**Acceptance Criteria**:
- ✅ User reports flag fall → system checks mate material → correct result
- ✅ User reports illegal move in Rapid A4 → different penalty than Standard
- ✅ User claims threefold repetition → system verifies position history → grants/denies
- ✅ All trees tested and working offline

**Test Coverage**:
- Unit tests for each tree (all branches)
- Integration tests: Route incidents to correct trees

---

### Milestone 5: LLM Integration (Week 8-9)

**Goal**: LLM-based incident classification and reasoning

**Why Fifth**:
- Handles incidents not covered by Decision Trees
- Requires internet (not offline-critical)
- Most complex integration

**Tasks**:

#### 5.1 Claude API Client (2 days)
- [ ] Create ClaudeClient service
- [ ] Implement Sonnet and Haiku calls
- [ ] Handle API errors and retries
- [ ] Rate limiting (10 req/min)

#### 5.2 Incident Classification (2 days)
- [ ] Implement LLM-based classifier (Haiku)
- [ ] Keyword fallback for offline
- [ ] Extract missing information
- [ ] Generate follow-up questions

#### 5.3 LLM Reasoning (4 days)
- [ ] Implement LLMReasoner (Sonnet + RAG)
- [ ] Retrieve articles from vector/full-text search
- [ ] Build prompt with articles + context
- [ ] Parse structured output (Decision schema)

#### 5.4 Output Validation (3 days)
- [ ] Implement LLMOutputValidator (per ADR-002)
- [ ] Check penalties have sources
- [ ] Verify cited articles exist in DB
- [ ] Detect speculative language
- [ ] Reject invalid outputs → CA escalation

#### 5.5 Integration (3 days)
- [ ] Decision Engine: Route LLM incidents to LLMReasoner
- [ ] Offline fallback: Show "CAへ確認" message
- [ ] Display LLM-generated decisions in UI

**Deliverable**: LLM-based decision support for complex incidents

**Acceptance Criteria**:
- ✅ User reports "スマートウォッチを着けている" → LLM classifies as player-behavior
- ✅ LLM searches rules → finds FIDE 11.3 + tournament regulations
- ✅ LLM generates decision with cited sources
- ✅ Output validation passes (all sources exist)
- ✅ If offline → shows "オンライン必須" message

**Test Coverage**:
- Unit tests: Output validation logic
- Integration tests: Mock LLM responses
- E2E test: Online incident → LLM decision

---

### Milestone 6: Tournament Management (Week 10)

**Goal**: User can create and manage tournaments

**Why Sixth**:
- Provides context for incidents (competition type, time control)
- Required for tournament-specific rules
- Enables Round Checklist

**Tasks**:

#### 6.1 Tournament Profile (3 days)
- [x] Tournament creation form
- [x] Tournament Profile model
- [x] TournamentRepository
- [x] Save to IndexedDB

#### 6.2 Round & Game Management (3 days)
- [x] Round model (status: pending/active/completed)
- [x] Game model (board, players)
- [x] PlayerRepository
- [x] Create rounds and games for tournament

#### 6.3 Tournament Regulations Upload (3 days)
- [x] Upload tournament-specific PDF
- [x] Parse into TournamentRegulation entities
- [x] Link to tournament
- [x] Include in rule search (highest priority)

#### 6.4 Home Screen (3 days)
- [x] Display active tournament
- [x] Quick actions (Report, Search)
- [x] Recent incidents list
- [x] Tournament selection dropdown

**Status**: Implemented (see ADR-006). "Parse into TournamentRegulation entities" is done through the
existing rule ingestion (tournament `RuleSource` + `Rule` linked by `tournamentId`), not the embedded
`Tournament.regulations` array.

**Deliverable**: Tournament management system

**Acceptance Criteria**:
- ✅ User creates new tournament with settings
- ✅ User uploads tournament regulations
- ✅ Rule search prioritizes tournament rules
- ✅ Home screen shows active tournament

**Test Coverage**:
- Unit tests: TournamentRepository CRUD
- E2E test: Create tournament → upload rules → search → see tournament rules first

---

### Milestone 7: Round Checklist (Week 11)

**Goal**: Arbiter can use round checklists

**Why Seventh**:
- Nice-to-have feature (not core decision support)
- Reuses existing UI patterns
- Low risk

**Tasks**:

#### 7.1 Checklist Model (1 day)
- [ ] ChecklistItem model
- [ ] Pre-round and post-round templates
- [ ] Store completion status

#### 7.2 Checklist UI (3 days)
- [ ] Round Checklist screen
- [ ] Phase-aware display (pre/post/during)
- [ ] Large checkboxes (48px target)
- [ ] Notes field per item

#### 7.3 Round Status (2 days)
- [ ] Round status transitions (pending → active → completed)
- [ ] Trigger checklist phase changes
- [ ] Button to start/end round

**Deliverable**: Working round checklist

**Acceptance Criteria**:
- ✅ User opens checklist before round → sees pre-round items
- ✅ User checks items → progress updates
- ✅ User starts round → checklist switches to "during" phase
- ✅ All items can be checked offline

**Test Coverage**:
- E2E test: Complete pre-round checklist → start round

---

### Milestone 8: Voice Input & Polish (Week 12)

**Goal**: Voice input and UX refinements

**Why Eighth**:
- Voice input is nice-to-have (text input works)
- Polish improves usability but not core functionality

**Tasks**:

#### 8.1 Voice Input (3 days)
- [ ] Integrate Web Speech API
- [ ] Voice button on incident report
- [ ] Show transcription before sending
- [ ] Offline detection (may or may not work depending on browser)

#### 8.2 Clock Operation Guide (2 days)
- [ ] Static content for common clocks (DGT 2010, etc.)
- [ ] Link from Decision Support ("Clock操作ガイド" button)
- [ ] Markdown or HTML content

#### 8.3 Player Question Mode (2 days)
- [ ] Player Q&A mode toggle
- [ ] Generate player-friendly explanations (LLM)
- [ ] Large text display for showing player

#### 8.4 UX Polish (3 days)
- [ ] Improve button sizes (ensure 48px minimum)
- [ ] Add loading states (spinners)
- [ ] Improve error messages
- [ ] Offline indicators (network status bar)
- [ ] PWA install prompt

**Deliverable**: Polished MVP

**Acceptance Criteria**:
- ✅ Voice input works (when online)
- ✅ Clock guide accessible from decision
- ✅ Player mode generates explanations
- ✅ All buttons meet touch target size
- ✅ App installable as PWA

**Test Coverage**:
- Manual testing: Voice input accuracy
- E2E test: Player Q&A mode

---

### Milestone 9: Testing & Bug Fixes (Week 13)

**Goal**: Comprehensive testing and bug fixes

**Why Ninth**:
- Ensure quality before release
- Find edge cases
- Performance optimization

**Tasks**:

#### 9.1 Decision Tree Testing (3 days)
- [ ] Verify all branches tested
- [ ] Test edge cases (e.g., game already ended)
- [ ] Test with tournament context

#### 9.2 E2E Testing (4 days)
- [ ] Critical flow tests (Playwright):
  - Report incident → decision → log
  - Search rules → view article
  - Create tournament → upload rules
  - Offline incident → fallback
- [ ] Cross-browser testing (Chrome, Safari, Firefox)
- [ ] Mobile testing (iOS, Android)

#### 9.3 Performance Testing (2 days)
- [ ] Measure Decision Tree execution (<100ms)
- [ ] Measure rule search (<3s)
- [ ] Measure LLM response time (<10s)
- [ ] Optimize slow queries

#### 9.4 Bug Fixes (5 days)
- [ ] Fix issues found in testing
- [ ] Edge case handling
- [ ] Error message improvements

**Deliverable**: Production-ready MVP

**Acceptance Criteria**:
- ✅ All P0 tests pass
- ✅ Performance targets met (§33)
- ✅ No critical bugs
- ✅ Works on iOS Safari and Android Chrome

**Test Coverage**:
- >80% code coverage for Decision Trees and domain logic
- All critical flows covered by E2E tests

---

### Milestone 10: Deployment & Documentation (Week 14)

**Goal**: Deploy to production and finalize documentation

**Tasks**:

#### 10.1 Deployment (2 days)
- [ ] Set up Vercel/Netlify project
- [ ] Configure environment variables (Claude API key)
- [ ] Deploy to production
- [ ] Test production deployment

#### 10.2 User Documentation (3 days)
- [ ] User guide: How to create tournament
- [ ] User guide: How to report incidents
- [ ] User guide: How to search rules
- [ ] FAQ: Common questions

#### 10.3 Developer Documentation (2 days)
- [ ] README: Setup instructions
- [ ] CONTRIBUTING: Development guidelines
- [ ] API documentation (if backend added later)

**Deliverable**: Deployed MVP with documentation

**Acceptance Criteria**:
- ✅ App live at production URL
- ✅ HTTPS enabled
- ✅ PWA installable from production
- ✅ Documentation complete

---

## 4. Implementation Timeline Summary

| Milestone | Duration | Cumulative | Deliverable |
|-----------|----------|------------|-------------|
| M0: Foundation | 1 week | Week 1 | Project setup |
| M1: Rule Search | 2 weeks | Week 3 | Working rule search |
| M2: Illegal Move DT | 1 week | Week 4 | End-to-end incident flow |
| M3: Incident Log | 1 week | Week 5 | Incident history |
| M4: Additional DTs | 2 weeks | Week 7 | 5 Decision Trees |
| M5: LLM Integration | 2 weeks | Week 9 | LLM decision support |
| M6: Tournament Mgmt | 1 week | Week 10 | Tournament profiles |
| M7: Round Checklist | 1 week | Week 11 | Round checklists |
| M8: Voice & Polish | 1 week | Week 12 | Polished UI |
| M9: Testing | 1 week | Week 13 | Production-ready |
| M10: Deployment | 1 week | Week 14 | Live MVP |

**Total: 14 weeks (~3.5 months) with 1 developer**

**With 2 developers**: ~2-2.5 months (parallelizing M1-M7)

---

## 5. Parallel Work Opportunities

If 2+ developers available:

### Developer A (Backend/Domain Logic)
- M1: RAG infrastructure
- M2: Decision Trees
- M4: Additional Decision Trees
- M5: LLM integration

### Developer B (Frontend/UI)
- M1: Search UI
- M2: Incident Report UI
- M3: Incident Log UI
- M6: Tournament management UI
- M7: Round Checklist UI

**Critical Path**: M1 (RAG) → M2 (First Decision Tree) → M5 (LLM)

---

## 6. Risk Mitigation

### 6.1 Technical Risks

| Risk | Mitigation | Contingency |
|------|------------|-------------|
| Transformers.js too slow | Test early (M1) | Fallback to full-text only |
| LLM hallucination | Validation layer (M5) | Stricter validation, manual review |
| IndexedDB quota exceeded | Monitor during M1 | Compress embeddings, lite mode |
| Position comparison complex | Allocate extra time (DT-005) | Use external library (chess.js) |

### 6.2 Schedule Risks

| Risk | Mitigation | Contingency |
|------|------------|-------------|
| Behind schedule | Weekly reviews, adjust scope | Defer P2 trees to post-MVP |
| Key developer unavailable | Document as we go | Pair programming, knowledge sharing |
| Requirement changes | Lock requirements during MVP | Create backlog for post-MVP |

---

## 7. Quality Gates

Each milestone must pass these gates before proceeding:

### Code Quality
- ✅ ESLint passes (no errors)
- ✅ TypeScript compiles (strict mode)
- ✅ Prettier applied

### Testing
- ✅ Unit tests pass (for Decision Trees)
- ✅ Integration tests pass (if applicable)
- ✅ Manual smoke test performed

### Functionality
- ✅ Acceptance criteria met
- ✅ No critical bugs
- ✅ Works offline (if required)

### Performance
- ✅ Meets performance targets (§33)
- ✅ No regressions

---

## 8. Post-MVP Prioritization

After MVP completion, prioritize based on:

1. **User Feedback**: What do arbiters actually need most?
2. **Incident Frequency**: Which incidents occur most often?
3. **Technical Debt**: What architectural improvements are needed?

**Likely Post-MVP Features**:
1. P2 Decision Trees (50-move, fivefold, stalemate, dead position)
2. Dark mode
3. Backend sync (optional cloud storage)
4. Multi-arbiter collaboration
5. Analytics dashboard

---

## 9. Success Metrics

Track these metrics to measure MVP success:

### Usage Metrics
- Number of tournaments created
- Number of incidents reported
- Number of rule searches
- Decision Tree vs. LLM usage ratio

### Quality Metrics
- LLM output validation pass rate (target: 100%)
- CA escalation rate (target: <10%)
- User-reported bugs (target: <5 critical bugs/month)

### Performance Metrics
- Decision Tree execution time (target: <100ms)
- Rule search time (target: <3s)
- LLM response time (target: <10s)

---

## 10. References

- [MVP Scope](./mvp-scope.md) - Feature breakdown
- [Architecture](./architecture.md) - System design
- [ADR-002: Decision Tree & LLM Boundary](../decisions/ADR-002-decision-tree-llm-boundary.md)
- [Product Requirements](../requirements/product-requirements.md)

---

## Revision History

- 2026-10-06: Initial implementation plan (14-week timeline)
