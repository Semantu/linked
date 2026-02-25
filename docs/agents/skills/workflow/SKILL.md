---
name: workflow
description: Enforce the explicit mode cadence (ideation -> plan -> tasks -> implementation -> review -> wrapup) with transition gates and optional single-mode overrides.
---

# Instructions

## When to use

- Default for any task that touches code or modifies planning/docs.

## Mandatory mode selection at task start

- For every new task/thread, the agent MUST ask the user to choose a starting mode before doing mode-specific work.
- The agent MUST offer all mode options: `ideation`, `plan`, `tasks`, `implementation`, `review`, `wrapup`.
- The agent MUST recommend starting with `ideation`.
- If the user starts by describing implementation/review/etc, the agent MUST still ask for explicit mode selection/confirmation before proceeding.

Use this prompt pattern:

1. `Would you like to start in ideation (recommended), plan, tasks, implementation, review, or wrapup?`
2. `If you want, I can start directly in <requested-mode>, but please confirm the mode.`

## Mode sequence

1. `ideation`
2. `plan`
3. `tasks`
4. `implementation`
5. `review`
6. `wrapup`

## Transition gates

- `ideation -> plan`: only when user explicitly confirms switching to plan mode.
- `plan -> tasks`: only when user explicitly confirms switching to tasks mode.
- `tasks -> implementation`: only when user explicitly confirms switching to implementation mode and the plan is explicitly approved.
- `implementation -> review`: only when user explicitly confirms switching to review mode.
- `review -> wrapup`: only when user explicitly confirms switching to wrapup mode.

After completing any mode, the agent MUST ask: `Which mode should we enter next?`

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
- Within implementation mode, if no deviations/major problems, continue through implementation phases without waiting.
- Mode changes are never implicit; every mode switch requires explicit user confirmation.
- If deviation/blocker/major risk appears, pause and report with focused decision questions.
