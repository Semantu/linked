# Report: Advanced Query Patterns

Implements three core features plus cleanup for the linked data DSL:
1. **MINUS** — `.minus()` on `QueryBuilder`
2. **Bulk Delete** — `.deleteAll()`, `.deleteWhere()`, `.delete().where()`
3. **Conditional Update** — `.update().where()`, `.update().forAll()`
4. **MINUS Multi-Property** — `.minus(p => [p.hobby, p.name])` with nested path support
5. **API Cleanup** — deprecate `sortBy`, require `update()` data, simplify delete API

Named graphs: deferred (out of scope). See [ideation doc](../ideas/007-advanced-query-patterns.md).

---

## Architecture Overview

All features follow the same pipeline:

```
DSL (Builder) → IR AST → SPARQL Algebra → SPARQL String
```

Each feature adds:
- **Builder method(s)** — new chainable methods on existing builders
- **IR type(s)** — new variant(s) in the IR union
- **Algebra conversion** — new case(s) in `irToAlgebra.ts`
- **Serialization** — reuses existing `algebraToString.ts` (no changes needed for any feature)

---

## File Structure

### Core IR Types

| File | Responsibility |
|------|---------------|
| `src/queries/IntermediateRepresentation.ts` | `IRMinusPattern`, `IRDeleteAllMutation`, `IRDeleteWhereMutation`, `IRUpdateWhereMutation` types added to existing unions |
| `src/queries/IRMutation.ts` | Canonical IR builder functions: `buildCanonicalDeleteAllMutationIR`, `buildCanonicalDeleteWhereMutationIR`, `buildCanonicalUpdateWhereMutationIR` |
| `src/queries/DeleteQuery.ts` | Widened `DeleteQuery` = `IRDeleteMutation \| IRDeleteAllMutation \| IRDeleteWhereMutation` |
| `src/queries/UpdateQuery.ts` | Widened `UpdateQuery` = `IRUpdateMutation \| IRUpdateWhereMutation` |

### MINUS Pipeline (Phases 2 + 6)

| File | Responsibility |
|------|---------------|
| `src/queries/QueryBuilder.ts` | `.minus()` method — accepts `ShapeConstructor`, `WhereClause`, or property-returning callback. Runtime type detection dispatches to shape scan, where clause, or property path extraction |
| `src/queries/IRDesugar.ts` | `PropertyPathSegment` type; `RawMinusEntry` and `DesugaredMinusEntry` with `propertyPaths` field; threads property paths through desugaring untransformed |
| `src/queries/IRCanonicalize.ts` | `CanonicalMinusEntry` with `propertyPaths` field; threads through canonicalization untransformed |
| `src/queries/IRLower.ts` | Converts `propertyPaths` to chained `IRTraversePattern` sequences; handles `shapeId` → shape scan, `propertyPaths` → traverse chains, `where` → filter-based MINUS |
| `src/sparql/irToAlgebra.ts` | `IRMinusPattern` → `SparqlMinus { left, right }` in `selectToAlgebra` |

### Bulk Delete Pipeline (Phase 3)

| File | Responsibility |
|------|---------------|
| `src/queries/DeleteBuilder.ts` | `mode` field (`'ids' \| 'all' \| 'where'`), `.all()` and `.where()` methods, `build()` dispatches by mode |
| `src/shapes/Shape.ts` | `Shape.deleteAll()` and `Shape.deleteWhere(fn)` static methods |
| `src/sparql/irToAlgebra.ts` | `deleteAllToAlgebra()` with `walkBlankNodeTree()` for schema-aware blank node cleanup; `deleteWhereToAlgebra()` adds filter conditions |

### Conditional Update Pipeline (Phase 4)

| File | Responsibility |
|------|---------------|
| `src/queries/UpdateBuilder.ts` | `mode` field (`'for' \| 'forAll' \| 'where'`), `.forAll()` and `.where()` methods, `buildUpdateWhere()` shared helper |
| `src/sparql/irToAlgebra.ts` | `updateWhereToAlgebra()` — shared field processing helper extracted from `updateToAlgebra()`, parameterized by subject term (IRI vs variable) |

### Dispatch

| File | Responsibility |
|------|---------------|
| `src/sparql/SparqlStore.ts` | Routes `deleteQuery()` by `kind`: `'delete'`, `'delete_all'`, `'delete_where'`; routes `updateQuery()` by `kind`: `'update'`, `'update_where'` |

---

## Public API Surface

### New QueryBuilder method

```ts
// Exclude by shape type
Person.select(p => p.name).minus(Employee)

// Exclude by condition
Person.select(p => p.name).minus(p => p.hobby.equals('Chess'))

// Exclude by property existence (single)
Person.select(p => p.name).minus(p => p.hobby)

// Exclude by property existence (multi, flat)
Person.select(p => p.name).minus(p => [p.hobby, p.name])

// Exclude by property existence (nested path)
Person.select(p => p.name).minus(p => [p.bestFriend.name])

// Chained — two separate MINUS blocks
Person.select(p => p.name).minus(Employee).minus(p => p.hobby)
```

### New Delete methods

```ts
// Delete all instances
Person.deleteAll()                    // static sugar → DeleteBuilder<S, void>

// Conditional delete
Person.deleteWhere(p => p.status.equals('inactive'))  // static sugar
DeleteBuilder.from(Person).all()                      // builder equivalent
DeleteBuilder.from(Person).where(p => ...)            // builder equivalent

// ID-based (simplified — .for() removed)
Person.delete('id-1')                 // single ID
Person.delete(['id-1', 'id-2'])       // multiple IDs
DeleteBuilder.from(Person, 'id-1')    // builder equivalent
```

### New Update methods

```ts
// Conditional update
Person.update({status: 'archived'}).where(p => p.status.equals('inactive'))

// Bulk update all
Person.update({verified: true}).forAll()

// Existing by-ID (unchanged)
Person.update({name: 'Bob'}).for('id-1')
```

### Deprecated

```ts
// sortBy — use orderBy instead
/** @deprecated Use `orderBy()` instead. */
sortBy(fn, direction)  // delegates to orderBy internally
```

### Removed

- `DeleteBuilder.for()` method — use `DeleteBuilder.from(shape, ids)` instead
- `Shape.update()` no-arg overload — `data` parameter is now required

---

## Key Design Decisions

### 1. MINUS runtime type detection

The `.minus()` callback can return three different types: `Evaluation` (WHERE condition), `QueryBuilderObject` (single property), or `QueryBuilderObject[]` (multi-property). Detection order in `toRawInput()`:

1. `Array.isArray(result)` → property paths array
2. `'property' in result && 'subject' in result` → single QBO (property existence)
3. Fallthrough → Evaluation (WHERE clause)

**Rationale:** These types don't overlap — `Evaluation` has no `property` field, `QBO` has no `getWherePath()`. Runtime detection avoids needing separate method names while keeping a single `.minus()` API.

### 2. PropertyPathSegment threading through pipeline

`PropertyPathSegment[][]` passes through Raw → Desugared → Canonical stages **untransformed**. Only `IRLower` converts segments to `IRTraversePattern` chains.

**Rationale:** Property path segments are already in their canonical form (property shape IDs). No desugaring or canonicalization needed. Converting to traverse patterns requires alias generation, which belongs in the lowering step.

### 3. Schema-aware blank node cleanup for deleteAll

`deleteAllToAlgebra()` uses `walkBlankNodeTree()` to recursively walk the shape tree and generate `OPTIONAL` blocks for blank node properties. This ensures blank node children are cleaned up.

```sparql
DELETE { ?a0 ?p ?o . ?addr ?p1 ?o1 . }
WHERE {
  ?a0 a <Person> . ?a0 ?p ?o .
  OPTIONAL { ?a0 <address> ?addr . FILTER(isBlank(?addr)) . ?addr ?p1 ?o1 . }
}
```

**Rationale:** Without blank node cleanup, deleting a Person would orphan its blank node Address. The `OPTIONAL` + `isBlank()` pattern safely handles cases where the property value is an IRI (not a blank node) — no false deletions.

### 4. Shared field processing for updateWhere

`updateToAlgebra()` was refactored to extract field processing (DELETE/INSERT/WHERE patterns per field) into a shared helper parameterized by subject term. `updateWhereToAlgebra()` calls the same helper with a variable `?a0` instead of a concrete IRI.

**Rationale:** Avoids duplicating the field-level DELETE/INSERT logic. The only difference between by-ID and conditional updates is whether the subject is `<iri>` or `?a0`.

### 5. Delete API simplification

Removed `.for()` from `DeleteBuilder`. ID-based deletes use `DeleteBuilder.from(shape, ids)` or `Shape.delete(id)`. This prevents the ambiguous pattern `DeleteBuilder.from(shape).for(id)` which duplicated `.from(shape, id)`.

**Rationale:** Two ways to do the same thing creates confusion. The `.from()` signature already accepts IDs. `.for()` is reserved for `UpdateBuilder` where it targets an entity for update (semantically different from "which entities to delete").

### 6. Typed R parameter on builders

`DeleteBuilder<S, R>` uses `R = DeleteResponse` for ID-based and `R = void` for bulk operations. `UpdateBuilder<S, U, R>` uses `R = AddId<U>` for by-ID and `R = void` for bulk.

**Rationale:** Bulk operations don't return individual results — they affect an unknown number of entities. The `void` return type prevents callers from expecting a response object.

### 7. MINUS multi-property nested path support

`.minus(p => [p.bestFriend.name])` produces chained traverse patterns: `?a0 <bestFriend> ?m0 . ?m0 <name> ?m1`.

`FieldSet.collectPropertySegments()` walks the `.subject` chain on the QBO backward, collecting `.property` fields into a `PropertyShape[]` in root-to-leaf order. Each segment becomes a `PropertyPathSegment { propertyShapeId }` that gets lowered to an `IRTraversePattern` chain.

**Rationale:** Reuses the same proxy and path collection infrastructure already used by `.select()` callbacks. No new proxy mechanism needed.

---

## Test Coverage

| Test file | Total tests | New/changed for this scope |
|-----------|-------------|---------------------------|
| `src/tests/sparql-select-golden.test.ts` | 63 | +11 (4 MINUS basic + 4 MINUS multi-property + 3 MINUS variants) |
| `src/tests/sparql-mutation-golden.test.ts` | 25 | +6 (2 deleteAll, 2 deleteWhere, 2 updateWhere/forAll) |
| `src/tests/mutation-builder.test.ts` | 25 | Updated existing tests for new delete/update API |
| `src/tests/query-builder.test.ts` | 60 | Changed sortBy→orderBy, updated delete/update paths |
| `src/tests/query-builder.types.test.ts` | 2 | Changed sortBy→orderBy |

**Total:** 644 tests pass, 0 failures. TypeScript clean.

### Golden test fixtures added

| Fixture | DSL | Validates |
|---------|-----|-----------|
| `minusShape` | `.minus(Employee)` | Shape type exclusion |
| `minusProperty` | `.minus(p => p.hobby)` | Single property existence |
| `minusCondition` | `.minus(p => p.hobby.equals('Chess'))` | WHERE condition in MINUS |
| `minusChained` | `.minus(Employee).minus(p => p.hobby)` | Two separate MINUS blocks |
| `minusMultiProperty` | `.minus(p => [p.hobby, p.nickNames])` | Multi-property flat |
| `minusNestedPath` | `.minus(p => [p.bestFriend.name])` | Nested path traversal |
| `minusMixed` | `.minus(p => [p.hobby, p.bestFriend.name])` | Mixed flat + nested |
| `minusSingleProperty` | `.minus(p => p.hobby)` via property path | Single QBO (non-array) |
| `deleteAll` | `Person.deleteAll()` | Delete all with blank node cleanup |
| `deleteWhere` | `.where(p => p.hobby.equals('Chess'))` | Conditional delete |
| `updateWhere` | `.where(p => p.hobby.equals('Jogging'))` | Conditional update |
| `updateForAll` | `.forAll()` | Bulk update with OPTIONAL bindings |

All golden tests use exact `toBe` matching on full SPARQL strings.

---

## Known Limitations

1. **Named graphs** — Deferred. All queries operate on the default graph.
2. **MINUS with nested WHERE conditions** — `.minus(p => p.bestFriend.name.equals('Bob'))` is NOT supported. Nested paths only support property existence checks, not value conditions. Condition-based MINUS uses the flat WHERE clause path.
3. **Circular shape references in deleteAll** — `walkBlankNodeTree` caps recursion depth to prevent infinite loops, but deeply nested shapes may produce verbose SPARQL.
4. **MINUS multi-property deduplication** — If `.minus(p => [p.bestFriend.name, p.bestFriend.hobby])`, each path gets independent aliases. The SPARQL engine handles deduplication via BGP matching, but the generated SPARQL could be more compact with shared prefixes.

---

## Deferred Work

- **Named graphs**: Route B from ideation doc. See `docs/ideas/007-advanced-query-patterns.md`.
- **Preload/eager loading**: Discussed but deferred to a separate scope.
- **MINUS with aggregation**: `.minus()` inside subqueries with GROUP BY — not currently supported.

---

## Commits

All work on branch `claude/setup-and-summarize-GQoTY` (18 commits):

1. `0a8f851` — Initial plan
2. `e8f8989` – `87803f1` — Ideation decisions and cross-cutting resolutions
3. `291e4dc` — Implementation plan
4. `a39f138` — Phase 1: IR types
5. `c5e5afb` — Phase 2: MINUS on QueryBuilder
6. `08f3335` — Fix: include missed IRDesugar/IRLower changes
7. `15d3182` — Phase 3: Bulk delete
8. `ac395a8` — Phase 4: Conditional update
9. `cd93175` — Mark phases complete in plan
10. `8d8f5e3` — Review gap fixes: shared helper, void returns, equivalence tests
11. `15c0c38` – `5a0121e` — Phase 6 plan + revision for nested paths
12. `ec99875` — Phase 6: MINUS multi-property with nested path support
13. `669df80` — Cleanup: deprecate sortBy, require update data, simplify delete API
