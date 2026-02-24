---
summary: Refactored query internals from legacy nested-array objects to a canonical backend-agnostic IR AST. SelectQuery/CreateQuery/UpdateQuery/DeleteQuery ARE the IR types. Full test parity, JSDoc coverage, and downstream implementer documentation.
packages: [core]
---

# IR refactoring

## What changed

The internal query representation was replaced with a canonical backend-agnostic IR AST. The public Shape DSL (`Shape.select()`, `.create()`, `.update()`, `.delete()`) is unchanged. What changed is what `IQuadStore` implementations receive.

### Before

Stores received ad-hoc nested arrays and objects:
```typescript
query.select[0][0].property.label  // "name"
query.shape                         // Shape class reference
```

### After

Stores receive typed IR with `kind` discriminators:
```typescript
query.root.shape.shapeId            // "https://..."
query.projection[0].expression.kind // "property_expr"
query.where?.kind                   // "binary_expr" | "logical_expr" | ...
```

## Architecture decisions

1. **Route B**: Keep the public Shape DSL unchanged. Replace only the produced query object structure.
2. **Compact ID references**: IR carries `shapeId` and `propertyShapeId` strings only — no embedded shape/property objects.
3. **Explicit aliasing with lexical scopes**: Deterministic alias generation (`a0`, `a1`, ...) with scope-valid cross-references.
4. **Flat canonical projection**: Projection is a flat `{alias, expression}[]` list. Nested result shaping via optional `resultMap`.
5. **Deterministic AST split**: Separate node families for graph patterns (`shape_scan`, `traverse`) and expressions (`property_expr`, `binary_expr`, `logical_expr`, `aggregate_expr`, etc.).
6. **Early normalization**: `some()` → `exists()`, `every()` → `not exists(not ...)` during canonicalization.
7. **Distinct mutation kinds**: Explicit `create`, `update`, `delete` top-level kinds with shared field/value primitives.
8. **Types in place**: `SelectQuery`, `CreateQuery`, `UpdateQuery`, `DeleteQuery` ARE the IR types. No separate "IR" vs "query" type hierarchy.
9. **QueryParser calls directly**: Shape calls `QueryParser.selectQuery()` etc. directly — no swappable `IQueryParser` interface.

## Pipeline

```
SelectQueryFactory.build()
  → toRawInput()        (extract factory state)
  → desugarSelectQuery() (IRDesugar.ts — flatten DSL tree to DesugaredSelectQuery)
  → canonicalize()       (IRCanonicalize.ts — normalize booleans, rewrite quantifiers)
  → lowerSelectQuery()   (IRLower.ts — produce full AST with aliases, patterns, expressions)
  → SelectQuery          (the IR)

MutationFactory.build()
  → buildCanonical*MutationIR() (IRMutation.ts — direct conversion)
  → CreateQuery | UpdateQuery | DeleteQuery
```

Pipeline modules: `IRDesugar.ts` → `IRCanonicalize.ts` → `IRLower.ts`, with `IRProjection.ts` and `IRAliasScope.ts` as helpers. All have JSDoc on exported functions.

## IR types (summary)

**Select query**: `SelectQuery` with `root: IRShapeScanPattern`, `projection: IRProjectionItem[]`, `where?: IRExpression`, `orderBy?: IROrderByItem[]`, `limit?`, `offset?`, `subjectId?`, `singleResult?`, `resultMap?`.

**Mutations**: `CreateQuery` (`kind: 'create'`), `UpdateQuery` (`kind: 'update'`), `DeleteQuery` (`kind: 'delete'`). Fields use `IRFieldUpdate[]` with `property` (full URI) and typed values.

**Expressions**: Discriminated union `IRExpression` — `property_expr`, `binary_expr`, `logical_expr`, `exists_expr`, `not_expr`, `aggregate_expr`, `literal_expr`, `ref_expr`.

**Graph patterns**: `IRGraphPattern` — `shape_scan`, `traverse`.

Full reference: `documentation/intermediate-representation.md`.

## Breaking changes for downstream stores

`IQuadStore` method signatures are unchanged, but the objects they receive are structurally different:

| Method | Old input | New input |
|---|---|---|
| `selectQuery(query)` | Ad-hoc nested arrays | `SelectQuery` (IR AST) |
| `createQuery(query)` | `{kind, shape, description}` | `CreateQuery` (same structure, typed) |
| `updateQuery(query)` | `{kind, id, shape, description}` | `UpdateQuery` (same structure, typed) |
| `deleteQuery(query)` | `{kind, ids, shape}` | `DeleteQuery` (same structure, typed) |

Mutation IR is structurally similar to the old format. Select IR is completely different — stores must be rewritten to read `query.root`, `query.projection`, `query.where`, etc.

Store result types are exported: `ResultRow`, `SelectResult`, `CreateResult`, `UpdateResult`, `SetOverwriteResult`, `SetModificationResult`.

## Factory API

All factories expose `build()` as the primary method:
- `SelectQueryFactory.build(): SelectQuery`
- `CreateQueryFactory.build(): CreateQuery`
- `UpdateQueryFactory.build(): UpdateQuery`
- `DeleteQueryFactory.build(): DeleteQuery`

`SelectQueryFactory.toRawInput()` exposes the pre-pipeline factory state for internal/test use.

## Test coverage

147 tests across 9 suites:
- `ir-select-golden.test.ts` — 56 select patterns (all from original `query.test.ts`)
- `ir-mutation-parity.test.ts` — 18 mutation patterns (create/update/delete)
- `ir-desugar.test.ts` — 35 desugar conversion tests
- `ir-canonicalize.test.ts` — boolean normalization, quantifier rewrites
- `ir-projection.test.ts` — flat projection, alias ordering, result maps
- `ir-alias-scope.test.ts` — alias generation, scope resolution, validation
- `store-routing.test.ts` — store dispatch by shape
- `intermediate-representation.types.test.ts` — compile-time IR contracts
- `query.types.test.ts` — compile-time DSL type inference (skip at runtime)

## Problems encountered during implementation

- **Type inference sensitivity**: `QueryResponseToResultType` is complex (~280 lines). Verified with `npx tsc --noEmit` every phase — no regressions.
- **Sub-select desugaring complexity**: Arrays-within-arrays, nested factories, custom objects. Built incrementally one pattern at a time.
- **Circular dependency (QueryParser ↔ Shape)**: Resolved by having Shape import QueryParser directly; QueryParser uses `import type {Shape}` (erased at compile time).
- **Snapshot churn**: Renamed kind strings changed many snapshots. Updated in dedicated phases with semantic assertions preserved alongside.

## Implementation phases (completed)

Executed across three plan documents (002, 003, 004), consolidated here:

1. Baseline hardening and coverage inventory
2. IR type definitions (`IntermediateRepresentation.ts`)
3. Desugar layer scaffolding
4. Canonicalization pass (expressions + boolean normalization)
5. Quantifier rewrite pass (`some`/`every`)
6. Alias/scoping resolver
7. Flat canonical projection + resultMap
8. End-to-end select IR pipeline
9. Golden fixture migration (select)
10. Mutation IR conversion (create/update/delete)
11. Remove legacy query-object dependency paths
12. Consolidation, documentation, and changelog
13. IR naming alignment (`canonical_select_ir` → `select_query`, builder/type renames)
14. Expand desugar for all query patterns
15. Lift pipeline to full IR AST types (IRLower.ts)
16. Full select IR test coverage (56 patterns)
17. Full mutation IR test coverage (18 patterns)
18. Wire production: factories emit IR directly
19. Remove compatibility aliases
20. Consolidate (shared test helpers, merge parity tests)
21. Documentation sync
22. Unify type names (IRSelectQuery → SelectQuery, etc.)
23. Rename factory method to `build()`, eliminate `getLegacyQueryObject()`
24. Rewrite desugar input to `RawSelectInput`
25. Migrate all tests from legacy to IR assertions, delete `query.test.ts`
26. Final cleanup (dead code removal, JSDoc comments, QueryParser simplification)
