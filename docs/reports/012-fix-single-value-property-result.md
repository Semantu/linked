# 012 — Fix single-value property select result shape

## Summary

Single-value object properties (`@objectProperty({maxCount: 1})`) such as `bestFriend` were incorrectly returned as `ResultRow[]` arrays when selected via traversal queries (e.g., `Person.select(p => p.bestFriend.name)`). After this fix, properties with `maxCount <= 1` are unwrapped to a single `ResultRow` (or `null` when absent).

## Root cause

The `maxCount` metadata from `PropertyShape` was never propagated through the IR pipeline. `IRTraversePattern` had no `maxCount` field, so the result mapping layer (`resultMapping.ts`) had no way to distinguish single-value from multi-value traversals. `collectNestedGroup()` always returned `ResultRow[]`.

## Architecture: maxCount propagation pipeline

```
PropertyShape.maxCount
  → IRDesugar: DesugaredPropertyStep.maxCount
  → IRLower: LoweringContext.getOrCreateTraversal(…, maxCount)
  → IR: IRTraversePattern.maxCount
  → resultMapping: NestedGroup.maxCount
  → assignNestedGroupValue(): unwrap when maxCount <= 1
```

Each layer adds an optional `maxCount?: number` field and passes it downstream. All additions are backward-compatible — properties without `maxCount` (or `maxCount > 1`) behave exactly as before.

## Key design decisions

1. **Optional field, not a boolean**: `maxCount?: number` preserves the full constraint value rather than reducing to `isSingleValue: boolean`. This allows future use (e.g., validation, LIMIT hints) without another pipeline change.

2. **Unwrap at result mapping, not query building**: The SPARQL query itself is unchanged — single-value and multi-value properties generate identical traversal patterns. Only the post-processing step (`assignNestedGroupValue`) applies the unwrap logic.

3. **`null` for absent single values**: When a single-value traversal has no match, the result is `null` (not `undefined`, not `{}`). This is consistent with `singleResult` behavior and matches the `ResultFieldValue` type.

## Files changed

| File | Responsibility |
|------|---------------|
| `src/queries/IntermediateRepresentation.ts` | Added `maxCount?: number` to `IRTraversePattern` |
| `src/queries/IRDesugar.ts` | Added `maxCount?: number` to `DesugaredPropertyStep`; propagated from `PropertyShape` in `segmentsToSteps` and `desugarEntry` |
| `src/queries/IRLower.ts` | Extended `getOrCreateTraversal` and `PathLoweringOptions.resolveTraversal` signatures to accept `maxCount`; passed through in `aliasAfterPath` |
| `src/queries/IRProjection.ts` | Updated `ProjectionPathLoweringOptions.resolveTraversal` signature; forwarded `step.maxCount` in `lowerSelectionPathExpression` |
| `src/sparql/resultMapping.ts` | Added `maxCount?: number` to `NestedGroup`; propagated through `buildAliasChain`, `insertIntoTree`, `buildNestingDescriptor`; added `assignNestedGroupValue()` helper |
| `src/test-helpers/query-fixtures.ts` | Added `selectBestFriendOnly` fixture |
| `src/tests/ir-select-golden.test.ts` | Added golden snapshot test verifying `maxCount: 1` on traverse pattern; added `selectBestFriendOnly` case |
| `src/tests/sparql-result-mapping.test.ts` | Updated 2 existing 3-level nesting tests; added 4 new single-value property tests |

## Test coverage

- **`sparql-result-mapping.test.ts`**: 4 new tests covering single-value select (returns `ResultRow`), absent single-value (returns `null`), single-value with nested select, multi-value regression guard
- **`ir-select-golden.test.ts`**: 1 new golden snapshot test asserting `maxCount: 1` flows from `PropertyShape` through the full pipeline to `IRTraversePattern`; 1 new parity case for `selectBestFriendOnly`
- **Total**: 903 tests pass, 114 skipped (Fuseki integration)

## Known gap

`createTraversalResolver()` in `IRLower.ts` (used by `lowerWhere` for EXISTS/MINUS patterns) does not propagate `maxCount`. This is correct because WHERE-clause traversals do not produce result nesting — they only generate SPARQL graph patterns for filtering. However, if `createTraversalResolver` is ever reused for projection-related traversals, `maxCount` support would need to be added there.

## Follow-on: flat multi-value projection fix

This fix addressed traversal-based properties but revealed a second bug: flat multi-value property projections (e.g., `Person.select(p => p.friends)`) returned a single entity reference instead of an array. See report 013 for the fix that extended `maxCount` propagation to `IRPropertyExpression` and refactored the flat result mapping code.
