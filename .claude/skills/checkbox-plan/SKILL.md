---
name: checkbox-plan
description: Create or update a short Markdown checkbox plan for a small or medium task — a flat checklist, or a few dependency-ordered phases with acceptance criteria. Use this whenever the user asks to plan, break down, outline steps for, or make a checklist or to-do plan for a bug fix, feature, refactor, migration or other bounded problem, even if they only say "plan this" or "what are the steps".
---

# Checkbox Plan

Write one Markdown file that a person or a coding agent can follow and tick off. Keep it short: the plan should be easy to read in one go and easy to update.

## Choose the shape

- **Flat checklist**: up to roughly 8 tasks that can be done and checked in one sitting.
- **Phased plan**: more tasks, or steps that should be implemented, validated and committed separately. Use 2–5 phases, ordered by dependency.

If unsure, start flat; convert to phases only when the list grows or contains natural checkpoints.

## Where to put it

Use the location the user names. Otherwise use `docs/plan/<slug>.md`, where `<slug>` is short and kebab-case (for example `fix-login-redirect`).

## Flat template

``` md
# <Title>

Goal: <one or two sentences describing the observable end state>

Scope: <what is included> · Not included: <explicit non-goals>

## Tasks

- [ ] 1 <concrete task with a verifiable outcome>
- [ ] 2 <task>
    - [ ] 2.1 <subtask, only when useful>
- [ ] 3 <task>

## Done when

- [ ] A <objective, checkable criterion>
- [ ] B <criterion>

## Notes

- <decisions, constraints or open questions; delete the section if empty>
```

## Phased template

``` md
# <Title>

Goal: <one or two sentences>

Scope: <included> · Not included: <non-goals>

## Phase 1 — <Name>

- [ ] 1.1 <task>
- [ ] 1.2 <task>

Done when:

- [ ] 1.A <criterion>

## Phase 2 — <Name>

Depends on: Phase 1

- [ ] 2.1 <task>

Done when:

- [ ] 2.A <criterion>

## Notes

- <decisions, constraints or open questions>
```

## Writing rules

- Tasks are concrete and verifiable ("Add a unit test for an expired token", not "Improve tests"). No checkbox per file edit.
- "Done when" criteria are objective: a command passes, a behaviour is observable, a test exists.
- Include only the detail needed to do the task correctly; specify outcomes and constraints, not keystrokes.
- Stay within the requested scope. Put possible extras under Notes as follow-ups, not as tasks.
- Before finishing, check the order: nothing is verified before what it depends on exists, and every decision a later step needs is made or listed as a task.
- Ask the user only about open decisions that would change the plan's structure; otherwise record the choice as a task or note.
- Use placeholder data in examples (`user_id: 12345`, `user@example.test`); never real names or identifiers.
- Write in a clear, formal register.

## Checkboxes and IDs

- `[ ]` incomplete, `[x]` complete and verified. Tick a task only after it has been checked; tick a parent only when all its children are ticked.
- IDs (`1`, `2.1`, `1.A`) are stable. When updating a plan, never renumber; give new items the next free number, even if that places them out of order.
- Keep completed `[x]` items. Strike through obsolete items with a short reason (`~~3 Add cache~~ — not needed, see Notes`) instead of deleting them.

## Working through a phased plan

Implement one phase at a time: complete its tasks, check its "Done when" criteria, tick the boxes, add any decision a later phase needs to Notes, then stop for review or commit before the next phase.