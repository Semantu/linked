---
name: workflow
description: Enforce the explicit mode cadence (ideation -> plan -> tasks -> implementation -> review -> wrapup) with transition gates and optional single-mode overrides.
---

# Instructions

## When to use

- Default for any task that touches code or modifies planning/docs.

## Mode selection at task start

- If the user has already explicitly chosen a mode (or explicitly called a mode skill), enter that mode directly.
- **Auto-enter ideation**: If the user is clearly brainstorming — weighing trade-offs, thinking out loud, exploring options — enter `ideation` mode directly without asking. This exception applies **only to ideation** (the first mode in the sequence). For all other starting modes (plan, implementation, etc.), always ask first.
- If the user is not clearly ideating, ask using this prompt pattern:
  `Should we start with exploring the options in ideation mode? Or do you want to go straight to planning the details in plan mode?`
  If the user is already asking to DO specific things, you can also add: `Or should I just go ahead and jump to implementation mode?`
- If the user asks to create/open/update a PR, or asks for PR title/body/message, treat that as an explicit request to enter `wrapup` mode.

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
When review defers work for future scope, the agent may switch `review -> ideation`, with explicit user confirmation.
Requests related to PR preparation/publishing are an explicit exception and should route directly to `wrapup` mode.

## Required artifacts by mode

- `ideation`: update/create `docs/ideas/<nnn>-<topic>.md`
- `plan`: update/create `docs/plans/<nnn>-<topic>.md`
- `tasks`: update the same plan doc with phased tasks and validation criteria
- `implementation`: update the plan doc after every completed phase; remove the originating ideation doc once implementation starts
- `review`: emit findings in chat first; after user decisions, update plan with now-work tasks and/or create ideation docs for deferred future work
- `wrapup`: convert plan into a final report doc in `docs/reports`, then remove the plan doc after report approval

## Global constraints

- Tool-native plan modes do NOT replace the on-disk plan file requirement.
- After each completed implementation phase, the on-disk plan file MUST be updated before moving to the next phase.
- Mode changes are never implicit; every mode switch requires explicit user confirmation.
- Numbering rule: when creating a new doc in `docs/ideas`, `docs/plans`, or `docs/reports`, `<nnn>` MUST be the next available 3-digit prefix in the destination folder.
- Conversion rule: when converting/moving docs across folders (for example `ideas -> plans` or `plans -> reports`), do not reuse the old prefix; assign the next available prefix in the destination folder and update references accordingly.
