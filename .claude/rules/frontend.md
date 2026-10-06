# Frontend Development Rules

**Applies to:**
- `src/app/**`
- `src/components/**`
- `src/features/**`

## Technology

- **Use TypeScript** for all frontend code

## Design Principles

1. **Mobile-first design**
   - Design for mobile devices first, then scale up
   - Assume arbiters will primarily use smartphones or tablets during tournaments

2. **Optimize for quick operation during tournaments**
   - Arbiters need to make decisions quickly under pressure
   - Minimize the number of taps/clicks required for common operations

3. **Do not place business logic in React Components**
   - Components should be presentational
   - Delegate domain logic to appropriate domain/service layers

4. **Minimize taps for critical operations**
   - Common tasks should complete in as few interactions as possible
   - Use shortcuts and defaults intelligently

5. **Show "what to do now" prominently**
   - Avoid displaying long text blocks initially
   - Present clear, actionable next steps
   - Provide detail on demand (expandable sections, drill-down)

## UI/UX Guidelines

- **Clear visual hierarchy** - Most important information first
- **Large touch targets** - Easy to tap accurately during stressful situations
- **Minimal scrolling** - Key information visible without scrolling
- **Progressive disclosure** - Show simple options first, details when needed
