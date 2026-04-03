# 013 — Fix flat multi-value property projection

## Architecture

### Pipeline: maxCount propagation for flat property expressions

```
PropertyShape.maxCount
  → IRDesugar: DesugaredPropertyStep.maxCount  (already done)
  → IRProjection: lowerSelectionPathExpression last-step property_expr  (ADD maxCount)
  → IR: IRPropertyExpression.maxCount  (ADD field)
  → resultMapping: FieldDescriptor.maxCount  (ADD field)
  → mapFlatRows / mapNestedRows: collect into array when maxCount absent or > 1
```

### Files to change

| File | Change |
|------|--------|
| `src/queries/IntermediateRepresentation.ts` | Add `maxCount?: number` to `IRPropertyExpression` |
| `src/queries/IRProjection.ts` | Pass `step.maxCount` when building property_expr for last steps |
| `src/sparql/resultMapping.ts` | Add `maxCount?: number` to `FieldDescriptor`. Refactor `mapFlatRows` to group by root and collect multi-value fields. Update `mapNestedRows` flat field population. |
| `src/tests/sparql-result-mapping.test.ts` | Add tests for flat multi-value collection. Update `flatSelectQuery` helper to accept maxCount. |

### Contracts

- `IRPropertyExpression.maxCount`: optional number. When absent, property is treated as multi-value. When `<= 1`, property is single-value.
- `FieldDescriptor.maxCount`: mirrors the expression's maxCount.
- Multi-value flat fields produce `ResultRow[]` arrays (deduplicated by value). Single-value flat fields produce a single `ResultRow` or coerced value.
- When all bindings for a multi-value flat field are null/missing, the result is an empty array `[]`.

### Pitfalls

- Must handle URI-type multi-value fields (object properties like `friends`) and potentially literal multi-value fields (like `nickNames`).
- Must not break existing single-value behavior — fields with `maxCount: 1` (like `bestFriend`, `name`) must continue to produce single values.
- `mapFlatRows` currently deduplicates by root ID and takes first binding — needs full refactor to group-based approach.

## Phases

### Phase 1: IR type changes
Add `maxCount?: number` to `IRPropertyExpression` and propagate in `IRProjection.ts`.

**Validation**: Run `npx jest --testPathIgnorePatterns=fuseki --no-coverage` — all 903 tests pass (backward compatible, maxCount is optional).

### Phase 2: Result mapping refactor
- Add `maxCount?: number` to `FieldDescriptor`.
- Propagate from `IRPropertyExpression.maxCount` in `buildNestingDescriptor`.
- Refactor `mapFlatRows` to group by root ID and collect multi-value flat fields.
- Update `mapNestedRows` to collect multi-value flat fields across all group bindings.

**Validation**: Run existing tests — all pass (existing fields have no maxCount → treated as multi-value, but existing test data has single bindings per field so behavior unchanged).

### Phase 3: Unit tests
- Add tests for flat multi-value URI collection (e.g., `friends` with 2 bindings → array of 2).
- Add tests for flat single-value (maxCount: 1) staying as single value.
- Add tests for mixed: some flat fields multi-value, some single-value.
- Add tests for absent multi-value field → empty array.

**Validation**: All new tests pass.

### Dependency graph

Phase 1 → Phase 2 → Phase 3 (sequential, each depends on prior).
