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
  - assign the next available 3-digit prefix in `docs/ideas` for each new ideation doc

Then report in chat what was updated.
Do not create a separate review report file in this mode.

## Follow-up questions before switching modes

**After updating the plan with new phases, always ask the user implementation-specific follow-up questions before offering to switch modes.** New phases added during review are often under-specified because they came from gap analysis rather than upfront design. Proactively ask about:

- **Placement decisions**: Where should new files/configs live? (e.g. project root vs subfolder)
- **Tool/dependency choices**: Which specific library, image, or tool version to use?
- **Configuration details**: Ports, environment variables, naming conventions
- **Scope boundaries**: How thorough should tests/error messages be? What's worth the maintenance cost vs what's overkill?
- **Anything the agent is unsure about** that would affect the implementation

Only offer to switch to tasks mode after these questions are answered. This prevents wasted implementation effort from under-specified phases.


## Guardrails

- Do not perform cleanup/release tasks in this mode; use wrapup mode for that.
- Do not remove `docs/plans/<nnn>-<topic>.md` in review mode; plan removal happens in wrapup after report approval.
- If big remaining work is identified, discuss tradeoffs/solutions in chat first.
- Only convert review findings into new not-yet-completed phases/tasks after the user confirms scope and approach.
- After adding new phases/tasks, ask the user to review the updated plan and ask whether to switch to tasks mode to refine them.
- For newly uncovered work, **always switch to tasks mode first** — never directly to implementation. Tasks mode validates that phases have proper validation criteria, dependency graphs, and parallel opportunities before implementation begins.
- If the user's response to review findings involves clarifying approach or scope (e.g. "do X but not Y", "let's use approach A"), treat this as still in the clarification loop — ask follow-up questions for any remaining ambiguity before switching modes.

## Exit criteria

- Gaps are clarified with explicit user decisions (now vs future, and chosen approach where needed).
- If now-work exists, plan was updated with new phases/tasks and user was asked whether to switch to tasks mode.
- If future-work exists, ideation docs were created according to grouping rules and user was informed.
- User has explicitly confirmed whether to:
  - stay in review mode,
  - switch to tasks mode (required path for any new implementation work),
  - switch to ideation mode for future work,
  - or move to wrapup mode (only when no new implementation work remains).
