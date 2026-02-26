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

Update the active plan file `docs/plans/<nnn>-<topic>.md` with a review findings section.

This section must include:
- What is complete
- What is not complete
- Readiness assessment
- Gaps/risks
- Recommended follow-up actions
- Recommended future work that requires its own plan

A summary of review findings should be emitted in chat together with at least 3 questions for the user which aim to clarify how the user would like to proceed. What they still want to do and how they want to approach that from different potential routes forward.
Do not create a separate review report file in this mode.
Keep newly uncovered future work in the plan review findings by default.
Only create a new ideation file when the user explicitly requests splitting that future work into a separate scope.


## Guardrails

- Do not perform cleanup/release tasks in this mode; use wrapup mode for that.
- Do not remove `docs/plans/<nnn>-<topic>.md` in review mode; plan removal happens in wrapup after report approval.
- If big remaining work is identified, discuss tradeoffs/solutions in chat first.
- Only convert review findings into new not-yet-completed phases/tasks when the user explicitly requests it.
- After adding new tasks, implementation starts only on explicit user request.
- For newly uncovered work, do not switch directly from review to implementation; switch to tasks mode first.

## Exit criteria

- Plan file has an updated review findings section with concrete findings and recommendations.
- User has explicitly confirmed whether to:
  - stay in review mode,
  - switch to tasks mode to add new work,
  - or move to wrapup mode.
