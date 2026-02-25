---
name: workflow
description: Enforce the explicit mode cadence (ideation -> plan -> tasks -> implementation -> review -> wrapup) with transition gates and optional single-mode overrides.
---

# Instructions

## When to use

- Default for any task that touches code or modifies planning/docs.
- If the user explicitly asks for a specific mode, run only that mode.

## Mode sequence

1. `ideation`
2. `plan`
3. `tasks`
4. `implementation`
5. `review`
6. `wrapup`

## Transition gates

- `ideation -> plan`: only when user requests converting ideation into a plan.
- `plan -> tasks`: only when user requests task breakdown.
- `tasks -> implementation`: only when user explicitly requests implementation start and the plan is explicitly approved.
- `implementation -> review`: when implementation is complete or user requests review mode.
- `review -> wrapup`: when review outcomes are accepted or user requests wrapup.

## Required artifacts by mode

- `ideation`: update/create `docs/ideas/<nnn>-<topic>.md`
- `plan`: update/create `docs/plans/<nnn>-<topic>.md`
- `tasks`: update the same plan doc with phased tasks and validation criteria
- `implementation`: update the plan doc after every completed phase; remove the originating ideation doc once implementation starts
- `review`: create/update `docs/reports/<nnn>-<topic>-review.md`
- `wrapup`: convert plan into a final report doc in `docs/reports`, then remove the plan doc after report approval

## Global constraints

- One commit per implementation phase.
- Every implementation phase must include validation checks.
- A plan MUST be written and maintained on disk at `docs/plans/<nnn>-<topic>.md`.
- Tool-native plan modes do NOT replace the on-disk plan file requirement.
- After each completed implementation phase, the on-disk plan file MUST be updated before moving to the next phase.
- If no deviations/major problems, continue through phases without waiting.
- If deviation/blocker/major risk appears, pause and report with focused decision questions.
