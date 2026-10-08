# Incident Classification System

**Version:** 1.0
**Last Updated:** 2026-10-06
**Status:** Draft

---

## 1. Overview

This document defines the **comprehensive incident classification taxonomy** for Arbiter Console. Per §9, the system must support 10 primary categories, each with subtypes to enable precise incident tracking and appropriate decision support routing.

---

## 2. Classification Hierarchy

```
Incident
├── Category (10 primary categories)
│   ├── Subtype (specific incident type)
│   │   ├── Handler (Decision Tree or LLM+RAG)
│   │   ├── Critical Information (questions to ask)
│   │   └── Typical Penalties
```

---

## 3. Primary Categories

Per §9, the 10 primary categories are:

| ID | Category | Japanese | Handler Distribution |
|----|----------|----------|---------------------|
| 1 | Illegal Move / Touch | 違法手・着手 | 80% Decision Tree, 20% LLM |
| 2 | Board / Piece Issue | 駒・盤面の異常 | 20% Decision Tree, 80% LLM |
| 3 | Clock / Time | 時計・時間 | 40% Decision Tree, 60% LLM |
| 4 | Game Result | 終局・勝敗 | 50% Decision Tree, 50% LLM |
| 5 | Draw | Draw | 90% Decision Tree, 10% LLM |
| 6 | Scoresheet | 棋譜 | 10% Decision Tree, 90% LLM |
| 7 | Player Behavior | プレーヤーの行動 | 5% Decision Tree, 95% LLM |
| 8 | Team Tournament | チーム戦 | 0% Decision Tree, 100% LLM |
| 9 | Fair Play / Anti-Cheating | Fair Play / Anti-Cheating | 0% Decision Tree, 100% LLM |
| 10 | Tournament Administration | その他・大会運営 | 0% Decision Tree, 100% LLM |

---

## 4. Category 1: Illegal Move / Touch (違法手・着手)

**Requirements**: §16, §17

**Frequency**: Very High (most common incident)

**Severity**: High (affects game result)

### 4.1 Subtypes

| Subtype | Description | Handler | Key Questions |
|---------|-------------|---------|---------------|
| `general-illegal-move` | General illegal move not covered below | Decision Tree | Clock pressed? Opponent moved? Offense count? Competition type? |
| `king-in-check` | King left in check after move | Decision Tree | Same as general |
| `check-not-resolved` | Check not resolved | Decision Tree | Same as general |
| `no-move-clock-pressed` | Pressed clock without moving | Decision Tree | Same as general |
| `two-hands-move` | Move made with two hands | Decision Tree | Same as general |
| `two-hands-castling` | Castling with two hands | Decision Tree | Same as general |
| `promotion-issue` | Incorrect promotion procedure | Decision Tree | Piece placed? Clock pressed? |
| `illegal-castling` | Castled when not allowed | Decision Tree | Why illegal? (King moved? Through check?) |
| `touch-move` | Touched piece not moved (Article 4) | Decision Tree (DT-007, ADR-014; implemented in J1b-6, fact-model §3.8) | Pieces touched in order? Adjust declared? On move? Released? Claim timing? |
| `illegal-en-passant` | En passant captured when not allowed | Decision Tree | Same as general |
| `piece-knocked-over` | Piece accidentally knocked during move | LLM+RAG | Intentional? Game affected? |

### 4.2 Decision Tree Coverage

**Covered by Decision Trees** (Standard):
- `general-illegal-move`
- `king-in-check`
- `check-not-resolved`
- `no-move-clock-pressed`
- `two-hands-move`
- `two-hands-castling`
- `promotion-issue`
- `illegal-castling`
- `illegal-en-passant`

**Critical Information** (for Decision Tree):
```typescript
interface IllegalMoveInput {
  clockPressed: boolean;             // 時計を押したか
  opponentMoved: boolean;            // 相手が次の手を指したか
  arbiterObserved: boolean;          // アービター自身が目撃したか
  gameEnded: boolean;                // 対局がすでに終了していないか
  playerColor: 'white' | 'black';    // 違反したプレーヤー
  playerIncidentCount: number;       // この選手の今回の対局での違法手回数
  competitionType: 'standard' | 'rapid';  // 競技形式
  rapidRulesType?: 'A4' | 'A5';      // Rapidの場合のルール種別
}
```

**Rapid Variations** (§17):
- Separate trees for A.4 and A.5
- A.5: Different handling if opponent moved

---

## 5. Category 2: Board / Piece Issue (駒・盤面の異常)

**Requirements**: §9 (implied)

**Frequency**: Low-Medium

**Severity**: Medium

### 5.1 Subtypes

| Subtype | Description | Handler | Key Questions |
|---------|-------------|---------|---------------|
| `piece-displacement` | Piece accidentally displaced | LLM+RAG | When noticed? Intentional? Position reconstructable? |
| `wrong-initial-position` | Initial position set up incorrectly | LLM+RAG | When discovered? Game in progress? |
| `piece-missing` | Piece missing from board | LLM+RAG | When noticed? Explanation? |
| `wrong-piece-color` | Wrong color piece used | LLM+RAG | When discovered? |
| `board-orientation-wrong` | Board oriented incorrectly (a1 not on left) | LLM+RAG | When discovered? |
| `promoted-piece-unavailable` | No queen available for promotion | LLM+RAG | Substitute used? Arbiter informed? |

**Handler Justification**: Most subtypes are context-dependent and require arbiter judgment.

---

## 6. Category 3: Clock / Time (時計・時間)

**Requirements**: §18

**Frequency**: High

**Severity**: High (can determine game result)

### 6.1 Subtypes

| Subtype | Description | Handler | Key Questions |
|---------|-------------|---------|---------------|
| `flag-fall` | Time expired | Decision Tree | Opponent has mating material? Who claims? |
| `clock-not-pressed` | Player forgot to press clock | LLM+RAG | How long? Opponent affected? Intentional? |
| `clock-pressed-before-move` | Clock pressed before making move | LLM+RAG | Move completed? Frequency? |
| `wrong-hand-clock` | Clock pressed with wrong hand | LLM+RAG | Frequency? Arbiter observed? |
| `clock-held-down` | Hand left on clock | LLM+RAG | How long? Intentional? |
| `clock-hit-violently` | Clock struck violently | LLM+RAG | Damage? Intentional? |
| `clock-malfunction` | Clock not working properly | LLM+RAG | Type of malfunction? When noticed? |
| `clock-settings-wrong` | Clock set with wrong time control | LLM+RAG | When discovered? Game state? |
| `time-control-wrong` | Wrong time control announced | LLM+RAG | When discovered? Correction possible? |
| `clock-stopped-by-player` | Player stopped clock | LLM+RAG | Reason? Arbiter permission? |
| `clock-stopped-by-arbiter` | Arbiter stopped clock | LLM+RAG | Reason? How to resume? |
| `time-adjustment-needed` | Time needs correction due to penalty | Decision Tree | Penalty type? Amount? |

**Decision Tree Coverage**:
- `flag-fall` (mate material algorithm)
- `time-adjustment-needed` (based on penalty type)

**Flag Fall Decision Tree**:
```typescript
interface FlagFallInput {
  playerColor: 'white' | 'black';    // 時間切れしたプレーヤー
  opponentMaterial: ChessPiece[];    // 相手の駒
  claimingPlayer?: 'white' | 'black'; // 誰が主張したか
}

// Mate material check (FIDE 6.9)
function hasMatingMaterial(pieces: ChessPiece[]): boolean {
  // King only → no mating material
  // King + Knight → no mating material
  // King + Bishop → no mating material
  // King + 2 Knights → mating material (mate is theoretically possible)
  // Any other combination → mating material
}
```

---

## 7. Category 4: Game Result (終局・勝敗)

**Requirements**: §9 (implied)

**Frequency**: Medium

**Severity**: Very High (determines winner)

### 7.1 Subtypes

| Subtype | Description | Handler | Key Questions |
|---------|-------------|---------|---------------|
| `checkmate-claim` | Player claims checkmate | Decision Tree | Checkmate verified? Clock stopped? |
| `stalemate-claim` | Player claims stalemate | Decision Tree | Stalemate verified? Clock stopped? |
| `resignation` | Player resigns | LLM+RAG | Clear resignation? Verbal or physical? |
| `result-dispute` | Players disagree on result | LLM+RAG | Each player's claim? Evidence? |
| `arbiter-declares-result` | Arbiter must determine result | LLM+RAG | Reason? Position analysis? |
| `default-claim` | Player claims opponent defaulted | LLM+RAG | Opponent absence confirmed? Default time? |

**Decision Tree Coverage**:
- `checkmate-claim` (verify position legality + checkmate)
- `stalemate-claim` (verify position legality + stalemate)

**Note**: Position verification may require chess engine or manual arbiter check.

---

## 8. Category 5: Draw (Draw)

**Requirements**: §19

**Frequency**: Medium-High

**Severity**: High (determines result)

### 8.1 Subtypes

The subtype values are `DrawSubtype` in `lib/domain/entities/incident.ts` and the `dr.kind` values of the fact catalogue. They were aligned with ADR-014 §1 in J1b-5 (2026-10-08).

| Subtype | Description | Handler | Key Questions |
|---------|-------------|---------|---------------|
| `threefold-repetition-claim` | Player claims threefold repetition (9.2) | DT-005 Draw Claim (`claimBasis: threefold`) | Position repeated 3 times? Player's turn (from the last mover or the confirmed history, never the clock)? Move written (9.2.1)? Piece touched (9.4)? |
| `fifty-move-claim` | Player claims the 50-move rule (9.3) | DT-005 Draw Claim (`claimBasis: fifty-move`) | 50 moves each without capture or pawn move (100 plies, from the verified game history or a board reconstruction)? Player's turn? Move written (9.3.1)? Piece touched? |
| `fivefold-repetition` | Arbiter declares a draw (9.6.1) | DT-006 Automatic Draw | Position repeated 5 times? |
| `75-move-rule` | Arbiter declares a draw (9.6.2) | DT-006 Automatic Draw | 75 moves each without capture or pawn move? Did the move reaching 75 checkmate (checkmate takes precedence)? |
| `agreement` | Players agree to a draw | Fact plan (no tree) | Observed offer, acceptance, handshake, result written (`dr.agreement-observed`) |
| `stalemate` | Stalemate position | Fact plan (no tree) | Situation note |
| `dead-position` | No possible checkmate | Fact plan (no tree). The mate-possibility service (ADR-014 §5) is used only inside DT-001…004 | Situation note |
| `other` | Anything else (e.g. a draw offer at the wrong time) | Fact plan (no tree) | Situation note |

**Decision Tree Coverage**:
- DT-005 Draw Claim: `threefold-repetition-claim`, `fifty-move-claim`
- DT-006 Automatic Draw: `fivefold-repetition`, `75-move-rule`
- No tree (ADR-014 §1): `agreement`, `stalemate`, `dead-position`, `other`. A dead position as its own incident type is not implemented.

**Draw Claim Decision Tree** (implemented): see `lib/domain/decision-trees/dt-005-draw-claim.ts` and `dt-006-automatic-draw.ts`, and fact-model §3.5 "Implementation (J1b-5)". The side to move comes from the last mover on the board or the confirmed game history, never from the clock (ADR-014 §2). Positions are the same as in 9.2.3: same player to move, same pieces on the same squares, same castling rights and same en passant possibilities.

---

## 9. Category 6: Scoresheet (棋譜)

**Requirements**: §20

**Frequency**: Medium

**Severity**: Low-Medium

### 9.1 Subtypes

| Subtype | Description | Handler | Key Questions |
|---------|-------------|---------|---------------|
| `scoresheet-not-written` | Scoresheet not being maintained | LLM+RAG | Reason? Time trouble? Competition type? |
| `scoresheet-delayed` | Scoresheet several moves behind | LLM+RAG | How many moves? Time trouble? |
| `scoresheet-pre-recording` | Moves recorded before playing | LLM+RAG | Reason? Draw claim exception? |
| `scoresheet-illegible` | Scoresheet unreadable | LLM+RAG | Can be reconstructed? |
| `scoresheet-error` | Incorrect move notation | LLM+RAG | Correction possible? |
| `draw-offer-not-recorded` | Draw offer not recorded on scoresheet | LLM+RAG | Offer confirmed? |
| `result-not-recorded` | Result not recorded | LLM+RAG | Result clear? |
| `player-name-wrong` | Wrong player name on scoresheet | LLM+RAG | When discovered? |
| `color-wrong` | Wrong color assignment on scoresheet | LLM+RAG | When discovered? |
| `board-number-wrong` | Wrong board number on scoresheet | LLM+RAG | When discovered? |
| `signature-missing` | Players did not sign scoresheet | LLM+RAG | Game completed? |

**Handler Justification**: Most scoresheet issues require context (time trouble, game phase, etc.) and arbiter discretion.

---

## 10. Category 7: Player Behavior (プレーヤーの行動)

**Requirements**: §21

**Frequency**: Medium

**Severity**: Medium-High (can be serious violations)

### 10.1 Subtypes

| Subtype | Description | Handler | Key Questions |
|---------|-------------|---------|---------------|
| `smartphone-possession` | Smartphone found on player | LLM+RAG | Where found? Turned on? Tournament rules? |
| `smartwatch-possession` | Smartwatch on player | LLM+RAG | Tournament rules? Functionality? |
| `electronic-device-other` | Other electronic device | LLM+RAG | Device type? Tournament rules? |
| `bag-access` | Player accessed bag without permission | LLM+RAG | Permission sought? Reason? |
| `note-taking` | Player taking notes during game | LLM+RAG | Content? Purpose? |
| `receiving-advice` | Player received advice | LLM+RAG | Source? Nature of advice? |
| `analyzing-other-game` | Player analyzing another board | LLM+RAG | Relevant to own game? |
| `conversation-during-game` | Player talking during game | LLM+RAG | Content? Duration? |
| `leaving-playing-area` | Player left playing area | LLM+RAG | How long? Permission? Frequency? |
| `excessive-noise` | Player making excessive noise | LLM+RAG | Type of noise? Intentional? |
| `excessive-draw-offers` | Excessive draw offers | LLM+RAG | How many? Frequency? |
| `annoying-opponent` | Behavior annoying opponent | LLM+RAG | Nature of behavior? Warned? |
| `smoking` | Smoking violation | LLM+RAG | Where? Tournament rules? |
| `spectator-interference` | Spectator interfered with game | LLM+RAG | Nature of interference? Player affected? |

**Handler Justification**: All subtypes heavily depend on tournament-specific rules (especially electronic devices) and context.

---

## 11. Category 8: Team Tournament (チーム戦)

**Requirements**: §22

**Frequency**: Low (only in team events)

**Severity**: Medium-High (can affect team result)

### 11.1 Subtypes

| Subtype | Description | Handler | Key Questions |
|---------|-------------|---------|---------------|
| `fbo-violation` | Fixed Board Order violated | LLM+RAG | Tournament FBO rules? When discovered? |
| `wrong-board-assignment` | Player on wrong board | LLM+RAG | When discovered? Game started? |
| `captain-advice` | Captain gave advice to player | LLM+RAG | Nature of advice? Tournament captain rules? |
| `captain-conversation-violation` | Captain conversation violated rules | LLM+RAG | Tournament rules? Content? Timing? |
| `team-member-conversation` | Team member talked to player | LLM+RAG | Tournament rules? Content? |
| `captain-result-query` | Captain asking about results improperly | LLM+RAG | Tournament rules? When asked? |
| `team-default` | Team defaulted a board | LLM+RAG | Reason? Tournament rules? |
| `team-bye` | Team bye handling issue | LLM+RAG | Tournament rules? |

**Handler Justification**: Team tournament rules are highly tournament-specific (§22).

---

## 12. Category 9: Fair Play / Anti-Cheating (Fair Play / Anti-Cheating)

**Requirements**: §23

**Frequency**: Low (but serious when occurs)

**Severity**: Very High

### 12.1 Subtypes

| Subtype | Description | Handler | Key Questions |
|---------|-------------|---------|---------------|
| `suspicious-leaving` | Unnatural pattern of leaving seat | LLM+RAG | Frequency? Duration? Pattern? |
| `frequent-toilet` | Frequent toilet visits | LLM+RAG | Frequency? Duration? |
| `external-info-suspicion` | Suspected use of external information | LLM+RAG | Observations? Evidence? |
| `electronic-device-use-suspicion` | Suspected electronic device use during game | LLM+RAG | Observations? Evidence? |
| `third-party-advice-suspicion` | Suspected advice from third party | LLM+RAG | Observations? Witness? |
| `search-refusal` | Player refused bag search | LLM+RAG | Tournament rules? Reason given? |
| `bag-search-request` | Arbiter conducting bag search | LLM+RAG | Reason? Player consent? |
| `cheating-accusation` | Player accused opponent of cheating | LLM+RAG | Accusation details? Evidence? |

**Critical Constraint** (§23):
> AIは不正を自動認定してはならない。

**Handler Justification**: ALL Fair Play incidents require:
- Detailed fact recording (not automatic judgment)
- CA escalation
- Documentation for reports

**AI Role**: Assist in documenting facts, citing relevant rules, but **NEVER** conclude cheating.

---

## 13. Category 10: Tournament Administration (その他・大会運営)

**Requirements**: §9

**Frequency**: Low

**Severity**: Variable

### 13.1 Subtypes

| Subtype | Description | Handler | Key Questions |
|---------|-------------|---------|---------------|
| `pairing-error` | Error in round pairing | LLM+RAG | Error type? When discovered? Correction possible? |
| `round-start-issue` | Problem starting round | LLM+RAG | Nature of issue? |
| `venue-issue` | Venue problem affecting play | LLM+RAG | Nature of issue? Affected boards? |
| `equipment-shortage` | Insufficient boards/pieces/clocks | LLM+RAG | What's missing? Impact? |
| `player-late-arrival` | Player arrived late | LLM+RAG | How late? Default time? |
| `bye-assignment-issue` | Problem with bye assignment | LLM+RAG | Tournament rules? |
| `general-inquiry` | General tournament question | LLM+RAG | Nature of question? |

**Handler Justification**: Administrative issues are typically one-off and context-specific.

---

## 14. Classification Metadata

For each category/subtype, the system maintains:

```typescript
interface IncidentClassificationMetadata {
  category: IncidentCategory;
  subtype: string;

  // Handler routing
  handler: 'decision-tree' | 'llm-rag';
  decisionTreeId?: string;          // If decision-tree, which tree?

  // Frequency & severity (for UI prioritization)
  estimatedFrequency: 'very-high' | 'high' | 'medium' | 'low' | 'very-low';
  severity: 'very-high' | 'high' | 'medium' | 'low';

  // Critical information to collect
  criticalQuestions: QuestionTemplate[];

  // Rule references (for quick lookup)
  primaryArticles: string[];        // e.g., ["FIDE 7.5.4", "JCF NA p.48"]

  // Keywords for classification
  keywords: string[];               // For keyword-based classification

  // Examples (for LLM few-shot)
  examples: string[];
}
```

---

## 15. Classification Algorithm

### 15.1 Keyword-Based Classification (Fast, Offline)

**Use Case**: Quick categorization when offline or for simple cases

```typescript
const keywordMap: Record<IncidentCategory, string[]> = {
  'illegal-move': [
    '違法手', 'illegal move', '両手', 'two hands',
    'キャスリング', 'castling', 'プロモーション', 'promotion',
    'チェック', 'check', '時計を押', 'clock press'
  ],
  'clock-time': [
    '時計', 'clock', '時間', 'time', 'タイムオーバー', 'flag',
    '押し忘れ', 'forgot press', '故障', 'malfunction'
  ],
  'draw': [
    'ドロー', 'draw', '同一局面', 'repetition', '50手', '50-move',
    'ステイルメイト', 'stalemate', '詰み不可能', 'dead position'
  ],
  // ... etc.
};

function classifyByKeywords(description: string): IncidentCategory | null {
  const scores = {};
  for (const [category, keywords] of Object.entries(keywordMap)) {
    scores[category] = keywords.filter(kw =>
      description.toLowerCase().includes(kw.toLowerCase())
    ).length;
  }

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return null;

  return Object.keys(scores).find(cat => scores[cat] === maxScore);
}
```

### 15.2 LLM-Based Classification (Accurate, Requires Internet)

**Use Case**: Complex descriptions or ambiguous cases

**Prompt**:
```
あなたはチェス大会のIncident分類システムです。

以下のIncident説明を10カテゴリのいずれかに分類してください。

カテゴリ:
1. 違法手・着手 (illegal-move)
2. 駒・盤面の異常 (board-piece-issue)
3. 時計・時間 (clock-time)
4. 終局・勝敗 (game-result)
5. Draw (draw)
6. 棋譜 (scoresheet)
7. プレーヤーの行動 (player-behavior)
8. チーム戦 (team)
9. Fair Play / Anti-Cheating (fair-play)
10. その他・大会運営 (tournament-admin)

Incident説明: {description}

出力 (JSON):
{
  "category": "...",
  "subtype": "...",
  "confidence": 0.0-1.0,
  "reasoning": "...",
  "missingInfo": ["..."]
}
```

**Validation**:
- Confidence < 0.5 → Ask user to select category manually
- Missing info → Generate follow-up questions

---

## 16. Subtype Selection UI

**For ambiguous cases**, show subtype selection:

```
Category: 違法手・着手

どの種類の違法手ですか？

[ ] 通常の違法手
[ ] Kingがチェック状態のまま
[ ] チェックを解除しなかった
[ ] 手を指さず時計を押した
[ ] 両手で着手
[ ] 両手でキャスリング
[ ] プロモーションの不備
[ ] キャスリング関連
[ ] その他

[確定]
```

---

## 17. Future Extensions

1. **Machine Learning Classifier**
   - Train on historical incident logs
   - Improve classification accuracy over time

2. **Multi-language Support**
   - Classify English and Japanese descriptions
   - Translate keywords automatically

3. **Custom Categories**
   - Allow tournament organizers to add custom categories
   - Useful for organization-specific incidents

4. **Auto-Tagging**
   - Extract entities: board number, player name, time, etc.
   - Pre-fill incident log fields

---

## 18. References

- [Product Requirements](../requirements/product-requirements.md) - §9 (Incident categories)
- [ADR-002: Decision Tree & LLM Boundary](../decisions/ADR-002-decision-tree-llm-boundary.md) - Handler routing
- [Domain Model](./domain-model.md) - Incident entity definition
- [Architecture](./architecture.md) - Classification flow

---

## Appendix: Quick Reference Table

| Category | Total Subtypes | Decision Tree Count | LLM Count | Offline Capable |
|----------|----------------|---------------------|-----------|-----------------|
| Illegal Move | 11 | 9 | 2 | ✅ (DT), ⚠️ (LLM) |
| Board/Piece | 6 | 0 | 6 | ⚠️ |
| Clock/Time | 12 | 2 | 10 | ✅ (DT), ⚠️ (LLM) |
| Game Result | 6 | 2 | 4 | ✅ (DT), ⚠️ (LLM) |
| Draw | 9 | 7 | 2 | ✅ (DT), ⚠️ (LLM) |
| Scoresheet | 11 | 0 | 11 | ⚠️ |
| Player Behavior | 14 | 0 | 14 | ⚠️ |
| Team | 8 | 0 | 8 | ⚠️ |
| Fair Play | 8 | 0 | 8 | ⚠️ |
| Tournament Admin | 7 | 0 | 7 | ⚠️ |
| **Total** | **92** | **20** | **72** | |

**Note**: Offline capability refers to ability to generate full decision (not just classify).

---

## Revision History

- 2026-10-06: Initial version with 92 subtypes across 10 categories
