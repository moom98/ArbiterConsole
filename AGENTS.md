# Arbiter Console - Codex AI Instructions

## Project Overview

**Project Name:** Arbiter Console

**Purpose:** Decision Support application for chess tournament arbiters

**Important:** This is a Decision Support system, not an automated ruling system. It assists human arbiters, but does not make final decisions on their behalf.

## Documentation Structure

- **Formal Requirements:** `docs/requirements/product-requirements.md`
- **Design Documents:** `docs/design/`
- **Architecture Decision Records:** `docs/decisions/`
- **Chess Rules & Reference Materials:** `docs/reference/rules/`

## Core Principles

### Before Implementation or Design

1. **Read relevant requirements and design documents first**
2. **Understand the context before proposing solutions**
3. **Do not modify `docs/requirements/product-requirements.md` for implementation convenience**

### Chess Domain Rules

1. **Never generate chess rulings without proper sources**
2. **Always consider tournament-specific rules**
3. **When information is insufficient, ask for clarification instead of guessing**

### Implementation Principles

1. **High-frequency, high-risk rulings should be implemented as deterministic Decision Trees / Rule Engines where possible**
2. **Separate LLM usage from deterministic domain logic**
3. **Do not write chess rule judgment logic directly in React Components**

### Decision Records

- **Record important design decisions as ADRs in `docs/decisions/`**
- **ADRs help maintain consistency and provide context for future changes**

## Autonomous Development Workflow

Development should proceed autonomously.
Do not stop to ask for confirmation for routine implementation decisions
unless the decision would materially change product requirements,
introduce a major architectural change, or create an irreversible operation.

Work milestone by milestone.

### Milestone lifecycle

For each milestone:

1. Read the relevant requirements and existing design documents.
2. Inspect the existing implementation before making changes.
3. Implement the milestone.
4. Run relevant tests.
5. Run lint and type checking where applicable.
6. Review the implementation critically.
7. Fix issues found during review.
8. Update design documents if the implementation changed the design.
9. Create or update ADRs for significant architectural decisions.
10. Update `docs/progress/current.md`.
11. Create a milestone summary under `docs/progress/`.

A milestone is not complete until implementation, verification, review,
documentation, and progress updates are finished.

### Context management

Do not rely on conversation history as persistent project knowledge.

All information required to continue development in a completely fresh
Codex session must be persisted in the repository.

At the end of each milestone, update:

`docs/progress/current.md`

with at least:

- completed work
- important implementation decisions
- relevant files
- tests and verification performed
- known issues
- unresolved questions
- next milestone
- information a fresh Codex session needs to continue

If an architectural decision is important for future development,
record it in `docs/decisions/` rather than only mentioning it in the
conversation.

Design knowledge belongs in `docs/design/`.
Product requirements belong in `docs/requirements/`.
Implementation state belongs in `docs/progress/`.

### Context reset boundary

Treat the completion of a milestone as a natural context boundary.

Before ending a milestone, ensure that a fresh Codex session could continue
the project by reading:

- `AGENTS.md`
- `docs/requirements/product-requirements.md`
- relevant documents under `docs/design/`
- `docs/progress/current.md`

Do not assume that future sessions have access to the current conversation.

### Implementation autonomy

You may independently:

- create and modify implementation files
- refactor code when necessary
- add tests
- fix bugs
- update design documents
- create ADRs
- choose reasonable implementation details consistent with existing design

Ask the user before:

- changing product requirements
- removing an existing requirement
- making a major architectural change that conflicts with current design
- introducing a paid external service
- performing destructive or irreversible operations
- weakening correctness or safety requirements

When multiple reasonable implementation options exist and none materially
affect product requirements or architecture, choose one and proceed.
Do not interrupt development merely to ask the user to choose between
equivalent implementation details.

## What This File Is NOT

This file is an entry point for Codex to understand the project, not a detailed requirements specification.

Keep this file concise and refer to specific documentation for details.
