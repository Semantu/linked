---
name: plan
description: Convert chosen ideation decisions into a concrete architecture plan focused on selected routes.
---

# Instructions

## Trigger

Run only when the user explicitly confirms plan mode (for example: converting ideation into a plan or updating the plan).

## Steps

1. Create/update `docs/plans/<nnn>-<topic>.md`. This on-disk plan file is mandatory.
   - When creating a new plan doc (including ideation -> plan conversion), `<nnn>` MUST be the next available 3-digit prefix in `docs/plans`.
2. Focus on chosen route(s), not all explored options.
3. Include:
   - Main architecture decisions
   - Files expected to change
   - Small code examples
   - Potential pitfalls
   - Remaining unclear areas/decisions
4. Mention tradeoffs only to explain why chosen paths were selected.
5. Continuously refine the plan with user feedback until it is explicitly approved for implementation.

## Guardrails

- Do not add task breakdown in this mode.
- Do not start implementation.
- Do not rely on tool-native planning state alone; all plan content MUST be persisted to `docs/plans/<nnn>-<topic>.md`.
- Do not remove the ideation doc in this mode.

## Exit criteria

- Plan clearly reflects chosen decisions.
- Risks and open questions are explicit.
- User has explicitly approved the plan and explicitly confirmed whether to switch to tasks mode or remain in plan mode.
