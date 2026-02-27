---
name: implementation
description: Execute planned tasks phase-by-phase with one commit per phase, required validation, and pause-on-deviation reporting.
---

# Instructions

## Trigger

Run only after explicit user confirmation to enter implementation mode, with an approved plan file in `docs/plans`.

## Steps

1. Confirm the approved plan exists on disk at `docs/plans/<nnn>-<topic>.md`. Tool-native plan mode alone is not sufficient.
2. If this plan stems from an ideation doc, remove the originating ideation doc in `docs/ideas` when implementation begins.
3. Implement one planned phase at a time.
4. Run the phase validation criteria and record results.
5. After a phase is completed, update `docs/plans/<nnn>-<topic>.md` to reflect completed work and mark phase status. This update is mandatory before moving to the next phase.
6. Create one commit per phase, including code changes and the phase-completion plan update in the same commit.
7. Continue to next phase without pausing only if there are no deviations and no major problems.
8. If any deviation/blocker/major risk appears, pause and report.

## Parallel execution

When the plan marks phases as parallelizable, use the Task tool (or any available sub-agent spawning tool) to run them concurrently:

- **Spawn one sub-agent per independent phase** using `run_in_background: true`. Give each agent a self-contained prompt with all context it needs (file paths, types, contracts, test specifications, validation criteria).
- **Avoid file conflicts**: If two phases write to the same file, combine them into a single agent or sequence them. Different agents should own different files.
- **Shared files** (barrel exports, test config): Let each agent add its own entries. After all agents complete, verify the shared files have no duplicates or conflicts.
- **Wait and verify**: After all parallel agents finish, run a full integration check (compile + full test suite) before committing. This catches cross-agent conflicts in shared files.
- **Single commit for parallel group**: All work from a parallel group goes into one commit after integration verification passes.

## Required pause report content

- What was done
- Deviations from plan
- Problems encountered
- Validation results (pass/fail counts and checks run)
- Proposed next step and any decision question for the user

## Documentation

- Update `docs/reports` when pausing for deviations/problems.

## Guardrails

- If the originating ideation doc is ambiguous, pause and ask the user which ideation file to remove.
- Do not skip plan updates between completed phases.
- Do not switch to review/wrapup implicitly; ask the user to explicitly confirm the next mode.

## Exit criteria

- All planned implementation phases are complete and validated, or
- Work is paused with explicit questions for the user.
