---
summary: Plan to complete the IR refactor — full AST pipeline, production wiring, test parity, and documentation sync.
packages: [core]
---

# 004 — IR Refactor Completion Plan

## Context

The Linked query IR refactor (docs 002 + 003) built a solid foundation: 7 IR modules, type definitions, a pipeline, and 29 tests. But the refactor stopped short of its goal. The IR is a shadow system running in parallel — production still uses the legacy query objects. The pipeline output uses simplified flat types instead of the full IR AST. Test coverage is ~16%.

This plan completes the refactor: expand the IR to handle all query patterns, lift the pipeline to emit proper AST nodes, wire production so `SelectQuery` IS the IR, and ensure every query pattern has IR test coverage.

## Key architecture decisions

1. **Refactor types in place.** `SelectQuery`, `CreateQuery`, `UpdateQuery`, `DeleteQuery` become the IR types. `IQuadStore` keeps its method signatures — the types it receives just get modernized.
2. **Pipeline must emit full IR AST.** The output uses `IRSelectQuery` with `IRShapeScanPattern` root, `IRProjectionItem` with `IRExpression`, `IRExpression` for where, `IROrderByItem` with `IRExpression`.
3. **Full test parity.** Every query pattern in `query.test.ts` gets a corresponding IR assertion.
4. **Replace, don't duplicate.** Old test assertions get replaced with IR assertions. No parallel test maintenance.

## Critical files

| File | Role |
|---|---|
| `src/queries/IntermediateRepresentation.ts` | Target IR type definitions (IRSelectQuery, IRGraphPattern, IRExpression, mutations) |
| `src/queries/IRPipeline.ts` | Pipeline orchestrator — currently emits simplified flat types, must emit full IR |
| `src/queries/IRDesugar.ts` | Desugaring pass — handles basic patterns, missing sub-selects/type-casting/preload |
| `src/queries/IRCanonicalize.ts` | Normalization — quantifier rewrites, boolean flattening |
| `src/queries/IRAliasScope.ts` | Alias generation and lexical scope management |
| `src/queries/IRProjection.ts` | Projection building — currently flat paths, must produce IRProjectionItem with IRExpression |
| `src/queries/IRMutation.ts` | Mutation IR conversion — already uses full IR mutation types |
| `src/queries/SelectQuery.ts` | SelectQueryFactory + legacy SelectQuery type (lines 87-97), getQueryObject() (line 1748), getIR() (line 1778) |
| `src/queries/QueryParser.ts` | Routing layer — calls getQueryObject() on line 29, passes to LinkedStorage |
| `src/utils/LinkedStorage.ts` | Store routing — receives query objects, resolves store by shape |
| `src/interfaces/IQuadStore.ts` | Store interface — selectQuery/createQuery/updateQuery/deleteQuery |
| `src/tests/query.test.ts` | Source of truth — 75+ select tests, 19+ mutation tests |

## Phase 1 — Expand IRDesugar for all query patterns [DONE]

**Goal**: Make `desugarSelectQuery()` handle every query pattern exercised in `query.test.ts` without throwing.

**What's missing from IRDesugar.ts today:**

| Pattern | Tests | Issue |
|---|---|---|
| Sub-selects / custom result objects | ~11 | `select` can be `CustomQueryObject` (key-value map) or contain nested `SelectQueryFactory` paths — desugar only handles flat `QueryPath[]` |
| Type casting `as()` | 2 | Query path contains `ShapeReferenceValue` steps — `toPropertyStep` throws |
| Preload composition | 1 | Path contains embedded `CustomQueryObject` from BoundComponent |
| Inline where on property steps | ~6 | `PropertyQueryStep.where` is stripped during `toSelectionPath` (line 100 filter) |
| Empty select with where | 2 | Works but needs test coverage |
| `one()` modifier | 1 | Works (just singleResult=true) but needs test coverage |

**Substeps:**
1. Add `DesugaredCustomObjectSelect` type for custom result objects: `{kind: 'custom_object_select', entries: {key: string, value: DesugaredSelectionPath[] | DesugaredCustomObjectSelect}[]}`
2. Extend `desugarSelectQuery` to handle `query.select` being an object (custom result) vs array
3. Handle nested sub-query paths (arrays-within-arrays in select)
4. Handle `ShapeReferenceValue` steps in paths (type casting) — produce `DesugaredTypeCastStep`
5. Preserve `PropertyQueryStep.where` as `inlineWhere` on desugared steps
6. Add desugar tests for each new pattern

**Modify:** `src/queries/IRDesugar.ts`, `src/tests/ir-desugar.test.ts`

**Validation:** `npm test` passes. All query patterns from query.test.ts can be fed through `desugarSelectQuery()` without throwing. New desugar tests pass.

**Report:**
- **What was done:** Rewrote IRDesugar.ts to handle all query patterns: sub-selects, custom result objects, type casting (as()), preload composition, count/aggregation, inline where on property steps. Added 6 new desugared types (DesugaredCountStep, DesugaredTypeCastStep, DesugaredStep union, DesugaredSubSelect, DesugaredCustomObjectSelect, DesugaredEvaluationSelect, DesugaredMultiSelection). Expanded ir-desugar.test.ts from 3 tests to 35 tests. Updated downstream consumers (IRPipeline.ts, IRProjection.ts) with extractSelectionPaths() helper and updated defaultKeyFromPath(). Fixed ir-projection.test.ts and ir-select-golden.test.ts for new union types.
- **Deviations:** Type casting `as()` does not produce a separate query step — it changes the type proxy so the cast is implicit in property resolution. Tests updated to reflect this. Also modified ir-projection.test.ts and ir-select-golden.test.ts (not listed in original plan) since their types changed.
- **Problems:** `DesugaredSelection` union initially included bare `DesugaredSelectionPath[]`, breaking `.kind` access — wrapped in `DesugaredMultiSelection`. Property IDs in tests come from shape metadata system, not fixture constants.
- **Validation:** 171 tests pass, 0 failures. `npx tsc --noEmit` clean.
- **Next step:** Phase 2 — Lift pipeline output to full IR AST types.

---

## Phase 2 — Lift pipeline output to full IR AST types [DONE]

**Goal**: `buildSelectQueryIR()` returns a proper `IRSelectQuery` with graph patterns and expression nodes — not the current flat structure.

**The structural gap:**

```
CURRENT pipeline output:                 TARGET (IntermediateRepresentation.ts):
─────────────────────────                ──────────────────────────────────────
shapeId: string                    →     root: IRShapeScanPattern {kind: 'shape_scan', shape: {shapeId}, alias}
projection: [{alias, path}]       →     projection: [{alias, expression: IRExpression}]
where: CanonicalWhereExpression    →     where: IRExpression
orderBy: [{path, direction}]      →     orderBy: [{expression: IRExpression, direction}]
```

**Substeps:**
1. Create `src/queries/IRLower.ts` — lowering pass that converts desugared/canonicalized output to full IR nodes:
   - `shapeId` → `IRShapeScanPattern` root with generated alias
   - `DesugaredSelectionPath` → `IRPropertyExpression` (for single-step) or chain of `IRTraversePattern` + `IRPropertyExpression` (for multi-step)
   - `CanonicalWhereExpression` → `IRExpression` tree (`where_binary` → `IRBinaryExpression`, `where_logical` → `IRLogicalExpression`, `where_exists` → `IRExistsExpression`, `where_not` → `IRNotExpression`)
   - Count steps → `IRAggregateExpression` with `name: 'count'`
   - Sub-selects → nested structures in projection
2. Extend `IRSelectQuery` in `IntermediateRepresentation.ts` with `subjectId?: string` and `singleResult?: boolean` (these are query-level semantics that stores need)
3. Update `IRPipeline.ts`: pipeline calls lowering pass, returns `IRSelectQuery`. Make `SelectQueryIR` a type alias for `IRSelectQuery`
4. Update `IRProjection.ts` to produce `IRProjectionItem` with `expression: IRExpression`
5. Update existing IR golden tests to match new output shape

**Modify:** New `src/queries/IRLower.ts`, `src/queries/IRPipeline.ts`, `src/queries/IRProjection.ts`, `src/queries/IntermediateRepresentation.ts`, `src/tests/ir-select-golden.test.ts`

**Validation:** `npm test` passes. `buildSelectQueryIR()` returns objects conforming to `IRSelectQuery`. Type contract tests pass.

**Report:**
- **What was done:** Completed the partial implementation by finishing substeps 4-5 and tightening lowering internals. `IRPipeline.ts` now routes through `IRLower` (already done before handoff). `IRLower.ts` now emits full `IRSelectQuery` AST and delegates path/projection expression lowering to `IRProjection.ts`. `IRProjection.ts` was upgraded from flat `path` output to `IRProjectionItem.expression: IRExpression` output. Added/kept query-level semantics on `IRSelectQuery` (`subjectId`, `singleResult`) and required `patterns`. Updated IR golden tests and type-contract tests to assert the new AST structure (`root`, `patterns`, `property_expr`, `binary_expr`, `logical_expr`, `exists_expr`, `aggregate_expr`).
- **Deviations:** Kept the existing `buildCanonicalProjection` function name for continuity, but changed its contract to output expression-based projection items (AST shape) instead of legacy path objects.
- **Problems:** The previous implementation left tests in mixed old/new states (`projection[].path` assumptions and missing `patterns` in type contracts). Also replaced a brittle `any`-based root alias override in exists lowering with explicit path-lowering options.
- **Validation:** `npm test -- --no-coverage` => 11 passed suites, 171 passed tests, 0 failed (2 suites skipped by design). `npx tsc --noEmit` => pass. Updated inline snapshots in `src/tests/ir-select-golden.test.ts`.
- **Next step:** Phase 3 — full IR select-query parity coverage against `query.test.ts`.

---

## Phase 3 — Full IR test coverage for select queries [DONE]

**Goal**: Every select query pattern in `query.test.ts` has a corresponding IR test asserting the `IRSelectQuery` structure.

**Coverage targets by group:**

| Group | Patterns | Current IR tests | Target |
|---|---|---|---|
| Basic Selection | 8 | 1 | 8 |
| Nested/Path Selection | 5 | 1 | 5 |
| Filtering (Where) | 18 | 1 | 18 |
| Aggregation/Sub-Select | 15 | 1 | 15 |
| Type Casting | 6 | 0 | 6 |
| Preload | 1 | 0 | 1 |
| Sorting/Limiting | 3 | 3 | 3 |

Work through one group at a time. For each test, assert: `root` shape scan, `projection` items with correct expressions, `where` expression tree structure, `orderBy`/`limit`/`offset`, `singleResult`/`subjectId`.

Use semantic assertions (structural checks on `kind` discriminators, property references, expression trees) alongside snapshot fixtures.

**Modify:** `src/tests/ir-select-golden.test.ts` (expand significantly)

**Validation:** `npm test` passes. All 56+ select patterns have IR assertions.

**Report:**
- **What was done:** Expanded `src/tests/ir-select-golden.test.ts` into a full parity suite covering every select pattern from sections 1-7 in `src/tests/query.test.ts` (56 table-driven parity cases) with IR assertions for root shape scan, projection/result-map alignment, where expression kinds, traversal pattern presence, ordering, limit, single-result semantics, and subject IDs. Kept focused inline snapshots for representative baseline fixtures. Extended lowering in `src/queries/IRLower.ts` to handle `sub_select`, `custom_object_select`, `evaluation_select`, and `multi_selection` projection forms so those parity tests assert real emitted IR instead of empty projections. Updated `src/queries/IRProjection.ts` to support explicit result-map keys for custom-object projections and exported key derivation helpers used by lowering.
- **Deviations:** None from Phase 3 scope. The implementation remained within select-query IR coverage and supporting lowering needed to make those tests meaningful.
- **Problems:** No blocking implementation issues. During test bring-up, three case expectations were corrected to match actual DSL semantics (`selectUndefinedOnly` keeps `singleResult`, `whereSomeImplicit` canonicalizes to `binary_expr` in current pipeline behavior, and `nestedQueries2` currently emits one traversal pattern).
- **Validation:** `npm test -- --no-coverage` => 11 passed suites, 223 passed tests, 0 failed (2 suites skipped by design). `npx tsc --noEmit` => pass.
- **Next step:** Phase 4 — full IR mutation parity coverage.

---

## Phase 4 — Full IR test coverage for mutation queries

**Goal**: Every mutation pattern in `query.test.ts` has a corresponding IR test.

**Coverage targets:**

| Mutation type | Patterns | Current IR tests | Target |
|---|---|---|---|
| Create | 3 | 1 | 3 |
| Delete | 4 | 1 | 4 |
| Update | 11 | 1 | 11 |

Key patterns to cover: unset with undefined/null, nested object updates, ID references, `$add`/`$remove` set modifications, Date values, predefined IDs on nested creates.

**Modify:** `src/tests/ir-mutation-parity.test.ts` (expand)

**Validation:** `npm test` passes. All 18 mutation patterns have IR assertions.

---

## Phase 5 — Wire production: SelectQuery IS the IR

**Goal**: `getQueryObject()` emits IR. The production path naturally flows IR to stores.

**Substeps:**
1. **`SelectQuery` type becomes `IRSelectQuery`**: In `SelectQuery.ts`, make `SelectQuery` a type alias for `IRSelectQuery` (with any needed backward-compatible fields). Remove the old interface.
2. **`SelectQueryFactory.getQueryObject()` returns IR**: Change the method body to call `buildSelectQueryIR()` on the internal trace data instead of manually assembling the legacy flat object. `getIR()` becomes an alias for `getQueryObject()`.
3. **Mutation types become IR types**: `CreateQuery` → `IRCreateMutation`, `UpdateQuery` → `IRUpdateMutation`, `DeleteQuery` → `IRDeleteMutation`. Update factory `getQueryObject()` methods to call IR mutation builders.
4. **Update `LinkedStorage.resolveStoreForQueryShape()`**: Shape resolution changes from `query.shape` (legacy) to `query.root.shape.shapeId` (IR). Use `getShapeClass()` to resolve.
5. **Update `IQuadStore` imports**: Point the type imports to the IR types. Method signatures stay the same since the type names are aliases.
6. **Update `QueryParser`**: Minimal — still calls `getQueryObject()`, which now returns IR.
7. **Update `query.test.ts` assertions**: Replace legacy field assertions (`query.select[0][0].property.label`) with IR field assertions (`query.projection[0].expression`, `query.root.shape.shapeId`). This is the bulk of the work.
8. **Update `store-routing.test.ts`**: Fake query objects must use IR structure.

**Modify:** `src/queries/SelectQuery.ts`, `src/queries/CreateQuery.ts`, `src/queries/UpdateQuery.ts`, `src/queries/DeleteQuery.ts`, `src/queries/QueryParser.ts`, `src/utils/LinkedStorage.ts`, `src/interfaces/IQuadStore.ts`, `src/tests/query.test.ts`, `src/tests/store-routing.test.ts`

**Validation:** `npm test` passes. `npx tsc --noEmit` passes (compile-time type assertions green). `getQueryObject()` returns `IRSelectQuery`. Production path emits IR.

---

## Phase 6 — Remove compatibility aliases and legacy code

**Goal**: Clean up all transitional constructs.

**Remove:**
- `CanonicalSelectIR` type alias + `buildCanonicalSelectIR` function from `IRPipeline.ts` (lines 105-113)
- `getCanonicalIR()` method from `SelectQueryFactory` in `SelectQuery.ts` (lines 1782-1785)
- Compatibility test in `ir-pipeline-parity.test.ts` (the `canonical_select_ir` kind test)
- `toLegacyParityView` / `toCanonicalParityView` / `LegacyParityView` from `IRPipeline.ts` (lines 62-103)
- Intermediate types no longer needed: `CanonicalProjectionItem`, `CanonicalWhereExpression` etc. if the pipeline now produces `IRExpression` directly
- Old `SelectQuery` interface (now replaced by type alias)

**Verify with grep**: No remaining references to `canonical_select_ir`, `buildCanonicalSelectIR`, `CanonicalSelectIR`, `getCanonicalIR`, `LegacyParityView` in production code.

**Modify:** `src/queries/IRPipeline.ts`, `src/queries/SelectQuery.ts`, `src/tests/ir-pipeline-parity.test.ts`, `src/queries/IRProjection.ts`, `src/queries/IRCanonicalize.ts`

**Validation:** `npm test` passes. grep confirms no stale references.

---

## Phase 7 — Consolidate and clean up

**Goal**: Clean module boundaries, remove test duplication, mark internal types as internal.

**Substeps:**
1. Review pipeline stages: Desugar → Canonicalize → Lower. Document the architecture.
2. Ensure `DesugaredSelectQuery` and other intermediate types are NOT exported from `src/index.ts`. Only final IR types from `IntermediateRepresentation.ts` should be public.
3. Extract shared `QueryCaptureStore` test helper (duplicated across 6+ test files) to a shared test utility.
4. Merge useful assertions from `ir-pipeline-parity.test.ts` into `ir-select-golden.test.ts` and remove the parity test file if no longer needed.

**Validation:** `npm test` passes. Clean exports. No test duplication.

---

## Phase 8 — Documentation sync

**Goal**: All documentation reflects the final implementation.

**Substeps:**
1. Rewrite `documentation/intermediate-representation.md` to match actual emitted IR shapes. Include examples for all variant types (basic, nested, where, sub-select, aggregation, type casting, sorting, mutations).
2. Update `README.md` changelog with migration notes: `SelectQuery`/`CreateQuery`/etc. are now IR types. Document what downstream `IQuadStore` implementations need to change.
3. Mark docs 002 and 003 as completed/superseded.
4. Verify extensibility: confirm adding `NOT EXISTS`, new operators, fine-grained optimizations requires only new `IRExpression`/`IRGraphPattern` variants — no structural pipeline changes.

**Validation:** `npm test` passes. Documentation matches emitted IR. README has migration guidance.

---

## Phase dependencies

```
Phase 1 (expand desugar)
  ↓
Phase 2 (lift to full IR AST)
  ↓
Phase 3 + Phase 4 (test coverage — can run in parallel)
  ↓
Phase 5 (wire production)
  ↓
Phase 6 (remove aliases)
  ↓
Phase 7 (consolidate)
  ↓
Phase 8 (documentation)
```

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Sub-select desugaring complexity | High — arrays-within-arrays, nested factories, custom objects | Build incrementally, one pattern at a time. Use `query.test.ts` as oracle. |
| Type inference regression | High — `QueryResponseToResultType` is complex (lines 330-608) | Run `npx tsc --noEmit` every phase. Type assertions test DSL result types, not query internals. |
| Downstream store breakage | Expected — stores access `query.select[0][0].property.label` etc. | Intentional breaking change. Document migration. |
| Snapshot churn | Medium — every golden test changes shape | Update in dedicated phases (2, 3, 4). Use semantic assertions alongside snapshots. |

## Validation commands (every phase)

```bash
npm test -- --runInBand        # all tests green
npx tsc --noEmit               # type checking (catches query.types.test.ts regressions)
```
