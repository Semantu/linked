---
name: review
description: Review implemented work against original intent, readiness for external use, remaining gaps, and future completeness work.
---

# Instructions

## Trigger

Run only when the user explicitly confirms review mode.

## Review focus

1. Compare current implementation against the original intent and agreed plan.
2. Assess whether the result is ready for others to use.
3. Identify what is still missing to make this work more complete.
4. Identify gaps or risks in the current implementation.
5. Identify likely future work required for fuller completeness.

## Output

Review findings must be emitted in chat first.
Do not write findings to plan or report files until decisions are clarified with the user.

For each identified gap, ask clarifying questions until both are explicit:

- whether this gap should be handled now in this session or deferred for future work
- how to approach the gap when multiple implementation routes exist

After decisions are clear:

- If handled now: update the active plan file `docs/plans/<nnn>-<topic>.md` with newly added not-yet-completed phases/tasks.
- If deferred: create ideation docs in `docs/ideas`:
  - group related deferred items into one ideation doc
  - create separate ideation docs only for very different, large deferred tasks

Then report in chat what was updated and ask the user to review those updates.
Do not create a separate review report file in this mode.


## Guardrails

- Do not perform cleanup/release tasks in this mode; use wrapup mode for that.
- Do not remove `docs/plans/<nnn>-<topic>.md` in review mode; plan removal happens in wrapup after report approval.
- If big remaining work is identified, discuss tradeoffs/solutions in chat first.
- Only convert review findings into new not-yet-completed phases/tasks after the user confirms scope and approach.
- After adding new tasks, ask the user to review the updated plan and explicitly ask whether to start implementation with the first new phase.
- For newly uncovered work, do not switch directly from review to implementation; switch to tasks mode first.

## Exit criteria

- Gaps are clarified with explicit user decisions (now vs future, and chosen approach where needed).
- If now-work exists, plan was updated with new phases/tasks and user was asked whether to start implementation of the first new phase.
- If future-work exists, ideation docs were created according to grouping rules and user was informed.
- User has explicitly confirmed whether to:
  - stay in review mode,
  - switch to tasks mode,
  - switch to implementation mode for approved next phase,
  - switch to ideation mode for future work,
  - or move to wrapup mode.
