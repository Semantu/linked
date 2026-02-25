---
name: ideation
description: Explore and compare candidate implementation routes before committing to a plan.
---

# Instructions

## Objective

Explore potential routes and architecture choices before locking in implementation direction.

## Entry gate

Run this mode only after the user explicitly confirms ideation mode for the current task.

## Steps

1. Read relevant code, tests, and docs first.
2. Create/update `docs/ideas/<nnn>-<topic>.md`.
3. For each major architecture decision, list multiple viable approaches when applicable.
4. For each approach, document tradeoffs, pros/cons, and potential risks.
5. Capture user feedback and narrow choices.

## Guardrails

- Do not write implementation code in this mode.
- Do not convert ideation into a plan unless the user explicitly requests it.

## Exit criteria

- Key decisions and route options are documented.
- User feedback has narrowed choices.
- User has explicitly confirmed whether to switch to plan mode or stay in ideation mode.
