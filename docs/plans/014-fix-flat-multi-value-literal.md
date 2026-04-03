# 014 — Fix flat multi-value literal field collection

## Architecture

The fix is minimal — two files for the core change, tests to validate.

### Files to change

| File | Change |
|------|--------|
| `src/queries/IntermediateRepresentation.ts` | Add `string[] \| number[] \| boolean[] \| Date[]` to `ResultFieldValue` |
| `src/sparql/resultMapping.ts` | Remove object/id guard in `populateFlatFields`, collect all values |
| `src/tests/sparql-result-mapping.test.ts` | Add tests for multi-value literal collection |

### Contracts

- Multi-value literal fields (no maxCount, literal type) produce typed primitive arrays (e.g. `string[]`).
- Multi-value URI fields continue to produce `ResultRow[]`.
- Mixed multi-value fields (theoretically impossible in practice) produce `ResultFieldValue[]`.

### Pitfalls

- Must not break existing `ResultRow[]` collection for URI multi-value fields.
- The `ResultFieldValue` type change must not cause downstream type errors.

## Phases

### Phase 1: Type and logic fix
- Add primitive array types to `ResultFieldValue`
- Fix `populateFlatFields` filter logic
- **Validation**: All existing tests pass

### Phase 2: Tests
- Add unit test for multi-value literal string collection
- Add unit test for mixed URI + literal multi-value fields in same query
- **Validation**: All tests pass including new ones

### Dependency graph
Phase 1 → Phase 2 (sequential)
