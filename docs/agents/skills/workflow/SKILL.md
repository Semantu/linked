---
name: workflow
description: Enforce the explicit mode cadence (ideation -> plan -> tasks -> implementation -> review -> wrapup) with transition gates and optional single-mode overrides.
---

# Instructions

## When to use

- Default for any task that touches code or modifies planning/docs.

## Mode selection at task start

- If the user has already explicitly chosen a mode (or explicitly called a mode skill), enter that mode directly.
- If the user has not explicitly chosen a mode and the task will involve implementation/code changes, the agent MUST ask whether to start in `ideation` (brainstorming) or `plan` mode before implementation.

Use this prompt pattern when mode is not yet explicit:
`Should we start with exploring the options in ideation mode? Or do you want to go straight to planning the details in plan mode?`

If the user is already asking to DO specific things, you can also add: `Or should I just go ahead and jump to implementation mode?`

## Mode sequence

1. `ideation`
2. `plan`
3. `tasks`
4. `implementation`
5. `review`
6. `wrapup`

## Transition gates
Only switch to the next sequential mode with explicit user confirmation. When completing any mode, the agent must ask: `Shall we switch to {name of next mode}?`.
Never skip a mode unless explicitly told to. 
If user seems to suggest skipping a mode but is not explicitly saying which mode to use, then the agent must ask the user `Do you want to continue with {name of next mode} or continue straight to {user suggested mode}?`
When review identifies remaining work, the agent may loop `review -> tasks -> implementation -> review`, but every switch still requires explicit user confirmation.

## Required artifacts by mode

- `ideation`: update/create `docs/ideas/<nnn>-<topic>.md`
- `plan`: update/create `docs/plans/<nnn>-<topic>.md`
- `tasks`: update the same plan doc with phased tasks and validation criteria
- `implementation`: update the plan doc after every completed phase; remove the originating ideation doc once implementation starts
- `review`: update plan doc with findings
- `wrapup`: convert plan into a final report doc in `docs/reports`, then remove the plan doc after report approval

## Global constraints

- Tool-native plan modes do NOT replace the on-disk plan file requirement.
- After each completed implementation phase, the on-disk plan file MUST be updated before moving to the next phase.
- Mode changes are never implicit; every mode switch requires explicit user confirmation.
