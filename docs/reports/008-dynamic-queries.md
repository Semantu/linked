---
summary: Final report for the Dynamic Queries system — FieldSet, QueryBuilder, Mutation Builders, and DSL alignment replacing the mutable SelectQueryFactory architecture.
plan: 001-dynamic-queries
packages: [core]
---

# 008 — Dynamic Queries

## 1. Summary

Replaced the mutable `SelectQueryFactory` + `PatchedQueryPromise` + `nextTick` query system with an immutable `QueryBuilder` + `FieldSet` architecture. The DSL (`Person.select(...)`, `Person.create(...)`, etc.) is now syntactic sugar over composable, serializable builders. Mutation operations (`create`, `update`, `delete`) follow the same immutable builder pattern.

**What was built:**

- `QueryBuilder` — immutable, fluent, PromiseLike select query builder
- `FieldSet` — immutable, composable, serializable collection of property paths (the canonical query primitive)
- `PropertyPath` — value object representing a chain of property traversals
- `CreateBuilder`, `UpdateBuilder`, `DeleteBuilder` — immutable PromiseLike mutation builders
- `ShapeConstructor` type — replaces the old `ShapeType` for concrete shape class references
- JSON serialization for QueryBuilder and FieldSet (round-trip safe)
- `.for(id)` / `.forAll(ids)` targeting API with `VALUES` clause generation
- Full type inference through builder chains via `QueryResponseToResultType`

**Why:**

The old `SelectQueryFactory` was a 2100-line mutable class with complex proxy tracing, `nextTick`-based deferred execution, and `PatchedQueryPromise` monkey-patching. It could not be composed, serialized, or used for runtime/CMS-style query construction. The new architecture enables both static (TypeScript DSL) and dynamic (string-based, JSON-driven) query building through a single pipeline.

**Scale:** ~20 commits across 19 phases. Final state: 629 passing tests across 22 test suites.

---

## 2. Architecture

### Pipeline Overview

```
DSL path:     Person.select(p => [p.name])
                → QueryBuilder.from(Person).select(fn)
                    → FieldSet (via ProxiedPathBuilder callback tracing)
                        → RawSelectInput (via desugarFieldSetEntries)
                            → buildSelectQuery() → IR → SPARQL

Dynamic path: QueryBuilder.from('my:PersonShape').select(['name', 'friends.name'])
                → FieldSet (via walkPropertyPath string resolution)
                    → RawSelectInput
                        → buildSelectQuery() → IR → SPARQL

JSON path:    QueryBuilder.fromJSON(json)
                → QueryBuilder (shape + fields resolved from registry)
                    → same pipeline
```

Both DSL and dynamic paths converge at `FieldSet`, which converts directly to `RawSelectInput` — the existing IR pipeline entry point. No new pipeline stages were needed.

### Key Design Decisions

**1. DSL and QueryBuilder are the same system.**
The DSL is syntactic sugar. `Person.select(p => [p.name])` internally creates a `QueryBuilder`, which holds a `FieldSet`. One shared `ProxiedPathBuilder` proxy implementation powers both paths.

**2. Immutable builders, PromiseLike execution.**
Every `.where()`, `.select()`, `.limit()`, etc. returns a new builder (shallow clone). `QueryBuilder implements PromiseLike<Result[]>` so `await` triggers execution. No `nextTick`, no mutable state, no `PatchedQueryPromise`.

**3. FieldSet as the canonical query primitive.**
FieldSet is a named, immutable, serializable collection of `FieldSetEntry` objects rooted at a shape. Entries carry property paths, scoped filters, sub-selects, aggregations, evaluations, and preloads. All query information flows through FieldSet before reaching the IR pipeline.

**4. Direct FieldSet-to-desugar conversion.**
Phase 18 eliminated the `SelectPath` / `QueryPath` intermediate representation. `desugarSelectQuery()` accepts FieldSet entries directly via `RawSelectInput.entries`, removing the `fieldSetToSelectPath()` bridge that had been used as an intermediate step.

**5. Targeting via `.for()` / `.forAll()`.**
`.for(id)` sets a single subject (implies `singleResult`). `.forAll(ids?)` generates a `VALUES ?subject { ... }` clause for multi-ID filtering. Both accept `string | NodeReferenceValue`. Mutually exclusive — calling one clears the other.

**6. Mutation builders follow the same pattern.**
`CreateBuilder`, `UpdateBuilder`, `DeleteBuilder` are immutable, PromiseLike, and delegate to existing `MutationQueryFactory.convertUpdateObject()` for input normalization. `UpdateBuilder` requires `.for(id)` before execution (enforced at runtime with a guard).

**7. `toRawInput()` bridges to the existing pipeline.**
QueryBuilder produces `RawSelectInput` — the same structure the old proxy tracing produced. The existing `buildSelectQuery()` → IRDesugar → IRCanonicalize → IRLower → irToAlgebra chain is reused unchanged.

### Resolved Design Decisions

- **Scoped filter merging** — AND by default. OR support deferred.
- **Immutability implementation** — shallow clone with structural sharing deferred unless benchmarks show need.
- **SelectPath elimination** — Phase 18 implemented direct FieldSet-to-desugar conversion, removing the SelectPath roundtrip that was the last legacy bridge.
- **SubSelectResult elimination** — Phase 12 replaced the type-only `SubSelectResult` interface with `FieldSet<R, Source>` phantom generics, unifying runtime and type representations.

---

## 3. Public API Surface

### QueryBuilder

```ts
class QueryBuilder<S extends Shape, R, Result> implements PromiseLike<Result> {
  static from<S>(shape: ShapeConstructor<S> | NodeShape | string): QueryBuilder<S>;

  // Selection
  select<R>(fn: (p: ProxiedShape<S>) => R): QueryBuilder<S, R, QueryResponseToResultType<R, S>[]>;
  select(labels: string[]): QueryBuilder<S>;
  select(fieldSet: FieldSet): QueryBuilder<S>;
  selectAll(): QueryBuilder<S>;
  setFields(...): QueryBuilder<S, R, Result>;
  addFields(...): QueryBuilder<S, R, Result>;
  removeFields(labels: string[]): QueryBuilder<S, R, Result>;

  // Filtering
  where(fn: (p: ProxiedShape<S>) => Evaluation): QueryBuilder<S, R, Result>;

  // Ordering & pagination
  orderBy(fn: (p: ProxiedShape<S>) => any, direction?: 'asc' | 'desc'): QueryBuilder<S, R, Result>;
  sortBy(fn, direction?): QueryBuilder<S, R, Result>;  // alias
  limit(n: number): QueryBuilder<S, R, Result>;
  offset(n: number): QueryBuilder<S, R, Result>;

  // Targeting
  for(id: string | NodeReferenceValue): QueryBuilder<S, R, Result>;
  forAll(ids?: (string | NodeReferenceValue)[]): QueryBuilder<S, R, Result>;
  one(): QueryBuilder<S, R, /* unwrapped single result */>;

  // Preloading
  preload(path: string, component: QueryComponentLike): QueryBuilder<S, R, Result>;

  // Introspection
  fields(): FieldSet;
  build(): IRSelectQuery;

  // Execution
  exec(): Promise<Result>;
  then<T>(onFulfilled?, onRejected?): Promise<T>;

  // Serialization
  toJSON(): QueryBuilderJSON;
  static fromJSON(json: QueryBuilderJSON): QueryBuilder;
}
```

**Usage examples:**

```ts
// DSL (returns QueryBuilder)
const results = await Person.select(p => [p.name, p.friends.name]);

// Dynamic builder
const results = await QueryBuilder.from(Person)
  .select(p => [p.name, p.friends.select(f => ({ name: f.name, hobby: f.hobby }))])
  .where(p => p.name.equals('Alice'))
  .orderBy(p => p.name)
  .limit(10);

// String-based (runtime/CMS)
const results = await QueryBuilder.from('my:PersonShape')
  .select(['name', 'friends.name'])
  .limit(20);

// JSON round-trip
const json = builder.toJSON();
const restored = QueryBuilder.fromJSON(json);
```

### FieldSet

```ts
class FieldSet<R = any, Source = any> {
  readonly shape: NodeShape;
  readonly entries: readonly FieldSetEntry[];

  // Construction
  static for<S>(shape: ShapeConstructor<S>, fn: (p: ProxiedShape<S>) => R): FieldSet<R>;
  static for(shape: NodeShape | string, labels: string[]): FieldSet;
  static all(shape: ShapeConstructor | NodeShape | string, opts?: { depth?: number }): FieldSet;
  static merge(sets: FieldSet[]): FieldSet;

  // Composition (returns new FieldSet)
  select(fields): FieldSet;
  add(fields): FieldSet;
  remove(labels: string[]): FieldSet;
  set(fields): FieldSet;
  pick(labels: string[]): FieldSet;

  // Introspection
  paths(): PropertyPath[];
  labels(): string[];

  // Serialization
  toJSON(): FieldSetJSON;
  static fromJSON(json: FieldSetJSON): FieldSet;
}
```

**FieldSetEntry structure:**

```ts
type FieldSetEntry = {
  path: PropertyPath;
  alias?: string;
  scopedFilter?: WhereCondition;
  subSelect?: FieldSet;
  aggregation?: 'count';
  customKey?: string;
  evaluation?: { method: string; wherePath: any };
  preload?: { component: any; queryPaths: any[] };
};
```

### PropertyPath

```ts
class PropertyPath {
  readonly segments: PropertyShape[];
  readonly rootShape: NodeShape;

  prop(property: PropertyShape): PropertyPath;
  toString(): string;  // dot-separated labels

  // Where clause helpers (validated against sh:datatype)
  equals(value: any): WhereCondition;
  notEquals(value: any): WhereCondition;
  gt(value: any): WhereCondition;
  gte(value: any): WhereCondition;
  lt(value: any): WhereCondition;
  lte(value: any): WhereCondition;
  contains(value: string): WhereCondition;
}

function walkPropertyPath(shape: NodeShape, path: string): PropertyPath;
```

### Mutation Builders

```ts
class CreateBuilder<S> implements PromiseLike<CreateResponse> {
  static from<S>(shape: ShapeConstructor<S> | NodeShape | string): CreateBuilder<S>;
  set(data: UpdatePartial<S>): CreateBuilder<S>;
  withId(id: string): CreateBuilder<S>;
  build(): IRCreateMutation;
  exec(): Promise<CreateResponse>;
}

class UpdateBuilder<S> implements PromiseLike<UpdateResponse> {
  static from<S>(shape: ShapeConstructor<S> | NodeShape | string): UpdateBuilder<S>;
  set(data: UpdatePartial<S>): UpdateBuilder<S>;
  for(id: string | NodeReferenceValue): UpdateBuilder<S>;
  forAll(ids: (string | NodeReferenceValue)[]): UpdateBuilder<S>;
  build(): IRUpdateMutation;  // throws if .for() not called
  exec(): Promise<UpdateResponse>;
}

class DeleteBuilder<S> implements PromiseLike<DeleteResponse> {
  static from<S>(shape: ShapeConstructor<S>, ids?: NodeId | NodeId[]): DeleteBuilder<S>;
  for(ids: NodeId | NodeId[]): DeleteBuilder<S>;
  build(): IRDeleteMutation;  // throws if no IDs specified
  exec(): Promise<DeleteResponse>;
}
```

### ShapeConstructor Type

```ts
type ShapeConstructor<S extends Shape = Shape> = {
  new (...args: any[]): S;
  shape: NodeShape;
  targetClass: NamedNode;
};
```

Replaces the old `ShapeType<S>` which was typed as `typeof Shape` (abstract constructor), causing pervasive `as any` casts. `ShapeConstructor` is a concrete constructor type with `new` + static `shape`/`targetClass`, reducing cast count from ~44 to ~31.

### JSON Serialization

**QueryBuilderJSON:**

```json
{
  "shape": "my:PersonShape",
  "fields": [
    { "path": "name" },
    { "path": "friends.name" },
    { "path": "hobbies.label", "as": "hobby" }
  ],
  "where": [
    { "path": "address.city", "op": "=", "value": "Amsterdam" }
  ],
  "orderBy": [{ "path": "name", "direction": "asc" }],
  "limit": 20,
  "offset": 0
}
```

**FieldSetJSON:** Uses the same `shape` + `fields` subset with optional `subSelect`, `aggregation`, `customKey`, and `evaluation` on each field entry.

Shape and property identifiers use prefixed IRIs resolved through the existing prefix registry. `fromJSON()` resolves shapes via `getShapeClass()` and paths via `walkPropertyPath()`.

---

## 4. Breaking Changes (2.0 Release)

### 4.1. `Shape.select(id, callback)` removed

The two-argument form that took a subject ID and callback is removed.

**Migration:** Use `.for()` targeting:
```ts
// Before
const result = await Person.select(id, p => [p.name]);
// After
const result = await Person.select(p => [p.name]).for(id);
```

### 4.2. `Shape.update(id, data)` removed

The two-argument `Shape.update()` that took an ID and data object is removed.

**Migration:** Use `.for()` targeting:
```ts
// Before
await Person.update(id, { name: 'Alice' });
// After
await Person.update({ name: 'Alice' }).for(id);
```

### 4.3. `ShapeType` renamed to `ShapeConstructor`

The `ShapeType<S>` generic type is replaced by `ShapeConstructor<S>` with a concrete (non-abstract) constructor signature.

**Migration:** Replace all `ShapeType<S>` references with `ShapeConstructor<S>`. The new type has `new (...args: any[]): S` + `shape: NodeShape` + `targetClass: NamedNode`.

### 4.4. `QueryString`, `QueryNumber`, `QueryBoolean`, `QueryDate` removed

Four empty subclasses consolidated into `QueryPrimitive<T>`.

**Migration:** Replace `instanceof QueryString` etc. with `instanceof QueryPrimitive`. These classes were internal and not part of the public API, so external impact is minimal.

### 4.5. `SelectPath` IR types removed

The `SelectPath`, `QueryPath`, `PropertyQueryStep`, `SizeStep` intermediate representation types used between FieldSet and desugar are removed. FieldSet entries feed directly into `desugarSelectQuery()`.

**Migration:** Code that consumed `SelectPath` types should use `FieldSetEntry[]` instead. The `QueryStep`/`PropertyQueryStep`/`SizeStep` types remain only for where-clause and sort-path representation.

### 4.6. `getPackageShape()` return type now nullable

`getShapeClass()` (used for shape resolution by IRI string) may return `undefined` when no shape is registered for the given IRI.

**Migration:** Add null checks when calling `getShapeClass()` with dynamic strings.

### 4.7. `SelectQueryFactory` removed

The entire `SelectQueryFactory` class (~600 lines) is deleted, along with `PatchedQueryPromise`, `patchResultPromise()`, `LinkedWhereQuery`, and the `next-tick` dependency. `Shape.query()` method is also removed.

**Migration:**
- `Shape.select()` / `Shape.selectAll()` now return `QueryBuilder` (still PromiseLike, so `await` works unchanged)
- `Shape.create()` returns `CreateBuilder`, `.update()` returns `UpdateBuilder`, `.delete()` returns `DeleteBuilder`
- Replace `Person.query(fn)` with `QueryBuilder.from(Person).select(fn)`
- Replace `SelectQueryFactory` type references with `QueryBuilder`
- Code using `instanceof Promise` on DSL results will break (builders are PromiseLike, not Promise)

---

## 5. File Map

### New Files

| File | Role |
|------|------|
| `src/queries/QueryBuilder.ts` | Immutable fluent select query builder with PromiseLike execution, JSON serialization, and direct FieldSet-to-RawSelectInput conversion |
| `src/queries/FieldSet.ts` | Immutable composable field collection — the canonical query primitive. Handles callback tracing via ProxiedPathBuilder, sub-selects, aggregations, evaluations, preloads. Carries `<R, Source>` phantom generics for type inference |
| `src/queries/PropertyPath.ts` | PropertyPath value object (rootShape, segments, comparison helpers) + `walkPropertyPath()` for string-based path resolution |
| `src/queries/ProxiedPathBuilder.ts` | `createProxiedPathBuilder()` — shared proxy extracted from the old SelectQueryFactory, used by both DSL callbacks and dynamic builders |
| `src/queries/WhereCondition.ts` | `WhereCondition` type and `WhereOperator` enum |
| `src/queries/CreateBuilder.ts` | Immutable create mutation builder (from, set, withId, build, exec, PromiseLike) |
| `src/queries/UpdateBuilder.ts` | Immutable update mutation builder with `.for()` guard (from, set, for, forAll, build, exec, PromiseLike) |
| `src/queries/DeleteBuilder.ts` | Immutable delete mutation builder (from, build, exec, PromiseLike) |
| `src/queries/resolveShape.ts` | Shape resolution utility — resolves `ShapeConstructor | NodeShape | string` to a consistent shape reference |
| `src/tests/query-builder.test.ts` | QueryBuilder tests: immutability, IR equivalence with DSL, walkPropertyPath, forAll, preloads, direct IR generation |
| `src/tests/field-set.test.ts` | FieldSet tests: construction, composition, callback tracing, sub-select extraction, evaluation entries, preload entries, IR equivalence |
| `src/tests/mutation-builder.test.ts` | Mutation builder tests: create/update/delete IR equivalence, immutability, guards, PromiseLike |
| `src/tests/serialization.test.ts` | JSON serialization round-trip tests for FieldSet and QueryBuilder |
| `src/tests/query-builder.types.test.ts` | Compile-time type inference tests for QueryBuilder (mirrors `query.types.test.ts` patterns) |
| `src/tests/type-probe-4.4a.ts` | Type probe with `Expect<Equal<>>` assertions for QueryResponseToResultType through builder generics |

### Modified Files

| File | Changes |
|------|---------|
| `src/shapes/Shape.ts` | `.select()`, `.selectAll()` return `QueryBuilder`. `.create()`, `.update()`, `.delete()` return mutation builders. `.query()` removed. Imports switched from factories to builders. `ShapeType` replaced with `ShapeConstructor`. |
| `src/queries/SelectQuery.ts` | `SelectQueryFactory` class deleted (~600 lines). `QueryShape`, `QueryShapeSet`, `QueryBuilderObject` retained for proxy tracing. Sub-select handlers return lightweight FieldSet-based objects instead of factory instances. `processWhereClause()` uses `createProxiedPathBuilder` directly (no `LinkedWhereQuery`). Type utilities migrated to pattern-match on `QueryBuilder`/`FieldSet` instead of `SelectQueryFactory`/`SubSelectResult`. |
| `src/queries/IRDesugar.ts` | `desugarSelectQuery()` accepts `RawSelectInput.entries` (FieldSetEntry array) as direct input alongside legacy `select` path. `desugarFieldSetEntries()` converts FieldSet entries to desugared query steps. |
| `src/queries/MutationQuery.ts` | Input conversion functions (`convertUpdateObject`, `convertNodeReferences`, etc.) retained as standalone functions. Factory class simplified. |
| `src/queries/QueryFactory.ts` | Empty abstract `QueryFactory` class retained as marker. Type utilities (`UpdatePartial`, `SetModification`, `NodeReferenceValue`, etc.) unchanged. |
| `src/index.ts` | Exports `QueryBuilder`, `FieldSet`, `PropertyPath`, `walkPropertyPath`, `WhereCondition`, `WhereOperator`, `CreateBuilder`, `UpdateBuilder`, `DeleteBuilder`, `FieldSetJSON`, `FieldSetFieldJSON`, `QueryBuilderJSON`, `LinkedComponentInterface`, `QueryComponentLike`. Removed `nextTick` and `SelectQueryFactory` exports. |
| `src/utils/ShapeClass.ts` | `ensureShapeConstructor` cleaned up (commented body removed, passthrough stub retained). `getShapeClass` return type made nullable. |

### Unchanged Pipeline Files

| File | Role |
|------|------|
| `src/queries/IntermediateRepresentation.ts` | IR types (`IRSelectQuery`, `IRGraphPattern`, `IRExpression`, mutations) — unchanged |
| `src/queries/IRCanonicalize.ts` | WHERE expression normalization — unchanged |
| `src/queries/IRLower.ts` | Graph pattern and projection building — unchanged |
| `src/sparql/irToAlgebra.ts` | IR to SPARQL algebra conversion — unchanged |
| `src/sparql/algebraToString.ts` | SPARQL algebra to string — unchanged |

---

## 6. Test Coverage

**Final count: 629 passing tests across 22 test suites.**

| Test File | Coverage Area | Approx. Count |
|-----------|---------------|----------------|
| `query-builder.test.ts` | QueryBuilder immutability (7), IR equivalence with DSL (12), walkPropertyPath (5), shape resolution (2), PromiseLike (2), forAll (6), preloads, direct IR generation (8) | ~42 |
| `field-set.test.ts` | Construction (6), composition (8), nesting (2), QueryBuilder integration (2), extended entries, ShapeClass overloads, callback tracing with ProxiedPathBuilder (8), IR equivalence (4), sub-select extraction (4+), evaluation entries (5+), preload entries | ~45 |
| `mutation-builder.test.ts` | Create IR equivalence (3), update IR equivalence (5), delete IR equivalence (2), immutability (4), guards (2), PromiseLike (5) | ~22 |
| `serialization.test.ts` | FieldSet round-trip (5), QueryBuilder round-trip (8), extended serialization (subSelect, aggregation, customKey), forAll serialization, callback select serialization, orderDirection | ~20 |
| `query-builder.types.test.ts` | Compile-time type assertions: literal property, object property, multiple paths, date, boolean, sub-select, count, custom object, string path degradation, chaining preservation, `.one()` unwrap, `selectAll` | ~15 |
| `query.types.test.ts` | Original DSL type inference tests (50+ compile-time assertions) — all pass unchanged | ~50 |
| `ir-select-golden.test.ts` | Golden IR generation tests including nested sub-selects | existing |
| `sparql-select-golden.test.ts` | Golden SPARQL output tests (50+) | existing |
| `ir-mutation-parity.test.ts` | Mutation IR inline snapshots | existing |
| `sparql-mutation-golden.test.ts` | Mutation SPARQL output | existing |
| `sparql-mutation-algebra.test.ts` | Mutation algebra tests | existing |
| Other test files | Core utils, IR desugar, projection, canonicalize, alias scope, metadata, algebra, result mapping, negative tests, serialization, store routing, fuseki integration | existing |

All existing tests pass without modification. No test was deleted or weakened.

---

## 7. Known Limitations & Deferred Work

### Remaining `as any` Casts

~31 `as any` casts remain in production code, down from ~44. The largest clusters are in `Shape.ts` (static method factory bridging where `this` type doesn't align with `ShapeConstructor`) and `SelectQuery.ts` (proxy construction, generic coercion). These are inherent to the proxy/dynamic pattern and would require deeper type system work to eliminate.

### `traceFieldsFromCallback` Fallback

The old simple proxy fallback in `FieldSet.ts` still exists for NodeShape-only paths where no `ShapeClass` can be resolved. The `ProxiedPathBuilder` is the primary path for all ShapeClass-aware construction.

### CreateQResult Type Complexity

`CreateQResult` (SelectQuery.ts) has 12+ levels of conditional nesting with recursive self-calls. Deferred to a separate effort (`docs/ideas/011-query-type-system-refactor.md`) because the types are stable and well-tested by type probes. Risk of silently breaking inference outweighs readability benefit.

### Type Inference Scope

Result type inference only works when `QueryBuilder.from(ShapeClass)` receives a TypeScript class. When using a string IRI (`QueryBuilder.from('my:PersonShape')`), `S` defaults to `Shape` and result types degrade to `any`. This is by design — the string path is for runtime/CMS use where types are not known at compile time.

### Deferred Features

| Item | Status |
|------|--------|
| Callback-style mutation updates | See `docs/ideas/006-computed-expressions-and-update-functions.md` |
| Scoped filter OR support | AND-only. OR deferred until needed in practice. |
| Shared variable bindings / `.as()` activation | See `docs/ideas/008-shared-variable-bindings.md` |
| Shape remapping / ShapeAdapter | See `docs/ideas/009-shape-remapping.md` |
| Computed expressions / L module | See `docs/ideas/006-computed-expressions-and-update-functions.md` |
| Result typing + CreateQResult refactor | See `docs/ideas/011-query-type-system-refactor.md` |
| CONSTRUCT / MINUS query types | See `docs/ideas/004-sparql-construct-support.md`, `007-advanced-query-patterns.md` |

---

## 8. Related Documentation

| Document | Path |
|----------|------|
| Implementation plan (removed) | was `docs/plans/001-dynamic-queries.md` |
| Dispatch registry report | `docs/reports/007-dispatch-registry-break-circular-deps.md` |
| Nested sub-select IR report | `docs/reports/006-nested-subselect-ir-completeness.md` |
| IR refactoring report | `docs/reports/003-ir-refactoring.md` |
| Type system refactor ideas | `docs/ideas/011-query-type-system-refactor.md` |
