# Domain Logic Rules

**Applies to:** `src/domain/**`

## Principles

1. **Domain logic must not depend on React**
   - Keep domain logic framework-agnostic
   - Domain models and rule evaluators should be pure TypeScript/JavaScript

2. **Rule evaluations should be deterministic where practical**
   - Prefer explicit decision trees over probabilistic approaches for high-frequency rulings
   - Make ruling logic testable and reproducible

3. **Every ruling result must retain references to its rule sources**
   - Link results to specific FIDE/JCF/Tournament rule clauses
   - Enable users to verify the basis for each ruling suggestion

4. **LLM calls must not be made directly from deterministic rule evaluators**
   - Separate deterministic logic from AI-assisted interpretation
   - Keep core domain logic LLM-free

5. **Tournament rules and rule versions must be explicit inputs to rule evaluation**
   - Never assume a default ruleset without explicit context
   - Track which version of rules is being applied

6. **Do not hard-code chess rulings in UI components**
   - UI components should display ruling results, not compute them
   - All ruling logic belongs in the domain layer
