---
summary: Final report for preserving nested sub-select paths in canonical IR (desugar -> lowering -> projection/resultMap), plus automatic-mode guardrails and workflow artifacts.
packages: [core]
---

# Overview

This change set fixes an IR fidelity gap where nested sub-select branches were present in `toRawInput().select` but dropped before canonical IR was built. The fix ensures `build()` emits complete canonical IR (patterns + projection + resultMap) for nested array-based sub-select structures.

In the same scope, wrapup also includes a process hardening update: automatic mode now has explicit transition gates that prevent implementation from starting before ideation/plan/tasks artifacts exist on disk.

# Original problem

Observed mismatch:

- DSL query shape (example): `pluralTestProp.where(...).select([name, friends.select([name, hobby])])`
- Raw pipeline input (`toRawInput().select`) contained both selected branches.
- Canonical IR after build/lowering emitted only the first branch (`... -> name`), dropping nested `friends -> name/hobby`.

Impact:

- Canonical IR became under-specified for downstream result materialization.
- Store layers needed compensating augmentation logic to reconstruct missing nested select paths.

# Final implementation decisions

## Decision 1: Preserve full sub-select tree in desugar

Changed the desugar contract so `multi_selection` retains *all* child selection kinds, not only plain `selection_path`.

Rationale:

- Information loss happened in desugar before lowering.
- Recovering dropped branches later is brittle and store-coupled.

## Decision 2: Recurse in lowering for `multi_selection`

Changed projection seed collection to recurse across nested child selections in `multi_selection`, flattening to `ProjectionSeed[]` only at lowering output.

Rationale:

- Keeps lowering aligned with recursive selection semantics.
- Produces complete projection/resultMap without store augmentation.

## Decision 3: Update affected golden behavior explicitly

Updated SPARQL golden for `nestedQueries2` to include the newly preserved nested branch (`bestFriend.name`), including required traverse and projected vars.

Rationale:

- Golden output must match actual DSL intent once branch loss is fixed.

# Architecture and pipeline notes

## Desugar stage (`IRDesugar`)

Contract change:

- `DesugaredMultiSelection.selections` now stores `DesugaredSelection[]` (recursive).

Behavior change:

- `toSubSelections` no longer filters child selections down to `selection_path` only.
- Mixed nested structures survive desugar intact (e.g., `selection_path` + nested `sub_select`).

## Lowering stage (`IRLower`)

Contract change:

- `collectProjectionSeeds` for `multi_selection` now recursively flattens child `DesugaredSelection` nodes.

Behavior change:

- Nested sub-select branches now contribute projection seeds, traverse patterns, and resultMap entries.

## End-to-end effect

For nested DSL selections, canonical IR now includes:

- all required traversals for selected nested branches
- projection entries for nested leaves
- corresponding resultMap aliases/keys

# Files changed and responsibilities

## Core pipeline

- `src/queries/IRDesugar.ts`
  - recursive `DesugaredMultiSelection` structure
  - preservation of nested children in `toSubSelections`

- `src/queries/IRLower.ts`
  - recursive flattening of `multi_selection` into projection seeds

## Fixtures and tests

- `src/test-helpers/query-fixtures.ts`
  - new fixture: `pluralFilteredNestedSubSelect`

- `src/tests/ir-desugar.test.ts`
  - new regression: nested `sub_select` retention inside `multi_selection`

- `src/tests/ir-select-golden.test.ts`
  - new regression: lowered IR includes nested traversals/properties for array sub-select branches
  - parity table updated with `pluralFilteredNestedSubSelect`

- `src/tests/sparql-select-golden.test.ts`
  - `nestedQueries2` golden updated for preserved nested branch output

## Workflow/skill docs

- `docs/agents/skills/automatic/SKILL.md` (new)
  - automatic meta-mode definition
  - mandatory transition gates to prevent skipping plan/tasks before implementation

- `docs/agents/skills/workflow/SKILL.md`
  - explicit-only automatic mode mention
  - transition-gate exception clarified for automatic mode

- `AGENTS.md`
  - workflow note updated to mention automatic explicit-only behavior

# Public API surface impact

No new public exports/classes/functions were added to `@_linked/core`.

Behavioral impact:

- Queries using nested array-based sub-select compositions now emit more complete canonical IR (and therefore richer SPARQL plans/output) consistent with DSL intent.

# Validation summary

Targeted phase validations:

- `npm test -- --runInBand src/tests/ir-desugar.test.ts -t "preserves nested sub-select paths inside multi-selection arrays"` -> pass
- `npm test -- --runInBand src/tests/ir-select-golden.test.ts -t "build preserves nested sub-select projections inside array selections"` -> pass
- `npm test -- --runInBand src/tests/ir-desugar.test.ts src/tests/ir-select-golden.test.ts src/tests/sparql-select-golden.test.ts` -> pass

Integration validation:

- `npm test` -> pass (18 passed suites, 2 skipped, 477 passed tests)
- `npm run sync:agents` -> pass

# Cleanup and documentation checks

- Dead code removal: none identified in changed scope.
- Clarifying code comments: none added; current code remained readable without extra inline commentary.
- Documentation coverage:
  - workflow/automatic skill docs updated
  - plan and report artifacts created
  - golden expectations aligned with runtime behavior

# Process deviations and notes

- The code implementation landed before strict mode artifact sequencing was completed in automatic mode.
- This was corrected by:
  - adding mandatory gates to automatic skill
  - backfilling full plan/tasks/implementation tracking in `docs/plans/001-...`
  - rerunning and recording validations phase-by-phase

Residual process gap:

- Per-phase commits (one commit per phase) were not created during this corrected rerun.

# Known limitations and remaining gaps

1. No dedicated integration test yet in this repo for an external store function like `augmentSelectIrFromRawPaths` removal; this repo validates canonical IR and SPARQL generation behavior directly.
2. Existing key-collision behavior is unchanged; newly preserved branches can surface collisions that were previously hidden by dropped paths.

# Deferred/future work

No additional deferred ideation doc was created in this scope.

Potential follow-up (optional):

- add a focused collision-policy test matrix for nested selections with repeated local property names under different parent branches.

# PR readiness checklist

- [x] Core behavior fix implemented
- [x] Regression tests added/updated
- [x] Full test suite green
- [x] Workflow docs updated for automatic mode guardrails
- [ ] Changeset bump level selected (`patch`/`minor`/`major`)
- [ ] Plan removal after report approval

# Draft PR title

`Preserve nested sub-select branches in canonical IR lowering`

# Draft PR body

## Summary

This PR fixes a canonical IR fidelity gap where nested array sub-select branches were dropped between desugar and lowering.

Example shape that now lowers correctly:

- `pluralTestProp.where(...).select([name, friends.select([name, hobby])])`

## What changed

- Preserve recursive `multi_selection` children in desugar.
- Recurse through `multi_selection` in lowering projection seed collection.
- Add regression fixture/test coverage for nested branch preservation.
- Update affected SPARQL golden (`nestedQueries2`) to match preserved nested branch output.
- Add automatic-mode transition gates to prevent skipping plan/tasks before implementation.

## Validation

- Targeted desugar/IR/SPARQL suites: pass
- Full `npm test`: pass
- Skill sync (`npm run sync:agents`): pass

## Notes

- No new public exports.
- Behavioral change is intentional: canonical IR now includes nested selected paths that were previously dropped.

