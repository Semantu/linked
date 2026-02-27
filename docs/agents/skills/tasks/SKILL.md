---
name: tasks
description: Break an approved plan into ordered phases and concrete tasks with explicit validation criteria.
---

# Instructions

## Trigger

Run only when the user explicitly confirms tasks mode.

## Steps

1. Update the active plan doc in `docs/plans/<nnn>-<topic>.md`. Task breakdown MUST be persisted in this same on-disk plan file.
2. Define implementation phases.
3. Define concrete tasks under each phase.
4. Add explicit validation criteria per phase (for example: unit tests, integration tests, build/typecheck commands, targeted runtime checks).
5. Write detailed test specifications for every phase (see **Test specification** below).
6. Ensure phases are commit-friendly (one commit per phase).

## Parallel execution

Phases should be designed for maximum parallelism — different agents may implement different phases or tasks concurrently.

- **Identify the dependency graph**: Which phases depend on which? Which can run in parallel? Mark this explicitly in the task breakdown.
- **Contracts first**: If the plan defines inter-component contracts (types, interfaces, shared data structures), schedule the contract/types phase first. Once contracts are established, phases that only depend on those contracts can run in parallel.
- **Stub boundaries**: When a phase depends on another phase's output, note what stubs or mocks are needed so it can proceed independently. For example: "Agent B can stub `irToAlgebra()` with hand-crafted algebra objects to test `algebraToString()` independently."
- **Mark parallel groups**: Use explicit notation in the task breakdown to indicate which phases can run simultaneously. For example: "Phase 2a, 2b, 2c can run in parallel after Phase 1."
- **Integration phase last**: Wire-up, end-to-end tests, and integration tests should be the final phase since they depend on all components being complete.

## Validation specification

Every phase must include a **Validation** section that describes the checks an implementing agent must perform and pass before considering the phase complete. Validation is not limited to coded tests — it includes any check that truly proves the work is correct.

**Types of validation checks** (use whichever are appropriate for the phase):
- **Unit/integration tests**: Coded test files with named test cases and concrete assertions.
- **Compilation/type-check**: e.g. `npm run compile` passes with no errors.
- **Runtime checks**: e.g. "execute the generated SPARQL against a running store and verify results".
- **Manual structural checks**: e.g. "assert the exported function is importable from the barrel", "assert the generated file exists and contains expected content".
- **HTTP/network checks**: e.g. "POST to the endpoint and verify 200 response with expected payload".

**When describing coded tests:**
- **Name each test case** with the fixture or scenario it covers (e.g. `` `selectName` — `Person.select(p => p.name)` ``).
- **State concrete assertions** — not just "test that it works" but what specifically must be true. Use "assert" language: "assert result is array of length 4", "assert field `name` equals `'Semmy'`", "assert plan type is `'select'`".
- **Include input and expected output** where practical — hand-crafted input objects, specific field values, structural expectations (e.g. "assert algebra contains a LeftJoin wrapping the property triple").
- **Cover edge cases explicitly** — null handling, missing values, type coercion, empty inputs.
- **Specify test file paths** — e.g. `src/tests/sparql-algebra.test.ts`.

**When describing non-test validation:**
- **State the exact command or check** to run and what a passing result looks like.
- **Be specific about success criteria** — "compiles" is too vague; "`npx tsc --noEmit` exits 0 with no errors" is clear.

The validation specifications serve as the phase's acceptance criteria: a phase is only complete when all described checks pass.

## Guardrails

- Do not start implementation unless user explicitly requests implementation mode.

## Exit criteria

- Every phase has tasks and validation criteria.
- Dependency graph and parallel opportunities are explicit.
- Stubs needed for parallel execution are noted.
- User has explicitly confirmed whether to switch to implementation mode or remain in tasks mode.
