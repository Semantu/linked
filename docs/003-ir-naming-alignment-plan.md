---
summary: Plan to align IR naming across runtime output, IR types, docs, and tests (with a full naming review and phased refactor).
status: completed — superseded by 004-ir-refactor-completion.md
packages: [core]
---

# IR naming alignment plan

## Key considerations and choices

This plan covers a naming-focused refactor to make IR output and contracts natural, consistent, and stable for downstream packages (including linked-sparql).

### Current mismatch to resolve

- Runtime select IR currently emits `kind: 'canonical_select_ir'` via `buildCanonicalSelectIR`.
- Type-level IR contracts currently model `kind: 'select_query'` and expression/pattern-oriented naming.
- Documentation examples are currently closer to `select_query` naming than emitted runtime names.

### Naming goals

1. **Natural query naming**
   - Prefer `select_query` over `canonical_select_ir`.
   - Prefer explicit query/mutation nouns over internal migration wording.

2. **Single contract language**
   - Runtime-emitted IR object names, exported TS type names, docs, and tests must match one-to-one.

3. **Backwards safety during refactor**
   - Introduce temporary adapters/aliases where needed for incremental migration.
   - Remove temporary aliases once all tests/docs are migrated.

### Proposed naming direction (recommended baseline)

- Runtime select IR kind: `select_query`
- Runtime mutation kinds remain: `create_mutation`, `update_mutation`, `delete_mutation`
- Exported select builder function rename:
  - from `buildCanonicalSelectIR`
  - to `buildSelectQueryIR` (temporary alias retained for migration phase)
- Exported select type rename:
  - from `CanonicalSelectIR`
  - to `SelectQueryIR` (temporary alias retained for migration phase)
- Keep current normalized where node names for now (`where_binary`, `where_logical`, `where_exists`, `where_not`) unless the naming review decides to align those too in the same pass.

### Scope of this naming review/refactor

- All IR naming surfaces in:
  - `src/queries/IRPipeline.ts`
  - `src/queries/IntermediateRepresentation.ts`
  - `src/queries/SelectQuery.ts` (`getCanonicalIR` naming)
  - `documentation/intermediate-representation.md`
  - all IR tests (`src/tests/ir-*.test.ts`)
- Include a naming inventory table before code changes.


### Final naming mapping (Phase 1 decision)

| Surface | Old name | Final name | Transition policy |
|---|---|---|---|
| Select IR runtime `kind` | `canonical_select_ir` | `select_query` | immediate runtime switch |
| Select IR type export | `CanonicalSelectIR` | `SelectQueryIR` | keep `CanonicalSelectIR` as temporary type alias |
| Select IR builder | `buildCanonicalSelectIR` | `buildSelectQueryIR` | keep `buildCanonicalSelectIR` as temporary function alias |
| Select factory method | `getCanonicalIR()` | `getIR()` | keep `getCanonicalIR()` as temporary method alias |
| Mutation runtime `kind` | `create_mutation` / `update_mutation` / `delete_mutation` | unchanged | no rename |
| Canonical where node kinds | `where_binary` / `where_logical` / `where_exists` / `where_not` | unchanged in this refactor | review later only if needed |

## Potential problems

1. **Downstream break risk**
   - linked-sparql (and any other consumer) may already depend on `canonical_*` names.
   - Mitigation: temporary aliases + explicit migration notes.

2. **Partial rename drift**
   - Easy to rename kind strings but miss helper names/types/tests/docs.
   - Mitigation: naming inventory checklist + grep-based verification pass.

3. **Confusion between “runtime IR” and “target AST” layers**
   - Mitigation: explicitly document one authoritative emitted contract and mark any other types as internal/legacy if retained.

4. **Snapshot churn**
   - Renaming kind strings changes many snapshots at once.
   - Mitigation: phase snapshot updates, with semantic assertions preserved.

## Phases

### Phase 1 — Naming inventory and final naming decisions

**Goal**: Freeze exact naming map before code changes.

**Steps**
1. Create a complete inventory of current names (kinds, types, builders, method names).
2. Propose final names and migration aliases.
3. Record final mapping table in this doc.

**Validation**
- Inventory table completed and reviewed.
- No code changes yet.

### Phase 1 completion notes

**Status**: completed  
**Commit**: see git history (phase 1 completion commit)

#### What was implemented

- Completed naming inventory and finalized rename mapping table for runtime kind names, API names, and transition aliases.
- Confirmed scope for this thread: implement Phases 1-3 (inventory + runtime/API rename + tests migration), with documentation contract rewrite deferred to Phase 4.

#### Deviations from plan

- None.

#### Problems encountered

- None blocking.

#### Validation summary

- Plan-only phase; no runtime code changes.

#### Next phase

- Phase 2 — Runtime and API rename with temporary aliases.

---

### Phase 2 — Runtime and API rename with temporary aliases

**Goal**: Align emitted select runtime IR names to natural query naming.

**Steps**
1. Rename emitted select kind to `select_query`.
2. Rename select builder/type exports (`buildSelectQueryIR`, `SelectQueryIR`).
3. Keep temporary aliases (`buildCanonicalSelectIR`, `CanonicalSelectIR`) to avoid immediate break.
4. Evaluate and potentially rename `getCanonicalIR()` to `getIR()` with temporary alias method.

**Validation**
- `npm test` passes.
- Existing consumers/tests still compile via aliases.

### Phase 2 completion notes

**Status**: completed  
**Commit**: see git history (phase 2 completion commit)

#### What was implemented

- Renamed primary select IR runtime type and builder surface in `src/queries/IRPipeline.ts`:
  - `SelectQueryIR` (new primary type)
  - `buildSelectQueryIR(...)` (new primary builder)
  - primary emitted kind switched to `select_query` for the new builder.
- Added compatibility aliases to preserve transition safety:
  - `CanonicalSelectIR` alias type with legacy kind shape,
  - `buildCanonicalSelectIR(...)` compatibility wrapper preserving legacy kind value.
- Added `getIR()` on `SelectQueryFactory` and kept `getCanonicalIR()` as compatibility alias in `src/queries/SelectQuery.ts`.
- Updated parity helper typing to accept both primary and compatibility select IR forms.

#### Deviations from plan

- Minor implementation detail: compatibility layer preserves legacy kind (`canonical_select_ir`) during transition to avoid immediate snapshot churn before Phase 3 test migration.

#### Problems encountered

- Type errors occurred during initial rename because `buildCanonicalSelectIR` import/wrapper and parity helper type signatures needed explicit compatibility handling.
- Resolved by:
  - restoring explicit compatibility import in `SelectQuery.ts`,
  - widening `toCanonicalParityView` input to handle both select IR kinds.

#### Validation summary

- `npm test -- --runInBand`
- Result: active suites pass (11 passed, 2 skipped), tests pass (124 passed, 74 skipped), snapshots pass (7 passed).

#### Next phase

- Phase 3 — Test migration and parity hardening.

---

### Phase 3 — Test migration and parity hardening

**Goal**: Update IR tests to assert final names and verify compatibility aliases.

**Steps**
1. Update all IR tests to use final naming.
2. Add compatibility tests for alias exports/methods during transition.
3. Update snapshots and keep semantic assertions.

**Validation**
- `npm test` passes.
- All IR suites green with final naming assertions.

### Phase 3 completion notes

**Status**: completed  
**Commit**: see git history (phase 3 completion commit)

#### What was implemented

- Migrated IR naming assertions in select IR tests to the new primary naming surface:
  - `src/tests/ir-select-golden.test.ts` now uses `buildSelectQueryIR` and `SelectQueryIR`.
  - Snapshot/golden expectations were updated from `kind: "canonical_select_ir"` to `kind: "select_query"`.
- Updated pipeline parity tests in `src/tests/ir-pipeline-parity.test.ts` to assert `getIR()` and primary builder naming.
- Added compatibility coverage in pipeline parity tests to explicitly validate that temporary alias APIs still emit legacy kind names:
  - `getCanonicalIR()`
  - `buildCanonicalSelectIR(...)`

#### Deviations from plan

- None.

#### Problems encountered

- Snapshot churn occurred as expected due kind-string migration.
- Resolved by updating only affected IR suites and preserving semantic assertions.

#### Validation summary

- `npm test -- --runInBand src/tests/ir-select-golden.test.ts src/tests/ir-pipeline-parity.test.ts -u`
- `npm test -- --runInBand`
- Result: active suites pass (11 passed, 2 skipped), tests pass (125 passed, 74 skipped), snapshots pass (7 passed).

#### Next phase

- Phase 4 — Sort/order parity in emitted select IR.

---

### Phase 4 — Sort/order parity in emitted select IR

**Goal**: Add explicit sort/order output to emitted select IR and close parity with existing query sort coverage before doc finalization.

**Steps**
1. Extend select IR desugar/pipeline output to include `orderBy` entries derived from existing `sortBy` query object data.
2. Add/upgrade IR tests to assert `orderBy` output for ASC and DESC sorting.
3. Ensure parity helper includes sort direction comparison.

**Validation**
- `npm test` passes.
- Sort/order IR assertions pass for ASC and DESC.

### Phase 4 completion notes

**Status**: completed  
**Commit**: see git history (phase 4 completion commit)

#### What was implemented

- Extended desugared select query model with `sortBy` support (`direction` + path list) in `src/queries/IRDesugar.ts`.
- Extended emitted select IR with `orderBy` entries in `src/queries/IRPipeline.ts`.
- Added sort parity in `LegacyParityView` / `toCanonicalParityView` via `sortDirection`.
- Added IR tests for sort output:
  - ASC and DESC `orderBy` assertions in `src/tests/ir-select-golden.test.ts`.
  - Updated pipeline parity coverage to use sorted query capture.

#### Deviations from plan

- None.

#### Problems encountered

- None blocking.

#### Validation summary

- `npm test -- --runInBand`
- Result: active suites pass (11 passed, 2 skipped), tests pass (127 passed, 74 skipped), snapshots pass (7 passed).

#### Next phase

- Phase 5 — Documentation sync and contract finalization.

---

### Phase 5 — Documentation sync and contract finalization

**Goal**: Ensure docs exactly match emitted runtime IR contract after sort/order parity is in place.

**Steps**
1. Rewrite `documentation/intermediate-representation.md` to match runtime emitted shape exactly.
2. Add explicit “stable contract” section and migration notes from alias names.
3. Verify examples are generated/validated against actual emitted IR fixtures.

**Validation**
- `npm test` passes.
- Doc examples match tested emitted objects.

### Phase 6 — Alias removal and cleanup

**Goal**: Remove temporary canonical naming aliases once migration is complete.

**Steps**
1. Remove deprecated alias exports/methods.
2. Remove compatibility notes that are no longer needed.
3. Final grep-based cleanup for old naming tokens.

**Validation**
- `npm test` passes.
- No remaining references to deprecated names (except in migration history docs if retained intentionally).

## Request for review before implementation

Please review this plan and confirm:
1. We should adopt `select_query` as the emitted select IR kind.
2. We should rename runtime helpers/types to `buildSelectQueryIR` / `SelectQueryIR` with temporary aliases.
3. We should rename `getCanonicalIR()` to `getIR()` with temporary alias support during migration.

After your confirmation, I’ll implement phase-by-phase with one commit per phase and reporting after each phase.
