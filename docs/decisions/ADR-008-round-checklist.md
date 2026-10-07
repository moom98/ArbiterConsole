# ADR-008: Round Checklist — Storage, Phases, Sources and Guarded Round Transitions

**Status:** Accepted

**Date:** 2026-10-07

> Numbering: ADR-007 is used by Milestone 5 (LLM provider, on another branch). This ADR takes 008
> to avoid a collision.

---

## Context

Milestone 7 adds the Round Checklist (requirements §26; implementation plan Milestone 7).

- §26 lists four phases: ラウンド開始前, 開始直後, 対局中, 終了時.
- `Round` (Milestone 6) has only `pending | active | completed`, and the domain model says
  checklists should attach to `Round.id` rather than be embedded.
- Checklist items are not rulings. The project still requires that any rule reference shown to
  the arbiter is quoted verbatim from `docs/reference/rules/`.
- Requirement from the coordinator: ending a round while incidents are still pending must warn
  and need explicit confirmation. Starting with incomplete pre-round items must warn, but the
  arbiter decides.

## Decision

1. **Phases and stages.**
   - Each item has one of the four §26 phases: `pre | start | during | post`.
   - The screen groups them into three stages that follow the round status:
     - `pending` shows `pre`.
     - `active` shows `start` and `during`.
     - `completed` shows `post`.
   - The arbiter can still open any stage. Post-game items such as signatures happen while the
     round is active, so they must stay reachable.
   - No `pre-setup` or `ready` status is added. The domain-model draft had them; they are not needed.
2. **Templates are code, customisation stores references.**
   - The default items live in `lib/domain/services/round-checklist.ts`
     (`DEFAULT_CHECKLIST_ITEMS`). Their ids are stable, because saved data refers to them.
   - A per-tournament customisation (`checklistTemplates`, keyed by `tournamentId`) stores an
     ordered list of entries:
     - `{kind:"builtin", id}` for a default item;
     - `{kind:"custom", id, phase, label}` for an item the arbiter added.
   - Built-in labels and citations always come from code. Template fixes therefore reach existing
     tournaments, and citations are never copied into IndexedDB.
   - Unknown built-in ids are ignored.
   - Custom items never have citations.
3. **Completion state per round.**
   - `roundChecklists` stores `{id = roundId, roundId, tournamentId, items: [{itemId, done, doneAt?, note?}]}`.
   - The state of a removed item stays stored, but views and progress ignore it.
   - `RoundChecklistService` serialises writes, so fast taps in a row do not lose updates.
4. **Sources.**
   - An item gets citations only when its text could be checked verbatim in the PDFs.
   - The new catalog entries, locked by `__tests__/citations.test.ts`:
     - Laws 6.5, 6.6, 6.7.1 and 11.3.2 (8.7 already existed).
     - The Arbiters' Manual 2025 "Summary of the General Duties of an Arbiter", A–C (printed pp. 3–4).
     - The Manual's commentary on 6.6 (p. 23).
     - JCF NA slides p.11–12, 「アービターの職務」 b–o.
   - Items without a verifiable source have no citation. These are: pairings/player names,
     board/colour mistakes, clock stopped/final position, scoresheet collection, and the
     incident reviews.
5. **Guarded transitions.**
   - `assessRoundTransition` is pure domain and returns warnings:
     - `incomplete-pre-round` when starting;
     - `pending-incidents` when ending. This counts incidents with `status === "pending"` on the
       round's games, which includes AI decisions awaiting confirmation (Milestone 5 keeps those
       pending).
   - `RoundChecklistService.changeRoundStatus(roundId, to, {confirmed})` returns
     `confirmation-required` until the arbiter confirms, then delegates to
     `TournamentService.changeRoundStatus`.
   - Warnings never block. The arbiter decides, consistent with decision support.
   - The confirmation is in-page (`RoundTransitionControl`); it does not use `confirm()`.
   - The tournament detail page uses the same control, so it cannot bypass the warning.
   - The confirmation sends the warnings that were shown (`acknowledged`). If new warnings have
     appeared since then (more pending incidents, more incomplete items, or a new kind), the
     service asks again (`warningsAcknowledged`).
6. **Schema.**
   - Dexie `version(7)` only adds the `roundChecklists` (`id, tournamentId`) and
     `checklistTemplates` (`tournamentId`) tables; existing data needs no conversion.
   - Version 6 is unused. Milestone 5 adds no stores. Any future schema change must use version 8 or higher.
   - Tournament deletion also removes these rows in the same transaction.

## Consequences

- Phases match §26, and the round status model stays as it was in Milestone 6.
- Template edits apply to every round of the tournament, past rounds included. A past round's
  progress can change if items are added later. This is accepted: the record keeps what was ticked
  and when.
- **Dexie version ordering:** new schema versions must be above 7, because a device that has opened
  a v7 build will not run a lower version later.
- Not included:
  - checklist history or audit across edits;
  - per-board checklists (for example, marking the specific boards whose clocks were checked);
  - linking the "未解決Incident" item to the incident list beyond the count and the log link.
