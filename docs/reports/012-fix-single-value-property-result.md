# 012 — Fix maxCount-aware result mapping for single-value and multi-value properties

## Summary

Three related bugs in the result mapping layer were fixed:

1. **Single-value traversals returned arrays**: `@objectProperty({maxCount: 1})` properties like `bestFriend` returned `ResultRow[]` instead of a single `ResultRow` when selected via traversal queries (e.g., `Person.select(p => p.bestFriend.name)`).

2. **Multi-value flat projections returned single values**: Multi-value object properties like `friends` (no `maxCount`) returned a single entity reference instead of `ResultRow[]` when selected via flat projections (e.g., `Person.select(p => p.friends)`).

3. **Multi-value literal fields were silently dropped**: Multi-value literal properties like `nickNames: string[]` returned empty arrays because the collection logic filtered out non-URI values.

## Root cause

The `maxCount` metadata from `PropertyShape` was never propagated through the IR pipeline. The result mapping layer had no way to distinguish single-value from multi-value properties, and flat result mapping discarded duplicate bindings for the same root entity.

## Architecture: maxCount propagation pipeline

```
PropertyShape.maxCount
  → IRDesugar: DesugaredPropertyStep.maxCount
  ├→ IRLower: IRTraversePattern.maxCount
  │   → resultMapping: NestedGroup.maxCount
  │   → assignNestedGroupValue(): unwrap when maxCount <= 1
  └→ IRProjection: IRPropertyExpression.maxCount
      → resultMapping: FieldDescriptor.maxCount
      → populateFlatFields(): array when absent, scalar when <= 1
```

Each layer adds an optional `maxCount?: number` field and passes it downstream. All additions are backward-compatible — properties without `maxCount` (or `maxCount > 1`) behave exactly as before.

## Key design decisions

1. **Optional field, not a boolean**: `maxCount?: number` preserves the full constraint value rather than reducing to `isSingleValue: boolean`. This allows future use (e.g., validation, LIMIT hints) without another pipeline change.

2. **Unwrap at result mapping, not query building**: The SPARQL query itself is unchanged — single-value and multi-value properties generate identical patterns. Only the post-processing applies the unwrap/collect logic.

3. **`null` for absent single values, `[]` for absent multi-values**: When a single-value traversal has no match, the result is `null`. When a multi-value flat field has no bindings, the result is `[]` (empty array).

4. **Group-then-collect in `mapFlatRows`**: Refactored from dedup-first to group-first. Bindings are grouped by root entity ID, then for each root: single-value fields take first binding, multi-value fields collect all distinct values.

5. **`extractFieldValue` consolidation**: Value extraction logic consolidated into a single `extractFieldValue()` function, eliminating duplication between `populateFields` and the old `mapFlatRows` loop.

6. **`ResultFieldValue` type widening**: Added `string[] | number[] | boolean[] | Date[]` to the `ResultFieldValue` union to support multi-value literal arrays alongside existing `ResultRow[]` for entity references.

## Files changed

| File | Responsibility |
|------|---------------|
| `src/queries/IntermediateRepresentation.ts` | Added `maxCount?: number` to `IRTraversePattern` and `IRPropertyExpression`; added primitive array types to `ResultFieldValue` |
| `src/queries/IRDesugar.ts` | Added `maxCount?: number` to `DesugaredPropertyStep`; propagated from `PropertyShape` |
| `src/queries/IRLower.ts` | Extended `getOrCreateTraversal` signature to accept `maxCount` |
| `src/queries/IRProjection.ts` | Forwarded `step.maxCount` to both traversal resolution and last-step `property_expr` |
| `src/sparql/resultMapping.ts` | Added `maxCount` to `NestedGroup` and `FieldDescriptor`; new helpers `isMultiValueField`, `extractFieldValue`, `populateFlatFields`; refactored `mapFlatRows`; added `assignNestedGroupValue()` |
| `src/test-helpers/query-fixtures.ts` | Added `selectBestFriendOnly` fixture |
| `src/tests/ir-select-golden.test.ts` | Golden snapshot tests for `maxCount` on traverse and property_expr |
| `src/tests/sparql-result-mapping.test.ts` | 13 new unit tests covering single-value unwrap, multi-value URI collection, multi-value literal collection, dedup, empty arrays, mixed fields |
| `src/tests/sparql-negative.test.ts` | Updated helper with `maxCount: 1` |
| `src/tests/sparql-fuseki.test.ts` | 13 weak integration tests strengthened with proper value assertions; 3 tests fixed for single-value unwrap |

## Public API surface

No new exports. Behavioral changes:

- `Person.select(p => p.bestFriend.name)` → `result.bestFriend` is now `ResultRow` (was `ResultRow[]`)
- `Person.select(p => p.friends)` → `result.friends` is now `ResultRow[]` (was single `{id: ...}`)
- `Person.select(p => p.nickNames)` → `result.nickNames` is now `string[]` (was `[]` empty)

## Test coverage

- **912 tests pass**, 114 skipped (Fuseki integration)
- 13 new unit tests + 13 strengthened Fuseki integration tests + 3 fixed Fuseki tests

## Known gap

`createTraversalResolver()` in `IRLower.ts` (used by `lowerWhere` for EXISTS/MINUS patterns) does not propagate `maxCount`. This is correct because WHERE-clause traversals do not produce result nesting — they only generate SPARQL graph patterns for filtering.
