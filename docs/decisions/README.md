# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Arbiter Console project.

## Purpose

ADRs document important architectural and design decisions made during the project lifecycle. They provide context for why certain approaches were chosen and help maintain consistency over time.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-001](./ADR-001-technology-stack.md) | Technology Stack Selection | Accepted |
| [ADR-002](./ADR-002-decision-tree-llm-boundary.md) | Decision Tree and LLM Responsibility Boundary | Accepted |
| [ADR-003](./ADR-003-offline-rule-search.md) | Offline Rule Search: Japanese Tokenization, Multilingual Embeddings, Self-hosted Assets | Accepted |
| [ADR-004](./ADR-004-explicit-ruleset-and-illegal-move-counting.md) | Explicit Ruleset Context and Illegal-Move Counting | Accepted |
| [ADR-005](./ADR-005-additional-decision-trees-mate-material-and-chess-library.md) | Additional Decision Trees, Mate-Material Check and Chess Library | Accepted |

## Naming Convention

ADRs should follow this naming pattern:

```
ADR-001-xxxx.md
ADR-002-xxxx.md
ADR-003-xxxx.md
...
```

Where:
- The number is sequential and zero-padded
- `xxxx` is a short, kebab-case description of the decision

Examples:
- `ADR-001-use-nextjs-framework.md`
- `ADR-002-offline-first-architecture.md`
- `ADR-003-rule-engine-design.md`

## ADR Template

Each ADR should contain at minimum:

### Status

Current status of the decision (e.g., Proposed, Accepted, Superseded, Deprecated)

### Context

What is the issue we're facing? What factors are influencing this decision?

### Decision

What decision have we made? Be specific and clear.

### Consequences

What are the implications of this decision? Consider:
- Positive outcomes
- Negative outcomes
- Trade-offs
- Risks
- Future constraints or opportunities
