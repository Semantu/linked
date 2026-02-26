---
name: tasks
description: Break an approved plan into ordered phases and concrete tasks with explicit validation criteria.
---

# Instructions

## Trigger

Run only when the user explicitly confirms tasks mode.

## Steps

1. Update the active plan doc in `docs/plans/<nnn>-<topic>.md`. Task breakdown MUST be persisted in this same on-disk plan file.
2. Define ordered implementation phases.
3. Define concrete tasks under each phase.
4. Add explicit validation criteria per phase (for example: unit tests, integration tests, build/typecheck commands, targeted runtime checks).
5. Ensure phases are commit-friendly (one commit per phase).

## Guardrails

- Do not start implementation unless user explicitly requests implementation mode.

## Exit criteria

- Every phase has tasks and validation criteria.
- Execution order/dependencies are clear.
- User has explicitly confirmed whether to switch to implementation mode or remain in tasks mode.
