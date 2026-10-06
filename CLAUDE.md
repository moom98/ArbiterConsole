# Arbiter Console - Claude AI Instructions

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

## What This File Is NOT

This file is an entry point for Claude to understand the project, not a detailed requirements specification.

Keep this file concise and refer to specific documentation for details.
