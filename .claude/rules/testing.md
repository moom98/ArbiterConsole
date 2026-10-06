# Testing Rules

## Core Testing Principles

1. **Rule Engine / Decision Tree must be unit-testable**
   - Design domain logic for easy testing
   - Avoid tight coupling that makes testing difficult

2. **Write tests for major branches in chess ruling logic**
   - Cover key decision points in rule evaluation
   - Test both common and edge cases

3. **Do not rely solely on LLM output for correctness**
   - LLM responses can vary; verify logic independently
   - Use deterministic tests for deterministic logic

4. **Test competition format variations**
   - Standard time control
   - Rapid time control
   - Blitz time control
   - Other formats as applicable

5. **Test tournament-specific rule overrides**
   - Ensure system correctly applies custom tournament rules
   - Verify that tournament rules properly override defaults

6. **Test scenarios where incident history affects results**
   - Repeated violations
   - Escalation policies
   - Context-dependent rulings

## Test Coverage Goals

- **High coverage for rule evaluation logic** - This is core functionality
- **Test rule version handling** - Ensure correct rules are applied
- **Test edge cases** - Unusual but possible scenarios
- **Integration tests for end-to-end flows** - Verify complete ruling workflows

## Continuous Verification

- **Regression tests** - Ensure changes don't break existing rulings
- **Test with real tournament data** - Use actual scenarios when possible
