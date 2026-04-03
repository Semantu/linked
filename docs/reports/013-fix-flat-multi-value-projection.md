# 013 — Fix flat multi-value property projection

## Summary

Multi-value object properties without `maxCount` constraints (e.g., `friends`) were returned as a single entity reference instead of an array when selected via flat projections like `Person.select(p => p.friends)`. After this fix, such properties correctly return `ResultRow[]` arrays with all distinct entity references.

This is a follow-on to report 012 (single-value traversal unwrapping). Report 012 propagated `maxCount` through the traversal pipeline (`IRTraversePattern` → `NestedGroup`). This report extends `maxCount` to the flat projection pipeline (`IRPropertyExpression` → `FieldDescriptor`).

## Root cause

Two independent bugs in the result mapping layer:

1. **`mapFlatRows`** (queries with no traversals) deduplicated by root entity ID and took only the first SPARQL binding. For `Person.select(p => p.friends)`, if p1 had friends [p2, p3], the SPARQL returned two rows for p1 but `mapFlatRows` discarded the second, returning only `{id: p2}`.

2. **`mapNestedRows`** (queries with traversals) took `groupBindings[0]` for root-level flat fields. For `Person.select(p => [p.friends, p.bestFriend.name])`, the flat `friends` field was populated from only the first binding.

Both bugs existed because the result mapping had no way to distinguish single-value from multi-value flat fields — `maxCount` was only propagated to traversal patterns, not to property expressions.

## Architecture: extended maxCount propagation

The full pipeline now covers both traversals and flat projections:

```
PropertyShape.maxCount
  → IRDesugar: DesugaredPropertyStep.maxCount
  ├→ IRLower: IRTraversePattern.maxCount         (report 012)
  │   → resultMapping: NestedGroup.maxCount
  │   → assignNestedGroupValue(): unwrap when maxCount <= 1
  └→ IRProjection: IRPropertyExpression.maxCount  (this report)
      → resultMapping: FieldDescriptor.maxCount
      → populateFlatFields(): array when absent, scalar when <= 1
```

## Key design decisions

1. **`maxCount` on `IRPropertyExpression`**: Added `maxCount?: number` to the type. When absent, the field is treated as multi-value (collected into array). When `<= 1`, single-value (take first binding). This mirrors the convention on `IRTraversePattern`.

2. **Group-then-collect in `mapFlatRows`**: Refactored from dedup-first to group-first. Bindings are grouped by root entity ID (like `mapNestedRows` already does), then for each root:
   - Single-value fields: take first binding (unchanged behavior)
   - Multi-value fields: collect all distinct URI values into `ResultRow[]`

3. **Shared `populateFlatFields` helper**: Both `mapFlatRows` and `mapNestedRows` now use `populateFlatFields()` for root-level flat fields. This eliminates the inconsistency where `mapNestedRows` used a different code path (`populateFields` with `groupBindings[0]`).

4. **`extractFieldValue` consolidation**: The inline value extraction logic that was duplicated in `populateFields` and the old `mapFlatRows` loop was consolidated into `extractFieldValue()`. The remaining `populateFields()` function (used inside `collectNestedGroup` for nested entity fields) now delegates to `extractFieldValue`.

5. **Empty array for absent multi-value fields**: When no bindings exist for a multi-value flat field, the result is `[]` (empty array), not `null`. This distinguishes "property exists but has no values" from "property is single-value and absent" (`null`).

## Files changed

| File | Responsibility |
|------|---------------|
| `src/queries/IntermediateRepresentation.ts` | Added `maxCount?: number` to `IRPropertyExpression` |
| `src/queries/IRProjection.ts` | Propagates `step.maxCount` to `property_expr` when building last-step flat projections |
| `src/sparql/resultMapping.ts` | Added `maxCount?: number` to `FieldDescriptor`; new helpers `isMultiValueField`, `extractFieldValue`, `populateFlatFields`; refactored `mapFlatRows` to group-then-collect; updated `mapNestedRows` to use `populateFlatFields` |
| `src/tests/sparql-result-mapping.test.ts` | Updated `flatSelectQuery` and `nestedSelectQuery` helpers to accept `maxCount`; added `maxCount: 1` to all existing single-value test fields; added 5 new flat multi-value tests |
| `src/tests/sparql-negative.test.ts` | Updated `singleFieldQuery` helper with `maxCount: 1` |
| `src/tests/ir-select-golden.test.ts` | Updated 3 inline snapshots to include `maxCount` on property_expr |
| `src/tests/sparql-fuseki.test.ts` | Strengthened 13 weak integration tests with proper value assertions |

## Public API surface

No new exports. The behavioral change is:

- **Before**: `Person.select(p => p.friends)` → `p.friends` is `{id: "...p2"}` (single entity ref, last binding wins)
- **After**: `Person.select(p => p.friends)` → `p.friends` is `[{id: "...p2"}, {id: "...p3"}]` (array of all friends)

This applies to any flat property projection where the property has no `maxCount` constraint.

## Test coverage

### New tests (sparql-result-mapping.test.ts)

- **multi-value flat field collects into array**: 2 bindings for same root → array of 2
- **multi-value flat field deduplicates**: duplicate bindings → array of 1
- **absent multi-value flat field → empty array**: no binding → `[]`
- **mixed single-value and multi-value flat fields**: name (maxCount:1) stays scalar, friends (no maxCount) becomes array
- **multi-value flat field in nested mode**: friends flat + bestFriend traversal in same query

### Strengthened Fuseki integration tests

13 tests updated with proper value assertions (previously only checked existence/array-ness):

- `selectFriends`: asserts friends is array of 2 with p2 and p3
- `selectNestedFriendsName`: validates 2-level nesting structure
- `selectDeepNested`: asserts empty result (chain impossible with test data)
- `selectMultiplePaths`: verifies name, bestFriend unwrap, friends array
- `nestedObjectPropertySingle`: matches nestedObjectProperty assertions
- `subSelectAllProperties`: verifies friend count and property values
- `subSelectAllPropertiesSingle`: verifies bestFriend unwrap with all properties
- `nestedQueries2`: verifies friends array, firstPet ref, bestFriend unwrap
- `subSelectArray`: verifies friend count, names, hobby values
- `selectShapeSetAs/selectShapeAs`: verifies guardDogLevel values
- `countNestedFriends/countLabel`: verifies actual count values
- `preloadBestFriend`: verifies bestFriend unwrap with preloaded name

### Totals

- 908 tests pass, 114 skipped (Fuseki integration)
- 5 new unit tests + 13 strengthened integration tests

## Known limitations

1. **Flat multi-value literal fields**: The current implementation only collects URI-typed values into arrays (object properties). Literal multi-value fields (e.g., `nickNames`) in flat projections are not yet handled — they would need a different code path since `extractFieldValue` returns coerced scalars for literals. This is a pre-existing limitation; such fields were already broken before this fix.

2. **`count_step` property_expr**: The `property_expr` constructed inside `count_step` (aggregate) handlers in `IRProjection.ts` does not carry `maxCount`. This is correct — aggregate expressions produce computed values via GROUP BY, so maxCount on their inner property has no effect on result mapping.

3. **`createTraversalResolver` in `IRLower.ts`**: Does not propagate `maxCount` (same as report 012). Correct because WHERE-clause traversals don't produce result nesting.
