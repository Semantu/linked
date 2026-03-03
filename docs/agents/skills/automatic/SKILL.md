---
name: automatic
description: Execute the full workflow cycle (ideation -> plan -> tasks -> implementation -> review) without waiting for user confirmation between modes. Use only when the user explicitly requests automatic mode. Never auto-suggest or auto-enter this mode. Pause after review and ask whether to continue with wrapup or iterate.
---

# Instructions

## Trigger

Run only when the user explicitly requests `automatic` mode.
Do not auto-enter this mode.
Do not suggest this mode in startup mode prompts.

## Objective

Run the standard workflow end-to-end without waiting for user confirmation between internal mode transitions:

1. `ideation`
2. `plan`
3. `tasks`
4. `implementation`
5. `review`

Then pause.

## Core behavior

1. Execute each mode in sequence using the same requirements and artifact rules as the corresponding individual mode skills.
2. Keep momentum: do not stop between internal mode transitions unless blocked by missing mandatory input, hard failures, or safety constraints.
3. In ideation, always document alternatives (at least two viable routes when applicable), evaluate tradeoffs, propose the best route, and explicitly select it before entering plan mode.
4. After selecting the route, continue immediately into plan mode, then tasks mode, then implementation mode, then review mode.
5. Pause after review and ask the user to choose exactly one:
   - `wrapup`
   - `iterate`

## Mandatory transition gates

Never transition to the next mode until the current mode's required on-disk artifacts are complete.

Before leaving each mode, enforce all checks below:

1. Ideation -> Plan gate:
   - A concrete ideation doc exists/was updated in `docs/ideas/<nnn>-<topic>.md`.
   - The doc contains alternatives, tradeoffs, and a clearly selected route.

2. Plan -> Tasks gate:
   - A plan doc exists/was updated in `docs/plans/<nnn>-<topic>.md`.
   - The plan includes architecture decisions, expected file changes, pitfalls, and explicit contracts.
   - The plan is focused on the chosen route (not a list of all routes).

3. Tasks -> Implementation gate:
   - The same plan doc includes phased tasks.
   - Every phase has explicit validation criteria.
   - Dependency graph / parallelization notes are present.

4. Implementation -> Review gate:
   - Implementation work is executed phase by phase against the tasked plan.
   - Validation for each completed phase is run and recorded.
   - The plan doc is updated after each completed phase before moving on.

If any gate check fails, stop and fix the missing artifact first. Do not implement code before the tasks gate is satisfied.

## Artifact rules

Use the same artifact contract as the normal workflow:

- `ideation`: create/update `docs/ideas/<nnn>-<topic>.md`
- `plan`: create/update `docs/plans/<nnn>-<topic>.md`
- `tasks`: update the active plan doc with phases/tasks/validation
- `implementation`: execute phases and update the active plan doc after completed phases
- `review`: emit findings first, then update plan/docs according to resolved now-vs-future decisions

Follow numbering and conversion rules from workflow mode.

## Iterate loop

If the user chooses `iterate` after review:

1. Continue with another cycle focused on the review-identified gaps:
   - ideation -> plan -> tasks -> implementation -> review
2. Reuse the same active plan document for this loop.
3. Append/refine phases/tasks in that existing plan document instead of creating a new plan file.
4. After the follow-up review, pause again and ask the same decision:
   - `wrapup`
   - `iterate`

Repeat until the user selects `wrapup` or stops.

## Handoff to wrapup

Do not enter `wrapup` automatically.
Enter `wrapup` only after the user explicitly chooses `wrapup` at a review pause point.

## Guardrails

- Do not bypass required validation in implementation.
- Do not skip required artifact updates.
- Do not silently change the chosen route without documenting why.
- If critical ambiguity appears that blocks correct implementation, ask focused clarification questions, then resume automatic progression.
- If implementation was started prematurely, pause and backfill the missing plan/tasks artifacts before continuing.
- Treat missing `docs/plans` as a hard blocker for implementation mode.

## Exit criteria

- Reached review mode and paused with explicit `wrapup` vs `iterate` question, or
- User explicitly selected `wrapup` and control has been handed off to wrapup mode.
