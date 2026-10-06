# Arbiter Console Domain Model

**Version:** 1.0
**Last Updated:** 2026-10-06
**Status:** Draft

---

## 1. Overview

This document defines the core domain model for Arbiter Console. All entities are designed to be:

- **Framework-agnostic**: No React/Next.js dependencies (per `.claude/rules/domain.md`)
- **Serializable**: Can be stored in IndexedDB and transmitted via API
- **Type-safe**: Defined with TypeScript interfaces and Zod schemas
- **Rule-aware**: Linked to FIDE/JCF/Tournament regulations

---

## 2. Domain Entity Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          Tournament                              │
│  • id, name, date                                                │
│  • competitionType (Standard/Rapid/Blitz)                        │
│  • timeControl, rapidRulesType                                   │
│  • regulations: TournamentRegulation[]                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ has many
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                            Round                                 │
│  • id, tournamentId, roundNumber                                 │
│  • status (pending/active/completed)                             │
│  • startTime, endTime                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ has many
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                             Game                                 │
│  • id, roundId, boardNumber                                      │
│  • whitePlayerId, blackPlayerId                                  │
│  • result, status                                                │
│  • incidents: Incident[]                                         │
└─────────────────────────────────────────────────────────────────┘
         │                                │
         │ references                     │ has many
         ▼                                ▼
┌──────────────────────┐      ┌──────────────────────────────────┐
│       Player         │      │          Incident                │
│  • id, name          │      │  • id, gameId, timestamp         │
│  • rating            │      │  • category, subtype             │
│  • penalties[]       │◄─────│  • description                   │
└──────────────────────┘      │  • decision: Decision            │
                              │  • arbiterObserved               │
                              └──────────────────────────────────┘
                                             │
                                             │ contains
                                             ▼
                              ┌──────────────────────────────────┐
                              │          Decision                │
                              │  • conclusion                    │
                              │  • actions: string[]             │
                              │  • intervention                  │
                              │  • penalties: Penalty[]          │
                              │  • sources: RuleCitation[]       │
                              └──────────────────────────────────┘
                                             │
                              ┌──────────────┴──────────────┐
                              ▼                             ▼
                  ┌──────────────────────┐    ┌──────────────────────┐
                  │      Penalty         │    │    RuleCitation      │
                  │  • type              │    │  • sourceId          │
                  │  • playerId          │    │  • article           │
                  │  • timeAdjustment    │    │  • page              │
                  └──────────────────────┘    │  • text              │
                                              └──────────────────────┘
                                                         │
                                                         │ references
                                                         ▼
                                              ┌──────────────────────┐
                                              │     RuleSource       │
                                              │  • id, name          │
                                              │  • version           │
                                              │  • sourceType        │
                                              │  • priority          │
                                              │  • articles[]        │
                                              └──────────────────────┘
```

---

## 3. Core Entities

### 3.1 Tournament

Represents a chess tournament with its configuration and regulations.

**Requirements:** §7 (Tournament Profile)

```typescript
interface Tournament {
  // Identity
  id: string;                          // UUID
  name: string;                        // e.g., "全日本選手権 2026"
  date: Date;                          // Start date

  // Competition Configuration
  competitionType: CompetitionType;    // 'standard' | 'rapid' | 'blitz'
  timeControl: TimeControl;
  defaultTime: number;                 // Minutes until default loss

  // Rapid-specific
  rapidRulesType?: RapidRulesType;     // 'A4' | 'A5' (if rapid)

  // Format
  format: TournamentFormat;            // 'individual' | 'team'
  teamSize?: number;                   // If team tournament
  fixedBoardOrder: boolean;            // FBO requirement

  // Rounds
  totalRounds: number;
  boardCount: number;

  // Regulations (§7: Tournament-specific rules)
  regulations: TournamentRegulation[]; // Links to custom rules

  // Equipment
  clockModel?: string;                 // e.g., "DGT 2010"

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  status: TournamentStatus;            // 'draft' | 'active' | 'completed'
}

type CompetitionType = 'standard' | 'rapid' | 'blitz';

type RapidRulesType = 'A4' | 'A5';

type TournamentFormat = 'individual' | 'team';

type TournamentStatus = 'draft' | 'active' | 'completed' | 'cancelled';

interface TimeControl {
  baseTimeMinutes: number;             // e.g., 30
  incrementSeconds?: number;           // e.g., 30 (Fischer)
  delaySeconds?: number;               // e.g., 5 (Bronstein)
  moveThreshold?: number;              // e.g., 40 moves
  additionalTimeMinutes?: number;      // e.g., 30 (after move 40)
}

// Per §7: Time control determines competition type
// Example: 30min + 30sec/move = 60min at move 60 → Standard
function deriveCompetitionType(tc: TimeControl): CompetitionType {
  const estimatedMinutesAt60Moves =
    tc.baseTimeMinutes +
    (tc.incrementSeconds ? (tc.incrementSeconds * 60) / 60 : 0);

  if (estimatedMinutesAt60Moves >= 60) {
    return 'standard';
  } else if (estimatedMinutesAt60Moves >= 10) {
    return 'rapid';
  } else {
    return 'blitz';
  }
}
```

### 3.2 TournamentRegulation

Custom rules specific to a tournament (§6: highest priority).

```typescript
interface TournamentRegulation {
  id: string;
  tournamentId: string;
  category: RegulationCategory;

  // Content
  title: string;                       // e.g., "電子機器持ち込み規則"
  description: string;                 // Full text
  overrides?: string[];                // FIDE article numbers it overrides

  // Searchability
  keywords: string[];                  // For RAG search
  embeddings?: number[];               // Vector representation

  // Metadata
  createdAt: Date;
}

type RegulationCategory =
  | 'electronic-devices'
  | 'draw-offers'
  | 'captain-rules'
  | 'default-time'
  | 'scoresheet'
  | 'other';
```

### 3.3 Round

Represents a single round in a tournament.

**Requirements:** §8 (Tournament state), §26 (Round Checklist)

```typescript
interface Round {
  // Identity
  id: string;
  tournamentId: string;
  roundNumber: number;                 // 1-indexed

  // Timing
  scheduledStartTime: Date;
  actualStartTime?: Date;
  endTime?: Date;

  // Status
  status: RoundStatus;

  // Checklist tracking (§26)
  preRoundChecklist: ChecklistItem[];
  postRoundChecklist: ChecklistItem[];

  // Games
  games: Game[];                       // All games in this round
}

type RoundStatus =
  | 'pending'        // Not started
  | 'pre-setup'      // Arbiter setting up boards
  | 'ready'          // Setup complete, waiting to start
  | 'active'         // Games in progress
  | 'completed';     // All games finished

interface ChecklistItem {
  id: string;
  label: string;                       // e.g., "全Clockが開始されているか"
  completed: boolean;
  completedAt?: Date;
  notes?: string;
}
```

### 3.4 Game

Represents a single game between two players.

**Requirements:** §8 (Game state)

```typescript
interface Game {
  // Identity
  id: string;
  roundId: string;
  boardNumber: number;

  // Players
  whitePlayerId: string;
  blackPlayerId: string;

  // State
  status: GameStatus;
  result?: GameResult;

  // Time tracking
  whiteTimeRemaining?: number;         // Seconds
  blackTimeRemaining?: number;         // Seconds
  moveCount?: number;

  // Incidents
  incidents: Incident[];               // All incidents for this game

  // Scoresheet
  scoresheetId?: string;               // Link to scoresheet image/data

  // Metadata
  startedAt?: Date;
  endedAt?: Date;
}

type GameStatus =
  | 'pending'        // Not started
  | 'active'         // In progress
  | 'completed'      // Finished
  | 'defaulted';     // One or both players defaulted

type GameResult =
  | '1-0'            // White wins
  | '0-1'            // Black wins
  | '1/2-1/2'        // Draw
  | '0-0'            // Double forfeit
  | 'white-default'  // White defaulted
  | 'black-default'; // Black defaulted
```

### 3.5 Player

Represents a chess player participating in the tournament.

**Requirements:** §8 (Player state), §25 (Penalty history)

```typescript
interface Player {
  // Identity
  id: string;
  name: string;

  // Chess-specific
  rating?: number;                     // FIDE rating
  title?: string;                      // GM, IM, FM, etc.

  // Team tournament (§22)
  teamId?: string;
  boardAssignment?: number;            // For FBO

  // Penalty tracking (§25)
  penalties: Penalty[];                // All penalties across tournament

  // Anti-cheating notes (§23)
  fairPlayNotes?: FairPlayNote[];
}

interface FairPlayNote {
  id: string;
  timestamp: Date;
  observation: string;                 // e.g., "頻繁なトイレ利用"
  arbiterName: string;
  escalated: boolean;
}
```

### 3.6 Incident

Represents a reportable event during a game.

**Requirements:** §9-11 (Incident reporting), §24 (Incident log)

```typescript
interface Incident {
  // Identity
  id: string;
  gameId: string;
  timestamp: Date;

  // Classification (§11)
  category: IncidentCategory;
  subtype?: string;                    // e.g., "両手によるキャスリング"

  // Description
  description: string;                 // Arbiter's input (text or voice)
  arbiterObserved: boolean;            // vs. player claim
  claimingPlayer?: PlayerColor;        // If player claim

  // Decision (§13)
  decision?: Decision;                 // Null if unresolved

  // Escalation
  escalatedToCA: boolean;
  escalationNotes?: string;

  // Metadata
  reportedBy: string;                  // Arbiter name/ID
  resolvedAt?: Date;
}

type IncidentCategory =
  | 'illegal-move'                     // 1. 違法手・着手
  | 'board-piece-issue'                // 2. 駒・盤面の異常
  | 'clock-time'                       // 3. 時計・時間
  | 'game-result'                      // 4. 終局・勝敗
  | 'draw'                             // 5. Draw
  | 'scoresheet'                       // 6. 棋譜
  | 'player-behavior'                  // 7. プレーヤーの行動
  | 'team'                             // 8. チーム戦
  | 'fair-play'                        // 9. Fair Play / Anti-Cheating
  | 'tournament-admin';                // 10. その他・大会運営

type PlayerColor = 'white' | 'black';

// Subtype examples (category-specific)
type IllegalMoveSubtype =
  | 'general'
  | 'king-in-check'
  | 'check-not-resolved'
  | 'no-move-clock-pressed'
  | 'two-hands'
  | 'promotion-issue'
  | 'castling-illegal';

type DrawSubtype =
  | 'agreement'
  | 'offer'
  | 'threefold-repetition'
  | 'fivefold-repetition'
  | '50-move-rule'
  | '75-move-rule'
  | 'stalemate'
  | 'dead-position';
```

### 3.7 Decision

The output of the Decision Support system.

**Requirements:** §13 (Decision Support format)

```typescript
interface Decision {
  // Summary
  conclusion: string;                  // e.g., "Blackの1回目のIllegal Move"

  // Actions (§13: "今すぐ行うこと")
  actions: string[];                   // e.g., ["時計を止める", "局面を戻す"]

  // Intervention guidance (§13)
  intervention: InterventionType;

  // Penalties (§13)
  penalties: Penalty[];

  // Rule citations (§13: "根拠")
  sources: RuleCitation[];

  // Confidence & escalation
  confidence: ConfidenceLevel;
  escalationRecommended: boolean;
  escalationReason?: string;

  // Metadata
  generatedBy: DecisionSource;         // 'decision-tree' | 'llm'
  generatedAt: Date;
}

type InterventionType =
  | 'immediate'                        // 今すぐ介入
  | 'wait-for-claim'                   // Playerの申立てを待つ
  | 'consult-ca'                       // CAへ確認
  | 'undetermined';                    // 判断不能

type ConfidenceLevel =
  | 'high'                             // Decision Tree or clear FIDE rule
  | 'medium'                           // LLM with strong citations
  | 'low'                              // LLM uncertain or conflicting rules
  | 'none';                            // Cannot determine

type DecisionSource =
  | 'decision-tree'                    // Deterministic logic
  | 'llm'                              // AI reasoning
  | 'hybrid';                          // Tree + LLM
```

### 3.8 Penalty

Represents a penalty applied to a player.

**Requirements:** §13 (Penalty types), §25 (Penalty history)

```typescript
interface Penalty {
  // Identity
  id: string;
  incidentId: string;
  playerId: string;
  gameId: string;

  // Type (§25: FIDE Article 12.9 penalties)
  type: PenaltyType;

  // Time adjustment
  timeAdjustmentSeconds?: number;      // Positive = add time, Negative = reduce
  targetPlayer?: PlayerColor;          // For opponent time addition

  // Description
  description: string;                 // Human-readable

  // Metadata
  appliedAt: Date;
  appliedBy: string;                   // Arbiter name/ID
}

type PenaltyType =
  | 'warning'
  | 'time-addition-opponent'           // 相手への時間加算
  | 'time-reduction-self'              // 当該Playerの時間減算
  | 'point-adjustment'                 // Point変更
  | 'game-loss'                        // Game Loss
  | 'round-exclusion'                  // Round exclusion
  | 'tournament-exclusion';            // Tournament exclusion

// Per §16: Illegal Move penalties in Standard
// 1st offense: opponent +2min
// 2nd offense: game loss
function getIllegalMovePenalty(
  offenseCount: number,
  competitionType: CompetitionType
): Penalty[] {
  if (competitionType === 'standard') {
    if (offenseCount === 1) {
      return [{
        type: 'time-addition-opponent',
        timeAdjustmentSeconds: 120,
        description: '相手に2分追加'
      }];
    } else if (offenseCount >= 2) {
      return [{
        type: 'game-loss',
        description: '2回目の違法手によりGame Loss'
      }];
    }
  }
  // Rapid rules differ (§17)
  // ... (implement A4/A5 logic)
}
```

### 3.9 RuleSource

Represents a source document of chess rules.

**Requirements:** §5.1 (Rule sources), §30 (Version management)

```typescript
interface RuleSource {
  // Identity
  id: string;
  name: string;                        // e.g., "FIDE Laws of Chess"

  // Version management (§30)
  version: string;                     // e.g., "2023 Edition"
  publishedDate: Date;
  effectiveDate: Date;
  status: RuleStatus;                  // 'active' | 'superseded'

  // Source type & priority (§6)
  sourceType: RuleSourceType;
  priority: number;                    // Higher = higher priority

  // Tournament linkage
  tournamentId?: string;               // If tournament-specific

  // Content
  articles: Article[];

  // Metadata
  sourceUrl?: string;                  // Official source link
  language: string;                    // 'ja' | 'en'
}

type RuleStatus =
  | 'active'                           // Current, use for rulings
  | 'superseded'                       // Replaced by newer version
  | 'draft';                           // Not yet effective

type RuleSourceType =
  | 'tournament'                       // Tournament-specific (priority 4)
  | 'jcf'                              // JCF regulations (priority 3)
  | 'fide'                             // FIDE Laws of Chess (priority 2)
  | 'commentary';                      // Interpretations (priority 1)

// Per §6: Rule priority
function getRulePriority(
  source: RuleSource,
  tournamentId: string
): number {
  if (source.sourceType === 'tournament' && source.tournamentId === tournamentId) {
    return 4;
  } else if (source.sourceType === 'jcf') {
    return 3;
  } else if (source.sourceType === 'fide') {
    return 2;
  } else {
    return 1;
  }
}
```

### 3.10 Article

Represents a specific rule article from a source.

**Requirements:** §28 (Rule search), §29 (Citation)

```typescript
interface Article {
  // Identity
  id: string;
  sourceId: string;                    // Links to RuleSource

  // Reference
  articleNumber: string;               // e.g., "7.5.4", "12.9"
  page?: number;                       // Page in source document

  // Content
  title?: string;                      // e.g., "Illegal Moves"
  content: string;                     // Full text

  // Search optimization
  keywords: string[];                  // For full-text search
  embeddings?: number[];               // Vector for semantic search

  // Related articles
  relatedArticles?: string[];          // Article IDs

  // Metadata
  language: string;
}
```

### 3.11 RuleCitation

A reference to a rule used in a decision.

**Requirements:** §13 (根拠), §29 (Source display)

```typescript
interface RuleCitation {
  // Source reference
  sourceId: string;
  sourceName: string;                  // e.g., "FIDE Laws of Chess"

  // Article reference
  articleId: string;
  articleNumber: string;               // e.g., "7.5.4"
  page?: number;

  // Excerpt
  text: string;                        // Relevant quote from article

  // Context
  relevance: string;                   // Why this rule applies
}

// Example citation display (§29):
// "FIDE Laws of Chess 7.5.4"
// "JCF NA Seminar 2025 p.48"
```

---

## 4. Decision Tree Models

### 4.1 DecisionTreeInput

Generic input for a Decision Tree.

```typescript
interface DecisionTreeInput {
  // Context
  competitionType: CompetitionType;
  rapidRulesType?: RapidRulesType;
  tournamentId: string;

  // Game state
  gameId: string;
  currentPlayer: PlayerColor;

  // Incident-specific data (varies by tree)
  [key: string]: any;
}
```

### 4.2 IllegalMoveInput (Example)

Specific input for Illegal Move Decision Tree.

```typescript
interface IllegalMoveInput extends DecisionTreeInput {
  // Incident details
  playerColor: PlayerColor;
  moveDescription: string;

  // Critical factors (§12: 追加確認質問)
  clockPressed: boolean;               // 時計を押したか
  opponentMoved: boolean;              // 相手が次の手を指したか
  arbiterObserved: boolean;            // アービター自身が目撃したか
  gameEnded: boolean;                  // 対局がすでに終了していないか

  // History
  playerIncidentCount: number;         // この選手の今回の対局での違法手回数
}
```

### 4.3 DecisionTreeOutput

Output from a Decision Tree (matches Decision interface).

```typescript
type DecisionTreeOutput = Decision;

// Decision Trees always return:
// - High confidence
// - Explicit sources (FIDE/JCF articles)
// - Deterministic intervention type
```

---

## 5. Aggregates & Value Objects

### 5.1 GameContext (Aggregate)

Full context needed for incident resolution.

```typescript
interface GameContext {
  // Tournament
  tournament: Tournament;
  round: Round;
  game: Game;

  // Players
  whitePlayer: Player;
  blackPlayer: Player;

  // Relevant regulations
  applicableRegulations: TournamentRegulation[];

  // History
  gameIncidents: Incident[];           // All incidents in this game
  whitePlayerPenalties: Penalty[];     // White's penalties this game
  blackPlayerPenalties: Penalty[];     // Black's penalties this game
}
```

### 5.2 RuleSearchQuery (Value Object)

Input for rule search.

```typescript
interface RuleSearchQuery {
  // Query
  text: string;                        // User input

  // Filters
  tournamentId?: string;               // Scope to tournament rules
  sourceTypes?: RuleSourceType[];      // Filter by source type
  competitionType?: CompetitionType;   // Filter by competition type

  // Options
  maxResults: number;                  // Default: 10
  includeSuperseded: boolean;          // Default: false
}
```

### 5.3 RuleSearchResult (Value Object)

Output from rule search.

```typescript
interface RuleSearchResult {
  articles: ScoredArticle[];
  totalResults: number;
  searchMethod: SearchMethod;          // 'vector' | 'fulltext' | 'hybrid'
}

interface ScoredArticle {
  article: Article;
  source: RuleSource;
  score: number;                       // Relevance score (0-1)
  matchedKeywords?: string[];          // For highlighting
}

type SearchMethod = 'vector' | 'fulltext' | 'hybrid';
```

---

## 6. Invariants & Business Rules

### 6.1 Tournament Invariants

- A tournament must have at least 1 round
- Board count must be ≥ 1
- Team tournaments must specify team size and FBO setting
- Rapid tournaments must specify A4 or A5 rules type
- Time control must be valid for competition type

### 6.2 Game Invariants

- A game must reference valid white and black players (no duplicates)
- Board number must be ≤ tournament board count
- Game result can only be set when status is 'completed' or 'defaulted'

### 6.3 Incident Invariants

- An incident must reference a valid game
- Decision can be null only if incident is unresolved
- If escalated to CA, escalationNotes should be populated
- Arbiter-observed incidents do not have claiming player

### 6.4 Penalty Invariants (§25)

- Illegal Move penalties:
  - Standard 1st offense: opponent +2min
  - Standard 2nd offense: game loss
  - Rapid varies by A4/A5 rules
- Time adjustments must be applied before game result is set
- Tournament exclusion implies all remaining games defaulted

### 6.5 Rule Priority Invariants (§6)

- Tournament-specific rules override JCF/FIDE
- JCF rules override FIDE for Japan-based tournaments
- Superseded rules cannot be cited in decisions
- AI cannot override registered rules with general knowledge

---

## 7. Domain Services

### 7.1 PenaltyCalculator

```typescript
class PenaltyCalculator {
  calculateIllegalMovePenalty(
    competitionType: CompetitionType,
    rapidRulesType: RapidRulesType | undefined,
    offenseCount: number,
    opponentMoved: boolean
  ): Penalty[];

  calculateFlagFallPenalty(
    winningPlayer: PlayerColor,
    losingPlayerMaterial: ChessPiece[]
  ): Penalty[];
}
```

### 7.2 RulePriorityResolver

```typescript
class RulePriorityResolver {
  // Per §6: Resolve conflicts between rules
  resolveConflict(
    articles: Article[],
    tournamentId: string
  ): Article | null;  // null if cannot auto-resolve

  // Check if CA escalation needed
  requiresCAEscalation(articles: Article[]): boolean;
}
```

### 7.3 IncidentCounter

```typescript
class IncidentCounter {
  // Per §25: Track penalty history
  countIllegalMoves(
    playerId: string,
    gameId: string
  ): number;

  getPenaltyHistory(
    playerId: string,
    gameId: string
  ): Penalty[];
}
```

---

## 8. Repository Interfaces

### 8.1 TournamentRepository

```typescript
interface TournamentRepository {
  findById(id: string): Promise<Tournament | null>;
  findAll(): Promise<Tournament[]>;
  save(tournament: Tournament): Promise<void>;
  delete(id: string): Promise<void>;
}
```

### 8.2 IncidentRepository

```typescript
interface IncidentRepository {
  findById(id: string): Promise<Incident | null>;
  findByGameId(gameId: string): Promise<Incident[]>;
  findByPlayerId(playerId: string): Promise<Incident[]>;
  save(incident: Incident): Promise<void>;

  // For sync (§31)
  findUnsyncedIncidents(): Promise<Incident[]>;
  markAsSynced(ids: string[]): Promise<void>;
}
```

### 8.3 RuleRepository

```typescript
interface RuleRepository {
  findSourceById(id: string): Promise<RuleSource | null>;
  findActiveSources(tournamentId?: string): Promise<RuleSource[]>;
  findArticleById(id: string): Promise<Article | null>;
  search(query: RuleSearchQuery): Promise<RuleSearchResult>;

  // For RAG
  findArticlesByEmbedding(
    embedding: number[],
    topK: number
  ): Promise<ScoredArticle[]>;
}
```

---

## 9. Example: Illegal Move Workflow

```typescript
// 1. Arbiter reports incident
const incident: Incident = {
  id: uuid(),
  gameId: game.id,
  timestamp: new Date(),
  category: 'illegal-move',
  subtype: 'two-hands',
  description: '黒が両手でキャスリングした',
  arbiterObserved: true,
  claimingPlayer: undefined,
  decision: null,  // Not yet resolved
  escalatedToCA: false,
  reportedBy: 'arbiter-001'
};

// 2. Get game context
const context: GameContext = {
  tournament: await tournamentRepo.findById(round.tournamentId),
  round: await roundRepo.findById(game.roundId),
  game: game,
  whitePlayer: await playerRepo.findById(game.whitePlayerId),
  blackPlayer: await playerRepo.findById(game.blackPlayerId),
  applicableRegulations: await regulationRepo.findByTournamentId(tournament.id),
  gameIncidents: await incidentRepo.findByGameId(game.id),
  whitePlayerPenalties: await penaltyRepo.findByPlayerAndGame(whitePlayer.id, game.id),
  blackPlayerPenalties: await penaltyRepo.findByPlayerAndGame(blackPlayer.id, game.id)
};

// 3. Decision Engine processes
const decisionEngine = new DecisionEngine();
const decision = await decisionEngine.processIncident(incident, context);

// 4. Decision returned
{
  conclusion: "Blackの1回目のIllegal Move（両手によるキャスリング）",
  actions: [
    "時計を止める",
    "局面をIllegal Move直前へ戻す",
    "Whiteに2分追加",
    "Blackに正しい手を指させる（片手で）"
  ],
  intervention: "immediate",
  penalties: [
    {
      type: "time-addition-opponent",
      timeAdjustmentSeconds: 120,
      targetPlayer: "white",
      description: "Whiteに2分追加"
    }
  ],
  sources: [
    {
      sourceName: "FIDE Laws of Chess",
      articleNumber: "7.5.4",
      text: "An illegal move is completed once the player has pressed his clock...",
      relevance: "違法手の成立条件"
    },
    {
      sourceName: "JCF NA Seminar 2025",
      articleNumber: "p.48",
      text: "1回目の違法手：相手に2分追加",
      relevance: "Standard競技における1回目の違法手の処置"
    }
  ],
  confidence: "high",
  escalationRecommended: false,
  generatedBy: "decision-tree",
  generatedAt: new Date()
}

// 5. Save incident with decision
incident.decision = decision;
incident.resolvedAt = new Date();
await incidentRepo.save(incident);

// 6. Apply penalties
for (const penalty of decision.penalties) {
  penalty.incidentId = incident.id;
  penalty.gameId = game.id;
  penalty.playerId = blackPlayer.id;
  penalty.appliedAt = new Date();
  penalty.appliedBy = 'arbiter-001';
  await penaltyRepo.save(penalty);
}
```

---

## 10. Validation (Zod Schemas)

All domain models will have corresponding Zod schemas for runtime validation.

Example:

```typescript
import { z } from 'zod';

const TournamentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  date: z.date(),
  competitionType: z.enum(['standard', 'rapid', 'blitz']),
  timeControl: z.object({
    baseTimeMinutes: z.number().min(1),
    incrementSeconds: z.number().optional(),
    delaySeconds: z.number().optional(),
    moveThreshold: z.number().optional(),
    additionalTimeMinutes: z.number().optional()
  }),
  // ... (full schema)
});

type Tournament = z.infer<typeof TournamentSchema>;
```

---

## 11. References

- [Product Requirements](../requirements/product-requirements.md)
- [Architecture](./architecture.md)
- [Domain Rules](../../.claude/rules/domain.md)
- [ADR-001: Technology Stack](../decisions/ADR-001-technology-stack.md)

---

## Appendix: Future Extensions

### Multi-Arbiter Collaboration
- Add `ArbiterSession` entity for concurrent access
- Add `IncidentAssignment` for delegation

### Swiss Pairing Integration
- Add `PairingResult` entity
- Link `Round.pairingMethod` to Swiss system

### FIDE Rating Calculation
- Add `RatingCalculation` entity
- Store pre/post-tournament ratings
