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

Create/update `docs/reports/<nnn>-<topic>-review.md` with:

- What is complete
- What is not complete
- Readiness assessment
- Gaps/risks
- Recommended follow-up actions (now vs later)

## Guardrails

- Do not perform cleanup/release tasks in this mode; use wrapup mode for that.
- Do not remove `docs/plans/<nnn>-<topic>.md` in review mode; plan removal happens in wrapup after report approval.

## Exit criteria

- Review report exists with concrete findings and recommendations.
- User has explicitly confirmed whether to switch to implementation mode, wrapup mode, or remain in review mode.
