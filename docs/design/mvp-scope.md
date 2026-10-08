# MVP Scope and Feature Breakdown

**Version:** 1.0
**Last Updated:** 2026-10-06
**Status:** Draft

---

## 1. Overview

This document details the **Minimum Viable Product (MVP) scope** for Arbiter Console. Per §36, the MVP focuses on core decision support functionality while excluding advanced features like pairing engines and rating calculations.

**MVP Goal**: Enable arbiters to report incidents, search rules, and receive decision support for the most common tournament scenarios.

---

## 2. MVP Principle

> Build the minimum feature set that provides **real value** to arbiters during actual tournaments.

**What this means**:
- ✅ Incident reporting and decision support work end-to-end
- ✅ Offline capability for critical functions
- ✅ Rule search with citations
- ✅ Incident logging and history
- ⏸️ Advanced features deferred to post-MVP

---

## 3. In Scope (MVP)

### 3.1 Core Functionality (Must Have)

| Feature | Description | Priority | Estimated Effort |
|---------|-------------|----------|------------------|
| **Tournament Profile** | Create and manage tournament settings (§7) | P0 | 2 days |
| **Tournament Regulations Upload** | Upload and process tournament-specific rules | P0 | 3 days |
| **JCF / FIDE Rule Search** | Search rule sources with vector + full-text | P0 | 5 days |
| **Text Input** | Natural language incident description (§10) | P0 | 2 days |
| **Voice Input** | Voice-to-text incident input (§10) | P1 | 3 days |
| **Incident 10 Categories** | Category selection UI (§9) | P0 | 2 days |
| **AI Classification** | LLM-based incident classification (§11) | P0 | 3 days |
| **Follow-up Questions** | Generate clarifying questions (§12) | P0 | 4 days |
| **Decision Support Display** | Show ruling with sources (§13) | P0 | 3 days |
| **Article / Source Display** | View full rule text with citations (§29) | P0 | 2 days |
| **Incident Log** | Save and view incident history (§24) | P0 | 3 days |
| **Penalty History** | Track player penalties per game (§25) | P0 | 2 days |
| **Round Checklist** | Pre/post-round task lists (§26) | P1 | 4 days |
| **Clock Operation Guide** | Clock operation instructions (§27) | P2 | 2 days |

**Total Estimated**: ~40 days (individual features, not accounting for parallel work)

### 3.2 Decision Trees (Must Have)

Per ADR-002, implement Decision Trees for high-frequency incidents:

| ID | Decision Tree | Competition Type | Priority | Estimated Effort |
|----|---------------|------------------|----------|------------------|
| DT-001 | Illegal Move Standard | Standard | P0 | 4 days |
| DT-002 | Illegal Move Rapid A4 | Rapid (A4) | P1 | 3 days |
| DT-003 | Illegal Move Rapid A5 | Rapid (A5) | P1 | 4 days |
| DT-004 | Flag Fall | All | P0 | 2 days |
| DT-005 | Draw Claim: threefold repetition (9.2) and 50 moves (9.3) (ADR-014; implemented in J1b-5) | All | P1 | 5 days* |
| DT-006 | Automatic Draw: fivefold and 75 moves (renumbered by ADR-014; implemented in J1b-5) | All | P2 | — |
| DT-007 | Touch Move, Article 4 (renumbered by ADR-014) | All | P1 | — |
| ~~DT-008~~ | ~~75-move Rule~~ — part of DT-006 (ADR-014) | All | — | — |
| ~~DT-009~~ | ~~Stalemate~~ — no tree; fact plan (ADR-014 §1) | All | — | — |
| ~~DT-010~~ | ~~Dead Position~~ — no tree; fact plan (ADR-014 §1) | All | — | — |

*Requires position comparison logic (FEN)

**MVP Target**: P0 + P1 trees (DT-001, 002, 003, 004, 005) = ~18 days

**Rationale**:
- DT-001: Most common incident (§16)
- DT-002, 003: Required for rapid tournaments (§17)
- DT-004: Time forfeit is common
- DT-005: Threefold repetition claims are frequent

**P2 Trees**: Deferred to post-MVP (lower frequency)

### 3.3 LLM+RAG Integration (Must Have)

| Feature | Description | Priority | Estimated Effort |
|---------|-------------|----------|------------------|
| **Claude API Client** | Integration with Sonnet/Haiku | P0 | 2 days |
| **Incident Classification** | Classify using Haiku | P0 | 2 days |
| **Rule Reasoning** | Generate decisions using Sonnet + RAG | P0 | 4 days |
| **Output Validation** | Validate LLM outputs (ADR-002) | P0 | 3 days |
| **Prompt Engineering** | System prompts + few-shot examples | P0 | 3 days |
| **Player Explanation Mode** | Generate player-friendly explanations (§15) | P1 | 2 days |

**Total**: ~16 days

### 3.4 RAG Infrastructure (Must Have)

| Feature | Description | Priority | Estimated Effort |
|---------|-------------|----------|------------------|
| **Rule Document Upload** | PDF upload and text extraction | P0 | 3 days |
| **Article Chunking** | Split documents into articles | P0 | 3 days |
| **Embedding Generation** | Transformers.js integration | P0 | 4 days |
| **Vector Search** | Local vector similarity search | P0 | 3 days |
| **Full-text Search** | Lunr.js integration | P0 | 2 days |
| **Hybrid Search** | Combine vector + full-text | P0 | 2 days |
| **Rule Priority** | Apply tournament > JCF > FIDE priority (§6) | P0 | 2 days |
| **Version Management** | Track active vs. superseded rules (§30) | P1 | 2 days |

**Total**: ~21 days

### 3.5 Data Persistence (Must Have)

| Feature | Description | Priority | Estimated Effort |
|---------|-------------|----------|------------------|
| **Dexie.js Setup** | IndexedDB schema definition | P0 | 2 days |
| **Tournament Repository** | CRUD for tournaments | P0 | 2 days |
| **Incident Repository** | CRUD for incidents | P0 | 2 days |
| **Rule Repository** | CRUD for rules and articles | P0 | 2 days |
| **Player Repository** | CRUD for players | P1 | 1 day |
| **Sync Queue** | Background sync queue (offline) | P1 | 3 days |

**Total**: ~12 days

### 3.6 UI/UX (Must Have)

| Feature | Description | Priority | Estimated Effort |
|---------|-------------|----------|------------------|
| **Digital Agency Design System Setup** | Install and configure | P0 | 2 days |
| **Home Screen** | Tournament dashboard | P0 | 3 days |
| **Incident Report Flow** | Multi-step wizard | P0 | 5 days |
| **Decision Support Display** | Ruling card with expandable sources | P0 | 4 days |
| **Rule Search Screen** | Search input + results list | P0 | 3 days |
| **Article Detail View** | Full article text display | P0 | 2 days |
| **Incident Log Screen** | Filterable incident list | P0 | 3 days |
| **Tournament Settings** | Tournament profile editor | P1 | 3 days |
| **Round Checklist** | Checklist UI | P1 | 3 days |
| **Bottom Navigation** | Tab bar navigation | P0 | 1 day |
| **Offline Indicators** | Network status bar | P1 | 1 day |

**Total**: ~30 days

### 3.7 PWA / Offline (Must Have)

| Feature | Description | Priority | Estimated Effort |
|---------|-------------|----------|------------------|
| **Service Worker Setup** | next-pwa configuration | P0 | 2 days |
| **Static Asset Caching** | Cache app shell | P0 | 1 day |
| **IndexedDB Persistence** | Store all data locally | P0 | Included above |
| **Offline Detection** | Network status monitoring | P0 | 1 day |
| **Graceful Degradation** | Offline fallback UI | P0 | 2 days |
| **Background Sync** | Sync queue when online | P1 | 3 days |
| **PWA Manifest** | Installable app configuration | P1 | 1 day |

**Total**: ~10 days

### 3.8 Testing (Must Have)

| Feature | Description | Priority | Estimated Effort |
|---------|-------------|----------|------------------|
| **Decision Tree Unit Tests** | Test all branches | P0 | 5 days |
| **LLM Validation Tests** | Test output validation logic | P0 | 2 days |
| **RAG Tests** | Test vector + full-text search | P0 | 3 days |
| **Repository Tests** | Test CRUD operations | P1 | 2 days |
| **E2E Tests (Playwright)** | Test critical flows | P1 | 4 days |

**Total**: ~16 days

---

## 4. Out of Scope (MVP)

Per §36, the following are explicitly **NOT** in MVP:

### 4.1 Advanced Features (Future Enhancements)

| Feature | Reason for Exclusion | Post-MVP Priority |
|---------|---------------------|-------------------|
| **Swiss Pairing Engine** | Complex algorithm, low arbiter priority | P3 |
| **FIDE Rating Calculation** | Can use external tools | P3 |
| **Tie-break Calculation** | Can be done manually | P3 |
| **Chess Engine Integration** | Position evaluation not core decision support | P4 |
| **Best Move Analysis** | Not arbiter's role (§14: no chess advice) | Never |
| **Auto Cheating Detection** | Explicitly forbidden (§23) | Never |
| **General Chess App Features** | Not arbiter-focused | Never |

### 4.2 Deferred UX Features

| Feature | Reason for Deferral | Post-MVP Priority |
|---------|---------------------|-------------------|
| **Dark Mode** | Nice-to-have, not critical | P2 |
| **Multi-language UI** | MVP targets Japanese arbiters | P2 |
| **Landscape Orientation** | Portrait is primary | P3 |
| **Voice Output (TTS)** | Accessibility feature, not core | P3 |
| **Offline Voice Input** | Web Speech API may work offline anyway | P2 |
| **Custom Incident Categories** | Standard 10 categories sufficient | P3 |

### 4.3 Deferred Technical Features

| Feature | Reason for Deferral | Post-MVP Priority |
|---------|---------------------|-------------------|
| **Backend Server** | MVP is offline-first, local-only | P2 |
| **Multi-Arbiter Collaboration** | Single arbiter per tournament for MVP | P2 |
| **Cloud Sync** | Offline-first sufficient | P2 |
| **Admin Panel** | Tournament organizers not primary users | P3 |
| **Analytics Dashboard** | Data collection not core | P3 |
| **Fine-tuned LLM** | Claude API sufficient for MVP | P4 |

---

## 5. MVP Decision Trees - Detailed Scope

### 5.1 DT-001: Illegal Move Standard (P0)

**Input Fields**:
```typescript
{
  playerColor: 'white' | 'black',
  clockPressed: boolean,
  opponentMoved: boolean,
  arbiterObserved: boolean,
  gameEnded: boolean,
  playerIncidentCount: number,
  moveDescription: string  // e.g., "両手でキャスリング"
}
```

**Output**:
- Conclusion
- Actions (4-5 step list)
- Intervention type
- Penalties
- Sources (FIDE 7.5.4, 7.5.5, JCF NA p.48)

**Branches**:
1. Clock not pressed → Not an illegal move
2. Opponent moved → Too late to correct
3. First offense → +2min to opponent
4. Second+ offense → Game Loss

**Test Cases**: 8 scenarios (all branches + edge cases)

### 5.2 DT-002/003: Illegal Move Rapid (P1)

**Differences from Standard**:
- A.4: Same as Standard
- A.5: Different handling if opponent moved (depends on if opponent's move was completed)

**Test Cases**: 6 scenarios per tree

### 5.3 DT-004: Flag Fall (P0)

**Input Fields**:
```typescript
{
  playerColor: 'white' | 'black',
  opponentMaterial: ChessPiece[],  // e.g., ['K', 'N']
  claimingPlayer?: 'white' | 'black'
}
```

**Output**:
- If opponent has mating material → Time forfeit wins
- If no mating material → Draw

**Mate Material Logic**:
```typescript
// No mating material:
// - K
// - K + N
// - K + B
// - K + B (same color as opponent's B)

// Has mating material:
// - K + Q, K + R, K + P, K + 2N, K + B + N, etc.
```

**Test Cases**: 10 material combinations

### 5.4 DT-005: Threefold Repetition (P1)

> **Superseded (J1b-5, 2026-10-08).** DT-005 is now Draw Claim (threefold and 50 moves) and DT-006 Automatic Draw (ADR-014 §1). The side to move comes from the last mover on the board or the confirmed game history, never from the clock (ADR-014 §2), and FEN lists are not accepted as a history (ADR-014 §4). See fact-model §3.5 "Implementation (J1b-5)". The sketch below is the original MVP plan.

**Input Fields**:
```typescript
{
  claimingPlayer: 'white' | 'black',
  isClaimingPlayerTurn: boolean,
  moveRecorded: boolean,
  clockStopped: boolean,
  positionHistory: FENPosition[]  // Full game history
}
```

**Output**:
- Verify claim is valid (3 identical positions)
- Check procedure (player's turn, move recorded, clock stopped)
- Result: Draw or Invalid claim

**Position Comparison**:
- Use FEN notation (Forsyth-Edwards Notation)
- Same position = same pieces + same castling rights + same en passant + same player to move

**Test Cases**: 5 scenarios (valid claim, invalid position, wrong procedure)

**Implementation Note**: This is the most complex tree due to position comparison. May require external library (e.g., `chess.js` for FEN parsing).

---

## 6. MVP Incident Coverage

Based on incident-classification.md, MVP covers:

| Category | Subtypes in MVP | Subtypes Deferred | Coverage % |
|----------|-----------------|-------------------|------------|
| Illegal Move | 9 (Decision Tree) | 2 (LLM) | 82% |
| Board/Piece | 0 | 6 | 0% → LLM fallback |
| Clock/Time | 2 (DT: flag-fall, time-adj) | 10 | 17% → LLM for rest |
| Game Result | 2 (DT: checkmate, stalemate) | 4 | 33% → LLM for rest |
| Draw | 5 (DT) | 4 | 56% → LLM for rest |
| Scoresheet | 0 | 11 | 0% → LLM only |
| Player Behavior | 0 | 14 | 0% → LLM only |
| Team | 0 | 8 | 0% → LLM only |
| Fair Play | 0 | 8 | 0% → LLM + CA escalation |
| Tournament Admin | 0 | 7 | 0% → LLM only |

**Total Decision Tree Coverage**: 18/92 subtypes (20%)
**LLM+RAG Coverage**: 74/92 subtypes (80%)

**Rationale**: 20% of incidents (Illegal Move, Draw, Time) account for ~70-80% of actual tournament incidents.

---

## 7. MVP Success Criteria

### 7.1 Functional Criteria

✅ **Arbiter can**:
1. Create a tournament profile
2. Upload FIDE Laws and JCF materials
3. Report an illegal move incident (text or voice)
4. Receive a decision with cited sources in <10 seconds
5. View incident history filtered by game/player
6. Search rules and view full articles
7. Use the app offline for Decision Tree incidents
8. Complete pre-round checklist

✅ **System can**:
1. Classify incidents with >80% accuracy (manual validation)
2. Generate valid decisions (pass output validation 100%)
3. Cite correct articles (manual verification)
4. Work offline for DT-001, 002, 003, 004, 005
5. Store 500+ articles in IndexedDB
6. Search rules in <3 seconds (offline)
7. LLM reasoning in <10 seconds (online)

### 7.2 Non-Functional Criteria

✅ **Performance**:
- Decision Tree execution: <100ms
- Rule search (local): <3s
- LLM classification: <5s
- LLM reasoning: <10s
- App load (cached): <2s

✅ **Reliability**:
- LLM output validation: 100% pass rate (reject invalid outputs)
- Offline functionality: All P0 features work offline (except LLM)
- Data persistence: No data loss on app close/refresh

✅ **Usability**:
- One-handed operation: All buttons >48px touch target
- Incident report: <5 taps from home to decision
- Large text: 16px minimum font size
- Clear offline indicators: Network status always visible

---

## 8. MVP Deployment

### 8.1 Hosting

**Platform**: Vercel (recommended) or Netlify

**Rationale**:
- Static Next.js app (no server-side rendering needed for MVP)
- Automatic HTTPS
- CDN for fast global access
- Free tier sufficient for MVP
- Easy deployment from Git

### 8.2 Domain

**Options**:
- Subdomain: `arbiter.example.com`
- Custom domain: `arbiter-console.app`

### 8.3 API Keys

**Claude API**:
- Use environment variables (`.env.local`)
- Rate limiting: 10 requests/minute per user (client-side)
- Cost estimation: ~$0.02 per incident (Sonnet reasoning)

**Budget**: $100/month → ~5,000 incidents/month

---

## 9. MVP Timeline Estimate

**Assumptions**:
- 1 developer full-time
- Working 8 hours/day, 5 days/week
- ~20% buffer for unknowns

| Phase | Tasks | Estimated Days | Calendar Weeks |
|-------|-------|----------------|----------------|
| **Setup** | Project init, dependencies, design system | 3 days | 1 week |
| **Foundation** | Dexie.js, domain models, repositories | 5 days | 1 week |
| **Decision Trees** | DT-001, 002, 003, 004, 005 + tests | 18 days | 4 weeks |
| **RAG** | Document upload, embeddings, search | 21 days | 4 weeks |
| **LLM** | Claude API, classification, validation | 16 days | 3 weeks |
| **UI** | All primary screens + navigation | 30 days | 6 weeks |
| **PWA** | Service worker, offline mode | 10 days | 2 weeks |
| **Testing** | E2E tests, manual testing | 10 days | 2 weeks |
| **Polish** | Bug fixes, UX refinements | 7 days | 1.5 weeks |
| **Total** | | **120 days** | **~24 weeks** |

**With Buffer (20%)**: **144 days** → **~6-7 months** (1 developer)

**With 2 Developers (parallel work)**: **~3.5-4 months**

---

## 10. Post-MVP Roadmap

### 10.1 Phase 2: Enhanced Decision Support

- **P2 Decision Trees**: DT-006 through DT-010 (numbering changed by ADR-014: DT-006 Automatic Draw, DT-007 Touch Move, the 50-move claim in DT-005; stalemate and dead position later)
- **Clock Operation Guide**: Detailed guides for common clock models
- **Multi-clock Support**: Clock model selection and specific guides

**Estimated**: 2-3 weeks

### 10.2 Phase 3: Collaboration Features

- **Backend Server**: Optional cloud sync
- **Multi-Arbiter Mode**: Multiple arbiters working same tournament
- **Conflict Resolution**: Handle simultaneous edits

**Estimated**: 4-6 weeks

### 10.3 Phase 4: Advanced Analytics

- **Incident Analytics**: Frequency charts, patterns
- **Tournament Report**: Auto-generate summary for organizers
- **Export Functionality**: Export logs to CSV/PDF

**Estimated**: 2-3 weeks

### 10.4 Phase 5: Tournament Organizer Tools

- **Pairing Engine Integration**: Use external APIs (e.g., FIDE Pairing)
- **Rating Calculation**: Display rating changes
- **Tie-break Calculation**: Auto-calculate tie-breaks

**Estimated**: 6-8 weeks

---

## 11. Open Questions

1. **Q**: Should MVP include voice input?
   - **Pro**: Hands-free operation useful
   - **Con**: Adds complexity, may not work well in noisy venues
   - **Decision**: Include as P1 (can disable if problematic)

2. **Q**: How many rule sources to pre-load?
   - **Proposal**: FIDE Laws 2023 + JCF NA Seminar (pre-loaded)
   - **User uploads**: Tournament-specific regulations
   - **Decision**: Pre-load FIDE, provide upload for others

3. **Q**: Support multiple tournaments simultaneously?
   - **Proposal**: Yes, but one "active" tournament at a time
   - **Decision**: Multiple tournaments, switch via home screen

---

## 12. References

- [Product Requirements](../requirements/product-requirements.md) - §36 (MVP scope)
- [ADR-002: Decision Tree & LLM Boundary](../decisions/ADR-002-decision-tree-llm-boundary.md)
- [Incident Classification](./incident-classification.md)
- [Screen Flow](./screen-flow.md)

---

## Revision History

- 2026-10-06: Initial MVP scope definition
