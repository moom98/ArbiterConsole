# ADR-002: Decision Tree and LLM Responsibility Boundary

**Status:** Accepted

**Date:** 2026-10-06

**Deciders:** Development Team

---

## Context

### The Core Problem

Arbiter Console must provide **Decision Support** for chess tournament arbiters (§2). The system faces a fundamental tension:

1. **Need for Speed & Reliability**: Arbiters need rulings in seconds, often offline (§4, §31, §33)
2. **Need for Accuracy**: Wrong rulings can unfairly affect tournament outcomes
3. **AI Safety Constraint**: Per §14, §34, the system must **never generate rulings without proper sources**
4. **Complexity**: Some incidents have clear deterministic rules, others are context-dependent

### Requirements Analysis

**§14: AI Constraints (MUST follow)**
- ✅ **必須**: Base all rulings on registered sources
- ✅ **必須**: Cite Article numbers
- ✅ **必須**: Consider Tournament Profile
- ✅ **必須**: Ask clarifying questions if information is missing
- ✅ **必須**: Explicitly state uncertainty
- ✅ **必須**: Recommend CA escalation for ambiguous cases
- ❌ **禁止**: Generate rulings without sources
- ❌ **禁止**: Speculate when rules are not found
- ❌ **禁止**: Override tournament regulations with general knowledge
- ❌ **禁止**: Give chess advice to players
- ❌ **禁止**: Use "probably" or "generally" as sole justification for penalties

**§34: Fail Safe**
- If applicable rules cannot be determined → "裁定を確定できません"
- If sources are insufficient for critical rulings → "CAへ確認してください"
- **AI must not force an answer**

**§35: Product AI Positioning**
> 頻出かつ重大な裁定は、可能な限りLLMのみで決定せず、明示的なルール・Decision Treeによって処理する。

This is the **critical requirement** that motivates this ADR.

### The Risk

If we route all incidents to LLM-based reasoning:
- **Hallucination risk**: LLM may cite non-existent articles or misinterpret rules
- **Performance**: Every ruling requires API call (slow, expensive, offline-incompatible)
- **Consistency**: Same incident may produce different rulings across requests
- **Trust**: Arbiters may distrust AI "black box" for critical decisions

If we route all incidents to Decision Trees:
- **Rigidity**: Cannot handle novel or context-dependent scenarios
- **Maintenance burden**: Thousands of edge cases to encode
- **Poor UX**: System says "cannot determine" too often

### The Question

**Which incidents should be handled by Decision Trees vs. LLM-based reasoning?**

---

## Decision

We adopt a **hybrid architecture** with clear separation:

### 1. Decision Tree Jurisdiction

**Decision Trees handle incidents where:**
1. **Deterministic rules exist**: Clear conditions → clear outcomes
2. **High frequency**: Common occurrences during tournaments
3. **High impact**: Directly affect game results (time, win/loss)
4. **Offline-critical**: Must work without internet

**Specific Incidents (Decision Tree):**

| Category | Incident Type | Rationale |
|----------|--------------|-----------|
| Illegal Move | Standard competition (§16) | Deterministic: 1st=+2min, 2nd=Game Loss. High frequency. |
| Illegal Move | Rapid A4 (§17) | Deterministic but different rules from Standard. |
| Illegal Move | Rapid A5 (§17) | More complex (depends on if opponent moved), but still encodable. |
| Flag Fall | Time forfeit with mate material check (§18) | Algorithmic: Check opponent's material for mating ability. |
| Draw Claim | Threefold repetition (§19) | Algorithmic: Position comparison + conditions check. |
| Draw Claim | 50-move rule (§19) | Countable: Verify move count since last capture/pawn move. |
| Draw Claim | Fivefold repetition (§19) | Algorithmic: Position comparison (arbiter intervenes). |
| Draw Claim | 75-move rule (§19) | Countable: Verify move count (arbiter intervenes). |
| Draw Claim | Stalemate (§19) | Algorithmic: Verify no legal moves + not in check. |
| Draw Claim | Dead position (§19) | Algorithmic: Check material combinations. |

**Total: ~10 Decision Trees for MVP**

### 2. LLM Jurisdiction

**LLM+RAG handles incidents where:**
1. **Context-dependent**: Requires interpretation of circumstances
2. **Rule ambiguity**: Multiple rules may apply, priority unclear
3. **Tournament-specific**: Heavily influenced by custom regulations
4. **Lower frequency**: Less common, but still important
5. **Human judgment**: Arbiter discretion is central (AI assists, not decides)

**Specific Incidents (LLM+RAG):**

| Category | Incident Type | Rationale |
|----------|--------------|-----------|
| Clock/Time | Clock malfunction (§18) | Context: Type of malfunction, game phase, affects ruling. |
| Clock/Time | Clock押し忘れ (§18) | Context: How long, was opponent affected, was it intentional? |
| Clock/Time | 手を指す前にClockを押した (§18) | Context: Did it affect game state, was it repeated? |
| Player Behavior | Electronic device possession (§21) | **Tournament-specific**: Rules vary by tournament. |
| Player Behavior | Leaving playing area (§21) | Context: How long, frequency, permission sought? |
| Player Behavior | Excessive draw offers (§21) | Subjective: What is "excessive"? |
| Player Behavior | Disturbance / noise (§21) | Subjective: Level of disturbance, intent. |
| Scoresheet | Scoresheet errors (§20) | Context: Type of error, when discovered, game phase. |
| Scoresheet | Pre-recording moves (§20) | Context: Exception for draw claims, verification needed. |
| Team | Captain violations (§22) | **Tournament-specific**: Captain rules vary. |
| Team | Board order violations (§22) | **Tournament-specific**: FBO rules vary. |
| Fair Play | Suspected cheating (§23) | **Never automate**: AI only assists documentation. |
| Fair Play | Refusal of bag search (§23) | Context: Tournament rules, player rights, escalation. |
| Draw | Draw offer disputes (§19) | Context: When offered, how recorded, tournament rules. |
| Board/Piece | Piece displacement (§9) | Context: How displaced, intentional or accidental, when noticed. |
| Game Result | Disputed result (§9) | Context: Conflicting claims, evidence, scoresheets. |

**Total: ~15-20 LLM-assisted categories for MVP**

### 3. Hybrid Cases

Some incidents **start with LLM classification, then route to Decision Tree**:

**Example: Illegal Move Workflow**
```
1. User input: "黒が両手でキャスリングした"
2. LLM classifies:
   - Category: illegal-move
   - Subtype: two-hands-castling
   - Missing info: clock pressed? opponent moved? game type?
3. System asks follow-up questions (LLM-generated)
4. User answers
5. → Route to IllegalMoveStandardTree (Decision Tree)
6. Decision Tree outputs deterministic ruling
```

**Rationale**: LLM excels at natural language understanding, but **ruling logic is deterministic**.

### 4. CA Escalation Triggers

**Automatic CA escalation recommendation when:**
1. **No applicable rules found** in RAG search (confidence < threshold)
2. **Multiple conflicting rules** from different sources (tournament vs. FIDE)
3. **LLM uncertainty flag** (model expresses low confidence)
4. **Fair Play incidents** (per §23: never automate cheating determination)
5. **Novel incidents** not covered by Decision Trees or indexed rules

**Per §34**: Display "CAへ確認してください" instead of forcing a ruling.

### 5. Architecture Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Input (NL or Voice)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Incident Classifier (LLM - Haiku)                │
│  • Extract: category, subtype, initial context                  │
│  • Identify: missing information                                 │
│  Output: IncidentClassification                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               Question Generator (LLM or Template)               │
│  • Generate follow-up questions for missing info                │
│  • Priority: Only ask questions that change ruling              │
│  Output: Question[]                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (after user answers)
┌─────────────────────────────────────────────────────────────────┐
│                    Decision Router (Rule Engine)                 │
│  IF incident in DECISION_TREE_CATEGORIES:                        │
│    → Route to Decision Tree                                      │
│  ELSE:                                                            │
│    → Route to LLM Reasoner                                       │
└─────────────────────────────────────────────────────────────────┘
         │                                    │
         │ Deterministic                      │ Context-dependent
         ▼                                    ▼
┌──────────────────────┐          ┌──────────────────────────────┐
│   Decision Tree      │          │   LLM Reasoner + RAG         │
│                      │          │                              │
│ • Pure TypeScript    │          │ • Search rules (RAG)         │
│ • No API calls       │          │ • Apply rule priority (§6)   │
│ • Offline-safe       │          │ • Synthesize with context    │
│ • 100% reproducible  │          │ • Generate explanation       │
│ • Explicit sources   │          │ • Cite all sources           │
│                      │          │ • Flag uncertainty           │
└──────────────────────┘          └──────────────────────────────┘
         │                                    │
         └────────────────┬───────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Output Validator (Zod)                        │
│  • Verify Decision schema                                        │
│  • Ensure sources are cited                                      │
│  • Reject if confidence=none without CA escalation              │
│  • Reject if penalties lack article references                  │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Decision Output (§13)                         │
│  • 結論                                                          │
│  • 今すぐ行うこと                                                 │
│  • 介入 (immediate / wait-for-claim / consult-ca)               │
│  • Penalty                                                       │
│  • 根拠 (sources with article numbers)                           │
└─────────────────────────────────────────────────────────────────┘
```

### 6. LLM Safety Constraints (Implementation)

**System Prompt Template (for LLM Reasoner):**
```
You are an assistant for chess arbiters. Your role is to:
1. Search registered rule sources and cite them
2. Explain applicable rules clearly
3. Recommend CA escalation if uncertain

CRITICAL CONSTRAINTS:
- You MUST cite article numbers for all rulings
- You MUST NOT invent rules or cite non-existent articles
- If no applicable rule is found, say "該当する規則が見つかりませんでした。CAへ確認してください。"
- If multiple rules conflict, say "複数の規定が関係するためCAへの確認が必要です。"
- You MUST NOT use "probably", "generally", or "usually" as the sole basis for penalties
- You MUST NOT give chess advice (e.g., "this move is better")
- Tournament-specific rules override FIDE rules

Retrieved sources:
{retrieved_articles}

Tournament context:
{tournament_profile}

Incident:
{incident_description}

Output format:
{decision_schema}
```

**Output Validation Rules:**
```typescript
// All LLM outputs must pass this validation
function validateLLMDecision(decision: Decision): ValidationResult {
  // Rule 1: All penalties must have sources
  for (const penalty of decision.penalties) {
    if (decision.sources.length === 0) {
      return { valid: false, reason: "Penalties without sources" };
    }
  }

  // Rule 2: If confidence is low/none, must recommend CA
  if (['low', 'none'].includes(decision.confidence)) {
    if (!decision.escalationRecommended) {
      return { valid: false, reason: "Low confidence without CA escalation" };
    }
  }

  // Rule 3: Sources must reference real articles
  for (const source of decision.sources) {
    const article = await articleRepo.findByNumber(source.articleNumber);
    if (!article) {
      return { valid: false, reason: `Article ${source.articleNumber} not found` };
    }
  }

  // Rule 4: No "probably" or "generally" in conclusion/actions
  const speculativeWords = ['probably', 'generally', 'usually', 'たぶん', '一般的に'];
  const allText = [decision.conclusion, ...decision.actions].join(' ');
  if (speculativeWords.some(word => allText.includes(word))) {
    return { valid: false, reason: "Speculative language detected" };
  }

  return { valid: true };
}
```

---

## Consequences

### Positive

1. **Safety First**: Decision Trees eliminate hallucination risk for critical incidents
2. **Offline Capability**: Decision Trees work without internet (§31)
3. **Performance**: Decision Trees execute in <100ms vs. LLM's ~5-10s
4. **Consistency**: Same input → same output for deterministic cases
5. **Trust**: Arbiters can verify Decision Tree logic (open, inspectable)
6. **Cost Efficiency**: Reduce LLM API calls by ~40-50% (rough estimate)
7. **Flexibility**: LLM handles long tail of edge cases and novel incidents
8. **Graceful Degradation**: If LLM unavailable, Decision Trees still work

### Negative

1. **Maintenance Burden**: Decision Trees require manual updates when rules change
   - **Mitigation**: Decision Trees are versioned with RuleSource versions
2. **Classification Dependency**: If LLM misclassifies, may route to wrong handler
   - **Mitigation**: Allow arbiter to manually select category
3. **Boundary Ambiguity**: Some incidents may be borderline (e.g., clock issues)
   - **Mitigation**: Document clear criteria in this ADR, allow override
4. **Code Duplication**: Decision Tree logic and RAG may reference same rules
   - **Mitigation**: Decision Trees cite same articles as RAG sources

### Risks

1. **Decision Tree Incompleteness**: May miss edge cases in deterministic logic
   - **Mitigation**: Extensive testing (per `.claude/rules/testing.md`), fallback to LLM
   - **Mitigation**: "Other" option in Decision Tree branches → escalate to CA
2. **LLM Hallucination Despite Safeguards**: Validation may not catch all errors
   - **Mitigation**: Human-in-the-loop: Arbiter reviews before applying
   - **Mitigation**: Incident log records AI-generated vs. arbiter-confirmed rulings
3. **Rule Source Gaps**: RAG may not retrieve relevant articles
   - **Mitigation**: Hybrid search (vector + full-text), manual rule lookup UI
   - **Mitigation**: If search returns 0 results → automatic CA escalation
4. **Over-reliance on Decision Trees**: Team may avoid LLM improvements
   - **Mitigation**: Monitor metrics (CA escalation rate, arbiter overrides)

---

## Implementation Guidelines

### 1. Decision Tree Development Process

**For each Decision Tree:**
1. Map all rule branches (Standard vs. Rapid, A4 vs. A5, etc.)
2. Identify all information requirements (questions to ask)
3. Define all output permutations (conclusion + actions + penalties)
4. Cite sources for each branch (FIDE article + JCF reference)
5. Write unit tests for all branches (per `.claude/rules/testing.md`)
6. Document assumptions and edge cases

**Example: Illegal Move Standard Tree**
```typescript
class IllegalMoveStandardTree implements DecisionTree {
  // Must cite these sources
  private readonly SOURCES = {
    illegalMoveDefinition: { article: 'FIDE 7.5.1', page: null },
    illegalMoveCompletion: { article: 'FIDE 7.5.4', page: null },
    firstOffensePenalty: { article: 'FIDE 7.5.5', page: null, jcf: 'p.48' },
    secondOffensePenalty: { article: 'FIDE 7.5.5', page: null, jcf: 'p.48' }
  };

  evaluate(input: IllegalMoveInput): Decision {
    // Branch 1: Clock not pressed → not an illegal move
    if (!input.clockPressed) {
      return {
        conclusion: "時計が押されていないため、違法手は成立していません。",
        actions: ["何もする必要はありません。"],
        intervention: 'wait-for-claim',
        penalties: [],
        sources: [this.SOURCES.illegalMoveCompletion],
        confidence: 'high',
        escalationRecommended: false,
        generatedBy: 'decision-tree'
      };
    }

    // Branch 2: Opponent already moved → too late to correct
    if (input.opponentMoved) {
      return {
        conclusion: "相手がすでに次の手を指したため、訂正できません。",
        actions: ["対局を継続させる。"],
        intervention: 'immediate',
        penalties: [],
        sources: [this.SOURCES.illegalMoveDefinition],
        confidence: 'high',
        escalationRecommended: false,
        generatedBy: 'decision-tree'
      };
    }

    // Branch 3: First offense
    if (input.playerIncidentCount === 0) {
      return {
        conclusion: `${input.playerColor}の1回目のIllegal Move。`,
        actions: [
          "時計を止める",
          "局面をIllegal Move直前へ戻す",
          `${input.opponentColor}に2分追加`,
          `${input.playerColor}に正しい手を指させる`
        ],
        intervention: 'immediate',
        penalties: [{
          type: 'time-addition-opponent',
          timeAdjustmentSeconds: 120,
          targetPlayer: input.opponentColor,
          description: `${input.opponentColor}に2分追加`
        }],
        sources: [
          this.SOURCES.illegalMoveCompletion,
          this.SOURCES.firstOffensePenalty
        ],
        confidence: 'high',
        escalationRecommended: false,
        generatedBy: 'decision-tree'
      };
    }

    // Branch 4: Second or more → Game Loss
    return {
      conclusion: `${input.playerColor}の2回目以降のIllegal Move。Game Loss。`,
      actions: [
        "時計を止める",
        `${input.playerColor}の負けとする`,
        "結果を記録する"
      ],
      intervention: 'immediate',
      penalties: [{
        type: 'game-loss',
        description: '2回目の違法手によりGame Loss'
      }],
      sources: [this.SOURCES.secondOffensePenalty],
      confidence: 'high',
      escalationRecommended: false,
      generatedBy: 'decision-tree'
    };
  }
}
```

### 2. LLM Reasoner Guidelines

**RAG Search Strategy:**
1. Generate query embedding from incident description
2. Vector search: Top 10 articles by semantic similarity
3. Full-text search: Top 10 articles by keyword match
4. Merge results, remove duplicates
5. Apply rule priority (§6): Tournament > JCF > FIDE
6. Include all articles in LLM context (up to context limit)

**LLM Prompt Engineering:**
- Use structured output (JSON mode or tool calling)
- Require citations in output schema
- Include retrieved articles verbatim in prompt
- Provide tournament context explicitly
- Use few-shot examples of good rulings

**Fallback Logic:**
```typescript
async function llmReasoning(
  incident: IncidentClassification,
  context: GameContext,
  articles: Article[]
): Promise<Decision> {
  // If no articles retrieved → auto-escalate
  if (articles.length === 0) {
    return {
      conclusion: "該当する規則が見つかりませんでした。",
      actions: ["CAへ確認してください。"],
      intervention: 'consult-ca',
      penalties: [],
      sources: [],
      confidence: 'none',
      escalationRecommended: true,
      escalationReason: 'No applicable rules found in database',
      generatedBy: 'llm'
    };
  }

  // Call LLM
  const llmOutput = await claudeAPI.generate({
    system: SYSTEM_PROMPT,
    articles,
    incident,
    context
  });

  // Validate output
  const validation = validateLLMDecision(llmOutput);
  if (!validation.valid) {
    // LLM violated constraints → auto-escalate
    return {
      conclusion: "裁定を確定できません。",
      actions: ["CAへ確認してください。"],
      intervention: 'consult-ca',
      penalties: [],
      sources: [],
      confidence: 'none',
      escalationRecommended: true,
      escalationReason: `LLM output validation failed: ${validation.reason}`,
      generatedBy: 'llm'
    };
  }

  return llmOutput;
}
```

### 3. Testing Requirements (per `.claude/rules/testing.md`)

**Decision Tree Tests:**
- ✅ All branches must have unit tests
- ✅ Test with Standard vs. Rapid competition types
- ✅ Test with different offense counts (1st, 2nd, 3rd)
- ✅ Test with tournament-specific overrides
- ✅ Verify sources are cited for all branches

**LLM Tests:**
- ✅ Test with mock articles (simulate RAG retrieval)
- ✅ Test validation logic (reject invalid outputs)
- ✅ Test escalation triggers (no rules, conflicts, low confidence)
- ✅ Test citation extraction (verify article references are valid)

**Integration Tests:**
- ✅ End-to-end: User input → classification → routing → decision
- ✅ Test Decision Tree routing for all 10 deterministic categories
- ✅ Test LLM routing for context-dependent categories
- ✅ Test offline mode (Decision Trees work, LLM fails gracefully)

---

## Open Questions & Assumptions

### Assumptions Made

1. **Assumption**: FIDE and JCF rules for Illegal Move penalties are stable and won't change mid-tournament
   - **Risk**: If rules change, Decision Trees need updates
   - **Mitigation**: Version Decision Trees with rule versions

2. **Assumption**: Arbiters can answer follow-up questions accurately (e.g., "時計を押しましたか？")
   - **Risk**: Arbiter may be uncertain or incorrect
   - **Mitigation**: Allow "不明" option → triggers CA escalation

3. **Assumption**: LLM (Claude) will reliably cite sources when provided in context
   - **Risk**: Hallucination despite citations
   - **Mitigation**: Validation layer rejects uncited sources

### Open Questions (To Be Resolved in Implementation)

1. **Q**: How to handle Decision Tree versioning when FIDE rules change?
   - **Options**: (a) Keep old trees for historical tournaments, (b) Migrate trees with rule updates
   - **Recommendation**: Discuss in future ADR

2. **Q**: Should we allow manual override from Decision Tree to LLM?
   - **Use case**: Arbiter thinks Decision Tree result is wrong
   - **Recommendation**: Yes, add "Override with manual CA consultation" button

3. **Q**: How to handle hybrid cases where Decision Tree needs LLM help?
   - **Example**: Illegal Move tree determines penalty, but arbiter needs explanation for player (§15)
   - **Recommendation**: Decision Tree outputs ruling, separate LLM call generates player explanation

4. **Q**: What if RAG retrieves conflicting articles from same source (e.g., FIDE 2023 vs. FIDE 2025)?
   - **Current Design**: Rule version management (§30) prevents this
   - **Validation**: Ensure only active rules are indexed

---

## Related Documents

- [Product Requirements](../requirements/product-requirements.md) - §14, §34, §35
- [Architecture](../design/architecture.md) - Decision Engine design
- [Domain Model](../design/domain-model.md) - Decision, Penalty entities
- [Domain Rules](../../.claude/rules/domain.md) - LLM separation from domain logic
- [Testing Rules](../../.claude/rules/testing.md) - Decision Tree testing requirements

---

## Appendix: Decision Tree Catalog (MVP)

| ID | Name | Competition Type | Input Questions | Est. Complexity |
|----|------|------------------|-----------------|-----------------|
| DT-001 | Illegal Move Standard | Standard | Clock pressed? Opponent moved? Offense count? | Medium |
| DT-002 | Illegal Move Rapid A4 | Rapid (A4) | Clock pressed? Opponent moved? Offense count? | Medium |
| DT-003 | Illegal Move Rapid A5 | Rapid (A5) | Clock pressed? Opponent moved? Offense count? | High |
| DT-004 | Flag Fall | All | Opponent material? (K, KN, KB, etc.) | Low |
| DT-005 | Threefold Repetition | All | Player claimed? On turn? Position history? | High |
| DT-006 | 50-move Rule | All | Player claimed? On turn? Move count? | Medium |
| DT-007 | Fivefold Repetition | All | Position history? | High |
| DT-008 | 75-move Rule | All | Move count? | Low |
| DT-009 | Stalemate | All | No legal moves? Not in check? | Low |
| DT-010 | Dead Position | All | Material check? | Low |

**Note**: DT-005, DT-007 (repetition trees) require position comparison logic, which may be complex. Consider using FEN comparison library.

---

## Revision History

- 2026-10-06: Initial version
