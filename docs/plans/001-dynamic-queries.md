---
summary: Implement FieldSet, QueryBuilder, and DSL alignment for dynamic query construction.
source: 003-dynamic-ir-construction
packages: [core]
---

# Plan: Dynamic Queries (FieldSet + QueryBuilder + DSL alignment)

## Goal

Replace the mutable `SelectQueryFactory` + `PatchedQueryPromise` + `nextTick` system with an immutable `QueryBuilder` + `FieldSet` architecture. Align mutation operations (`create`, `update`, `delete`) to the same immutable builder pattern. The DSL (`Person.select(...)`, `Person.create(...)`, etc.) becomes sugar over builders. A new public API enables CMS-style runtime query building.

---

## Architecture Decisions

### 1. DSL and QueryBuilder are the same system

The DSL is syntactic sugar. Both paths produce the same `RawSelectInput` and feed through the same IR pipeline:

```
Person.select(p => [p.name])       →  QueryBuilder internally  →  toRawInput()  →  buildSelectQuery()  →  SPARQL
QueryBuilder.from(PersonShape).select(p => [p.name])  →  same path
```

One shared `ProxiedPathBuilder` proxy implementation. No separate codepaths.

### 2. Immutable builders, PromiseLike execution

- Every `.where()`, `.select()`, `.setFields()`, `.addFields()`, `.limit()`, etc. returns a **new** QueryBuilder (shallow clone).
- `QueryBuilder implements PromiseLike<ResultRow[]>` — `await` triggers execution.
- No more `nextTick`. No more mutable `PatchedQueryPromise`.
- `.exec()` available for explicit execution without `await`.

### 3. Method naming

| Operation | FieldSet | QueryBuilder |
|---|---|---|
| Initial selection | — | `.select(fields)` |
| Replace all | `.set(fields)` | `.setFields(fields)` |
| Add to existing | `.add(fields)` | `.addFields(fields)` |
| Remove | `.remove(fields)` | `.removeFields(fields)` |
| Keep only | `.pick(fields)` | — |
| Union | `FieldSet.merge([...])` | — |

### 4. Targeting: `.for()` / `.forAll()`

- `.for(id)` — single ID (implies singleResult)
- `.forAll(ids?)` — specific list or all instances (no args)
- **Update requires targeting** — `Person.update({...})` without `.for()`/`.forAll()` is a type error.
- **Delete takes id directly** — `Person.delete(id)`, `Person.deleteAll(ids?)`.
- All targeting methods accept `string | NodeReferenceValue` (i.e. an IRI string or `{id: string}`). Bulk variants (`.forAll()`, `.deleteAll()`) accept arrays of either form. This supports both raw IRIs and node references from query results.

### 5. Mutation builders: same pattern as QueryBuilder

The existing mutation classes (`CreateQueryFactory`, `UpdateQueryFactory`, `DeleteQueryFactory`) are mutable, imperative, and not composable. They get replaced with immutable builders that follow the same pattern as QueryBuilder:

- `Person.create({name: 'Alice'})` → `CreateBuilder` → `await` / `.exec()`
- `Person.update({name: 'Alice'}).for(id)` → `UpdateBuilder` → `await` / `.exec()`
- `Person.delete(id)` → `DeleteBuilder` → `await` / `.exec()`
- `Person.deleteAll(ids?)` → `DeleteBuilder` → `await` / `.exec()`

All builders are immutable (each method returns a new instance) and implement `PromiseLike` for `await`-based execution.

**Create** doesn't need targeting (it creates a new node). **Update requires targeting** — `.for(id)` or `.forAll(ids)` must be called before execution, enforced at the type level. **Delete takes ids directly** at construction.

The builders delegate to the existing `MutationQueryFactory.convertUpdateObject()` for input normalization, and produce the same `IRCreateMutation` / `IRUpdateMutation` / `IRDeleteMutation` that feeds into `irToAlgebra`.

### 6. FieldSet as the composable primitive

FieldSet is a named, immutable, serializable collection of property paths rooted at a shape. It supports:
- Construction: `FieldSet.for(shape, fields)`, `FieldSet.for(shape).select(fields)`, `FieldSet.all(shape)`, callback form with proxy
- Composition: `.add()`, `.remove()`, `.set()`, `.pick()`, `FieldSet.merge()`
- Scoped filters: conditions that attach to a specific traversal
- Serialization: `.toJSON()` / `FieldSet.fromJSON()`
- Nesting: `{ friends: personSummary }` and `{ hobbies: ['label', 'description'] }`

### 7. Bridge to existing pipeline: `toRawInput()`

QueryBuilder produces `RawSelectInput` — the same structure proxy tracing produces. No new pipeline stages needed. The existing `buildSelectQuery()` → IRDesugar → IRCanonicalize → IRLower → irToAlgebra chain is reused as-is.

---

## Inter-Component Contracts

### PropertyPath (value object)

```ts
class PropertyPath {
  readonly segments: PropertyShape[];  // each segment is one property traversal hop
  readonly rootShape: NodeShape;
  readonly bindingName?: string;     // reserved for 008

  prop(property: PropertyShape): PropertyPath;
  as(name: string): PropertyPath;
  matches(name: string): PropertyPath;

  // Where clause helpers — validated against sh:datatype of the terminal property
  // (boolean: only equals/notEquals, numeric/date: all comparisons, string: equals/notEquals/contains)
  equals(value: any): WhereCondition;
  notEquals(value: any): WhereCondition;
  gt(value: any): WhereCondition;
  gte(value: any): WhereCondition;
  lt(value: any): WhereCondition;
  lte(value: any): WhereCondition;
  contains(value: string): WhereCondition;

  // Sub-selection
  select(fn: (p: ProxiedPathBuilder) => FieldSetInput[]): FieldSetInput;
  select(fields: FieldSetInput[]): FieldSetInput;
}
```

### ProxiedPathBuilder (shared proxy)

```ts
// The `p` in callbacks — same proxy used by DSL and dynamic builders.
// Property access (p.name, p.friends) creates PropertyPaths via Proxy handler.
class ProxiedPathBuilder {
  constructor(rootShape: NodeShape);

  // Escape hatch for dynamic/runtime strings — resolves via walkPropertyPath
  path(input: string | PropertyShape): PropertyPath;

  // Property access via Proxy handler: p.name → PropertyPath for 'name'
  // p.friends.name → PropertyPath with segments [friendsProp, nameProp]
}
```

### walkPropertyPath (utility function)

```ts
function walkPropertyPath(shape: NodeShape, path: string): PropertyPath;
// 'friends.name' → resolves via NodeShape.getPropertyShape(label) + PropertyShape.valueShape walking
// Throws on invalid path segments
```

### FieldSet

```ts
class FieldSet {
  readonly shape: NodeShape;
  readonly entries: FieldSetEntry[];

  static for(shape: NodeShape | string, fields: FieldSetInput[]): FieldSet;
  static for(shape: NodeShape | string, fn: (p: ProxiedPathBuilder) => FieldSetInput[]): FieldSet;
  static for(shape: NodeShape | string): FieldSetBuilder;  // chained: FieldSet.for(shape).select(fields)
  static all(shape: NodeShape | string, opts?: { depth?: number }): FieldSet;
  static merge(sets: FieldSet[]): FieldSet;

  select(fields: FieldSetInput[]): FieldSet;
  select(fn: (p: ProxiedPathBuilder) => FieldSetInput[]): FieldSet;
  add(fields: FieldSetInput[]): FieldSet;
  remove(fields: string[]): FieldSet;
  set(fields: FieldSetInput[]): FieldSet;
  pick(fields: string[]): FieldSet;

  paths(): PropertyPath[];
  labels(): string[];
  toJSON(): FieldSetJSON;
  static fromJSON(json: FieldSetJSON): FieldSet;
}

type FieldSetInput =
  | string | PropertyShape | PropertyPath | FieldSet
  | ScopedFieldEntry
  | Record<string, FieldSetInput[] | FieldSet>;

type FieldSetEntry = {
  path: PropertyPath;
  alias?: string;
  scopedFilter?: WhereCondition;
  bindingName?: string;              // reserved for 008
};
```

### QueryBuilder

```ts
class QueryBuilder implements PromiseLike<ResultRow[]> {
  // string form resolves via shape registry (prefixed IRI or label)
  static from(shape: NodeShape | string): QueryBuilder;

  select(fields: FieldSet | FieldSetInput[] | ((p: ProxiedPathBuilder) => FieldSetInput[])): QueryBuilder;
  setFields(fields: ...same...): QueryBuilder;
  addFields(fields: ...same...): QueryBuilder;
  removeFields(fields: string[]): QueryBuilder;

  where(fn: (p: ProxiedPathBuilder) => WhereCondition): QueryBuilder;
  where(path: string, op: string, value: any): QueryBuilder;

  orderBy(path: string, direction?: 'asc' | 'desc'): QueryBuilder;
  limit(n: number): QueryBuilder;
  offset(n: number): QueryBuilder;

  for(id: string | NodeReferenceValue): QueryBuilder;
  forAll(ids?: (string | NodeReferenceValue)[]): QueryBuilder;

  fields(): FieldSet;
  build(): IRSelectQuery;
  exec(): Promise<ResultRow[]>;
  then<T>(onFulfilled?, onRejected?): Promise<T>;

  toJSON(): QueryBuilderJSON;
  static fromJSON(json: QueryBuilderJSON, shapeRegistry: ShapeRegistry): QueryBuilder;
}
```

### QueryBuilder ↔ Pipeline bridge

```ts
// Inside QueryBuilder — not public
private toRawInput(): RawSelectInput {
  // Converts FieldSet entries → QueryPath[] (same as proxy tracing output)
  // Converts WhereCondition[] → where path structure
  // Passes through to existing buildSelectQuery()
}
```

### CreateBuilder

```ts
class CreateBuilder<S> implements PromiseLike<CreateResponse> {
  static from(shape: NodeShape | string): CreateBuilder;

  set(data: UpdatePartial<S> | ((p: ProxiedPathBuilder) => UpdatePartial<S>)): CreateBuilder<S>;
  withId(id: string): CreateBuilder<S>;   // optional: pre-assign id for the new node
  // Note: __id in data object is also supported (existing behavior): Person.create({__id: 'x', name: 'Alice'})

  build(): IRCreateMutation;
  exec(): Promise<CreateResponse>;
  then<T>(onFulfilled?, onRejected?): Promise<T>;
}
```

### UpdateBuilder

```ts
class UpdateBuilder<S> implements PromiseLike<UpdateResponse> {
  static from(shape: NodeShape | string): UpdateBuilder;

  set(data: UpdatePartial<S> | ((p: ProxiedPathBuilder) => UpdatePartial<S>)): UpdateBuilder<S>;
  for(id: string | NodeReferenceValue): UpdateBuilder<S>;
  forAll(ids: (string | NodeReferenceValue)[]): UpdateBuilder<S>;

  build(): IRUpdateMutation;
  exec(): Promise<UpdateResponse>;
  then<T>(onFulfilled?, onRejected?): Promise<T>;
}
```

### DeleteBuilder

```ts
class DeleteBuilder implements PromiseLike<DeleteResponse> {
  static from(shape: NodeShape | string, ids: (string | NodeReferenceValue) | (string | NodeReferenceValue)[]): DeleteBuilder;

  build(): IRDeleteMutation;
  exec(): Promise<DeleteResponse>;
  then<T>(onFulfilled?, onRejected?): Promise<T>;
}
```

### Mutation builders ↔ Pipeline bridge

```ts
// Inside mutation builders — not public
// Reuse MutationQueryFactory.convertUpdateObject() for input normalization
// Produce IRCreateMutation / IRUpdateMutation / IRDeleteMutation
// Feed into existing createToAlgebra() / updateToAlgebra() / deleteToAlgebra()
```

### Serialization format

Shape and property identifiers use prefixed IRIs (resolved through existing prefix registry). Unprefixed strings resolve as property labels on the base shape.

**QueryBuilder.toJSON():**
```json
{
  "shape": "my:PersonShape",
  "fields": [
    { "path": "name" },
    { "path": "friends.name" },
    { "path": "hobbies.label", "as": "hobby" }
  ],
  "where": [
    { "path": "address.city", "op": "=", "value": "Amsterdam" },
    { "path": "age", "op": ">=", "value": 18 }
  ],
  "orderBy": [{ "path": "name", "direction": "asc" }],
  "limit": 20,
  "offset": 0
}
```

**FieldSet.toJSON()** uses the same `shape` + `fields` subset. `FieldSet.fromJSON()` and `QueryBuilder.fromJSON(json, shapeRegistry)` resolve prefixed IRIs back to NodeShape/PropertyShape references.

---

## Files Expected to Change

### New files
- `src/queries/PropertyPath.ts` — PropertyPath value object + walkPropertyPath utility
- `src/queries/ProxiedPathBuilder.ts` — Shared proxy extracted from SelectQuery.ts (used by DSL and builders)
- `src/queries/FieldSet.ts` — FieldSet class
- `src/queries/QueryBuilder.ts` — QueryBuilder class
- `src/queries/WhereCondition.ts` — WhereCondition type + comparison helpers (may be extracted from existing code)
- `src/tests/field-set.test.ts` — FieldSet composition, merging, scoped filters, serialization
- `src/tests/query-builder.test.ts` — QueryBuilder chain, immutability, IR output equivalence
- `src/queries/CreateBuilder.ts` — CreateBuilder class (replaces CreateQueryFactory)
- `src/queries/UpdateBuilder.ts` — UpdateBuilder class (replaces UpdateQueryFactory)
- `src/queries/DeleteBuilder.ts` — DeleteBuilder class (replaces DeleteQueryFactory)
- `src/tests/mutation-builder.test.ts` — Mutation builder tests (create, update, delete)

### Modified files
- `src/queries/SelectQuery.ts` (~72 KB, ~2100 lines) — Largest change. Contains `SelectQueryFactory`, `QueryShape`, `QueryShapeSet`, `QueryBuilderObject`, proxy handlers (lines ~1018, ~1286, ~1309). Refactor to delegate to QueryBuilder internally. `PatchedQueryPromise` replaced. Proxy creation extracted into shared `ProxiedPathBuilder`.
- `src/queries/QueryFactory.ts` (~5.5 KB) — Currently contains an empty `abstract class QueryFactory` (extended by `SelectQueryFactory` and `MutationQueryFactory` as a marker) plus mutation-related type utilities (`UpdatePartial`, `SetModification`, `NodeReferenceValue`, etc.) imported by ~10 files. The empty abstract class should be removed (QueryBuilder replaces it). The types stay; file may be renamed to `MutationTypes.ts` later.
- `src/queries/IRDesugar.ts` (~12 KB) — Owns `RawSelectInput` type definition (lines ~22-31). Type may need extension if QueryBuilder adds new fields. Also defines `DesugaredSelectQuery` and step types.
- `src/queries/IRPipeline.ts` (~1 KB) — Orchestrates desugar → canonicalize → lower. May need minor adjustments if `buildSelectQuery` input types change.
- `src/queries/MutationQuery.ts` — `MutationQueryFactory` input normalization logic (`convertUpdateObject`, `convertNodeReferences`, etc.) to be extracted/reused by new builders. The factory class itself is replaced.
- `src/queries/CreateQuery.ts` — `CreateQueryFactory` replaced by `CreateBuilder`. Input conversion logic reused.
- `src/queries/UpdateQuery.ts` — `UpdateQueryFactory` replaced by `UpdateBuilder`. Input conversion logic reused.
- `src/queries/DeleteQuery.ts` — `DeleteQueryFactory` replaced by `DeleteBuilder`. Input conversion logic reused.
- `src/shapes/Shape.ts` — Update `Shape.select()` (line ~125), `Shape.query()` (line ~95), `Shape.selectAll()` (line ~211) to return QueryBuilder. Update `Shape.create()`, `Shape.update()`, `Shape.delete()` to return mutation builders. Add `.for()`, `.forAll()`, `.deleteAll()` with consistent id types.
- `src/index.ts` — Export new public API (`QueryBuilder`, `FieldSet`, `PropertyPath`, `CreateBuilder`, `UpdateBuilder`, `DeleteBuilder`) alongside existing namespace.

### Existing pipeline (no changes expected)
- `src/queries/IntermediateRepresentation.ts` (~6.7 KB) — IR types stay as-is (`IRSelectQuery`, `IRGraphPattern`, `IRExpression`, mutations)
- `src/queries/IRCanonicalize.ts` (~5 KB) — no changes (normalizes WHERE expressions)
- `src/queries/IRLower.ts` (~11 KB) — no changes (builds graph patterns and projections)
- `src/sparql/irToAlgebra.ts` (~37 KB) — no changes (IR → SPARQL algebra)
- `src/sparql/algebraToString.ts` (~12 KB) — no changes (algebra → SPARQL string)

### Supporting files (reference, may need minor touches)
- `src/queries/IRProjection.ts` (~4.3 KB) — Result mapping and projection extraction
- `src/queries/IRAliasScope.ts` (~1.7 KB) — Alias scope management for IR variables
- `src/utils/ShapeClass.ts` (~10.6 KB) — Shape metadata and property shape utilities
- `src/queries/QueryContext.ts` (~1.3 KB) — Query execution context

### Existing tests (must pass after refactor)
- `src/tests/ir-select-golden.test.ts` — Golden tests for full IR generation
- `src/tests/sparql-select-golden.test.ts` — Golden tests for SPARQL output
- `src/tests/query.types.test.ts` — Compile-time type inference tests
- `src/test-helpers/query-fixtures.ts` — Test shapes (Person, Dog, Pet) and query factory builders

---

## Potential Pitfalls

1. **SelectQueryFactory complexity** — It's ~2100 lines / 72 KB with 4 interrelated classes (`SelectQueryFactory`, `QueryShape`, `QueryShapeSet`, `QueryBuilderObject`) and complex proxy tracing with mutable state. Refactoring it to use QueryBuilder internally without breaking existing behavior is the highest-risk change. Strategy: keep old code paths working alongside new ones initially, validate with existing golden tests (`ir-select-golden.test.ts`, `sparql-select-golden.test.ts`), then swap.

2. **ProxiedPathBuilder extraction** — The proxy is currently embedded in SelectQueryFactory. Extracting it into a shared module that both the DSL and QueryBuilder use requires understanding all proxy trap behaviors and edge cases (`.select()` for sub-selection, `.where()` for scoped filters, `.as()` for bindings, `.path()` escape hatch).

3. **Scoped filter representation** — FieldSet entries can carry scoped filters. These must be correctly lowered into `IRTraversePattern.filter` fields. The existing proxy-based scoped `.where()` already does this — need to ensure the FieldSet path produces identical IR.

4. **String path resolution** — `walkPropertyPath('friends.name')` must walk `NodeShape.getPropertyShape('friends')` → get valueShape → `getPropertyShape('name')`. Need to handle cases where property labels are ambiguous or the valueShape isn't a NodeShape.

---

## Open Questions (remaining from ideation)

1. **Scoped filter merging** — When two FieldSets have scoped filters on the same traversal and are merged, AND is the default. If merging detects potential conflicts (e.g. same property with contradictory equality filters), log a warning. OR support and more sophisticated conflict resolution are deferred to when this actually comes up in practice.

2. **Immutability implementation** — Shallow clone is sufficient for typical queries. Structural sharing deferred unless benchmarks show need.

## Future work (noted, not in scope)

- **Result typing** — Dynamic queries use generic `ResultRow` type for now. Potential future addition: `QueryBuilder.from<T>(shape)` type parameter for static result typing.
- **Raw IR helpers** (Option A from ideation) — `ir.select()`, `ir.shapeScan()`, `ir.traverse()` etc. for power-user direct IR construction.
- **Desugar pass: accept FieldSet directly** — Currently the pipeline is `FieldSet → fieldSetToSelectPath() → SelectPath → RawSelectInput → desugarSelectQuery() → IRSelectQuery`. The `SelectPath` format (arrays of `QueryStep`, `SizeStep`, `CustomQueryObject`, etc.) is the old IR representation from `SelectQueryFactory`. `fieldSetToSelectPath()` is a translation layer that converts FieldSet's clean data model (PropertyPath, entries with aggregation/subSelect/evaluation/preload) into this old format, only for `desugarSelectQuery()` to parse it back out. A future phase should modify `desugarSelectQuery()` (in `IRDesugar.ts`) to accept `FieldSet` directly, collapsing the pipeline to `FieldSet → desugarSelectQuery(fieldSet) → IRSelectQuery` and eliminating the `fieldSetToSelectPath()` bridge and the `SelectPath`/`QueryStep`/`SizeStep` intermediate types.

---

## Implementation Phases

Top-down approach: tackle the riskiest refactor first (ProxiedPathBuilder extraction from the 72KB SelectQuery.ts), then build new APIs on the clean foundation. Existing golden tests (IR + SPARQL) act as the safety net throughout.

### Global test invariants

1. **All existing tests must pass after every phase.** The 477+ currently passing tests (18 suites) are the regression safety net. This includes golden IR tests, golden SPARQL tests, type inference tests, mutation parity tests, and algebra tests. No existing test may be deleted or weakened — only extended.
2. **Full test coverage for all new code.** Every new public class and function gets dedicated tests covering: construction, core API behavior, immutability guarantees, edge cases (empty inputs, invalid inputs, missing values), and IR equivalence against the existing DSL where applicable.
3. **Fuseki integration tests** are environment-dependent (skipped when Fuseki is unavailable). They must not be broken but are not required to run in CI. The SPARQL pipeline (irToAlgebra, algebraToString) is untouched, so these tests remain valid.
4. **Type-checking** via `npx tsc --noEmit` must pass with zero errors after every phase.

### Dependency graph

```
Phase 1 (done)
    ↓
Phase 2 (done)
    ↓
Phase 3a (done)  ←→  Phase 3b (done)   [parallel after Phase 2]
    ↓                         ↓
Phase 4 (done)       [after 3a and 3b]
    ↓
Phase 5 (done)       [after 4.4a and 3a — preloadFor + component integration]
    ↓
Phase 6 (done)       [forAll multi-ID — independent, small, quick win]
    ↓
Phase 7 (done)       [unified callback tracing — THE foundational refactor]
  7a: Extend FieldSetEntry data model (done)
    ↓
  7b: FieldSet.for() accepts ShapeClass + NodeShape overloads (done)
    ↓
  7c: Replace traceFieldsFromCallback with ProxiedPathBuilder (done)
    ↓
  7d: toJSON for callback-based selections + orderDirection fix (done)
    ↓
  7e: Typed FieldSet<R> — carry callback return type (done)
    ↓
Phase 8 (done)       [QueryBuilder direct IR — bypass SelectQueryFactory]
    ↓
Phase 9 (done)       [sub-queries through FieldSet — DSL proxy produces FieldSets]
    ↓
Phase 10 (done)      [remove SelectQueryFactory]
    ↓
Phase 11 (mostly done) [hardening — API cleanup, reviewed item by item]
```

---

### Phase 1 — ProxiedPathBuilder extraction + DSL rewire ✅

**Status: Complete.**

Extracted `createProxiedPathBuilder()` from `SelectQueryFactory.getQueryShape()` into `src/queries/ProxiedPathBuilder.ts`. Created `PropertyPath` value object and `WhereCondition` type as foundations. All 477 tests pass, zero behavioral changes.

**Files delivered:**
- `src/queries/ProxiedPathBuilder.ts` — `createProxiedPathBuilder()` function
- `src/queries/PropertyPath.ts` — PropertyPath value object (rootShape, segments, prop, equals, toString)
- `src/queries/WhereCondition.ts` — WhereCondition type and WhereOperator
- Modified `src/queries/SelectQuery.ts` — `getQueryShape()` delegates to `createProxiedPathBuilder()`

---

### Phase 2 — QueryBuilder (select queries) ✅

**Status: Complete.**

Built `QueryBuilder` as an immutable, fluent, PromiseLike query builder on top of `SelectQueryFactory`. Added `walkPropertyPath()` for string-based path resolution. All 28 new tests + 477 existing tests pass (505 total). IR equivalence verified for 12 query patterns.

**Files delivered:**
- `src/queries/QueryBuilder.ts` — Immutable QueryBuilder class (from, select, selectAll, where, orderBy/sortBy, limit, offset, for, forAll, one, build, exec, PromiseLike)
- `src/queries/PropertyPath.ts` — Added `walkPropertyPath(shape, path)` for dot-separated path resolution
- `src/tests/query-builder.test.ts` — 28 tests: immutability (7), IR equivalence (12), walkPropertyPath (5), shape resolution (2), PromiseLike (2)
- `jest.config.js` — Added `query-builder.test.ts` to testMatch
- `src/index.ts` — Exports `QueryBuilder`, `PropertyPath`, `walkPropertyPath`, `WhereCondition`, `WhereOperator`

**Deferred to Phase 4:**
- Tasks 2.3/2.4 (rewiring `Shape.select()`/`selectAll()` to return `QueryBuilder`, deprecating `SelectQueryFactory` public surface) require threading result types through QueryBuilder generics. The existing DSL uses complex conditional types (`QueryResponseToResultType`, `GetQueryResponseType`) that `QueryBuilder.then()` currently erases to `any`. This is a type-system concern that should be addressed alongside FieldSet and serialization in Phase 4.

#### Tasks

**2.1 — Add `walkPropertyPath` to PropertyPath.ts**
- Implement `walkPropertyPath(shape: NodeShape, path: string): PropertyPath`
- Resolve dot-separated labels: `'friends.name'` → walk `NodeShape.getPropertyShapes(true)` by label → follow `PropertyShape.valueShape` → `getShapeClass(valueShape).shape.getPropertyShapes(true)` → match next label
- Throw on invalid segments, missing valueShape, or non-NodeShape intermediates

**2.2 — Create `QueryBuilder.ts`**
- Immutable class: every method (`.select()`, `.where()`, `.limit()`, `.offset()`, `.orderBy()`, `.for()`, `.forAll()`) returns a new shallow-cloned instance
- `static from(shape: NodeShape | ShapeType | string): QueryBuilder` — accepts NodeShape, shape class, or prefixed IRI string (resolved via `getShapeClass()`)
- `.select(fn)` — accepts callback `(p) => [...]` using `createProxiedPathBuilder()`, stores trace response
- `.select(fields)` — accepts `string[]` (resolved via `walkPropertyPath`)
- `.where(fn)` — accepts callback producing `Evaluation` (reuses existing `processWhereClause` / `LinkedWhereQuery`)
- `.for(id)` — sets subject + singleResult, accepts `string | NodeReferenceValue`
- `.forAll(ids?)` — sets subject for multiple or all, accepts `(string | NodeReferenceValue)[]`
- `.orderBy(fn, direction?)` — stores sort trace
- `.limit(n)`, `.offset(n)` — store pagination
- `.build(): IRSelectQuery` — calls `toRawInput()` → `buildSelectQuery()`
- `.exec(): Promise<ResultRow[]>` — calls `getQueryDispatch().selectQuery(this.build())`
- `implements PromiseLike` — `.then()` delegates to `.exec()`
- Private `toRawInput(): RawSelectInput` — converts internal state to the same `RawSelectInput` that `SelectQueryFactory.toRawInput()` produces (same shape: `{ select, subject, limit, offset, shape, sortBy, singleResult, where }`)

**2.3 — Rewire `Shape.select()`, `.selectAll()`, `.query()` in Shape.ts**
- `Shape.select(fn)` and `Shape.select(subject, fn)` return `QueryBuilder` instead of patched Promise
- `Shape.selectAll()` returns `QueryBuilder` using `FieldSet.all()` (or interim: build labels from `getUniquePropertyShapes`)
- `Shape.query(fn)` returns `QueryBuilder` (template, not executed)
- Remove `nextTick` import and the `new Promise` + `nextTick` wrapping in `Shape.select()`
- Remove `PatchedQueryPromise` usage — QueryBuilder's immutable `.where()`, `.limit()`, `.sortBy()`, `.one()` replace it
- Keep backward compatibility: chaining `.where().limit().sortBy()` on the result of `Shape.select()` must still work (QueryBuilder supports all these)

**2.4 — Deprecate `SelectQueryFactory` public surface**
- `SelectQueryFactory` stays as an internal class (still used by `QueryShape.select()`, `QueryShapeSet.select()` for sub-queries)
- Remove `patchResultPromise()` method
- Remove `onQueriesReady` / DOMContentLoaded logic (was for browser bundle lazy init — QueryBuilder's PromiseLike model doesn't need it)
- Mark `SelectQueryFactory` as `@internal` — not part of public API

**2.5 — Update `src/index.ts` exports**
- Export `QueryBuilder` from `src/queries/QueryBuilder.ts`
- Export `PropertyPath` and `walkPropertyPath` from `src/queries/PropertyPath.ts`
- Keep existing exports for backward compatibility during transition

#### Validation — `src/tests/query-builder.test.ts`

**Immutability tests:**
- `immutability — .where() returns new instance`: Create builder, call `.where()`, assert original and result are different objects, assert original has no where clause
- `immutability — .limit() returns new instance`: Same pattern for `.limit(10)`
- `immutability — .select() returns new instance`: Same pattern for `.select(fn)`
- `immutability — chaining preserves prior state`: `b1 = from(Person)`, `b2 = b1.limit(5)`, `b3 = b1.limit(10)`, assert b2 and b3 have different limits, b1 has no limit

**IR equivalence tests (must produce identical IR as existing DSL):**
Use `buildSelectQuery()` on both `SelectQueryFactory.toRawInput()` and `QueryBuilder.toRawInput()` for each fixture, assert deep equality on the resulting `IRSelectQuery`.
- `selectName` — `QueryBuilder.from(Person).select(p => p.name)` vs `Person.select(p => p.name)` golden IR
- `selectMultiplePaths` — `QueryBuilder.from(Person).select(p => [p.name, p.friends, p.bestFriend.name])`
- `selectFriendsName` — `QueryBuilder.from(Person).select(p => p.friends.name)`
- `selectDeepNested` — `QueryBuilder.from(Person).select(p => p.friends.bestFriend.bestFriend.name)`
- `whereFriendsNameEquals` — `.select(p => p.friends.where(f => f.name.equals('Moa')))`
- `whereAnd` — `.select(p => p.friends.where(f => f.name.equals('Moa').and(f.hobby.equals('Jogging'))))`
- `selectById` — `.select(p => p.name).for(entity('p1'))`
- `outerWhereLimit` — `.select(p => p.name).where(p => p.name.equals('Semmy').or(p.name.equals('Moa'))).limit(1)`
- `sortByAsc` — `.select(p => p.name).orderBy(p => p.name)`
- `countFriends` — `.select(p => p.friends.size())`
- `subSelectPluralCustom` — `.select(p => p.friends.select(f => ({name: f.name, hobby: f.hobby})))`
- `selectAllProperties` — `QueryBuilder.from(Person).selectAll()` vs `Person.selectAll()`

**String path resolution tests:**
- `walkPropertyPath — single segment`: `walkPropertyPath(Person.shape, 'name')` — assert segments length 1, terminal label `'name'`
- `walkPropertyPath — nested segments`: `walkPropertyPath(Person.shape, 'friends.name')` — assert segments length 2
- `walkPropertyPath — invalid segment throws`: `walkPropertyPath(Person.shape, 'nonexistent')` — assert throws

**Shape resolution test:**
- `from() with string`: `QueryBuilder.from(Person.shape.id)` — assert build does not throw and produces valid IR

**PromiseLike test:**
- `then() triggers execution`: assert `QueryBuilder.from(Person).select(p => p.name)` is thenable (has `.then` method)

**Existing test regression:**
- `npx tsc --noEmit` exits 0
- `npm test` — all existing 477+ tests pass

---

### Phase 3a — FieldSet ✅

**Status: Complete.**

Built `FieldSet` as an immutable, composable collection of PropertyPaths. Integrated with QueryBuilder via `.select(fieldSet)` and `.fields()`. 17 new tests covering construction, composition, nesting, and QueryBuilder integration.

**Files delivered:**
- `src/queries/FieldSet.ts` — FieldSet class (for, all, merge, select, add, remove, set, pick, paths, labels, toJSON, fromJSON)
- `src/tests/field-set.test.ts` — 17 tests: construction (6), composition (8), nesting (2), QueryBuilder integration (2)
- Modified `src/queries/QueryBuilder.ts` — Added `.select(fieldSet)` overload, `.fields()`, FieldSet state tracking

**Depends on:** Phase 2 (QueryBuilder, PropertyPath with walkPropertyPath)

#### Tasks

**3a.1 — Create `FieldSet.ts`**
- `FieldSet` class with `readonly shape: NodeShape`, `readonly entries: FieldSetEntry[]`
- `FieldSetEntry = { path: PropertyPath, alias?: string, scopedFilter?: WhereCondition }`
- `static for(shape, fields)` — accepts `NodeShape | string`, resolves string via `getShapeClass()`; fields can be string[] (resolved via `walkPropertyPath`), PropertyPath[], or callback `(p) => [...]`
- `static all(shape, opts?)` — enumerate all `getUniquePropertyShapes()`, optionally recurse to `depth`
- `static merge(sets)` — union entries, deduplicate by path equality, AND merge scoped filters on same path
- `.select(fields)` — returns new FieldSet with only the given fields
- `.add(fields)` — returns new FieldSet with additional entries
- `.remove(labels)` — returns new FieldSet without entries matching labels
- `.set(fields)` — returns new FieldSet replacing all entries
- `.pick(labels)` — returns new FieldSet keeping only entries matching labels
- `.paths()` — returns `PropertyPath[]`
- `.labels()` — returns `string[]` (terminal property labels)
- Nesting support: `{ friends: ['name', 'hobby'] }` and `{ friends: existingFieldSet }`

**3a.2 — Integrate FieldSet with QueryBuilder**
- `QueryBuilder.select(fieldSet: FieldSet)` — converts FieldSet entries to the same trace structure used by proxy callbacks
- `.setFields(fieldSet)`, `.addFields(fieldSet)`, `.removeFields(labels)` — delegate to FieldSet composition methods internally
- `.fields(): FieldSet` — returns the current selection as a FieldSet

**3a.3 — FieldSet to QueryPath bridge**
- Private utility that converts `FieldSetEntry[]` → `QueryPath[]` (the format `RawSelectInput.select` expects)
- Each `PropertyPath` segment becomes a `PropertyQueryStep` with `{ property, where? }`
- Nested entries become `SubQueryPaths`
- Scoped filters become `WherePath` on the relevant step

#### Validation — `src/tests/field-set.test.ts`

**Construction tests:**
- `FieldSet.for — string fields`: `FieldSet.for(Person.shape, ['name', 'hobby'])` — assert entries length 2, first entry path terminal label is `'name'`
- `FieldSet.for — callback`: `FieldSet.for(Person.shape, p => [p.name, p.hobby])` — assert same entries as string form
- `FieldSet.for — string shape resolution`: `FieldSet.for(Person.shape.id, ['name'])` — assert resolves correctly
- `FieldSet.all — depth 1`: `FieldSet.all(Person.shape)` — assert entries include all of Person's unique property shapes (name, hobby, nickNames, birthDate, isRealPerson, bestFriend, friends, pets, firstPet, pluralTestProp)
- `FieldSet.all — depth 0`: `FieldSet.all(Person.shape, { depth: 0 })` — assert same as depth 1 (no recursion into object properties)

**Composition tests:**
- `add — appends entries`: start with `['name']`, `.add(['hobby'])`, assert 2 entries
- `remove — removes by label`: start with `['name', 'hobby']`, `.remove(['hobby'])`, assert 1 entry with label `'name'`
- `set — replaces all`: start with `['name', 'hobby']`, `.set(['friends'])`, assert 1 entry with label `'friends'`
- `pick — keeps only listed`: start with `['name', 'hobby', 'friends']`, `.pick(['name', 'friends'])`, assert 2 entries
- `merge — union of entries`: merge two FieldSets `['name']` and `['hobby']`, assert 2 entries
- `merge — deduplicates`: merge `['name']` and `['name', 'hobby']`, assert 2 entries (not 3)
- `immutability`: original FieldSet unchanged after `.add()` call

**Nesting tests:**
- `nested — object form`: `FieldSet.for(Person.shape, [{ friends: ['name', 'hobby'] }])` — assert produces entries with 2-segment paths (friends.name, friends.hobby)

**QueryBuilder integration tests:**
- `QueryBuilder.select(fieldSet)` — build IR from FieldSet and from equivalent callback, assert identical IR
- `QueryBuilder.fields()` — assert returns a FieldSet with expected entries

**Validation commands:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 3b — Mutation builders ✅

**Status: Complete.**

Created immutable PromiseLike mutation builders (CreateBuilder, UpdateBuilder, DeleteBuilder) that delegate to existing factories for identical IR generation. 22 new tests covering IR equivalence, immutability, guards, and PromiseLike behavior.

**Files delivered:**
- `src/queries/CreateBuilder.ts` — Immutable create builder (from, set, withId, build, exec, PromiseLike)
- `src/queries/UpdateBuilder.ts` — Immutable update builder (from, for, set, build, exec, PromiseLike) with guards
- `src/queries/DeleteBuilder.ts` — Immutable delete builder (from, build, exec, PromiseLike)
- `src/tests/mutation-builder.test.ts` — 22 tests: create IR equiv (3), update IR equiv (5), delete IR equiv (2), immutability (4), guards (2), PromiseLike (5)

Replace `CreateQueryFactory` / `UpdateQueryFactory` / `DeleteQueryFactory` with immutable PromiseLike builders.

**Depends on:** Phase 2 (PromiseLike pattern, `createProxiedPathBuilder`)
**Independent of:** Phase 3a (FieldSet)

#### Tasks

**3b.1 — Extract mutation input conversion as standalone functions**
- Extract `MutationQueryFactory.convertUpdateObject()`, `convertNodeReferences()`, `convertNodeDescription()`, `convertUpdateValue()`, `convertSetModification()`, `isNodeReference()`, `isSetModification()` from `MutationQuery.ts` as standalone functions (not methods on a class)
- These functions take `(obj, shape, ...)` and return the same `NodeDescriptionValue` / `NodeReferenceValue[]` as before
- `MutationQueryFactory` can be retained as a thin wrapper calling these functions, or removed if nothing depends on it
- **Stub for parallel execution:** If 3b starts before Phase 2 is fully merged, the PromiseLike pattern can be implemented standalone using `getQueryDispatch()` directly, without depending on QueryBuilder

**3b.2 — Create `CreateBuilder.ts`**
- Immutable: `.set(data)` returns new instance, `.withId(id)` returns new instance
- `static from(shape)` — accepts `NodeShape | ShapeType | string`
- `.set(data)` — accepts `UpdatePartial<S>`, stores internally
- `.withId(id)` — pre-assigns node id
- `.build(): IRCreateMutation` — calls extracted `convertUpdateObject()` → `buildCanonicalCreateMutationIR()`
- `.exec()` — calls `getQueryDispatch().createQuery(this.build())`
- `implements PromiseLike` via `.then()`

**3b.3 — Create `UpdateBuilder.ts`**
- Immutable: `.set(data)`, `.for(id)`, `.forAll(ids)` return new instances
- `.for(id)` required before `.build()` / `.exec()` — throw if not set
- `.build(): IRUpdateMutation` — calls `convertUpdateObject()` → `buildCanonicalUpdateMutationIR()`
- Type-level enforcement: `.exec()` / `.then()` on an UpdateBuilder without `.for()` is a compile error (use branded type or overloads)

**3b.4 — Create `DeleteBuilder.ts`**
- `static from(shape, ids)` — accepts single or array of `string | NodeReferenceValue`
- `.build(): IRDeleteMutation` — calls `convertNodeReferences()` → `buildCanonicalDeleteMutationIR()`
- Immutable, PromiseLike

**3b.5 — Rewire `Shape.create()`, `.update()`, `.delete()` in Shape.ts**
- `Shape.create(data)` → returns `CreateBuilder`
- `Shape.update(id, data)` → returns `UpdateBuilder` with `.for(id)` pre-set
- `Shape.delete(ids)` → returns `DeleteBuilder`
- Remove direct `getQueryDispatch().createQuery()` / `.updateQuery()` / `.deleteQuery()` calls from Shape.ts — builders handle execution

**3b.6 — Deprecate old factory classes**
- Mark `CreateQueryFactory`, `UpdateQueryFactory`, `DeleteQueryFactory` as `@internal` or remove entirely
- `MutationQueryFactory` class removed; conversion functions are standalone

#### Validation — `src/tests/mutation-builder.test.ts`

**IR equivalence tests (must produce identical IR as existing factories):**

Capture IR from both old factory path and new builder path, assert deep equality:
- `create — simple`: `CreateBuilder.from(Person).set({name: 'Test', hobby: 'Chess'}).build()` — assert matches `createSimple` fixture IR
- `create — with friends`: `CreateBuilder.from(Person).set({name: 'Test', friends: [entity('p2'), {name: 'New Friend'}]}).build()` — assert matches `createWithFriends` fixture IR
- `create — with fixed id`: `CreateBuilder.from(Person).set({name: 'Fixed'}).withId(tmpEntityBase + 'fixed-id').build()` — assert `data.id` equals the fixed id
- `update — simple`: `UpdateBuilder.from(Person).for(entity('p1')).set({hobby: 'Chess'}).build()` — assert matches `updateSimple` fixture IR
- `update — add/remove multi`: `UpdateBuilder.from(Person).for(entity('p1')).set({friends: {add: [...], remove: [...]}}).build()` — assert matches fixture
- `update — nested with predefined id`: assert matches `updateNestedWithPredefinedId` fixture
- `delete — single`: `DeleteBuilder.from(Person, entity('to-delete')).build()` — assert matches `deleteSingle` fixture IR
- `delete — multiple`: `DeleteBuilder.from(Person, [entity('to-delete-1'), entity('to-delete-2')]).build()` — assert matches `deleteMultiple` fixture IR

**Immutability tests:**
- `CreateBuilder — .set() returns new instance`: assert original and result are different objects
- `UpdateBuilder — .for() returns new instance`: assert original and result are different objects

**Guard tests:**
- `UpdateBuilder — .build() without .for() throws`: assert throws with descriptive message

**PromiseLike test:**
- `CreateBuilder has .then()`: assert `.then` is a function

**Existing mutation golden tests must still pass:**
- `ir-mutation-parity.test.ts` — all inline snapshots unchanged
- `sparql-mutation-golden.test.ts` — all SPARQL output unchanged
- `sparql-mutation-algebra.test.ts` — all algebra tests pass

**Validation commands:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 4 — Serialization + integration ✅

**Status: Complete (dead code cleanup deferred).**

Added `toJSON()` / `fromJSON()` to FieldSet and QueryBuilder. Finalized public API exports. 14 new serialization tests with round-trip IR equivalence verification.

**Files delivered:**
- Modified `src/queries/FieldSet.ts` — Added `toJSON()`, `fromJSON()`, `FieldSetJSON`, `FieldSetFieldJSON` types
- Modified `src/queries/QueryBuilder.ts` — Added `toJSON()`, `fromJSON()`, `QueryBuilderJSON` type
- `src/tests/serialization.test.ts` — 14 tests: FieldSet round-trip (5), QueryBuilder round-trip (8), minimal (1)
- Modified `src/index.ts` — Exports `FieldSetJSON`, `FieldSetFieldJSON`, `QueryBuilderJSON`

**Deferred — Builder type threading + DSL rewire + dead code cleanup (4.4a–4.4f):**
PatchedQueryPromise, patchResultPromise(), nextTick, and factory class removal blocked by Shape.select()/selectAll() DSL rewire. Changing return types requires threading `QueryResponseToResultType` through QueryBuilder generics. Now broken into 6 sub-phases (4.4a–4.4f) with detailed code examples, dependency graph, and validation steps. See task 4.4 below for full breakdown.

Add `toJSON()` / `fromJSON()` to QueryBuilder and FieldSet. Final integration: verify all public API exports, remove dead code.

**Depends on:** Phase 3a (FieldSet) and Phase 3b (mutation builders)

#### Tasks

**4.1 — FieldSet serialization**
- `.toJSON(): FieldSetJSON` — produces `{ shape: string, fields: Array<{ path: string, as?: string }> }` where `shape` is the NodeShape id and `path` is dot-separated labels
- `static fromJSON(json, shapeRegistry?): FieldSet` — resolves shape id via `getShapeClass()`, resolves field paths via `walkPropertyPath()`

**4.2 — QueryBuilder serialization**
- `.toJSON(): QueryBuilderJSON` — produces the JSON format specified in the plan contracts section
- `static fromJSON(json): QueryBuilder` — reconstructs builder from JSON, resolves shape and paths

**4.3 — Update `src/index.ts` with full public API**
- Export `QueryBuilder`, `FieldSet`, `PropertyPath`, `walkPropertyPath`
- Export `CreateBuilder`, `UpdateBuilder`, `DeleteBuilder`
- Export `WhereCondition`, `WhereOperator`
- Remove `nextTick` re-export (no longer needed)
- Keep `SelectQueryFactory` export for backward compatibility but mark deprecated

**4.4 — Builder type threading + DSL rewire + dead code cleanup**

This is a multi-step sub-phase that threads result types through builder generics, rewires `Shape.*()` to return builders, and removes dead code. See detailed breakdown below.

##### Phase 4.4a — Thread result types through QueryBuilder

**Goal:** `await QueryBuilder.from(Person).select(p => p.name)` resolves to `QueryResponseToResultType<R, S>[]` instead of `any`.

**Proven viable:** A type probe (`src/tests/type-probe-4.4a.ts`) confirms that `QueryResponseToResultType<R, S>` resolves correctly when used as a computed generic parameter in a class, including through `PromiseLike`/`Awaited<>`. All 4 probe scenarios pass: standalone type computation, SingleResult unwrap, class generic propagation, and full PromiseLike chain with `Awaited<>`.

**Type inference scope:** Result type inference only works when `QueryBuilder.from(ShapeClass)` receives a TypeScript class. When using a string IRI (`QueryBuilder.from('my:PersonShape')`), `S` defaults to `Shape` and result types degrade to `any`. This is by design — the string/NodeShape path is for runtime/CMS use where types aren't known at compile time. The `<ShapeClass>` generic is required for type inference.

**File:** `src/queries/QueryBuilder.ts`

**Incremental implementation steps:**

Each step is independently verifiable with `npx tsc --noEmit` and `npm test`.

**Step 1 — Add `Result` generic parameter (pure additive, breaks nothing):**
```ts
// Before
export class QueryBuilder<S extends Shape = Shape, R = any>
  implements PromiseLike<any>, Promise<any>

// After — Result defaults to any, so all existing code compiles unchanged
export class QueryBuilder<S extends Shape = Shape, R = any, Result = any>
  implements PromiseLike<Result>, Promise<Result>
```
Update `QueryBuilderInit` to carry `Result` if needed, or just propagate via generics.
**Tests:** No new type tests (Result = any). Validation: `npx tsc --noEmit` + `npm test` — all existing tests pass unchanged.

**Step 2 — Wire `then()`, `catch()`, `finally()`, `exec()` to use `Result`:**
```ts
exec(): Promise<Result> {
  return getQueryDispatch().selectQuery(this.build()) as Promise<Result>;
}
then<TResult1 = Result, TResult2 = never>(
  onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
  onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
): Promise<TResult1 | TResult2> { ... }
catch<TResult = never>(...): Promise<Result | TResult> { ... }
finally(...): Promise<Result> { ... }
```
Since `Result` still defaults to `any`, this is a no-op change at runtime and compile time.
**Tests:** No new type tests (Result = any). Validation: `npx tsc --noEmit` + `npm test`.

**Step 3 — Wire `select()` to compute `Result` via `QueryResponseToResultType`:**
This is the key step. Import `QueryResponseToResultType` and update the callback overload:
```ts
import {QueryResponseToResultType} from './SelectQuery.js';

select<NewR>(fn: QueryBuildFn<S, NewR>): QueryBuilder<S, NewR, QueryResponseToResultType<NewR, S>[]>;
select(labels: string[]): QueryBuilder<S>;
select(fieldSet: FieldSet): QueryBuilder<S>;
```
**Tests — add to `query-builder.types.test.ts` (compile-only, `describe.skip`):**
```ts
test('select literal property', () => {
  const promise = QueryBuilder.from(Person).select(p => p.name);
  type Result = Awaited<typeof promise>;
  const first = (null as unknown as Result)[0];
  expectType<string | null | undefined>(first.name);
  expectType<string | undefined>(first.id);
});
test('select object property (set)', () => {
  const promise = QueryBuilder.from(Person).select(p => p.friends);
  type Result = Awaited<typeof promise>;
  expectType<string | undefined>((null as unknown as Result)[0].friends[0].id);
});
test('select multiple paths', () => {
  const promise = QueryBuilder.from(Person).select(p => [p.name, p.friends, p.bestFriend.name]);
  type Result = Awaited<typeof promise>;
  const first = (null as unknown as Result)[0];
  expectType<string | null | undefined>(first.name);
  expectType<string | undefined>(first.friends[0].id);
  expectType<string | null | undefined>(first.bestFriend.name);
});
test('select date type', () => {
  const promise = QueryBuilder.from(Person).select(p => p.birthDate);
  type Result = Awaited<typeof promise>;
  expectType<Date | null | undefined>((null as unknown as Result)[0].birthDate);
});
test('select boolean type', () => {
  const promise = QueryBuilder.from(Person).select(p => p.isRealPerson);
  type Result = Awaited<typeof promise>;
  expectType<boolean | null | undefined>((null as unknown as Result)[0].isRealPerson);
});
test('sub-select plural custom object', () => {
  const promise = QueryBuilder.from(Person).select(p =>
    p.friends.select(f => ({name: f.name, hobby: f.hobby})),
  );
  type Result = Awaited<typeof promise>;
  expectType<string | null | undefined>((null as unknown as Result)[0].friends[0].name);
  expectType<string | null | undefined>((null as unknown as Result)[0].friends[0].hobby);
});
test('count', () => {
  const promise = QueryBuilder.from(Person).select(p => p.friends.size());
  type Result = Awaited<typeof promise>;
  expectType<number>((null as unknown as Result)[0].friends);
});
test('custom result object', () => {
  const promise = QueryBuilder.from(Person).select(p => ({numFriends: p.friends.size()}));
  type Result = Awaited<typeof promise>;
  expectType<number>((null as unknown as Result)[0].numFriends);
});
test('string path — no type inference (any)', () => {
  const promise = QueryBuilder.from('my:PersonShape').select(['name']);
  type Result = Awaited<typeof promise>;
  expectType<any>(null as unknown as Result);
});
```
Validation: `npx tsc --noEmit` + `npm test`.

**Step 4 — Update fluent methods to preserve `Result`:**
Change `where()`, `orderBy()`, `limit()`, `offset()`, `for()`, `sortBy()` return types from `QueryBuilder<S, R>` to `QueryBuilder<S, R, Result>`:
```ts
where(fn: WhereClause<S>): QueryBuilder<S, R, Result> { ... }
limit(n: number): QueryBuilder<S, R, Result> { ... }
// etc.
```
Update `clone()` to propagate `Result`:
```ts
private clone(overrides: Partial<QueryBuilderInit<S, any>> = {}): QueryBuilder<S, R, Result> {
  return new QueryBuilder<S, R, Result>({...});
}
```
**Tests — add to `query-builder.types.test.ts`:**
```ts
test('select with chaining preserves types', () => {
  const promise = QueryBuilder.from(Person)
    .select(p => [p.name, p.friends])
    .where(p => p.name.equals('x'))
    .limit(5);
  type Result = Awaited<typeof promise>;
  const first = (null as unknown as Result)[0];
  expectType<string | null | undefined>(first.name);
  expectType<string | undefined>(first.friends[0].id);
});
test('select with .for() preserves types', () => {
  const promise = QueryBuilder.from(Person)
    .select(p => p.name)
    .for({id: 'p1'});
  type Result = Awaited<typeof promise>;
  const first = (null as unknown as Result)[0];
  expectType<string | null | undefined>(first.name);
});
test('orderBy preserves types', () => {
  const promise = QueryBuilder.from(Person)
    .select(p => p.name)
    .orderBy(p => p.name);
  type Result = Awaited<typeof promise>;
  expectType<string | null | undefined>((null as unknown as Result)[0].name);
});
```
Validation: `npx tsc --noEmit` + `npm test`.

**Step 5 — Wire `one()` to unwrap array:**
```ts
one(): QueryBuilder<S, R, Result extends (infer E)[] ? E : Result> {
  return this.clone({limit: 1, singleResult: true}) as any;
}
```
**Tests — add to `query-builder.types.test.ts`:**
```ts
test('select with .one() unwraps array', () => {
  const promise = QueryBuilder.from(Person).select(p => p.name).one();
  type Result = Awaited<typeof promise>;
  const single = null as unknown as Result;
  expectType<string | null | undefined>(single.name);
  expectType<string | undefined>(single.id);
});
test('.one() after chaining', () => {
  const promise = QueryBuilder.from(Person)
    .select(p => [p.name, p.friends])
    .where(p => p.name.equals('x'))
    .one();
  type Result = Awaited<typeof promise>;
  const single = null as unknown as Result;
  expectType<string | null | undefined>(single.name);
  expectType<string | undefined>(single.friends[0].id);
});
```
Validation: `npx tsc --noEmit` + `npm test`.

**Step 6 — Wire `selectAll()` result type:**
```ts
selectAll(): QueryBuilder<S, any, QueryResponseToResultType<SelectAllQueryResponse<S>, S>[]> { ... }
```
This requires importing `SelectAllQueryResponse` from SelectQuery.ts.
**Tests — add to `query-builder.types.test.ts`:**
```ts
test('selectAll returns typed results', () => {
  const promise = QueryBuilder.from(Person).selectAll();
  type Result = Awaited<typeof promise>;
  const first = (null as unknown as Result)[0];
  expectType<string | undefined>(first.id);
  expectType<string | null | undefined>(first.name);
});
```
Validation: `npx tsc --noEmit` + `npm test`.

**Validation (full, after all steps):**
- `npx tsc --noEmit` passes
- All existing `query-builder.test.ts` tests pass (IR equivalence unchanged)
- New `query-builder.types.test.ts` (compile-only, `describe.skip`) mirroring key patterns from `query.types.test.ts`:
  ```ts
  test('select literal property', () => {
    const promise = QueryBuilder.from(Person).select(p => p.name);
    type Result = Awaited<typeof promise>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.name);
    expectType<string | undefined>(first.id);
  });
  test('select with .one()', () => {
    const promise = QueryBuilder.from(Person).select(p => p.name).one();
    type Result = Awaited<typeof promise>;
    const single = null as unknown as Result;
    expectType<string | null | undefined>(single.name);
  });
  test('select with chaining preserves types', () => {
    const promise = QueryBuilder.from(Person)
      .select(p => [p.name, p.friends])
      .where(p => p.name.equals('x'))
      .limit(5);
    type Result = Awaited<typeof promise>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.name);
    expectType<string | undefined>(first.friends[0].id);
  });
  test('sub-select', () => {
    const promise = QueryBuilder.from(Person).select(p =>
      p.friends.select(f => ({name: f.name, hobby: f.hobby})),
    );
    type Result = Awaited<typeof promise>;
    expectType<string | null | undefined>((null as unknown as Result)[0].friends[0].name);
  });
  test('count', () => {
    const promise = QueryBuilder.from(Person).select(p => p.friends.size());
    type Result = Awaited<typeof promise>;
    expectType<number>((null as unknown as Result)[0].friends);
  });
  test('date type', () => {
    const promise = QueryBuilder.from(Person).select(p => p.birthDate);
    type Result = Awaited<typeof promise>;
    expectType<Date | null | undefined>((null as unknown as Result)[0].birthDate);
  });
  test('boolean type', () => {
    const promise = QueryBuilder.from(Person).select(p => p.isRealPerson);
    type Result = Awaited<typeof promise>;
    expectType<boolean | null | undefined>((null as unknown as Result)[0].isRealPerson);
  });
  test('string path — no type inference (any)', () => {
    const promise = QueryBuilder.from('my:PersonShape').select(['name']);
    type Result = Awaited<typeof promise>;
    // Result is any — string-based construction has no type inference
    expectType<any>(null as unknown as Result);
  });
  ```

**Risk (largely mitigated):** Type probe confirms `QueryResponseToResultType` resolves correctly through class generics and `Awaited<PromiseLike>`. The incremental 6-step approach means any step that fails can be diagnosed in isolation without rolling back prior steps. Each step is a self-contained commit.

---

##### Phase 4.4b — Rewire Shape.select() / Shape.selectAll() to return QueryBuilder

**Goal:** `Person.select(p => p.name)` returns `QueryBuilder` instead of `PatchedQueryPromise`. Chaining (`.where()`, `.limit()`, `.one()`, `.sortBy()`) works because QueryBuilder already has these methods.

**File:** `src/shapes/Shape.ts`

**Changes:**

1. Add imports:
```ts
import {QueryBuilder} from '../queries/QueryBuilder.js';
```

2. Replace `Shape.select()` implementation — remove `nextTick`, `SelectQueryFactory`, `patchResultPromise`:
```ts
static select<
  ShapeType extends Shape,
  S = unknown,
  ResultType = QueryResponseToResultType<S, ShapeType>[],
>(
  this: {new (...args: any[]): ShapeType},
  selectFn: QueryBuildFn<ShapeType, S>,
): QueryBuilder<ShapeType, S, ResultType>;
// ... keep subject overloads ...
static select(this, targetOrSelectFn?, selectFn?) {
  let _selectFn, subject;
  if (selectFn) { _selectFn = selectFn; subject = targetOrSelectFn; }
  else { _selectFn = targetOrSelectFn; }

  let builder = QueryBuilder.from(this as any).select(_selectFn);
  if (subject) builder = builder.for(subject);
  return builder;
}
```

3. Replace `Shape.selectAll()` similarly:
```ts
static selectAll<ShapeType extends Shape>(
  this: {new (...args: any[]): ShapeType},
): QueryBuilder<ShapeType>;
// ... subject overload ...
static selectAll(this, subject?) {
  let builder = QueryBuilder.from(this as any).selectAll();
  if (subject) builder = builder.for(subject);
  return builder;
}
```

4. Remove unused imports: `nextTick`, `PatchedQueryPromise`, `GetQueryResponseType`, `SelectAllQueryResponse`. Keep `SelectQueryFactory` import only if `Shape.query()` still uses it.

**Breaking change analysis:**
- Return type changes from `Promise<R> & PatchedQueryPromise<R, S>` to `QueryBuilder<S, ...>`.
- Both are `PromiseLike`, so `await Person.select(...)` still works.
- `.where()`, `.limit()`, `.one()` still exist on QueryBuilder.
- `.sortBy()` exists on QueryBuilder (added as alias for `orderBy`).
- Downstream code that explicitly typed the return as `PatchedQueryPromise` will break — but `PatchedQueryPromise` is not re-exported in `index.ts`, so it's internal only.

**Validation:**
- All `query-builder.test.ts` IR equivalence tests pass (DSL path now IS builder path, IR should be identical by construction)
- `npx tsc --noEmit` passes
- `npm test` — all tests pass
- Verify `.where().limit().sortBy()` chaining works on `Person.select(...)` result

---

##### Phase 4.4c — Rewire Shape.create() / Shape.update() / Shape.delete() to return builders

**Goal:** `Person.create(data)` returns `CreateBuilder`, `Person.update(id, data)` returns `UpdateBuilder`, `Person.delete(id)` returns `DeleteBuilder`.

**File:** `src/shapes/Shape.ts`

**Changes:**

1. Add imports:
```ts
import {CreateBuilder} from '../queries/CreateBuilder.js';
import {UpdateBuilder} from '../queries/UpdateBuilder.js';
import {DeleteBuilder} from '../queries/DeleteBuilder.js';
```

2. Replace `Shape.create()`:
```ts
static create<ShapeType extends Shape, U extends UpdatePartial<ShapeType>>(
  this: {new (...args: any[]): ShapeType},
  updateObjectOrFn?: U,
): CreateBuilder<ShapeType> {
  let builder = CreateBuilder.from<ShapeType>(this as any);
  if (updateObjectOrFn) builder = builder.set(updateObjectOrFn);
  return builder;
}
```

3. Replace `Shape.update()`:
```ts
static update<ShapeType extends Shape, U extends UpdatePartial<ShapeType>>(
  this: {new (...args: any[]): ShapeType},
  id: string | NodeReferenceValue | QShape<ShapeType>,
  updateObjectOrFn?: U,
): UpdateBuilder<ShapeType> {
  const idValue = typeof id === 'string' ? id : (id as any).id;
  let builder = UpdateBuilder.from<ShapeType>(this as any).for(idValue);
  if (updateObjectOrFn) builder = builder.set(updateObjectOrFn);
  return builder;
}
```

4. Replace `Shape.delete()`:
```ts
static delete<ShapeType extends Shape>(
  this: {new (...args: any[]): ShapeType},
  id: NodeId | NodeId[] | NodeReferenceValue[],
): DeleteBuilder<ShapeType> {
  return DeleteBuilder.from<ShapeType>(this as any, id as any);
}
```

5. Remove imports: `CreateQueryFactory`, `UpdateQueryFactory`, `DeleteQueryFactory`

**Breaking change analysis:**
- Return type changes from `Promise<X>` to builder (which implements `PromiseLike<X>`).
- `await Person.create(...)` still works identically.
- Code that chains `.then()` directly on the result still works (builders have `.then()`).
- Only breaks if someone does `instanceof Promise` checks on the result.

**Validation:**
- `mutation-builder.test.ts` passes
- `npx tsc --noEmit` passes
- `npm test` — all tests pass

---

##### Phase 4.4d — Thread result types through mutation builders

**Goal:** `await CreateBuilder.from(Person).set(data)` resolves to `CreateResponse<U>` instead of `any`.

**Sub-steps:**

**Step 4.4d.1 — CreateBuilder:**
- Add `U extends UpdatePartial<S> = UpdatePartial<S>` generic to class
- Wire `set<NewU>()` to return `CreateBuilder<S, NewU>`
- Wire `exec/then/catch/finally` to use `CreateResponse<U>` instead of `any`
- Update `implements` clause to `PromiseLike<CreateResponse<U>>`
- Validation: `npx jest --testPathPattern='mutation-builder' --no-coverage` passes

**Step 4.4d.2 — UpdateBuilder:**
- Add `U extends UpdatePartial<S> = UpdatePartial<S>` generic to class
- Wire `set<NewU>()` to return `UpdateBuilder<S, NewU>`
- Wire `exec/then/catch/finally` to use `AddId<U>` instead of `any`
- `for()` preserves `U` generic: returns `UpdateBuilder<S, U>`
- Update `implements` clause to `PromiseLike<AddId<U>>`
- Validation: `npx jest --testPathPattern='mutation-builder' --no-coverage` passes

**Step 4.4d.3 — Verify DeleteBuilder (no changes needed):**
- DeleteBuilder already uses `DeleteResponse` throughout — just confirm.
- Validation: full `npm test` passes

Note: `DeleteBuilder` already has proper `DeleteResponse` typing — no changes needed.

**Validation:**
- `mutation-builder.test.ts` passes
- `npx tsc --noEmit` passes

---

##### Phase 4.4e — Dead code removal

**Goal:** Remove all legacy code no longer reachable after 4.4b and 4.4c.

**Changes by file:**

1. **`src/queries/SelectQuery.ts`:**
   - Remove `PatchedQueryPromise` type (lines 277-287)
   - Remove `patchResultPromise()` method from `SelectQueryFactory` (lines 1863-1892)

2. **`src/shapes/Shape.ts`:**
   - Remove `import nextTick from 'next-tick'`
   - Remove unused imports: `PatchedQueryPromise`, `GetQueryResponseType`, `SelectAllQueryResponse`
   - Remove unused imports: `CreateQueryFactory`, `UpdateQueryFactory`, `DeleteQueryFactory`
   - **Remove `Shape.query()` method** (lines 95-117) — this returned `SelectQueryFactory` directly as a "template" pattern. With QueryBuilder available, this method is no longer needed. Note: this is a **breaking change** for any code using `Shape.query()`. Document in changelog.
   - Remove `SelectQueryFactory` import from Shape.ts entirely (no longer used after `query()` removal)

3. **`src/index.ts`:**
   - Remove `import nextTick from 'next-tick'` (line 47)
   - Remove `export {nextTick}` (line 48)

4. **`package.json`:**
   - Remove `next-tick` from dependencies if no other file imports it

**NOT removed (still used internally):**
- `SelectQueryFactory` class — still used by `QueryBuilder.buildFactory()` for IR generation
- `QueryResponseToResultType`, `GetQueryResponseType` — still used for type inference
- `MutationQueryFactory` — still used by mutation builders for `convertUpdateObject()`

**Validation:**
- `npx tsc --noEmit` passes
- `npm test` — all tests pass
- `grep -r 'next-tick' src/` returns no hits (only in node_modules)
- `grep -r 'PatchedQueryPromise' src/` returns no hits
- `grep -r 'patchResultPromise' src/` returns no hits

---

##### Phase 4.4f — Final validation

- Run full test suite: `npm test`
- Run type check: `npx tsc --noEmit`
- Run build: `npm run build` (if available)
- Verify no `any` leaks in builder `.then()` signatures by inspecting the `.d.ts` output or running a type-level test
- Verify `nextTick` is not imported anywhere in src/

---

##### Phase 4.4 type invariant

**Result types must stay identical.** The resolved `Awaited<T>` types that consumers see from `Person.select(...)`, `Person.create(...)`, `Person.update(...)`, `Person.delete(...)` must not change. The existing `query.types.test.ts` (584 lines, 50+ compile-time type assertions) is the source of truth. All tests in that file must continue to compile without modification. If a test needs to change, that indicates a type regression — escalate before proceeding.

Internal type plumbing (how `QueryResponseToResultType` flows through generics) is free to be restructured. Only the external-facing resolved types are contractual.

A new `query-builder.types.test.ts` must be added mirroring key patterns from `query.types.test.ts` but using `QueryBuilder.from(...)` instead of the DSL. This proves both paths resolve to the same types.

##### Phase 4.4 dependency graph

```
4.4a (type threading QueryBuilder)       4.4d (type threading mutation builders)
  │                                        │
  ▼                                        ▼
4.4b (rewire Shape.select/selectAll)     4.4c (rewire Shape.create/update/delete)
  │                                        │
  └──────────────┬─────────────────────────┘
                 ▼
           4.4e (dead code removal)
                 │
                 ▼
           4.4f (final validation)
```

4.4a and 4.4d are independent and can be done in parallel.
4.4b depends on 4.4a. 4.4c depends on 4.4d.
4.4e depends on both 4.4b and 4.4c.
4.4f is the final gate.

**4.5 — Integration verification**
- Run all existing golden tests (select + mutation) to confirm no regressions
- Verify `QueryBuilder` and old DSL produce identical IR for every fixture in `query-fixtures.ts`
- Verify mutation builders produce identical IR for every mutation fixture

#### Validation — `src/tests/serialization.test.ts`

**FieldSet round-trip tests:**
- `FieldSet.toJSON — simple fields`: `FieldSet.for(Person.shape, ['name', 'hobby']).toJSON()` — assert shape is Person's id, fields array has 2 entries with `path: 'name'` and `path: 'hobby'`
- `FieldSet.fromJSON — round-trip`: `FieldSet.fromJSON(fieldSet.toJSON())` — assert `.labels()` equals original `.labels()`
- `FieldSet.toJSON — nested`: `FieldSet.for(Person.shape, ['friends.name']).toJSON()` — assert field path is `'friends.name'`

**QueryBuilder round-trip tests:**
- `QueryBuilder.toJSON — select + where + limit`: build a query, serialize, assert JSON has expected shape/fields/where/limit
- `QueryBuilder.fromJSON — round-trip IR equivalence`: serialize a QueryBuilder, deserialize, build IR from both, assert identical IR
- `QueryBuilder.toJSON — orderBy`: assert orderBy appears in JSON with correct path and direction

**Integration tests:**
- `full pipeline — QueryBuilder from JSON produces valid SPARQL`: deserialize a QueryBuilder from JSON, build IR, convert to SPARQL algebra, convert to SPARQL string, assert string contains expected clauses

**Validation commands:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass
- `npm run build` (if available) — clean build with no errors

---

### Phase 5 — preloadFor + Component Query Integration ✅

**Status: Complete.**

Integrate `preloadFor` with the new QueryBuilder/FieldSet system. Ensure `linkedComponent` (in `@_linked/react`) continues to work by accepting QueryBuilder-based component definitions alongside the legacy SelectQueryFactory pattern.

**Depends on:** Phase 4.4a (QueryBuilder with result types), Phase 3a (FieldSet)

#### Background

The current `preloadFor` system works like this:

1. `linkedComponent(query, ReactComponent)` creates a new React component with a `.query` property (a `SelectQueryFactory`)
2. The component satisfies `QueryComponentLike<S, R> = { query: SelectQueryFactory | Record<string, SelectQueryFactory> }`
3. In a parent query: `Person.select(p => p.bestFriend.preloadFor(ChildComponent))` creates a `BoundComponent`
4. `BoundComponent.getPropertyPath()` extracts the child's `SelectQueryFactory`, calls `getQueryPaths()`, and merges the result paths into the parent query path
5. The IR pipeline wraps the component's selections in an `OPTIONAL` block (so preloaded fields don't filter parent results)

The current system is tightly coupled to `SelectQueryFactory`. This phase extends it to work with `QueryBuilder` and `FieldSet`.

#### Architecture Decisions

**1. `QueryComponentLike` accepts QueryBuilder and FieldSet**

```ts
export type QueryComponentLike<ShapeType extends Shape, CompQueryResult> = {
  query:
    | SelectQueryFactory<ShapeType, CompQueryResult>
    | QueryBuilder<ShapeType>
    | FieldSet
    | Record<string, SelectQueryFactory<ShapeType, CompQueryResult> | QueryBuilder<ShapeType>>;
};
```

This is backward-compatible — existing components with `{query: SelectQueryFactory}` still work.

**2. `linkedComponent` exposes both `.query` and `.fields`**

The `@_linked/react` `linkedComponent` wrapper should expose:
- `.query` — a `QueryBuilder` (replaces the old `SelectQueryFactory` template)
- `.fields` — a `FieldSet` derived from the query's selection

This is a contract that `@_linked/react` implements. Core defines the interface.

**3. `Shape.query()` is removed — use `QueryBuilder.from()` directly**

`Shape.query()` was a convenience that returned a `SelectQueryFactory` as a "template". With QueryBuilder available, the equivalent is `QueryBuilder.from(Person).select(p => ({name: p.name}))`. `linkedComponent` in `@_linked/react` should accept a `QueryBuilder` directly instead of relying on `Shape.query()`.

`Shape.query()` is removed in Phase 4.4e as originally planned. `@_linked/react` must update `linkedComponent` to accept `QueryBuilder` before that happens (see `@_linked/react` migration note below).

**4. `preloadFor` on PropertyPath for QueryBuilder API**

The proxy-based DSL (`p.bestFriend.preloadFor(comp)`) already works via `QueryBuilderObject.preloadFor()`. For the QueryBuilder/FieldSet API, preloading is expressed as a nested FieldSet input or a dedicated method:

```ts
// Option A: FieldSet nesting with component
FieldSet.for(Person.shape, [
  'name',
  { bestFriend: PersonCardComponent.fields }
])

// Option B: QueryBuilder.preload() method
QueryBuilder.from(Person)
  .select(p => [p.name])
  .preload('bestFriend', PersonCardComponent)

// Option C: Both — FieldSet nesting for static, preload() for dynamic
```

Decision: Support **both Option A and B**. FieldSet nesting (`{ path: FieldSet }`) already works for sub-selections. Component preloading through QueryBuilder adds a `.preload()` convenience method.

#### Tasks

**5.1 — Extend `QueryComponentLike` type**

**File:** `src/queries/SelectQuery.ts`

Update the type to accept `QueryBuilder` and `FieldSet`:

```ts
export type QueryComponentLike<ShapeType extends Shape, CompQueryResult> = {
  query:
    | SelectQueryFactory<ShapeType, CompQueryResult>
    | QueryBuilder<ShapeType>
    | FieldSet
    | Record<string, SelectQueryFactory<ShapeType, CompQueryResult> | QueryBuilder<ShapeType>>;
  fields?: FieldSet;  // optional: component can also expose a FieldSet
};
```

**5.2 — Update `BoundComponent.getParentQueryFactory()` to handle new types**

**File:** `src/queries/SelectQuery.ts`

Rename to `getComponentQueryPaths()` (more accurate since it now returns paths from multiple sources). Handle:
- `SelectQueryFactory` → call `getQueryPaths()` (existing)
- `QueryBuilder` → call `buildFactory().getQueryPaths()` or `toRawInput()` and extract select paths
- `FieldSet` → convert to `QueryPath[]` via the existing FieldSet→QueryPath bridge (from Phase 3a.3)

```ts
getComponentQueryPaths(): SelectPath {
  const query = this.originalValue.query;

  // If component exposes a FieldSet, prefer it
  if (this.originalValue.fields instanceof FieldSet) {
    return fieldSetToQueryPaths(this.originalValue.fields);
  }

  if (query instanceof SelectQueryFactory) {
    return query.getQueryPaths();
  }
  if (query instanceof QueryBuilder) {
    return query.buildFactory().getQueryPaths();
  }
  if (query instanceof FieldSet) {
    return fieldSetToQueryPaths(query);
  }
  // Record case
  if (typeof query === 'object') {
    // ... existing Record handling, extended for QueryBuilder values
  }
}
```

**5.3 — Add `.preload()` method to QueryBuilder**

**File:** `src/queries/QueryBuilder.ts`

Add a method that creates a preload relationship:

```ts
preload<CS extends Shape, CR>(
  path: string,
  component: QueryComponentLike<CS, CR>,
): QueryBuilder<S, R, Result> {
  // Resolve the path, create a BoundComponent-like structure
  // that the FieldSet→QueryPath bridge can handle
  // Store as additional preload entries in the builder state
}
```

This stores preload bindings that get merged when `toRawInput()` is called.

**5.4 — FieldSet nesting with component FieldSets**

**File:** `src/queries/FieldSet.ts`

FieldSet nesting already supports `{ friends: ['name', 'hobby'] }` and `{ friends: childFieldSet }`. Verify and test that this works correctly for component preloading:

```ts
const personCardFields = FieldSet.for(Person.shape, ['name', 'hobby']);
const parentFields = FieldSet.for(Person.shape, [
  'name',
  { bestFriend: personCardFields }
]);
```

The existing `resolveInputs()` handles `Record<string, FieldSet>` — this just needs validation that the resulting QueryPaths produce the correct OPTIONAL-wrapped SPARQL when going through the IR pipeline.

**5.5 — Define `ComponentInterface` for `@_linked/react` contract**

**File:** `src/queries/SelectQuery.ts` (or new file `src/queries/ComponentInterface.ts`)

Define the interface that React components (from `@_linked/react`) must satisfy:

```ts
export interface LinkedComponentInterface<S extends Shape = Shape, R = any> {
  /** The component's data query (QueryBuilder template, not executed) */
  query: QueryBuilder<S, any, R> | SelectQueryFactory<S, R>;
  /** The component's field requirements as a FieldSet */
  fields?: FieldSet;
}
```

This is what `linkedComponent()` in `@_linked/react` should produce. Export from `src/index.ts`.

**5.6 — Remove `Shape.query()` (confirm Phase 4.4e removal)**

`Shape.query()` is removed as planned in Phase 4.4e. No changes needed here — just confirm the removal doesn't break preloadFor tests (the test fixtures in `query-fixtures.ts` should be updated to use `QueryBuilder.from(Person).select(...)` instead of `Person.query(...)`).

#### `@_linked/react` Migration Note

When `@_linked/core` completes Phase 5, `@_linked/react` must update its `linkedComponent` implementation:

1. **Accept `QueryBuilder` instead of `SelectQueryFactory`:**
   ```ts
   // Before (current)
   function linkedComponent<S extends Shape, R>(
     query: SelectQueryFactory<S, R>,
     component: React.ComponentType<R>,
   ): LinkedComponent<S, R>;

   // After
   function linkedComponent<S extends Shape, R>(
     query: QueryBuilder<S, any, R>,
     component: React.ComponentType<R>,
   ): LinkedComponent<S, R>;
   ```

2. **Expose `.fields` on the returned component:**
   ```ts
   const result = linkedComponent(query, Component);
   // result.query = the QueryBuilder passed in
   // result.fields = query.fields()  ← derive FieldSet from the QueryBuilder
   ```

3. **Satisfy `LinkedComponentInterface`** (exported from `@_linked/core`):
   The returned component must implement:
   ```ts
   interface LinkedComponentInterface<S, R> {
     query: QueryBuilder<S, any, R>;
     fields?: FieldSet;
   }
   ```

4. **Update `linkedComponent` call sites** from `Person.query(...)` to `QueryBuilder.from(Person).select(...)`:
   ```ts
   // Before
   const PersonCard = linkedComponent(Person.query(p => ({name: p.name})), CardComponent);
   // After
   const PersonCard = linkedComponent(QueryBuilder.from(Person).select(p => ({name: p.name})), CardComponent);
   ```

5. **`linkedSetComponent`** follows the same pattern — accept `QueryBuilder` or `Record<string, QueryBuilder>` instead of `SelectQueryFactory`.

These changes are required before `Shape.query()` is removed in Phase 4.4e.

#### Validation — `src/tests/preload-component.test.ts`

**Backward compatibility tests:**
- `preloadFor with SelectQueryFactory` — existing `preloadBestFriend` fixture produces same IR as before
- `preloadFor SPARQL golden` — same SPARQL with OPTIONAL wrapper

**New QueryBuilder-based tests:**
- `preloadFor with QueryBuilder` — `Person.select(p => p.bestFriend.preloadFor({query: QueryBuilder.from(Person).select(p => ({name: p.name}))}))` produces equivalent IR
- `preloadFor with FieldSet` — `Person.select(p => p.bestFriend.preloadFor({query: FieldSet.for(Person.shape, ['name'])}))` produces equivalent IR
- `FieldSet nesting as preload` — `FieldSet.for(Person.shape, [{ bestFriend: FieldSet.for(Person.shape, ['name']) }])` through QueryBuilder produces correct IR with OPTIONAL

**QueryBuilder.preload() tests:**
- `QueryBuilder.preload()` — `QueryBuilder.from(Person).select(p => [p.name]).preload('bestFriend', {query: personCardQuery})` produces equivalent IR to DSL `preloadFor`

**Validation commands:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 6: `forAll(ids)` — multi-ID subject filtering ✅

**Status: Complete.**

Implemented `_subjects` field on QueryBuilder, `forAll(ids)` normalizes and stores IDs, generates `VALUES` clause in SPARQL, with full serialization support. 6 new tests in query-builder.test.ts + 2 serialization tests.

**Goal:** Make `Person.select(...).forAll([id1, id2])` actually filter by the given IDs instead of silently ignoring them.

**Current problem (resolved):** Both branches of `forAll()` (with and without `ids`) do the exact same thing: `clone({subject: undefined, singleResult: false})`. The IDs parameter is discarded.

**Approach: `VALUES` clause (Option A)**

Use a `VALUES ?subject { <id1> <id2> }` binding, consistent with how `.for(id)` already works for single subjects.

#### Implementation

1. **Add `_subjects` field to `QueryBuilder`:**
   - New `private readonly _subjects?: NodeReferenceValue[]` field alongside existing `_subject`
   - Update `QueryBuilderInit` and `clone()` to carry `_subjects`
   - `forAll(ids)` stores normalized IDs in `_subjects`, clears `_subject`
   - `for(id)` clears `_subjects` (mutually exclusive)

2. **Update `buildFactory()` to pass subjects array:**
   - When `_subjects` is set, pass to `SelectQueryFactory` (new parameter or method)
   - Factory generates `VALUES ?subject { <id1> <id2> ... }` in the SPARQL output

3. **Update `SelectQueryFactory.toRawInput()`:**
   - Accept plural `subjects` in the raw input
   - Generate appropriate `VALUES` clause or `FILTER(?subject IN (...))` depending on what the IR pipeline supports

4. **Serialization:**
   - `toJSON()` — serialize `_subjects` as string array
   - `fromJSON()` — restore `_subjects` and call `.forAll(ids)`

#### Validation

- Test: `Person.select(p => [p.name]).forAll([id1, id2])` produces IR with VALUES binding for both IDs
- Test: `.forAll()` without IDs still selects all (no subject filter)
- Test: `.for(id)` after `.forAll(ids)` clears the multi-subject (and vice versa)
- Test: serialization round-trip preserves subjects array
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 7: Unified callback tracing — FieldSet as canonical query primitive ✅

**Status: Complete.**

All sub-phases (7a–7e) implemented. FieldSetEntry extended with subSelect/aggregation/customKey. FieldSet.for() accepts ShapeClass. Callback tracing uses createProxiedPathBuilder. toJSON works for callback-based selections. FieldSet carries generic `<R, Source>` type parameters.

**Goal:** Make FieldSet the single canonical declarative primitive that queries are built from. Unify FieldSet's callback tracing with the existing `QueryShape`/`ProxiedPathBuilder` proxy so nested paths, where clauses, and orderBy all work. Enable `toJSON()` for callback-based selections. Add type parameter `R` to FieldSet.

**Current problem (resolved):**

`FieldSet.traceFieldsFromCallback()` uses a **simple proxy** that only captures top-level string keys:
```ts
// Current: only captures 'friends', not 'friends.name'
const proxy = new Proxy({}, {
  get(_target, key) { accessed.push(key); return key; }
});
```

Meanwhile, `createProxiedPathBuilder()` → `QueryShape.create()` uses the **full QueryShape proxy** that:
- Resolves each key to its `PropertyShape` via `getPropertyShapeByLabel()`
- Returns nested `QueryBuilderObject` instances for traversal (`p.friends.name` works)
- Supports `.where()`, `.count()`, `.preloadFor()`, etc.
- Already handles both single-value (`QueryShape`) and set-value (`QueryShapeSet`) properties

These should be the same code path. The DSL already solves nested path tracing — FieldSet just isn't using it.

**Approach: Reuse `createProxiedPathBuilder` in FieldSet, extend FieldSetEntry data model, add typed generics.**

---

#### Phase 7a: Extend FieldSetEntry data model

**Goal:** Expand `FieldSetEntry` so it can carry everything that `QueryPath` / `PropertyQueryStep` currently carries. Pure data model change — no behavior changes yet.

1. **Extend `FieldSetEntry` type:**
   ```ts
   type FieldSetEntry = {
     path: PropertyPath;
     alias?: string;
     scopedFilter?: WhereCondition;  // existing but unused — will be populated in 7c
     subSelect?: FieldSet;           // NEW: nested selections (p.friends.select(...))
     aggregation?: 'count';          // NEW: p.friends.size()
     customKey?: string;             // NEW: keyed results from custom objects
   };
   ```

2. **Update FieldSet methods to preserve new fields:**
   - `add()`, `remove()`, `pick()`, `merge()` — carry `subSelect`, `aggregation`, `customKey` through
   - `toJSON()` / `fromJSON()` — serialize new fields where possible (sub-selects serialize recursively, aggregation as string)
   - Path equality checks — entries with same path but different subSelect/aggregation are distinct

3. **No behavior changes yet** — existing code continues to produce entries with only `path` and optional `alias`. New fields are optional and unused until 7b.

##### Validation
- Existing FieldSet tests pass unchanged
- New test: FieldSetEntry with `subSelect` field preserved through `add()` / `pick()` / `merge()`
- New test: `toJSON()` / `fromJSON()` round-trip with `subSelect` and `aggregation` fields
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

#### Phase 7b: `FieldSet.for()` accepts ShapeClass + NodeShape overloads

**Goal:** Allow `FieldSet.for()` to accept a Shape class (e.g. `Person`) in addition to `NodeShape` or string. This is prerequisite for using `createProxiedPathBuilder` which needs a Shape class.

1. **Add ShapeClass overload to `FieldSet.for()`:**
   ```ts
   static for(shape: ShapeType<S>, labels: string[]): FieldSet;
   static for(shape: ShapeType<S>, fn: (p: ProxiedShape<S>) => any[]): FieldSet;
   static for(shape: NodeShape | string, labels: string[]): FieldSet;
   static for(shape: NodeShape | string, fn: (p: any) => any[]): FieldSet;
   ```

2. **Resolve ShapeClass → NodeShape internally:**
   - When given a ShapeClass, extract `shape.shape` (the NodeShape instance)
   - Store the ShapeClass reference for later use in callback tracing (7c)
   - `resolveShape()` updated to handle both input types

3. **Same for `FieldSet.all()`:**
   - Accept ShapeClass in addition to NodeShape/string

4. **No callback behavior change yet** — callbacks still go through the simple proxy for now. ShapeClass is stored but the richer proxy isn't used until 7c.

##### Validation
- Test: `FieldSet.for(Person, ['name'])` produces same FieldSet as `FieldSet.for(Person.shape, ['name'])`
- Test: `FieldSet.all(Person)` produces same FieldSet as `FieldSet.all(Person.shape)`
- Existing tests pass unchanged
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

#### Phase 7c: Replace traceFieldsFromCallback with ProxiedPathBuilder

**Goal:** Replace FieldSet's simple string-capturing proxy with `createProxiedPathBuilder`. This enables nested paths, where conditions, sub-selects, and aggregations in FieldSet callbacks.

**Core principle:** FieldSet is the canonical declarative primitive. The DSL's proxy tracing produces FieldSet entries, not a parallel QueryPath representation.

1. **Replace `traceFieldsFromCallback` with `createProxiedPathBuilder`:**
   - When given a ShapeClass, use `createProxiedPathBuilder(shape)` to get a full `QueryShape` proxy
   - When given a NodeShape, reverse-lookup to ShapeClass via registry
   - Pass proxy through callback: `fn(proxy)` returns `QueryBuilderObject[]`
   - Convert each `QueryBuilderObject` to a `FieldSetEntry` (see step 2)

2. **Add `QueryBuilderObject → FieldSetEntry` conversion utility:**
   - Walk the `QueryBuilderObject` chain (each has `.property: PropertyShape` and `.subject: QueryBuilderObject`)
   - Collect segments into a `PropertyPath`
   - `.wherePath` → `scopedFilter`
   - Sub-`SelectQueryFactory` result → `subSelect: FieldSet` (recursive conversion)
   - `SetSize` instance → `aggregation: 'count'`
   - This is the single bridge between the proxy world and the FieldSet world

3. **Remove old `traceFieldsFromCallback`** — replaced entirely

4. **This immediately enables:**
   - Nested paths: `FieldSet.for(Person, p => [p.friends.name])`
   - Where on paths: `FieldSet.for(Person, p => [p.friends.where(f => f.age.gt(18))])`
   - Aggregations: `FieldSet.for(Person, p => [p.friends.size()])`
   - Sub-selects: `FieldSet.for(Person, p => [p.friends.select(f => [f.name])])`

##### Validation
- Test: `FieldSet.for(Person, p => [p.friends.name])` produces entry with 2-segment PropertyPath
- Test: `FieldSet.for(Person, p => [p.friends.where(f => f.age.gt(18))])` produces entry with `scopedFilter` populated
- Test: `FieldSet.for(Person, p => [p.friends.size()])` produces entry with `aggregation: 'count'`
- Test: `FieldSet.for(Person, p => [p.friends.select(f => [f.name])])` produces entry with `subSelect` FieldSet
- Test: existing flat callbacks `FieldSet.for(Person, p => [p.name])` still work
- IR equivalence: FieldSet-built nested query produces same IR as DSL equivalent
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

#### Phase 7d: `toJSON()` for callback-based selections

**Goal:** Make `QueryBuilder.toJSON()` work when the selection was set via a callback (not just FieldSet or string[]).

**Depends on:** Phase 7c (FieldSet callbacks now produce full entries via the real proxy)

1. **Pre-evaluate callbacks in `fields()`:**
   - When `_selectFn` is set but `_fieldSet` is not, run the callback through `createProxiedPathBuilder` to produce a `FieldSet`
   - Cache the result (the callback is pure — same proxy always produces same paths)
   - `toJSON()` then naturally works because `fields()` always returns a `FieldSet`

2. **`fromJSON()` restores `orderDirection`:**
   - Fix the existing bug: read `json.orderDirection` and store it
   - Since the sort *key* callback isn't serializable, store direction separately — when a sort key is later re-applied, the direction is preserved

3. **Where/orderBy callback serialization (exploration):**
   - `where()` callbacks use the same `QueryShape` proxy — the result is a `WherePath`
   - `orderBy()` callbacks produce a single `QueryBuilderObject` identifying the sort property
   - Both could be pre-evaluated through the proxy and serialized as path expressions
   - **Scope decision needed:** Is serializing where/orderBy required now, or can it wait? The `FieldSet.scopedFilter` field already exists for per-field where conditions — this could be the serialization target

##### Validation
- Test: `QueryBuilder.from(Person).select(p => [p.name]).toJSON()` produces fields even with callback select
- Test: round-trip `toJSON()`/`fromJSON()` preserves callback-derived fields
- Test: `orderDirection` survives `fromJSON()` round-trip
- Test: nested callback selections serialize correctly (sub-selects, where, aggregation)
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

#### Phase 7e: Typed FieldSets — carry `R` through FieldSet

**Goal:** When a FieldSet is built from a callback, capture the callback's return type as a generic parameter so that `QueryBuilder.select(fieldSet)` preserves type safety.

**Depends on:** Phase 7c (FieldSet callbacks go through real proxy which produces typed results)

1. **Add generic `R` parameter to FieldSet:**
   ```ts
   class FieldSet<R = any> {
     // When built from callback: R = callback return type
     // When built from labels/string[]: R = any (no inference possible)
   }
   ```

2. **Wire callback type capture:**
   ```ts
   static for<S extends Shape, R>(
     shape: ShapeType<S>,
     fn: (p: ProxiedShape<S>) => R,
   ): FieldSet<R>;
   ```

3. **Wire through QueryBuilder.select():**
   ```ts
   select<R>(fieldSet: FieldSet<R>): QueryBuilder<S, R, QueryResponseToResultType<R, S>[]>;
   ```

4. **Composition preserves types where possible:**
   - `.add()`, `.remove()`, `.pick()` on a typed FieldSet degrade `R` to `any` (composition changes the structure)
   - `.merge()` degrades to `any`
   - Only the original callback-constructed FieldSet carries the precise type

##### Validation
- Test: `FieldSet.for(Person, p => [p.name])` → FieldSet carries type, `QueryBuilder.select(fieldSet)` resolves to typed result
- Test: `FieldSet.for(Person.shape, ['name'])` → FieldSet<any> (no callback, no type)
- Type probe file: compile-time assertions for FieldSet<R> → QueryBuilder result type flow
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 8: QueryBuilder generates IR directly — bypass SelectQueryFactory ✅

**Status: Complete.**

QueryBuilder.toRawInput() now constructs RawSelectInput directly from FieldSet when selections are set via FieldSet, labels, or selectAll. Arbitrary callbacks still use the legacy path (via _buildFactory()) until Phase 9.

**Files delivered:**
- `src/queries/SelectQuery.ts` — exported `fieldSetToSelectPath()` (enhanced: handles aggregation, scopedFilter, subSelect), `processWhereClause()`, `evaluateSortCallback()`
- `src/queries/QueryBuilder.ts` — new `_buildDirectRawInput()`, `buildFactory` renamed to `_buildFactory()` and marked deprecated
- `src/tests/query-builder.test.ts` — 8 new tests in "QueryBuilder — direct IR generation" block

**Scope note:** Only FieldSet/label/selectAll selections use the direct path. Arbitrary callbacks (which may produce BoundComponent, Evaluation, or SelectQueryFactory results) fall back to the legacy _buildFactory() path. Phase 9 will handle sub-selects through FieldSet, enabling more callbacks to use the direct path.

**Original plan below for reference:**

**Goal:** Remove the `buildFactory()` bridge. QueryBuilder converts its internal state (FieldSet-based) directly to `RawSelectInput`, bypassing `SelectQueryFactory` entirely for top-level queries.

**Depends on:** Phase 7 (FieldSet carries full query information including where/sub-select/aggregation)

**Current state:** `QueryBuilder.buildFactory()` creates a fresh `SelectQueryFactory`, passes the callback + state, lets the factory run the proxy tracing + `getQueryPaths()`, then calls `toRawInput()`. This is the legacy bridge.

**Target state:** QueryBuilder holds a `FieldSet` (from Phase 7, carrying where/sub-select/aggregation). It converts `FieldSet → RawSelectInput` directly:

#### Implementation

1. **Build `fieldSetToRawSelectInput()` conversion:**
   - Walk `FieldSetEntry[]` and produce `QueryPath[]` (the format `RawSelectInput.select` expects)
   - Each `PropertyPath` segment → `PropertyQueryStep { property, where? }`
   - `entry.scopedFilter` → `PropertyQueryStep.where`
   - `entry.subSelect` → nested `QueryPath[]` (recursive)
   - `entry.aggregation === 'count'` → `SizeStep { count, label }`
   - This replaces the `SelectQueryFactory.getQueryPaths()` call

2. **Replace `buildFactory()` with direct `toRawInput()`:**
   ```ts
   private toRawInput(): RawSelectInput {
     const fields = this.fields(); // FieldSet with full info
     return {
       select: fieldSetToSelectPath(fields),
       where: this._whereFn ? evaluateWhere(this._whereFn, this._shape) : undefined,
       sortBy: this._sortByFn ? evaluateSort(this._sortByFn, this._shape) : undefined,
       subject: this._subject,
       shape: this._shape,
       limit: this._limit,
       offset: this._offset,
       singleResult: this._singleResult,
     };
   }
   ```

3. **Evaluate where/sort callbacks independently:**
   - `evaluateWhere()`: run callback through `createProxiedPathBuilder`, extract `WherePath`
   - `evaluateSort()`: run callback through proxy, extract sort path + direction
   - These are one-shot evaluations (same as what SelectQueryFactory.init() does)

4. **Keep `buildFactory()` as deprecated fallback** (removed in Phase 10)

#### Validation

- Test: Every IR equivalence test from Phase 2 still passes when going through the new direct path
- Test: Sub-selections via FieldSet produce identical IR to DSL sub-selects
- Test: Where conditions on paths produce identical IR
- Test: Aggregations produce identical IR
- Golden SPARQL tests pass unchanged
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 9: Sub-queries through FieldSet — remove SelectQueryFactory from DSL path

**Goal:** When the DSL does `p.friends.select(f => [f.name, f.hobby])`, the sub-selection is represented as a nested `FieldSet` instead of a nested `SelectQueryFactory`. This means `QueryShape.select()` and `QueryShapeSet.select()` produce FieldSets, not factories.

**Depends on:** Phase 8 (QueryBuilder generates IR directly from FieldSet)

**Current sub-query flow:**
```
p.friends.select(fn)
  → QueryShapeSet.select(fn) creates new SelectQueryFactory(valueShape, fn)
  → Factory stored as response element
  → getQueryPaths() recurses into factory.getQueryPaths()
  → Produces nested QueryPath[]
```

**Target sub-query flow:**
```
p.friends.select(fn)
  → QueryShapeSet.select(fn) creates FieldSet.for(valueShape, fn)
  → FieldSet stored in parent FieldSetEntry.subSelect
  → fieldSetToSelectPath() recurses into sub-FieldSet
  → Produces nested QueryPath[] (same output)
```

#### Implementation

1. **Update `QueryShapeSet.select()` to produce FieldSet:**
   - Instead of `new SelectQueryFactory(valueShape, fn)`, call `FieldSet.for(valueShape, fn)`
   - Store result as `FieldSetEntry.subSelect` on the parent entry
   - This requires the `QueryBuilderObject → FieldSetEntry` conversion from Phase 7 to handle recursion

2. **Update `QueryShape.select()` similarly:**
   - Single-value sub-selections also produce FieldSet

3. **Update `BoundComponent.getComponentQueryPaths()`:**
   - For preloadFor, convert component's query to FieldSet
   - Merge component's FieldSet into parent's sub-selection at the preload path

4. **Remove SelectQueryFactory creation from proxy handlers:**
   - `QueryShapeSet.select()` no longer imports/creates SelectQueryFactory
   - `QueryShape.select()` no longer imports/creates SelectQueryFactory
   - SelectQueryFactory only used by legacy code paths

#### Validation

- Test: `Person.select(p => p.friends.select(f => [f.name]))` produces identical IR through FieldSet path
- Test: `Person.select(p => p.friends.select(f => ({name: f.name, hobby: f.hobby})))` handles custom objects
- Test: Nested sub-selects (3+ levels deep) produce correct IR
- Test: preloadFor through FieldSet produces same OPTIONAL-wrapped IR
- Golden IR + SPARQL tests pass unchanged
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 10: Remove SelectQueryFactory ✅

**Status: COMPLETE** — All 7 sub-phases (10a–10g) implemented and committed.

**Goal:** Delete `SelectQueryFactory` and all supporting code that is no longer reachable.

**Depends on:** Phase 9 (all DSL paths use FieldSet, no code creates SelectQueryFactory)

#### Implementation

1. **Verify no remaining usages:**
   - `grep -r 'SelectQueryFactory' src/` should only find the definition and type-only imports
   - `grep -r 'buildFactory' src/` should find nothing (removed in Phase 8)
   - Confirm `QueryBuilder.buildFactory()` deprecated path is removed

2. **Remove from SelectQuery.ts:**
   - Delete `SelectQueryFactory` class (~600 lines)
   - Delete `patchResultPromise()` (already removed in 4.4e, confirm)
   - Delete `PatchedQueryPromise` type (already removed in 4.4e, confirm)
   - Keep: `QueryShape`, `QueryShapeSet`, `QueryBuilderObject` — still used by proxy tracing
   - Keep: Type exports (`QueryResponseToResultType`, `SelectAllQueryResponse`, etc.)
   - Keep: `QueryComponentLike`, `BoundComponent` if still needed

3. **Remove from exports:**
   - Remove `SelectQueryFactory` from `src/index.ts`
   - Remove from `QueryFactory.ts` if referenced there

4. **Clean up `QueryContext.ts`:**
   - If `QueryContext` was only used by SelectQueryFactory, remove it
   - Otherwise keep

5. **Update remaining references:**
   - `QueryComponentLike` type no longer needs `SelectQueryFactory` variant
   - Any `instanceof SelectQueryFactory` checks → remove or replace

#### Validation

- `grep -r 'SelectQueryFactory' src/` returns 0 hits (excluding comments/changelog)
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass
- Golden IR + SPARQL tests pass unchanged
- Bundle size reduced (SelectQueryFactory was ~600 lines)

---

### Phase 11: Hardening — API cleanup and robustness

**Goal:** Address remaining review findings. Each item to be discussed with project owner before implementation.

**Depends on:** Phases 6–10 complete

**Candidate items (to be reviewed individually):**

1. **`FieldSet.merge()` shape validation** — should it throw when merging FieldSets from different shapes, or silently take the first shape?

2. **`CreateBuilder.build()` missing-data guard** — should it throw like UpdateBuilder does when no data is set, or is `{}` valid for creating an empty node?

3. **`FieldSet.all()` depth parameter** — implement recursive depth enumeration, or remove the parameter? What does depth > 1 mean for circular shape references?

4. **`FieldSet.select()` vs `FieldSet.set()` duplication** — remove one? Which name is canonical?

5. **Dead import cleanup** — remove `FieldSetJSON` import from QueryBuilder.ts, `toNodeReference` import from UpdateBuilder.ts

6. **`toJSON()` dead branch** — remove unreachable `else if (this._selectAllLabels)` in QueryBuilder.toJSON()

7. **Reduce `as any` / `as unknown as` casts** — now that Phase 7 unifies the proxy code and Phase 9 removes the factory bridge, many of the 28 `as any` casts in the queries directory should be eliminable

8. **Clone type preservation** — `clone()` currently returns `QueryBuilder<S, any>` then casts back. With the architecture settled, can clone preserve all generic parameters properly?

9. **`PropertyPath.segments` defensive copy** — constructor receives bare `PropertyShape[]` array, caller could mutate. Add `Object.freeze` or slice?

10. **`FieldSet.traceFieldsFromCallback` removal** — after Phase 7 replaces it with `createProxiedPathBuilder`, delete the old simple proxy code

---

## Scope boundaries

**In scope (this plan):**
- PropertyPath (value object, segments, comparison helpers with `sh:datatype` validation)
- walkPropertyPath (string path → PropertyPath resolution)
- ProxiedPathBuilder extraction (shared proxy between DSL and dynamic builders, `.path()` escape hatch)
- FieldSet as canonical query primitive (construction, composition, scoped filters, sub-selections, aggregations, nesting, serialization)
- QueryBuilder (fluent chain, immutable, PromiseLike, direct IR generation, serialization)
- Mutation builders: CreateBuilder, UpdateBuilder, DeleteBuilder (immutable, PromiseLike, reuse existing IR pipeline)
- DSL alignment (Person.select/create/update/delete → returns builders, .for()/.forAll() pattern)
- Shape resolution by prefixed IRI string (for `.from('my:PersonShape')` and JSON deserialization)
- `Person.selectAll({ depth })` — FieldSet.all with depth exposed on DSL
- Tests verifying DSL and builders produce identical IR
- `forAll(ids)` — multi-ID subject filtering via VALUES clause (Phase 6)
- Unified callback tracing — FieldSet reuses ProxiedPathBuilder, carries where/sub-select/aggregation, typed `FieldSet<R>` (Phase 7)
- Direct IR generation — QueryBuilder bypasses SelectQueryFactory, converts FieldSet → RawSelectInput (Phase 8)
- Sub-queries through FieldSet — DSL proxy produces nested FieldSets instead of nested SelectQueryFactory (Phase 9)
- SelectQueryFactory removal (Phase 10a–10g): Evaluation support in FieldSetEntry (10a), preload/BoundComponent support (10b), standalone where evaluation replacing LinkedWhereQuery (10c), lightweight sub-select wrapper replacing factory in proxy handlers (10d), remove _buildFactory() (10e), migrate type utilities (10f), delete SelectQueryFactory class (10g)
- Hardening — API cleanup, robustness, cast reduction (Phase 11, items reviewed individually)

**Out of scope (separate plans, already have ideation docs):**
- `FieldSet.summary()` — CMS-layer concern, not core
- Shared variable bindings / `.as()` activation → 008
- Shape remapping / ShapeAdapter → 009
- Computed expressions / L module → 006
- Raw IR helpers (Option A) → future
- CONSTRUCT / MINUS query types → 004, 007

---

## Task Breakdown (Phases 6–11)

### Dependency Graph

```
Phase 6              [independent — can run in parallel with 7a/7b]
Phase 7a             [independent — pure data model]
    ↓
Phase 7b             [depends on 7a — uses new entry fields]
    ↓
Phase 7c             [depends on 7b — uses ShapeClass overloads]
    ↓
Phase 7d ←→ Phase 7e [both depend on 7c, independent of each other — can run in parallel]
    ↓         ↓
Phase 8              [depends on 7c+7d+7e — needs FieldSet with full info + serialization + types]
    ↓
Phase 9              [depends on 8 — FieldSet replaces factory in DSL proxy]
    ↓
Phase 10a ←→ 10b ←→ 10c ←→ 10d  [all depend on 9, independent of each other — can run in parallel]
    ↓         ↓         ↓         ↓
Phase 10e            [depends on 10a+10b+10c+10d — remove _buildFactory()]
    ↓
Phase 10f            [depends on 10e — migrate type utilities]
    ↓
Phase 10g            [depends on 10f — delete SelectQueryFactory class]
    ↓
Phase 11             [depends on 10g — cleanup pass]
```

**Parallel opportunities:**
- Phase 6, 7a can run in parallel (no shared code)
- Phase 7d, 7e can run in parallel after 7c (7d = serialization, 7e = types — no overlap)
- Phase 10a, 10b, 10c, 10d can all run in parallel after Phase 9 (each removes one dependency cluster independently)

---

### Phase 6: forAll(ids) — multi-ID subject filtering ✅

#### Tasks

1. Add `_subjects: string[]` field to QueryBuilder internal state
2. Implement `.forAll(ids?: (string | {id: string})[])` method — normalizes inputs, returns clone
3. Implement mutual exclusion with `.for()` — `.for()` clears `_subjects`, `.forAll()` clears `_subject`
4. Update `toRawInput()` — pass `subjects` array to `RawSelectInput`
5. Update IR pipeline — add `VALUES` clause or `FILTER(?subject IN (...))` for multi-subject
6. `toJSON()` — serialize `_subjects` as string array
7. `fromJSON()` — restore `_subjects` and populate builder

#### Validation

**Test file:** `src/tests/query-builder.test.ts` (new `QueryBuilder — forAll` describe block)

| Test case | Assertion |
|---|---|
| `forAll([id1, id2])` produces IR with subjects | Assert IR has `subjects` array of length 2 containing both IRIs |
| `forAll()` without IDs produces no subject filter | Assert IR has no `subject` and no `subjects` field |
| `for(id)` after `forAll(ids)` clears multi-subject | Assert IR has single `subject`, no `subjects` |
| `forAll(ids)` after `for(id)` clears single subject | Assert IR has `subjects`, no `subject` |
| `forAll() immutability` | Assert original builder unchanged after `.forAll()` |
| `forAll accepts {id} references` | Assert `forAll([{id: 'urn:x'}, 'urn:y'])` normalizes both to strings |

**Test file:** `src/tests/serialization.test.ts` (add to `QueryBuilder — serialization`)

| Test case | Assertion |
|---|---|
| `toJSON — with subjects` | Assert `json.subjects` is string array of length 2 |
| `fromJSON — round-trip forAll` | Assert round-trip IR equivalence for multi-subject query |

**Non-test validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 7a: Extend FieldSetEntry data model ✅

#### Tasks

1. Add optional fields to `FieldSetEntry` type: `subSelect?: FieldSet`, `aggregation?: 'count'`, `customKey?: string`
2. Update `FieldSetJSON` / `FieldSetFieldJSON` types to include `subSelect?: FieldSetJSON`, `aggregation?: string`, `customKey?: string`
3. Update `toJSON()` — serialize new fields (subSelect recursively via `subSelect.toJSON()`, aggregation as string, customKey as string)
4. Update `fromJSON()` — deserialize new fields (subSelect recursively via `FieldSet.fromJSON()`, aggregation, customKey)
5. Update `merge()` — include new fields in deduplication key (entries with same path but different subSelect/aggregation are distinct)
6. Verify `add()`, `remove()`, `pick()` preserve new fields on entries (they already operate on whole entries — just verify)

#### Validation

**Test file:** `src/tests/field-set.test.ts` (new `FieldSet — extended entries` describe block)

| Test case | Assertion |
|---|---|
| `entry with subSelect preserved through add()` | Create FieldSet with entry that has `subSelect` field manually set. Call `.add(['hobby'])`. Assert original entry still has `subSelect` field intact |
| `entry with aggregation preserved through pick()` | Create FieldSet with entry that has `aggregation: 'count'`. Call `.pick([label])`. Assert picked entry has `aggregation: 'count'` |
| `entry with customKey preserved through merge()` | Merge two FieldSets where one entry has `customKey: 'numFriends'`. Assert merged result contains the entry with `customKey` |
| `entries with same path but different aggregation are distinct in merge()` | Merge FieldSet with `friends` (plain) and FieldSet with `friends` + `aggregation: 'count'`. Assert merged has 2 entries, not 1 |

**Test file:** `src/tests/serialization.test.ts` (new `FieldSet — extended serialization` describe block)

| Test case | Assertion |
|---|---|
| `toJSON — entry with subSelect` | Create entry with `subSelect` FieldSet containing `['name']`. Assert `json.fields[0].subSelect` is a valid FieldSetJSON with 1 field |
| `toJSON — entry with aggregation` | Create entry with `aggregation: 'count'`. Assert `json.fields[0].aggregation === 'count'` |
| `toJSON — entry with customKey` | Create entry with `customKey: 'numFriends'`. Assert `json.fields[0].customKey === 'numFriends'` |
| `fromJSON — round-trip subSelect` | Round-trip entry with subSelect. Assert restored entry has `subSelect` FieldSet with correct shape and labels |
| `fromJSON — round-trip aggregation` | Round-trip entry with `aggregation: 'count'`. Assert restored entry has `aggregation === 'count'` |
| `fromJSON — round-trip customKey` | Round-trip entry with `customKey`. Assert restored entry has matching customKey |

**Non-test validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all existing tests pass unchanged (new fields are optional, no behavior change)

---

### Phase 7b: FieldSet.for() accepts ShapeClass + NodeShape overloads ✅

#### Tasks

1. Add overload signatures to `FieldSet.for()` accepting `ShapeType<S>` (shape class like `Person`)
2. Update `resolveShape()` to handle ShapeClass input — extract `.shape` property to get NodeShape
3. Add same overload to `FieldSet.all()` — accept ShapeClass
4. Store ShapeClass reference on FieldSet instance (private `_shapeClass?: ShapeType<any>`) for later use in 7c
5. Update `FieldSet.merge()` to propagate `_shapeClass` when all inputs share the same one

#### Validation

**Test file:** `src/tests/field-set.test.ts` (new `FieldSet — ShapeClass overloads` describe block)

| Test case | Assertion |
|---|---|
| `FieldSet.for(Person, ['name'])` produces same FieldSet as NodeShape | Assert `FieldSet.for(Person, ['name']).labels()` equals `FieldSet.for(personShape, ['name']).labels()` |
| `FieldSet.for(Person, ['name'])` has correct shape | Assert `.shape` is the same NodeShape instance as `personShape` |
| `FieldSet.for(Person, p => [p.name])` callback works | Assert produces FieldSet with 1 entry, label `'name'` (still uses simple proxy for now) |
| `FieldSet.all(Person)` produces same as FieldSet.all(personShape)` | Assert `.labels()` are identical |
| `FieldSet.for(Person, ['friends.name'])` nested path works | Assert entry path toString equals `'friends.name'` |

**Non-test validation:**
- `npx tsc --noEmit` exits 0 — overloads compile correctly, `Person` accepted without cast
- `npm test` — all existing tests pass unchanged

---

### Phase 7c: Replace traceFieldsFromCallback with ProxiedPathBuilder ✅

**This is the core phase.** FieldSet callbacks now go through the real `createProxiedPathBuilder` proxy, enabling nested paths, where, aggregation, and sub-selects.

#### Tasks

1. Add `queryBuilderObjectToFieldSetEntry()` conversion utility:
   - Walk `QueryBuilderObject` chain (`.subject` → `.property`) to collect `PropertyPath` segments
   - Extract `.wherePath` → `scopedFilter` on the entry
   - Detect `SetSize` instance → `aggregation: 'count'`
   - Detect sub-`SelectQueryFactory` or sub-select result → `subSelect: FieldSet` (recursive)
   - Handle custom object results → `customKey` on each entry
2. Replace `traceFieldsFromCallback()` body:
   - When `_shapeClass` is available (set in 7b), use `createProxiedPathBuilder(shapeClass)` to get full proxy
   - When only NodeShape available, look up ShapeClass via registry; fall back to current simple proxy if not found
   - Pass proxy through callback, convert returned `QueryBuilderObject[]` via step 1
3. Delete old simple proxy code (the `new Proxy({}, { get(_target, key) { accessed.push(key) } })` block)
4. Update `FieldSet.for(Person, callback)` path to flow through new proxy

**Stubs needed for parallel execution:** None — 7c depends on 7a+7b, and 7d+7e depend on 7c.

#### Validation

**Test file:** `src/tests/field-set.test.ts` (new `FieldSet — callback tracing (ProxiedPathBuilder)` describe block)

These tests are the FieldSet-native equivalents of assertions that currently only exist in the QueryBuilder/DSL test suites. They validate that FieldSet itself — not just the downstream IR — correctly captures the rich query information.

| Test case | Assertion |
|---|---|
| `flat callback still works` | `FieldSet.for(Person, p => [p.name, p.hobby])` → 2 entries, labels `['name', 'hobby']` |
| `nested path via callback` | `FieldSet.for(Person, p => [p.friends.name])` → 1 entry, `path.toString() === 'friends.name'`, `path.segments.length === 2` |
| `deep nested path via callback` | `FieldSet.for(Person, p => [p.friends.bestFriend.name])` → 1 entry, `path.segments.length === 3`, `path.toString() === 'friends.bestFriend.name'` |
| `where condition captured on entry` | `FieldSet.for(Person, p => [p.friends.where(f => f.name.equals('Moa'))])` → 1 entry with `scopedFilter` defined and non-null |
| `aggregation captured on entry` | `FieldSet.for(Person, p => [p.friends.size()])` → 1 entry with `aggregation === 'count'` |
| `sub-select captured on entry` | `FieldSet.for(Person, p => [p.friends.select(f => [f.name, f.hobby])])` → 1 entry with `subSelect` instanceof FieldSet, `subSelect.labels()` equals `['name', 'hobby']` |
| `sub-select with custom object` | `FieldSet.for(Person, p => [p.friends.select(f => ({name: f.name, hobby: f.hobby}))])` → 1 entry with `subSelect` FieldSet and `customKey` values on sub-entries |
| `multiple mixed selections` | `FieldSet.for(Person, p => [p.name, p.friends.name, p.bestFriend.hobby])` → 3 entries with correct paths |

**IR equivalence tests** (in `src/tests/field-set.test.ts`, new `FieldSet — IR equivalence with callback` describe block):

These prove that FieldSet-constructed queries produce the same IR as direct callback queries. They mirror existing tests in `query-builder.test.ts` but go through the FieldSet path.

| Test case | Assertion |
|---|---|
| `nested path IR equivalence` | `QueryBuilder.from(Person).select(fieldSet)` where fieldSet built from `FieldSet.for(Person, p => [p.friends.name])` produces same IR as `QueryBuilder.from(Person).select(p => p.friends.name).build()` |
| `where condition IR equivalence` | FieldSet with where → same IR as callback with where |
| `aggregation IR equivalence` | FieldSet with `.size()` → same IR as callback with `.size()` |
| `sub-select IR equivalence` | FieldSet with `.select()` → same IR as callback with `.select()` |

**Non-test validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass including all existing query-builder and golden tests (regression)
- Existing `FieldSet.for — callback` test in construction block still passes (backward compatible)

---

### Phase 7d: toJSON for callback-based selections ✅

#### Tasks

1. Update `QueryBuilder.fields()` — when `_selectFn` is set but `_fieldSet` is not, eagerly evaluate the callback through `createProxiedPathBuilder` to produce and cache a FieldSet
2. `toJSON()` then works naturally because `fields()` always returns a FieldSet
3. Fix `fromJSON()` — read and restore `orderDirection` from JSON (currently ignored)
4. Assess where/orderBy callback serialization scope — document decision in plan

#### Validation

**Test file:** `src/tests/serialization.test.ts` (add to `QueryBuilder — serialization`)

| Test case | Assertion |
|---|---|
| `toJSON — callback select` | `QueryBuilder.from(Person).select(p => [p.name]).toJSON()` → `json.fields` has 1 entry with `path === 'name'` |
| `toJSON — callback select nested` | `QueryBuilder.from(Person).select(p => [p.friends.name]).toJSON()` → `json.fields[0].path === 'friends.name'` |
| `toJSON — callback select with aggregation` | `QueryBuilder.from(Person).select(p => [p.friends.size()]).toJSON()` → `json.fields[0].aggregation === 'count'` |
| `toJSON — callback select with subSelect` | `QueryBuilder.from(Person).select(p => [p.friends.select(f => [f.name])]).toJSON()` → `json.fields[0].subSelect` is valid FieldSetJSON |
| `fromJSON — round-trip callback select` | Round-trip: callback select → toJSON → fromJSON → build → compare IR to original |
| `fromJSON — orderDirection preserved` | `QueryBuilder.from(Person).select(['name']).orderBy(p => p.name, 'DESC').toJSON()` → fromJSON → assert `orderDirection` is 'DESC' in rebuilt JSON |
| `fromJSON — orderDirection round-trip IR` | Full round-trip: orderBy DESC → toJSON → fromJSON → build → assert IR has DESC sort |

**Non-test validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 7e: Typed FieldSet\<R\> — carry callback return type ✅

#### Tasks

1. Add generic parameter `R` to FieldSet class: `class FieldSet<R = any>`
2. Update `FieldSet.for()` overload for callback form to capture `R`: `static for<S extends Shape, R>(shape: ShapeType<S>, fn: (p: ProxiedShape<S>) => R): FieldSet<R>`
3. String/label overloads return `FieldSet<any>` (no type inference possible)
4. Wire through `QueryBuilder.select()`: `select<R>(fieldSet: FieldSet<R>): QueryBuilder<S, R, ...>`
5. Composition methods (`.add()`, `.remove()`, `.pick()`, `.merge()`) return `FieldSet<any>` (composition breaks type capture)

#### Validation

**Test file:** `src/tests/query-builder.types.test.ts` (add to compile-time type assertions)

| Test case | Assertion |
|---|---|
| `FieldSet.for(Person, p => [p.name]) carries type` | `const fs = FieldSet.for(Person, p => [p.name])` — compile-time: `fs` is `FieldSet<QueryBuilderObject[]>` (or the specific return type) |
| `QueryBuilder.select(typedFieldSet) resolves typed result` | `QueryBuilder.from(Person).select(fs)` — compile-time: result type matches callback return type |
| `FieldSet.for(personShape, ['name']) is FieldSet<any>` | Compile-time: string-constructed FieldSet has `any` type parameter |
| `composition degrades to FieldSet<any>` | `fs.add(['hobby'])` — compile-time: result is `FieldSet<any>` |

**Non-test validation:**
- `npx tsc --noEmit` exits 0 — this is the primary validation (type system correctness)
- `npm test` — all tests pass (runtime behavior unchanged)

---

### Phase 8: QueryBuilder generates IR directly — bypass SelectQueryFactory

#### Tasks

1. Build `fieldSetToSelectPath()` — converts `FieldSetEntry[]` to `QueryPath[]` (the format `RawSelectInput.select` expects):
   - PropertyPath segments → `PropertyQueryStep[]`
   - `entry.scopedFilter` → step `.where`
   - `entry.subSelect` → nested `QueryPath[]` (recursive)
   - `entry.aggregation === 'count'` → `SizeStep`
2. Build `evaluateWhere()` — runs where callback through `createProxiedPathBuilder`, extracts `WherePath`
3. Build `evaluateSort()` — runs orderBy callback through proxy, extracts sort path + direction
4. Replace `QueryBuilder.buildFactory()` with direct `toRawInput()` using steps 1–3
5. Keep `buildFactory()` as deprecated fallback (removed in Phase 10)

#### Validation

**Test file:** `src/tests/query-builder.test.ts` — all existing `IR equivalence with DSL` tests serve as regression validation. No new test file needed — the existing 12 IR equivalence tests (`selectName`, `selectMultiplePaths`, `selectFriendsName`, `selectDeepNested`, `whereFriendsNameEquals`, `whereAnd`, `selectById`, `outerWhereLimit`, `sortByAsc`, `countFriends`, `subSelectPluralCustom`, `selectAllProperties`) must all still pass.

**Additional test cases** (add to `query-builder.test.ts`, new `QueryBuilder — direct IR generation` describe block):

| Test case | Assertion |
|---|---|
| `FieldSet with where produces same IR as callback` | `QueryBuilder.from(Person).select(fieldSetWithWhere).build()` equals callback-based IR |
| `FieldSet with subSelect produces same IR as callback` | Sub-select through FieldSet → same IR |
| `FieldSet with aggregation produces same IR as callback` | Aggregation through FieldSet → same IR |
| `buildFactory is no longer called` | Spy/mock `buildFactory` — assert it's never invoked when FieldSet path is used |

**Non-test validation:**
- All golden SPARQL tests pass (`sparql-select-golden.test.ts` — 50+ tests)
- All IR golden tests pass (`ir-select-golden.test.ts`)
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 9: Sub-queries through FieldSet — remove SelectQueryFactory from DSL path ✅

**Status: Complete.**

FieldSet now properly handles sub-selects from DSL proxy tracing. Instead of changing `QueryShapeSet.select()` (which would break the legacy path), we enhanced `FieldSet.convertTraceResult()` to extract sub-select FieldSets from the factory's `traceResponse`. Callbacks producing sub-selects now go through the direct FieldSet→RawSelectInput path via try/catch fallback. Callbacks with Evaluation or BoundComponent (preload) results still fall back to the legacy path.

**Files delivered:**
- `src/queries/FieldSet.ts` — enhanced `convertTraceResult()` for SelectQueryFactory extraction, added `extractSubSelectEntries()`, `createInternal()`, duck-type detectors for Evaluation and BoundComponent
- `src/queries/SelectQuery.ts` — `fieldSetToSelectPath()` returns `SelectPath` (supports `CustomQueryObject` when all entries have `customKey`), refactored to use `entryToQueryPath()` helper
- `src/queries/QueryBuilder.ts` — `toRawInput()` uses try/catch for callback direct path, preload guard restored
- `src/tests/field-set.test.ts` — 4 new tests in "FieldSet — sub-select extraction" block

**Original plan below for reference:**

#### Tasks

1. Update `QueryShapeSet.select()` — instead of `new SelectQueryFactory(valueShape, fn)`, produce `FieldSet.for(valueShape, fn)` and store as parent `FieldSetEntry.subSelect`
2. Update `QueryShape.select()` — same change for single-value sub-selections
3. Update `BoundComponent.getComponentQueryPaths()` — convert component's query to FieldSet, merge into parent sub-selection
4. Remove SelectQueryFactory creation from proxy handlers

**Stubs for parallel execution:** N/A — this phase is sequential after Phase 8.

#### Validation

**Test file:** `src/tests/query-builder.test.ts` — existing sub-select IR equivalence test (`subSelectPluralCustom`) must pass unchanged.

**Regression tests** — all golden tests that exercise sub-selects must pass:

| Golden test file | Sub-select test cases |
|---|---|
| `sparql-select-golden.test.ts` | `subSelectSingleProp`, `subSelectPluralCustom`, `subSelectAllProperties`, `subSelectAllPropertiesSingle`, `subSelectAllPrimitives`, `subSelectArray`, `doubleNestedSubSelect`, `nestedQueries2` |
| `ir-select-golden.test.ts` | `build preserves nested sub-select projections inside array selections` |

**New integration test** (add to `field-set.test.ts`):

| Test case | Assertion |
|---|---|
| `DSL sub-select produces FieldSet entry with subSelect` | After Phase 9, `Person.select(p => p.friends.select(f => [f.name]))` internally creates FieldSet. Verify via `QueryBuilder.from(Person).select(p => p.friends.select(f => [f.name])).fields()` returns a FieldSet with entry that has `subSelect` |

**Non-test validation:**
- `grep -r 'new SelectQueryFactory' src/` returns 0 hits (excluding the factory's own file and tests)
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 10a: Evaluation support in FieldSetEntry ✅

**Goal:** Remove the `throw` for Evaluation selections in `FieldSet.convertTraceResult()`. Evaluation-as-selection (e.g. `p.bestFriend.equals(someValue)` used inside a select callback) becomes a proper `FieldSetEntry` variant.

**Depends on:** Phase 9

**Files expected to change:**
- `src/queries/FieldSet.ts` — `FieldSetEntry` type, `convertTraceResult()`, `toJSON()`, `fromJSON()`, `FieldSetFieldJSON`
- `src/queries/SelectQuery.ts` — `fieldSetToSelectPath()` / `entryToQueryPath()`
- `src/queries/QueryBuilder.ts` — remove Evaluation fallback from `toRawInput()` try/catch
- `src/tests/field-set.test.ts` — new test block
- `src/tests/query-builder.test.ts` — IR equivalence test

#### Architecture

An Evaluation used as a selection represents a boolean/filter column projected into the result. The `isEvaluation()` duck-type check (FieldSet.ts line 40) detects objects with `method`, `value`, and `getWherePath()`. Currently throws — needs to extract:
- The property path from the Evaluation's underlying `QueryBuilderObject` (the `.value` chain) — same `collectPropertySegments()` logic used for regular QueryBuilderObjects
- The where condition from `Evaluation.getWherePath()` stored as `evaluation`

Add an optional `evaluation` field to `FieldSetEntry`:

```typescript
export type FieldSetEntry = {
  path: PropertyPath;
  alias?: string;
  scopedFilter?: WhereCondition;
  subSelect?: FieldSet;
  aggregation?: 'count';
  customKey?: string;
  evaluation?: { method: string; wherePath: any };  // NEW
};
```

**Key pitfall:** The Evaluation's `.value` is a `QueryBuilderObject` but may be deeply nested (e.g. `p.friends.bestFriend.equals(...)`). The `collectPropertySegments()` already walks `.subject` → `.property` chains — verify it handles the `.value` chain the same way, or if `.value` IS a `QueryBuilderObject` that has `.subject`.

#### Tasks

1. **Add `evaluation` field to `FieldSetEntry` type** (FieldSet.ts ~line 65)
   - Add `evaluation?: { method: string; wherePath: any }` to the type
2. **Update `FieldSetFieldJSON` type** (FieldSet.ts ~line 83)
   - Add `evaluation?: { method: string; wherePath: any }` to the JSON type
3. **Replace `throw` in `convertTraceResult()`** (FieldSet.ts ~line 472)
   - When `isEvaluation(obj)`:
     - Extract `obj.value` — this is the underlying QueryBuilderObject
     - Call `FieldSet.collectPropertySegments(obj.value)` to get PropertyPath segments
     - Create entry with `path: new PropertyPath(rootShape, segments)` and `evaluation: { method: obj.method, wherePath: obj.getWherePath() }`
4. **Update `entryToQueryPath()` in SelectQuery.ts** (~line 920)
   - When entry has `evaluation` field, produce the same `QueryPath` that the legacy `getQueryPaths()` produced for Evaluation results — a property path step that carries the boolean evaluation as a terminal
   - **Critical:** Study how `SelectQueryFactory.getQueryPaths()` handles Evaluation results (search for `instanceof Evaluation` in `getQueryPaths()` at ~line 1897) to understand the exact IR shape expected
5. **Update `toJSON()`** (FieldSet.ts) — serialize `evaluation` field as-is (method string + wherePath object)
6. **Update `fromJSON()`** (FieldSet.ts) — restore `evaluation` field from JSON
7. **Remove Evaluation fallback from `toRawInput()`** (QueryBuilder.ts ~line 462)
   - The try/catch at line 462-471 catches errors from `_buildDirectRawInput()` and falls back to `_buildFactoryRawInput()`. After this phase, Evaluation selections no longer throw — but the try/catch stays for BoundComponent (removed in 10b)
   - No code change here yet — the try/catch now simply won't trigger for Evaluation. Verify with test.

**Stubs for parallel execution:** None needed — this phase only touches the Evaluation branch. BoundComponent branch remains unchanged. Other agents working on 10b/10c/10d touch different code paths.

#### Validation

**Test file:** `src/tests/field-set.test.ts` (new `FieldSet — evaluation entries` describe block)

Uses `Person` shape from `query-fixtures`. `personShape = (Person as any).shape`.

| Test case | Assertion |
|---|---|
| `Evaluation trace produces entry with evaluation field` | `FieldSet.for(Person, p => [p.name.equals('Moa')])` → assert `entries.length === 1`, assert `entries[0].evaluation` is defined, assert `entries[0].evaluation.method` is a string (e.g. `'equals'`) |
| `Evaluation entry has correct property path` | Same FieldSet as above → assert `entries[0].path.toString() === 'name'`, assert `entries[0].path.segments.length === 1` |
| `Deep evaluation path` | `FieldSet.for(Person, p => [p.friends.name.equals('Moa')])` → assert `entries[0].path.toString() === 'friends.name'`, assert `entries[0].path.segments.length === 2` |
| `Evaluation entry has wherePath` | Assert `entries[0].evaluation.wherePath` is defined and is a valid WherePath object (has expected structure) |
| `Evaluation mixed with regular fields` | `FieldSet.for(Person, p => [p.hobby, p.name.equals('Moa')])` → assert `entries.length === 2`, assert `entries[0].evaluation` is undefined, assert `entries[1].evaluation` is defined |
| `Evaluation entry serialization round-trip` | Build FieldSet with evaluation entry → `toJSON()` → assert `json.fields[0].evaluation` has `method` and `wherePath` → `fromJSON()` → assert restored entry has matching `evaluation` field |

**IR equivalence test** (in `src/tests/query-builder.test.ts`, add to `QueryBuilder — direct IR generation` describe block):

| Test case | Assertion |
|---|---|
| `evaluationSelection` — `Person.select(p => [p.name.equals('Moa')])` | Capture IR from DSL via `captureDslIR()`. Build equivalent via `QueryBuilder.from(Person).select(p => [p.name.equals('Moa')]).build()`. Assert `sanitize(builderIR) === sanitize(dslIR)` — same deep-equal pattern used by existing IR equivalence tests (lines 97-227 of query-builder.test.ts) |

**Non-test validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass including all 50+ golden SPARQL tests
- Existing `FieldSet — callback tracing` tests at line 195 still pass (no regression for non-evaluation paths)

---

### Phase 10b: BoundComponent (preload) support in FieldSetEntry ✅

**Goal:** Remove the `throw` for BoundComponent in `FieldSet.convertTraceResult()`. Preloads become a proper `FieldSetEntry` variant. Remove `_buildFactory()` preload guard in `toRawInput()`.

**Depends on:** Phase 9 (independent of 10a — can run in parallel)

**Files expected to change:**
- `src/queries/FieldSet.ts` — `FieldSetEntry` type, `convertTraceResult()`, `FieldSetFieldJSON`
- `src/queries/SelectQuery.ts` — `entryToQueryPath()` or `fieldSetToSelectPath()`
- `src/queries/QueryBuilder.ts` — remove preload guard in `toRawInput()`, update `_buildDirectRawInput()` to handle preloads via FieldSet, remove `_preloads` insertion in `_buildFactory()`
- `src/tests/field-set.test.ts` — new test block
- `src/tests/query-builder.test.ts` — IR equivalence test for preloads

#### Architecture

A BoundComponent (duck-typed at FieldSet.ts line 47: has `source`, `originalValue`, `getComponentQueryPaths()`) represents `p.friends.preloadFor(someComponent)`. The entry needs:
- The property path from the BoundComponent's `.source` chain — the `.source` is a QueryBuilderObject, walk it with `collectPropertySegments()`
- The component's query paths from `obj.getComponentQueryPaths()` — these are the nested selections the component needs

Add an optional `preload` field to `FieldSetEntry`:

```typescript
export type FieldSetEntry = {
  // ... existing fields ...
  preload?: { component: any; queryPaths: any[] };  // NEW
};
```

**Key pitfall:** The legacy preload path in `_buildFactory()` (QueryBuilder.ts line 397-435) wraps preloads into the `selectFn` callback, causing them to be traced as part of the regular selection. The new path needs to produce the same IR — specifically the OPTIONAL-wrapped pattern that preloads generate. Study the existing preload test at query-builder.test.ts line 309-384 to understand the expected IR shape.

**Key pitfall 2:** `QueryBuilder.preload()` stores entries in `_preloads` array (not in the select callback). After this phase, preloads should go through the FieldSet path instead. The `_preloads` array may become unnecessary, but keep it for now — removal in 10e.

#### Tasks

1. **Add `preload` field to `FieldSetEntry` type** (FieldSet.ts ~line 65)
   - Add `preload?: { component: any; queryPaths: any[] }`
2. **Replace `throw` in `convertTraceResult()`** (FieldSet.ts ~line 477)
   - When `isBoundComponent(obj)`:
     - Extract `obj.source` — this is the underlying QueryBuilderObject for the property path
     - Call `FieldSet.collectPropertySegments(obj.source)` to get segments
     - Call `obj.getComponentQueryPaths()` to get the component's query paths
     - Return entry with `path` and `preload: { component: obj, queryPaths }`
3. **Update `entryToQueryPath()` in SelectQuery.ts**
   - When entry has `preload` field, emit the same `QueryPath` structure that the legacy `getQueryPaths()` produced for BoundComponent results
   - Study `SelectQueryFactory.getQueryPaths()` handling of `BoundComponent` (search for `instanceof BoundComponent` at ~line 1905) — it calls `getComponentQueryPaths()` and merges results into the parent path
4. **Update `QueryBuilder.toRawInput()`** (line 452-454)
   - Remove the preload guard: `if (this._preloads && this._preloads.length > 0) { return this._buildFactoryRawInput(); }`
   - Instead, when `_preloads` exist, merge them into the FieldSet before calling `_buildDirectRawInput()`:
     - Create proxy via `createProxiedPathBuilder(this._shape)`
     - For each preload entry, trace `proxy[entry.path].preloadFor(entry.component)` to get a BoundComponent
     - The resulting BoundComponent will be handled by `convertTraceResult()` (from step 2)
5. **Do NOT remove `_preloads` array yet** — keep for backward compatibility until 10e

**Stubs for parallel execution:** None needed — touches different code path than 10a (BoundComponent vs Evaluation branch). 10c touches `processWhereClause` (unrelated). 10d touches `QueryShapeSet.select()`/`QueryShape.select()` (unrelated).

#### Validation

**Test file:** `src/tests/field-set.test.ts` (new `FieldSet — preload entries` describe block)

Uses `Person` shape and a mock component. The existing preload tests at query-builder.test.ts lines 309-384 use `tmpEntityBase` to create a component with `PersonQuery`.

| Test case | Assertion |
|---|---|
| `BoundComponent trace produces entry with preload field` | Create a mock BoundComponent (or use real `preloadFor` via proxy tracing). Assert `entries.length === 1`, assert `entries[0].preload` is defined |
| `Preload entry has correct property path` | Assert `entries[0].path.toString()` matches the property name (e.g. `'friends'` or `'bestFriend'`) |
| `Preload entry carries component query paths` | Assert `entries[0].preload.queryPaths` is an array with length > 0, containing the paths the component declared |
| `Preload mixed with regular fields` | `FieldSet.for(Person, p => [p.name, p.friends.preloadFor(comp)])` → assert `entries.length === 2`, assert `entries[0].preload` is undefined, assert `entries[1].preload` is defined |

**IR equivalence tests** (in `src/tests/query-builder.test.ts`, extend existing `QueryBuilder — preloads` describe block at line 309):

| Test case | Assertion |
|---|---|
| `preload through direct FieldSet path produces same IR` | Use existing `tmpEntityBase` setup. Build `QueryBuilder.from(Person).select(p => [p.name]).preload('friends', comp).build()`. Capture IR. Compare with legacy `_buildFactory()` IR (call `_buildFactoryRawInput()` before removal). Assert `sanitize(directIR) === sanitize(legacyIR)` |
| `preload guard removed — toRawInput no longer falls back` | After change, verify that `toRawInput()` for a preload query does NOT call `_buildFactory()` — confirm by adding a `console.warn` or spy in `_buildFactory()`, or simply by verifying the test passes after the guard is removed |

**Non-test validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass
- Existing preload tests at query-builder.test.ts lines 309-384 pass unchanged
- All golden SPARQL tests pass unchanged (preload patterns produce same SPARQL)

---

### Phase 10c: Replace LinkedWhereQuery with standalone where evaluation ✅

**Goal:** `processWhereClause()` no longer instantiates `SelectQueryFactory` (via `LinkedWhereQuery extends SelectQueryFactory`). Use `createProxiedPathBuilder` directly.

**Depends on:** Phase 9 (independent of 10a/10b — can run in parallel)

**Files expected to change:**
- `src/queries/SelectQuery.ts` — `processWhereClause()` function (~line 1053), delete `LinkedWhereQuery` class (~line 2177)

#### Architecture

`LinkedWhereQuery` (SelectQuery.ts line 2177-2187) extends `SelectQueryFactory`, inheriting the constructor that:
1. Calls `createProxiedPathBuilder(shape)` to build a proxy
2. Passes the proxy to the callback
3. Stores the result as `this.traceResponse`

Then `LinkedWhereQuery.getWherePath()` just calls `(this.traceResponse as Evaluation).getWherePath()`.

The replacement in `processWhereClause()` does the same thing directly:
1. Look up the ShapeClass from `shape` parameter (it may be a ShapeClass already, or need resolution)
2. Call `createProxiedPathBuilder(shapeClass)` to get the proxy
3. Call `validation(proxy)` — the where callback — returns an Evaluation
4. Call `evaluation.getWherePath()` directly

**Key pitfall:** The `shape` parameter to `processWhereClause()` can be a `ShapeType` (class) or a `NodeShape`. The `SelectQueryFactory` constructor handles both via its own resolution. The replacement needs to handle both cases too — use the same `getShapeClass()` or just pass to `createProxiedPathBuilder()` which already handles ShapeClass input.

**Key pitfall 2:** `processWhereClause()` is also called by `SelectQueryFactory` internally (lines 1312, 1353, 1578, 1585, 1617, 1827). After deleting `LinkedWhereQuery`, these internal calls must still work. They pass `this.shape` which is a ShapeClass — verify `createProxiedPathBuilder` handles it.

#### Tasks

1. **Update `processWhereClause()` body** (SelectQuery.ts ~line 1053-1065):
   ```typescript
   export const processWhereClause = (
     validation: WhereClause<any>,
     shape?,
   ): WherePath => {
     if (validation instanceof Function) {
       if (!shape) {
         throw new Error('Cannot process where clause without shape');
       }
       const proxy = createProxiedPathBuilder(shape);
       const evaluation = validation(proxy);
       return evaluation.getWherePath();
     } else {
       return (validation as Evaluation).getWherePath();
     }
   };
   ```
2. **Delete `LinkedWhereQuery` class** (SelectQuery.ts ~line 2177-2187)
3. **Add import for `createProxiedPathBuilder`** if not already imported in SelectQuery.ts
4. **Verify all 6+ callers of `processWhereClause()`** still compile and pass tests

#### Validation

**Test file:** `src/tests/query-builder.test.ts` — existing where tests serve as full regression (no new tests needed — this is a pure refactor with identical behavior)

| Test case | Assertion |
|---|---|
| `whereFriendsNameEquals` IR equivalence (existing, ~line 155) | `Person.select(p => [p.name]).where(p => p.friends.name.equals('Moa'))` → assert IR matches DSL IR. Already passes — just verify no regression. |
| `whereAnd` IR equivalence (existing, ~line 168) | `Person.select(p => [p.name]).where(p => p.friends.name.equals('Moa').and(p.hobby.equals('fishing')))` → assert IR matches DSL IR |
| `outerWhereLimit` IR equivalence (existing, ~line 180) | `.where().limit()` combination → assert IR matches |
| All golden SPARQL where tests | `sparql-select-golden.test.ts` tests involving `where` clauses all pass unchanged |

**New test** (in `src/tests/query-builder.test.ts`, add to `QueryBuilder — direct IR generation` block):

| Test case | Assertion |
|---|---|
| `processWhereClause with raw Evaluation` | Create an Evaluation object directly (trace through proxy: `const proxy = createProxiedPathBuilder(Person); const eval = proxy.name.equals('test')`). Call `processWhereClause(eval)`. Assert returns valid WherePath with the expected structure. |

**Non-test validation:**
- `grep -rn 'LinkedWhereQuery' src/` returns 0 hits (only comments allowed)
- `grep -rn 'new LinkedWhereQuery' src/` returns 0 hits
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 10d: Lightweight sub-select wrapper — replace SelectQueryFactory in proxy handlers ✅

**Goal:** `QueryShapeSet.select()` and `QueryShape.select()` no longer create `new SelectQueryFactory`. Replace with a lightweight duck-typed object that satisfies the `isSelectQueryFactory` check in `FieldSet.convertTraceResult()`.

**Depends on:** Phase 9

**Files expected to change:**
- `src/queries/SelectQuery.ts` — `QueryShapeSet.select()` (~line 1318), `QueryShape.select()` (~line 1485)

#### Architecture

Currently `QueryShapeSet.select()` (line 1318-1325) and `QueryShape.select()` (line 1485-1497) create `new SelectQueryFactory(leastSpecificShape, subQueryFn)` and set `.parentQueryPath`. The `SelectQueryFactory` constructor:
1. Calls `createProxiedPathBuilder(shape)` to build a proxy
2. Passes the proxy to `subQueryFn` to trace the sub-query
3. Stores the result as `this.traceResponse`

`FieldSet.convertTraceResult()` (line 441) then detects this via `isSelectQueryFactory()` (line 33: checks for `getQueryPaths` function and `parentQueryPath` property) and extracts `parentQueryPath`, `traceResponse`, and `shape`.

Replace with a plain object carrying the same duck-type interface:

```typescript
select<QF = unknown>(subQueryFn: QueryBuildFn<S, QF>) {
  const leastSpecificShape = this.getOriginalValue().getLeastSpecificShape();
  const proxy = createProxiedPathBuilder(leastSpecificShape);
  const traceResponse = subQueryFn(proxy as any);
  return {
    parentQueryPath: this.getPropertyPath(),
    traceResponse,
    shape: leastSpecificShape,
    getQueryPaths() {
      throw new Error('Legacy getQueryPaths() not supported — use FieldSet path');
    },
  } as any;
}
```

**Key pitfall:** The `SelectQueryFactory` constructor does more than just trace — it also handles `selectAll` mode (no callback), and the traceResponse can be an array or single value. Verify that `subQueryFn(proxy)` produces the same `traceResponse` shape as `SelectQueryFactory`'s constructor would. Specifically:
- The proxy passed to `subQueryFn` must be the same type that `SelectQueryFactory` would pass — a `ProxiedPathBuilder` that returns `QueryBuilderObject`, `QueryShape`, `QueryShapeSet`, etc.
- `createProxiedPathBuilder(leastSpecificShape)` should work if `leastSpecificShape` is a ShapeClass. Verify.

**Key pitfall 2:** `getQueryPaths()` is still called by the legacy `SelectQueryFactory.getQueryPaths()` path (line 1897: `if (endValue instanceof SelectQueryFactory)`). Since we're replacing with a plain object, `instanceof` checks will fail — but this is fine because the FieldSet path (which doesn't use `getQueryPaths()`) is now primary. However, if `_buildFactory()` is still active for some paths, it might call `getQueryPaths()` on the sub-query. The `throw` in `getQueryPaths()` will trigger the try/catch fallback in `toRawInput()`. This is acceptable during the transition — 10e removes `_buildFactory()` entirely.

#### Tasks

1. **Update `QueryShapeSet.select()`** (SelectQuery.ts ~line 1318-1325):
   - Replace `new SelectQueryFactory(leastSpecificShape, subQueryFn)` with lightweight object
   - Use `createProxiedPathBuilder(leastSpecificShape)` to get proxy
   - Call `subQueryFn(proxy)` to trace
   - Return plain object with `parentQueryPath`, `traceResponse`, `shape`, `getQueryPaths()`
2. **Update `QueryShape.select()`** (SelectQuery.ts ~line 1485-1497):
   - Same replacement. Note: uses `getShapeClass((this.getOriginalValue() as Shape).nodeShape.id)` to get the shape class — keep this resolution logic.
3. **Verify `isSelectQueryFactory()` still matches** — the duck-type check requires `typeof obj.getQueryPaths === 'function'` and `'parentQueryPath' in obj`. The lightweight object has both. ✓
4. **Verify `FieldSet.convertTraceResult()` handles it** — it reads `obj.parentQueryPath`, `obj.traceResponse`, `obj.shape`. All present on lightweight object. ✓
5. **Remove `SelectQueryFactory` import** from proxy handler section if no other code in that scope needs it

**Stubs for parallel execution:** None needed. The lightweight object satisfies the same duck-type interface that `FieldSet.convertTraceResult()` expects. Other phases (10a, 10b, 10c) touch different code paths.

#### Validation

**Test files:** `src/tests/query-builder.test.ts`, `src/tests/field-set.test.ts` — existing sub-select tests serve as full regression

| Test case | Assertion |
|---|---|
| `subSelectPluralCustom` IR equivalence (existing, ~line 210) | `Person.select(p => p.friends.select(f => ({name: f.name, hobby: f.hobby})))` → assert IR matches DSL IR. Already passes — verify no regression. |
| `selectAll` IR equivalence (existing, ~line 220) | `Person.select(p => p.friends.select(f => [f.name]))` variant → assert IR matches |
| Existing `FieldSet — sub-select extraction` tests (field-set.test.ts ~line 408-444) | All 4 tests pass: sub-select array, sub-select custom object, sub-select with aggregation, sub-select IR equivalence |
| `doubleNestedSubSelect` golden SPARQL test | 3+ levels of nesting through lightweight wrapper → passes unchanged |
| `subSelectAllProperties` golden SPARQL test | `.select()` without specific fields → passes unchanged |

**New test** (in `src/tests/field-set.test.ts`, add to `FieldSet — sub-select extraction` block):

| Test case | Assertion |
|---|---|
| `sub-select through QueryShape.select() works` | `FieldSet.for(Person, p => [p.bestFriend.select(f => [f.name])])` (singular relationship, goes through `QueryShape.select()` not `QueryShapeSet.select()`) → assert `entries.length === 1`, assert `entries[0].subSelect` is defined, assert `entries[0].subSelect.labels()` includes `'name'` |

**Non-test validation:**
- `grep -rn 'new SelectQueryFactory' src/queries/SelectQuery.ts` — only in `SelectQueryFactory` class itself (constructor) and `_buildFactory()` in QueryBuilder.ts
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass

---

### Phase 10e: Remove `_buildFactory()` and remaining SelectQueryFactory runtime usage ✅

**Goal:** Delete `QueryBuilder._buildFactory()` and `_buildFactoryRawInput()`. All runtime paths now go through FieldSet / `_buildDirectRawInput()`. SelectQueryFactory is only referenced by types and its own definition.

**Depends on:** Phase 10a + 10b + 10c + 10d (all runtime fallback triggers removed)

**Files expected to change:**
- `src/queries/QueryBuilder.ts` — delete `_buildFactory()`, `_buildFactoryRawInput()`, simplify `toRawInput()`, update `getQueryPaths()`, remove `SelectQueryFactory` import
- `src/queries/SelectQuery.ts` — remove `instanceof SelectQueryFactory` checks in `getQueryPaths()` (~lines 1897, 1905)

#### Tasks

1. **Delete `_buildFactory()` method** (QueryBuilder.ts ~line 397-435)
2. **Delete `_buildFactoryRawInput()` method** (if separate from `_buildFactory`)
3. **Simplify `toRawInput()`** (QueryBuilder.ts ~line 452-472):
   - Remove the try/catch fallback entirely
   - Remove the preload guard (already handled by FieldSetEntry from 10b)
   - `toRawInput()` now just calls `_buildDirectRawInput()` directly
   ```typescript
   toRawInput(): RawSelectInput {
     return this._buildDirectRawInput();
   }
   ```
   Or inline `_buildDirectRawInput()` into `toRawInput()` if preferred.
4. **Update `getQueryPaths()`** (QueryBuilder.ts ~line 441-443):
   - Currently delegates to `this._buildFactory().getQueryPaths()`
   - Replace with FieldSet-based derivation: `return fieldSetToSelectPath(this.fields())`
5. **Remove `SelectQueryFactory` import** from QueryBuilder.ts
6. **Remove `instanceof SelectQueryFactory` checks** in SelectQuery.ts `getQueryPaths()` (~lines 1897, 1905)
   - These checks are inside `SelectQueryFactory.getQueryPaths()` itself — they handle nested sub-query results
   - After 10d, sub-queries are lightweight objects, not `SelectQueryFactory` instances — `instanceof` will never match
   - Remove the dead `instanceof` branch. The lightweight objects' `getQueryPaths()` throws, but that's fine because this code path is only reached from `SelectQueryFactory.getQueryPaths()` which is itself dead after this phase.
7. **Assess `_preloads` array** — if `_preloads` is no longer read by any code path (10b made preloads go through FieldSet), remove the field and `.preload()` method's storage into it. If `.preload()` still stores into `_preloads` for the FieldSet merge in `toRawInput()`, keep it.

#### Validation

| Check | Expected result |
|---|---|
| `grep -rn '_buildFactory' src/queries/QueryBuilder.ts` | 0 hits |
| `grep -rn '_buildFactoryRawInput' src/queries/QueryBuilder.ts` | 0 hits |
| `grep -rn 'new SelectQueryFactory' src/queries/QueryBuilder.ts` | 0 hits |
| `grep -rn 'import.*SelectQueryFactory' src/queries/QueryBuilder.ts` | 0 hits |
| `npx tsc --noEmit` | exits 0 |
| `npm test` | all tests pass |
| All golden IR tests (`ir-select-golden.test.ts`) | pass unchanged |
| All golden SPARQL tests (`sparql-select-golden.test.ts`, 50+ tests) | pass unchanged |
| All query-builder.test.ts IR equivalence tests (12 tests) | pass unchanged |
| All preload tests (query-builder.test.ts lines 309-384) | pass unchanged |

---

### Phase 10f: Migrate type utilities away from SelectQueryFactory ✅

**Goal:** All type utilities (`GetQueryResponseType`, `QueryIndividualResultType`, `QueryResponseToResultType`, etc.) and `Shape.ts` overloads reference `QueryBuilder<S, R>` instead of `SelectQueryFactory<S, R>`.

**Depends on:** Phase 10e (runtime removal complete — types are the last reference)

**Files expected to change:**
- `src/queries/SelectQuery.ts` — 8 type definitions (~lines 300-630)
- `src/shapes/Shape.ts` — 4 `static select()` overloads (~lines 99-170)
- `src/tests/type-probe-4.4a.ts` — update type assertions if they reference `SelectQueryFactory`

#### Architecture

The type utilities use `SelectQueryFactory<S, R>` for generic inference in conditional types. They need to infer from `QueryBuilder<S, R>` instead.

**Migration table** (8 types, ~20 reference sites):

| Type (SelectQuery.ts) | Line | Current pattern | New pattern |
|---|---|---|---|
| `QueryIndividualResultType` | 300 | `T extends SelectQueryFactory<any>` → `SelectQueryFactory<infer S, infer R>` | `T extends QueryBuilder<any>` → `QueryBuilder<infer S, infer R>` |
| `ToQueryResultSet` | 305 | `T extends SelectQueryFactory<infer S, infer R>` | `T extends QueryBuilder<infer S, infer R>` |
| `QueryResponseToResultType` | 320 | `T extends SelectQueryFactory<any, infer Response, infer Source>` | `T extends QueryBuilder<any, infer Response>` — note: QueryBuilder doesn't have 3rd generic for Source, so extraction may need adjustment |
| `GetQueryObjectResultType` | 339 | No direct `SelectQueryFactory` reference — but nested conditionals reference `BoundComponent` which returns `SelectQueryFactory`-dependent types | May need adjustment if BoundComponent's type parameter chain references `SelectQueryFactory` |
| `GetQueryResponseType` | 608 | `Q extends SelectQueryFactory<any, infer ResponseType>` | `Q extends QueryBuilder<any, infer ResponseType>` |
| `GetQueryShapeType` | 611 | `Q extends SelectQueryFactory<infer ShapeType, infer ResponseType>` | `Q extends QueryBuilder<infer ShapeType, infer ResponseType>` |
| `QueryResponseToEndValues` | 616 | `T extends SelectQueryFactory<any, infer Response>` | `T extends QueryBuilder<any, infer Response>` |
| `GetCustomObjectKeys` | 292 | References `SelectQueryFactory<any>` in conditional | Update to `QueryBuilder<any>` |

**Shape.ts overloads** (4 overloads, lines 111, 121, 133, 145):
- Current: `GetQueryResponseType<SelectQueryFactory<ShapeType, S>>`
- This is wrapping `SelectQueryFactory` just to feed it to `GetQueryResponseType` for type inference
- After migrating `GetQueryResponseType` to use `QueryBuilder`, update to: `GetQueryResponseType<QueryBuilder<ShapeType, S>>`
- **Simplification opportunity:** Since `GetQueryResponseType<QueryBuilder<ShapeType, S>>` just extracts `S`, this may simplify to just `S` directly — but only if the conditional type resolution is equivalent. Test carefully.

**Key pitfall:** `QueryResponseToResultType` at line 320 uses `SelectQueryFactory<any, infer Response, infer Source>` — the 3rd generic parameter `Source` captures the parent query path type. `QueryBuilder` may not have an equivalent 3rd parameter. Study whether `Source` is actually used downstream in `GetNestedQueryResultType<Response, Source>` — if it's only used for type narrowing that's no longer needed, it can be simplified.

**Key pitfall 2:** These types are deeply nested conditionals. Changing one layer can break inference in unexpected ways. The type probe file (`type-probe-4.4a.ts`, 204 lines) with `Expect<Equal<>>` assertions is the primary safety net. Run `npx tsc --noEmit` after each type change, not just at the end.

#### Tasks

1. **Migrate `GetQueryResponseType`** (line 608) — straightforward replacement
2. **Migrate `GetQueryShapeType`** (line 611) — straightforward replacement
3. **Migrate `QueryIndividualResultType`** (line 300) — replace both occurrences
4. **Migrate `ToQueryResultSet`** (line 305) — replace infer pattern
5. **Migrate `QueryResponseToResultType`** (line 320) — requires careful handling of 3rd `Source` generic
6. **Migrate `QueryResponseToEndValues`** (line 616) — straightforward replacement
7. **Migrate `GetCustomObjectKeys`** (line 292) — replace `SelectQueryFactory<any>` check
8. **Review `GetQueryObjectResultType`** (line 339) — may not directly reference `SelectQueryFactory` but verify
9. **Update Shape.ts overloads** (lines 111, 121, 133, 145) — replace `SelectQueryFactory<ShapeType, S>` with `QueryBuilder<ShapeType, S>` in `GetQueryResponseType<>` wrapper
10. **Update `type-probe-4.4a.ts`** — fix any type assertions that reference `SelectQueryFactory` directly
11. **Run `npx tsc --noEmit` after each change** — catch type inference breakage incrementally

**Stubs for parallel execution:** N/A — this phase is sequential after 10e and must be done as a single unit.

#### Validation

**Type probe file:** `src/tests/type-probe-4.4a.ts` (204 lines) — compile-time type assertions using `Expect<Equal<>>` pattern

| Probe | What it validates |
|---|---|
| PROBE 1 (line 20-38) | `QueryResponseToResultType` resolves `Person` with `p.name` → correct result type |
| PROBE 2 (line 66-75) | SingleResult unwrapping via `.one()` |
| PROBE 3 (line 77-110) | Generic propagation through builder class |
| PROBE 4 (line 139-201) | PromiseLike builder with `Awaited<>`, covers nested selects, aggregations, custom objects, booleans, dates |

All probes must pass `npx tsc --noEmit` with 0 errors.

**Runtime tests:**

| Test | Assertion |
|---|---|
| All existing `npm test` tests | Pass unchanged — type changes don't affect runtime, but imports may shift |
| All golden IR tests | Pass unchanged |
| All golden SPARQL tests | Pass unchanged |

**Structural validation:**
- `grep -rn 'SelectQueryFactory' src/queries/SelectQuery.ts` — only in the class definition itself, nowhere in type utilities
- `grep -rn 'SelectQueryFactory' src/shapes/Shape.ts` — 0 hits
- `grep -rn 'SelectQueryFactory' src/tests/type-probe` — 0 hits
- `npx tsc --noEmit` exits 0

---

### Phase 10g: Delete SelectQueryFactory class and final cleanup ✅

**Status: COMPLETE** — Commit `d4e0d34`

**Goal:** Delete the `SelectQueryFactory` class (~362 lines) and all supporting dead code. Final cleanup commit.

**Depends on:** Phase 10f (all references migrated)

**Outcome:** Replaced the class with a type-only interface stub preserving the 3 generic parameters (S, ResponseType, Source) for conditional type inference. Deleted 365 lines, added 17. Removed dead imports: `QueryFactory`, `buildSelectQuery`, `getQueryDispatch`, `RawSelectInput`. All 614 tests pass, TypeScript compiles cleanly.

**Files expected to change:**
- `src/queries/SelectQuery.ts` — delete `SelectQueryFactory` class, `patchResultPromise()`, `PatchedQueryPromise`, helper methods only used by factory
- `src/index.ts` — remove `SelectQueryFactory` export
- `src/queries/QueryFactory.ts` — remove reference if present
- `src/queries/QueryContext.ts` — delete if only used by factory
- `src/queries/SelectQuery.ts` — update `QueryComponentLike` type

#### Tasks

1. **Verify no remaining usages:**
   - `grep -rn 'SelectQueryFactory' src/` — should only find the class definition, `QueryComponentLike` type, and maybe comments
   - `grep -rn 'new SelectQueryFactory' src/` — should return 0 hits
   - `grep -rn 'extends SelectQueryFactory' src/` — should return 0 hits (LinkedWhereQuery deleted in 10c)
2. **Delete `SelectQueryFactory` class** from SelectQuery.ts (~600 lines, starts around line 1070)
   - Delete the class definition and all its methods
   - Keep: `QueryShape`, `QueryShapeSet`, `QueryBuilderObject`, `QueryPrimitive`, `QueryPrimitiveSet`, `QueryBoolean`, `QueryString`, `SetSize`, `Evaluation`, `BoundComponent` — these are used by the proxy tracing system
   - Keep: All type exports (`QueryResponseToResultType`, etc.) — migrated in 10f
   - Keep: `processWhereClause()` — updated in 10c
   - Keep: `fieldSetToSelectPath()`, `entryToQueryPath()` — used by QueryBuilder
3. **Delete `patchResultPromise()` and `PatchedQueryPromise`** — if they still exist (may have been removed in Phase 4)
4. **Remove from barrel export** (`src/index.ts`) — remove `SelectQueryFactory` from export list
5. **Check `QueryFactory.ts`** — if it references `SelectQueryFactory`, remove the reference
6. **Check `QueryContext.ts`** — if only used by `SelectQueryFactory`, delete the file entirely. If used elsewhere, keep.
7. **Update `QueryComponentLike` type** — remove the `SelectQueryFactory` variant from the union
8. **Clean up dead imports** — scan all files in `src/queries/` for unused `SelectQueryFactory` imports
9. **Remove `isSelectQueryFactory()` duck-type check** from FieldSet.ts (line 33-37) if the lightweight sub-select objects from 10d use a different detection mechanism, OR rename to `isSubSelectWrapper()` for clarity
10. **Remove `LinkedWhereQuery`** — should already be deleted in 10c, verify

#### Validation

| Check | Expected result |
|---|---|
| `grep -rn 'SelectQueryFactory' src/` | 0 hits in runtime code (comments/changelog OK) |
| `grep -rn 'class SelectQueryFactory' src/` | 0 hits |
| `grep -rn 'new SelectQueryFactory' src/` | 0 hits |
| `grep -rn 'extends SelectQueryFactory' src/` | 0 hits |
| `grep -rn 'buildFactory' src/` | 0 hits |
| `grep -rn 'patchResultPromise' src/` | 0 hits |
| `grep -rn 'PatchedQueryPromise' src/` | 0 hits |
| `grep -rn 'LinkedWhereQuery' src/` | 0 hits |
| `npx tsc --noEmit` | exits 0 |
| `npm test` | all tests pass |
| All golden IR tests | pass unchanged — same IR output |
| All golden SPARQL tests (50+) | pass unchanged — same SPARQL output |
| Type probe file compiles | `npx tsc --noEmit` on `type-probe-4.4a.ts` passes |

**Post-deletion structural check:**
- `wc -l src/queries/SelectQuery.ts` — should be ~600 lines shorter than before this phase
- `grep -c 'export' src/index.ts` — `SelectQueryFactory` no longer in exports

---

### Phase 10 — Dependency Graph

```
Phase 10a (Evaluation)     ──┐
Phase 10b (Preload)        ──┤
Phase 10c (LinkedWhereQuery)──┼──→ Phase 10e (Remove _buildFactory) ──→ Phase 10f (Migrate types) ──→ Phase 10g (Delete class)
Phase 10d (Sub-select wrap) ──┘
```

**Parallel opportunities:**
- 10a, 10b, 10c, 10d are independent — can all run in parallel (each touches a different code path)
- 10e depends on all four completing (convergence point)
- 10f depends on 10e
- 10g depends on 10f

**Stubs for parallel execution (10a–10d):**
- No stubs needed — each phase touches isolated code:
  - 10a: `isEvaluation()` branch in `convertTraceResult()`, `entryToQueryPath()` evaluation handling
  - 10b: `isBoundComponent()` branch in `convertTraceResult()`, preload guard in `toRawInput()`, `entryToQueryPath()` preload handling
  - 10c: `processWhereClause()` function, `LinkedWhereQuery` class
  - 10d: `QueryShapeSet.select()`, `QueryShape.select()` methods
- If running in parallel, each agent should NOT touch `FieldSetEntry` type simultaneously — coordinate by having each agent add their new field and verify compilation. Alternative: 10a adds both `evaluation` and `preload` fields to the type in a shared prep step.

**Integration consideration:** After merging 10a+10b+10c+10d, run full test suite before proceeding to 10e. The try/catch in `toRawInput()` may mask subtle issues — 10e removes that safety net.

---

### Phase 11: Hardening — API cleanup and robustness

**Status: Mostly complete (7/10 items done).**

Each item to be discussed with project owner before implementation. This phase is a series of small, independent tasks.

#### Tasks (each reviewed individually)

1. ✅ `FieldSet.merge()` shape validation — throw on mismatched shapes
2. ✅ `CreateBuilder.build()` missing-data guard — throw like UpdateBuilder
3. ✅ `FieldSet.all()` depth parameter — implemented with circular reference handling
4. ✅ `FieldSet.select()` vs `FieldSet.set()` duplication — keep as-is, both are valid API surface
5. ⚠️ Dead import cleanup — `toNodeReference` clean; `FieldSetJSON` unused import in QueryBuilder.ts still present
6. ✅ `toJSON()` dead branch — removed (comment: "T1: dead else-if removed")
7. ⚠️ Reduce `as any` / `as unknown as` casts — still ~65 across src/queries/*.ts, target was <10
8. ✅ Clone type preservation — `clone()` returns properly typed `QueryBuilder<S, R, T>` with full generic propagation
9. ✅ `PropertyPath.segments` defensive copy — TypeScript `readonly` annotation is sufficient
10. ⚠️ `FieldSet.traceFieldsFromCallback` removal — still exists as fallback (line 159 in FieldSet.ts); ProxiedPathBuilder is primary but old code kept as fallback for NodeShape-only paths

#### Validation

Per-item validation — each item gets its own commit with:
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass
- For item 7 (cast reduction): `grep -c 'as any\|as unknown' src/queries/*.ts` count < 10

---

### Phase 12: Typed FieldSet — carry response type through sub-selects ✅

**Status: Complete.**

FieldSet now carries `<R, Source>` generics with phantom `declare` fields. `forSubSelect()` factory preserves types. `QueryShapeSet.select()` and `QueryShape.select()` return typed `FieldSet`. All conditional types migrated from `SubSelectResult` to pattern-match on `FieldSet`. `SubSelectResult` eliminated from codebase. 20 deep-nesting type probe tests + 7 FieldSet type tests pass.

**Goal:** Make `FieldSet<R>` the typed carrier for sub-select results, eliminating the need for the `SubSelectResult` type-only interface. After this phase, the type inference for sub-selects flows through `FieldSet` generics instead of a separate structural interface.

**Motivation:** Currently sub-selects (`.select()` on QueryShapeSet/QueryShape) return plain objects typed as `SubSelectResult<S, ResponseType, Source>`. This interface exists *only* for conditional type pattern-matching — at runtime, these objects are ad-hoc literals that get converted to FieldSets anyway. FieldSet already has an unused `R` generic parameter (`class FieldSet<R = any>`). By wiring up this generic and adding a `Source` parameter, FieldSet can carry the same type information and the conditional types can pattern-match on `FieldSet` directly.

**Key insight:** The proxy callbacks (`QueryBuildFn`) already produce fully typed results. The `traceResponse` (callback return value) carries all type information. Today it's stored on `SubSelectResult.traceResponse`; after this phase it will be stored on `FieldSet<R, Source>.traceResponse` (or inferred from the generic).

#### Background: Current flow

```typescript
// 1. User writes:
p.friends.select(f => ({ name: f.name, age: f.age }))

// 2. QueryShapeSet.select() returns:
SubSelectResult<Person, { name: QueryString, age: QueryNumber }, QueryShapeSet<Person, ...>>

// 3. Conditional types pattern-match on SubSelectResult to infer:
//    Response = { name: QueryString, age: QueryNumber }
//    Source = QueryShapeSet<...>  →  result is array

// 4. At runtime, the returned object is a plain literal { traceResponse, parentQueryPath, shape, getQueryPaths() }
//    which gets converted to a FieldSet when consumed by QueryBuilder
```

#### Target flow

```typescript
// 1. User writes (same):
p.friends.select(f => ({ name: f.name, age: f.age }))

// 2. QueryShapeSet.select() returns:
FieldSet<{ name: QueryString, age: QueryNumber }, QueryShapeSet<Person, ...>>

// 3. Conditional types pattern-match on FieldSet to infer:
//    Response = { name: QueryString, age: QueryNumber }
//    Source = QueryShapeSet<...>  →  result is array

// 4. At runtime, select() directly constructs a FieldSet (no intermediate plain object)
```

#### Phase 12a: Add Source generic to FieldSet

**Files:** `src/queries/FieldSet.ts`

Add a second generic parameter `Source` to FieldSet:

```typescript
// Before:
export class FieldSet<R = any> {
  readonly shape: NodeShape;
  readonly entries: readonly FieldSetEntry[];

// After:
export class FieldSet<R = any, Source = any> {
  readonly shape: NodeShape;
  readonly entries: readonly FieldSetEntry[];
  /** Phantom field for conditional type inference of response type */
  declare readonly __response: R;
  /** Phantom field for conditional type inference of source context */
  declare readonly __source: Source;
```

Using `declare` ensures no runtime cost — these are compile-time-only fields.

**Validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all 614 tests pass
- No runtime behavior changes — purely additive type change

#### Phase 12b: Wire up FieldSet.for() to propagate Source generic

**Files:** `src/queries/FieldSet.ts`

Update the `FieldSet.for()` callback overload to accept an optional Source parameter:

```typescript
// The callback overload already infers R:
static for<S extends Shape, R>(shape: ShapeType<S>, fn: (p: any) => R): FieldSet<R>

// Add a Source-aware factory for sub-selects:
static forSubSelect<S extends Shape, R, Source>(
  shape: ShapeType<S>,
  fn: (p: any) => R,
  parentPath: QueryPath,
): FieldSet<R, Source> {
  const entries = FieldSet.traceFieldsWithProxy(shape.shape || shape, fn);
  const fs = new FieldSet(shape.shape || shape, entries);
  (fs as any)._parentPath = parentPath;
  return fs as FieldSet<R, Source>;
}
```

Also update `createFromEntries` to preserve generics:

```typescript
static createFromEntries<R = any, Source = any>(
  shape: NodeShape, entries: FieldSetEntry[]
): FieldSet<R, Source> {
  return new FieldSet(shape, entries) as FieldSet<R, Source>;
}
```

**Validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all 614 tests pass

#### Phase 12c: Update QueryShapeSet.select() and QueryShape.select() to return FieldSet

**Files:** `src/queries/SelectQuery.ts`, `src/queries/FieldSet.ts`

Change the `.select()` methods to construct and return typed FieldSets instead of plain objects:

```typescript
// Before (QueryShapeSet.select):
select<QF = unknown>(
  subQueryFn: QueryBuildFn<S, QF>,
): SubSelectResult<S, QF, QueryShapeSet<S, Source, Property>> {
  // ...builds plain object with traceResponse, parentQueryPath, shape, getQueryPaths()
  return { ... } as any;
}

// After:
select<QF = unknown>(
  subQueryFn: QueryBuildFn<S, QF>,
): FieldSet<QF, QueryShapeSet<S, Source, Property>> {
  const leastSpecificShape = this.getOriginalValue().getLeastSpecificShape();
  const parentPath = this.getPropertyPath();
  return FieldSet.forSubSelect<S, QF, QueryShapeSet<S, Source, Property>>(
    leastSpecificShape,
    subQueryFn as any,
    parentPath,
  );
}
```

Same pattern for `QueryShape.select()`, changing `SubSelectResult` → `FieldSet`.

Also update `selectAll()` return types accordingly.

**Critical:** The FieldSet must still expose `getQueryPaths()` and `parentQueryPath` for compatibility with `BoundComponent.getComponentQueryPaths()` and `fieldSetToSelectPath()`. Add these as computed properties or methods on FieldSet.

**Validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all 614 tests pass
- Type probe file compiles with same inferred types

#### Phase 12d: Migrate conditional types from SubSelectResult to FieldSet

**Files:** `src/queries/SelectQuery.ts`, `src/queries/SubSelectResult.ts`

Update all 8 conditional type pattern matches to match on `FieldSet` instead of `SubSelectResult`:

```typescript
// Before:
export type GetQueryResponseType<Q> =
  Q extends SubSelectResult<any, infer ResponseType> ? ResponseType : Q;

// After:
export type GetQueryResponseType<Q> =
  Q extends FieldSet<infer ResponseType, any> ? ResponseType : Q;
```

```typescript
// Before:
T extends SubSelectResult<any, infer Response, infer Source>
  ? GetNestedQueryResultType<Response, Source>

// After:
T extends FieldSet<infer Response, infer Source>
  ? GetNestedQueryResultType<Response, Source>
```

Full list of pattern matches to update:
1. `QueryWrapperObject` (line 60) — `SubSelectResult<ShapeType>` → `FieldSet<any, any>`
2. `GetCustomObjectKeys` (line 289) — `T[P] extends SubSelectResult<any>` → `T[P] extends FieldSet`
3. `ToQueryResultSet` (line 296) — extract ShapeType and ResponseType from FieldSet
4. `QueryResponseToResultType` (line 310) — extract Response and Source from FieldSet
5. `GetQueryObjectProperty` (line 396) — extract SubSource from FieldSet
6. `GetQueryObjectOriginal` (line 406) — extract SubResponse and SubSource from FieldSet
7. `GetQueryResponseType` (line 598) — extract ResponseType from FieldSet
8. `GetQueryShapeType` (line 601) — extract ShapeType from FieldSet (needs shape generic)

**Challenge for #8:** `GetQueryShapeType` currently extracts `S` (Shape type) from `SubSelectResult<S, ...>`. FieldSet doesn't currently have an `S` generic — its shape is stored as `NodeShape`, not `ShapeType<S>`. Options:
- Add a third generic `S` to FieldSet: `FieldSet<R, Source, S extends Shape>` — adds complexity
- Store `ShapeType<S>` on FieldSet alongside `NodeShape` — mirrors SubSelectResult
- Keep `GetQueryShapeType` pattern-matching on SubSelectResult as a temporary bridge

**Recommendation:** If `GetQueryShapeType` is only used in a few places, check if those usages can be refactored. Otherwise add `ShapeType<S>` storage to FieldSet.

**Validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all 614 tests pass
- Type probe file `type-probe-4.4a.ts` compiles and produces identical inferred types
- `grep -rn 'SubSelectResult' src/` — zero hits in conditional types (only in deprecated alias)

#### Phase 12e: Delete SubSelectResult interface

**Files:** `src/queries/SubSelectResult.ts`, `src/queries/SelectQuery.ts`

Once all conditional types match on FieldSet:
1. Remove the `SubSelectResult` interface from `SubSelectResult.ts`
2. Keep the deprecated `SelectQueryFactory` alias pointing to `FieldSet` if external consumers use it, or delete entirely
3. Remove re-exports from `SelectQuery.ts`
4. Delete `SubSelectResult.ts` if empty

**Validation:**
- `grep -rn 'SubSelectResult' src/` — zero hits (or only in deprecated alias)
- `npx tsc --noEmit` exits 0
- `npm test` — all 614 tests pass
- Type probe file compiles

#### Phase 12 — Dependency Graph

```
Phase 12a (Add Source generic)
    ↓
Phase 12b (Wire up FieldSet.for/createFromEntries)
    ↓
Phase 12c (select() returns FieldSet)
    ↓
Phase 12d (Migrate conditional types)
    ↓
Phase 12e (Delete SubSelectResult)
```

Strictly sequential — each phase builds on the previous.

#### Risks and Considerations

1. **FieldSet is a class, SubSelectResult is an interface** — TypeScript conditional types with `extends` work on both, but `FieldSet` is nominal (class) while `SubSelectResult` was structural (interface). The conditional type `T extends FieldSet<infer R>` will match actual FieldSet instances. This is correct since after 12c, `.select()` returns real FieldSets.

2. **`getQueryPaths()` and `parentQueryPath`** — These are currently on SubSelectResult but not on FieldSet. Phase 12c must add them (either as methods/getters or stored properties) so that existing code in `BoundComponent`, `isSubSelectResult` duck-checks, and `fieldSetToSelectPath` continues to work. FieldSet already has `entries` which can produce query paths via `fieldSetToSelectPath()`, so `getQueryPaths()` can be a computed method.

3. **`traceResponse` field** — SubSelectResult stores `traceResponse` (the raw callback return). FieldSet currently doesn't store this — it processes it into entries during construction. For the phantom `__response` type to work, we don't need the runtime value, just the `declare` field. But `extractSubSelectEntriesPublic` uses `traceResponse` at runtime. Two options:
   - Store `traceResponse` on FieldSet (adds runtime field)
   - Process it eagerly during `forSubSelect()` construction (cleaner — no raw trace needed after construction)

   **Recommendation:** Process eagerly. The FieldSet already processes the trace into entries in `for()`, so `forSubSelect()` should do the same.

4. **Duck-type check in FieldSet.ts** — `isSubSelectResult()` checks for `getQueryPaths` and `parentQueryPath`. After 12c, sub-selects return FieldSet instances. The duck-type check should be updated to `obj instanceof FieldSet` (possible since FieldSet.ts owns the class) or kept as structural check with updated comment.

5. **Backward compatibility** — The deprecated `SelectQueryFactory` alias can be updated to point to `FieldSet` with matching generics: `type SelectQueryFactory<S, R, Source> = FieldSet<R, Source>`. Shape parameter `S` is lost but may be acceptable for deprecated usage.

6. **`getQueryPaths` monkey-patch cleanup** — In `SelectQuery.ts` (BoundComponent.select and BoundShapeComponent.select), `getQueryPaths` is assigned onto the FieldSet instance via runtime monkey-patch after construction (lines ~1301-1307 and ~1481-1487). This is legacy glue from the old SubSelectResult setup. It should be factored into the FieldSet class itself (e.g. as a method on `forSubSelect`) so that the assignment happens inside the class rather than externally.

---

## Type System Review

Conducted after Phases 11–12 and follow-up fix-ups. This section captures what's good, what's concerning, and what's bad in the current type system state.

### What's Good

- **Phantom types in FieldSet** — `declare readonly __response: R` carries type info with zero runtime cost. Clean pattern.
- **Proxy-based path tracing** — `ProxiedPathBuilder.ts` cleanly captures `p.friends.bestFriend.name` chains.
- **QueryBuilder generic flow** — `S` (shape), `R` (response), `Result` stay consistent through `.select()`, `.one()`, `.where()`, `.limit()`.
- **PromiseLike integration** — `await builder` works without losing types.
- **Type probe tests** — `type-probe-4.4a.ts` and `type-probe-deep-nesting.ts` cover 4+ levels of nesting, sub-selects, custom objects, inheritance. Solid coverage.

### What's Concerning

- **CreateQResult** (SelectQuery.ts:415–493) — 12+ levels of conditional nesting. There's a TODO comment saying "this must be simplified and rewritten" and "likely the most complex part of the type system". It recursively self-calls.
- **GetQueryObjectResultType** (SelectQuery.ts:324–370) — 10+ conditional branches. Hard to trace.
- **Silent `never` fallthrough** — `QueryResponseToResultType`, `GetQueryObjectResultType`, `ToQueryPrimitive` all end with `: never`. If a type doesn't match any branch, it silently becomes `never` instead of giving a useful error.
- **QResult's second generic** — `QResult<ShapeType, Object = {}>` is completely unconstrained. Any garbage object type gets merged in.
- **Generic naming** — mostly consistent (`S`, `R`, `Source`, `Property`) but `QShapeType` vs `ShapeType` vs `T` appear inconsistently in the conditional types.

### What's Bad

- **~44 `as any` casts in production code** — the biggest cluster is `Shape.ts` (10 casts for static method factory bridging) and `SelectQuery.ts` (20+ casts for proxy construction, generic coercion, shape instantiation).
  - **Root cause:** `ShapeType` (the class constructor type) and `typeof Shape` (the abstract base) don't align. Every `Shape.select()`, `Shape.update()`, `Shape.create()`, `Shape.delete()` starts with `this as any`. This is the single biggest type gap.
- **IRDesugar shape resolution** — `(query.shape as any)?.shape?.id` because `RawSelectInput.shape` is typed as `unknown`. The runtime value is actually always a `ShapeType` or `NodeShape`.

### Commented-Out Dead Code (still present)

| Location | What |
|---|---|
| SelectQuery.ts:1365–1370 | Old `where()` method |
| SelectQuery.ts:1402–1428 | Old property resolution, TestNode, convertOriginal |
| SelectQuery.ts:733–746 | Abandoned TestNode approach |
| SelectQuery.ts:1441, 1462 | Debug `console.error`, old proxy return |
| SelectQuery.ts:1729–1740 | Old countable logic |
| MutationQuery.ts:266–269 | Commented validation |
| ShapeClass.ts:137–161 | `ensureShapeConstructor()` entirely commented out |

### Incomplete Features (TODOs)

| Location | What |
|---|---|
| MutationQuery.ts:33 | "Update functions not implemented yet" |
| QueryContext.ts:8 | "should return NullQueryShape" |
| SelectQuery.ts:693–697 | Async shape loading |
| SelectQuery.ts:1615–1616 | Consolidate QueryString/Number/Boolean/Date into QueryPrimitive |

---

## Proposed Phases: Type System Cleanup + Pipeline Improvements

### Phase Dependency Graph

```
Phase 13 (Dead code removal)           — independent
Phase 14 (Type safety quick wins)      — independent
Phase 15 (QueryPrimitive consolidation) — independent
Phase 16 (CreateQResult simplification) — independent, benefits from 14
Phase 17 (getQueryPaths cleanup)        — depends on 13 (cleaner codebase)
Phase 18 (FieldSet → desugar direct)    — depends on 17 (getQueryPaths resolved)
Phase 19 (Shape factory + as any)       — depends on 14 (RawSelectInput typed)

Parallel group A: 13, 14, 15 can run in parallel
Parallel group B: 16, 17 can run after group A
Sequential: 18 after 17, 19 after 14
```

---

### Phase 13: Dead Code Removal

**Effort: Low | Impact: Clarity**

Remove all commented-out dead code identified in the review. No functional changes.

| # | Task |
|---|---|
| 13.1 | Remove commented `where()` method (SelectQuery.ts:1365–1370) |
| 13.2 | Remove commented property resolution / TestNode / convertOriginal (SelectQuery.ts:1402–1428) |
| 13.3 | Remove abandoned TestNode approach (SelectQuery.ts:733–746) |
| 13.4 | Remove debug `console.error` and old proxy return (SelectQuery.ts:1441, 1462) |
| 13.5 | Remove old countable logic (SelectQuery.ts:1729–1740) |
| 13.6 | Remove commented validation (MutationQuery.ts:266–269) |
| 13.7 | Clean up `ensureShapeConstructor` — body is entirely commented out, function just does `return shape;`. Remove the commented body or the entire function if unused (ShapeClass.ts:137–161) |

**Validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass, no regressions
- `grep -rn '// *const\|// *if\|// *let\|// *return\|// *throw\|console.error' src/queries/SelectQuery.ts src/queries/MutationQuery.ts src/utils/ShapeClass.ts` — confirm targeted blocks are gone

**Open questions:**
1. **`ensureShapeConstructor` — remove entirely or keep stub?** The function body is fully commented out, leaving just `return shape;`. If nothing calls it, remove entirely. If callers exist, keep the passthrough stub. **Recommendation:** Check callers; if any exist, keep the stub with a `// no-op: shape validation removed` comment. If none, delete.
2. **SelectQuery.ts:1147 "strange bug" comment** — there's a comment about a strange bug near line 1147. Should we investigate and fix, or just remove the comment? **Recommendation:** Investigate briefly. If the bug is no longer reproducible, remove the comment. If it reveals a real issue, file it as a separate task.

---

### Phase 14: Type Safety Quick Wins

**Effort: Low–Medium | Impact: Type safety, DX**

| # | Task | Detail |
|---|---|---|
| 14.1 | Type `RawSelectInput.shape` properly | Change from `unknown` to `ShapeType \| NodeShape` in IRDesugar.ts:28. Eliminates the `(query.shape as any)?.shape?.id` cast in desugarSelectQuery. Import ShapeType from Shape.ts and NodeShape from SHACL.ts. |
| 14.2 | Constrain `QResult`'s second generic | Change `Object = {}` to `Object extends Record<string, unknown> = {}` at SelectQuery.ts:270. Catches shape mismatches at compile time. |
| 14.3 | Add branded error types for `never` fallthrough | Replace silent `: never` in `QueryResponseToResultType` (line 316), `GetQueryObjectResultType` (line 370), `ToQueryPrimitive` (line 207) with `never & { __error: 'descriptive message' }`. Better DX when types break. |

**Validation:**
- `npx tsc --noEmit` exits 0
- Type probe files (`type-probe-4.4a.ts`, `type-probe-deep-nesting.ts`) compile unchanged
- `npm test` — all tests pass
- Manual check: hover over a deliberately wrong type in IDE to verify branded error message appears

**Open questions:**
1. **`RawSelectInput.shape` type — `ShapeType | NodeShape` or narrower?** The runtime value is always a ShapeType or NodeShape, but typing it narrows what callers can pass. **Recommendation:** Use `ShapeType | NodeShape` — matches actual runtime usage and eliminates the `as any` in desugar.
2. **`QResult` constraint — `Record<string, unknown>` or `object`?** `Record<string, unknown>` is stricter (only string-keyed objects). `object` allows any non-primitive. **Recommendation:** `Record<string, unknown>` — QResult merges properties by key, so string-keyed constraint is correct.
3. **Branded error messages — verbose or terse?** E.g. `never & { __error: 'QueryResponseToResultType: no matching branch for input type' }` vs `never & { __typeError: 'unmatched_response_type' }`. **Recommendation:** Verbose with full type name — developers will see these in IDE hover tooltips and need context.

---

### Phase 15: QueryPrimitive Consolidation

**Effort: Medium | Impact: Less code, simpler type surface**

Merge `QueryString`, `QueryNumber`, `QueryBoolean`, `QueryDate` into `QueryPrimitive<T>` (TODO at SelectQuery.ts:1615–1616). The UPDATE comment notes "some of this has started — Query response to result conversion is using QueryPrimitive only".

| # | Task |
|---|---|
| 15.1 | Audit all usages of `QueryString`, `QueryNumber`, `QueryBoolean`, `QueryDate` in src/ and tests — list every call site |
| 15.2 | Replace each subclass usage with `QueryPrimitive<string>`, `QueryPrimitive<number>`, `QueryPrimitive<boolean>`, `QueryPrimitive<Date>` |
| 15.3 | Remove the 4 empty subclass definitions |
| 15.4 | Update type probes to verify inference still works |
| 15.5 | Update any `instanceof QueryString` etc. checks to use `instanceof QueryPrimitive` with type narrowing |

**Validation:**
- `npx tsc --noEmit` exits 0
- Type probe files compile and produce identical inferred types
- `npm test` — all tests pass
- `grep -rn 'QueryString\|QueryNumber\|QueryBoolean\|QueryDate' src/` — zero hits (only in comments/changelogs if any)

**Open questions:**
1. **Remove subclasses entirely, or keep as type aliases?** We could keep `type QueryString<S, P> = QueryPrimitive<string, S, P>` for backward compat. **Recommendation:** Remove entirely — they're internal classes, not part of the public API. Any external usage would already be through the proxy, not direct class references.
2. **`instanceof` checks — are there any?** If code uses `instanceof QueryString`, consolidation breaks it. **Recommendation:** Audit first (task 15.5). If found, switch to property-based checks (`typeof value === 'string'`).

---

### Phase 16: CreateQResult Simplification

**Effort: Medium–High | Impact: Readability, maintainability**

Break the 12-level conditional `CreateQResult` (SelectQuery.ts:415–493) into 2–3 smaller helper types. This is the riskiest change but type probes provide a safety net.

| # | Task |
|---|---|
| 16.1 | Map out which branches of `CreateQResult` handle which input patterns (document the decision tree) |
| 16.2 | Extract helper types: e.g. `ResolveQResultPrimitive`, `ResolveQResultObject`, `ResolveQResultArray` |
| 16.3 | Recompose `CreateQResult` from the helpers — must be semantically equivalent |
| 16.4 | Verify all type probes produce identical inferred types (diff the `.d.ts` output before/after) |

**Validation:**
- Type probes (primary) — `npx tsc --noEmit` on probe files, diff inferred types
- `npx tsc --noEmit` exits 0 on full project
- `npm test` — all tests pass
- Snapshot: generate `.d.ts` for SelectQuery.ts before and after, diff must show only the helper type extractions

**Open questions:**
1. **How many helper types to extract?** The 12-level conditional could be split into 2 (primitive vs object) or 3 (primitive, plain object, array/set). **Recommendation:** Start with 3 helpers — `ResolveQResultPrimitive`, `ResolveQResultObject`, `ResolveQResultCollection`. This matches the natural decision points in the conditional.
2. **Should `GetQueryObjectResultType` be simplified in the same phase?** It has 10+ branches and is closely related. **Recommendation:** Yes, tackle both together — they share the same decomposition pattern and the type probes test them jointly.

---

### Phase 17: getQueryPaths Monkey-Patch Cleanup

**Effort: Medium | Impact: Code health, enables Phase 18**

Factor the `getQueryPaths` monkey-patch into the FieldSet class properly. Currently assigned externally at SelectQuery.ts:1301–1307 and 1481–1487.

**Current state:**
- `FieldSet` declares `getQueryPaths?: () => any` (FieldSet.ts:195)
- Two call sites in `BoundComponent.select()` and `BoundShapeComponent.select()` monkey-patch it onto the instance after `FieldSet.forSubSelect()`
- Consumed via duck-type check: `typeof (query as any).getQueryPaths === 'function'` (SelectQuery.ts:964)
- Delegates to `fieldSetToSelectPath(fs)` with parent path prepended

| # | Task |
|---|---|
| 17.1 | Add `parentQueryPath` as a proper stored property on FieldSet (already partially there via `forSubSelect` constructor) |
| 17.2 | Implement `getQueryPaths()` as a real method on FieldSet — computes from `fieldSetToSelectPath(this)` + `parentQueryPath` |
| 17.3 | Remove the monkey-patch assignments at SelectQuery.ts:1301–1307 and 1481–1487 |
| 17.4 | Remove the optional property declaration `getQueryPaths?: () => any` from FieldSet |
| 17.5 | Update the duck-type checks at SelectQuery.ts:964–965 to use `instanceof FieldSet` or call the method directly |

**Validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass
- `grep -rn 'fs.getQueryPaths =' src/` — zero hits (monkey-patch gone)
- `grep -rn 'getQueryPaths\b' src/queries/` — only method definition and legitimate call sites remain

**Open questions:**
1. **Compute `getQueryPaths()` lazily or eagerly?** Lazily (compute on call from entries) is cleaner. Eagerly (store in constructor) avoids repeat computation. **Recommendation:** Lazily — `getQueryPaths()` is called at most once per FieldSet, and computing from entries is cheap. No need to store extra state.
2. **Keep `getQueryPaths` on QueryBuilder too?** QueryBuilder.ts:366 has its own `getQueryPaths()`. After this phase, should it delegate to `this.fields().getQueryPaths()`? **Recommendation:** Yes — single source of truth. QueryBuilder's `getQueryPaths()` should just call `this.fields().getQueryPaths()`.

---

### Phase 18: FieldSet → Desugar Direct Pipeline

**Effort: Medium–High | Impact: Architecture — eliminates SelectPath bridge**

Make `desugarSelectQuery()` accept FieldSet directly, eliminating the `fieldSetToSelectPath()` bridge. This collapses the pipeline from `FieldSet → SelectPath → desugar → IRSelectQuery` to `FieldSet → desugar → IRSelectQuery`.

**Current pipeline:**
```
QueryBuilder._buildDirectRawInput()
  → fieldSetToSelectPath(fs)  // converts FieldSet entries to SelectPath
  → constructs RawSelectInput { select: SelectPath, ... }
  → desugarSelectQuery(rawInput)
  → IRSelectQuery
```

**Target pipeline:**
```
QueryBuilder._buildDirectRawInput()
  → constructs RawFieldSetInput { fieldSet: FieldSet, ... }
  → desugarFieldSetQuery(rawFieldSetInput)
  → IRSelectQuery
```

| # | Task |
|---|---|
| 18.1 | Create `RawFieldSetInput` type — same as `RawSelectInput` but with `fieldSet: FieldSet` instead of `select: SelectPath` |
| 18.2 | Implement `desugarFieldSetQuery()` — walks FieldSet entries directly to produce `DesugaredSelectQuery`, bypassing SelectPath entirely |
| 18.3 | Each FieldSetEntry already has `path.segments`, `scopedFilter`, `subSelect`, `aggregation`, `customKey` — map these directly to `DesugaredPropertyStep`, `DesugaredCountStep`, etc. |
| 18.4 | Update `QueryBuilder._buildDirectRawInput()` to call the new path |
| 18.5 | Keep `fieldSetToSelectPath()` and `desugarSelectQuery()` available for backward compat — deprecate but don't remove yet |
| 18.6 | Add tests that verify FieldSet-direct and SelectPath-bridge produce identical `DesugaredSelectQuery` output for all existing test cases |

**Stubs for parallel execution:** If running before Phase 17, the FieldSet `getQueryPaths` monkey-patch can be ignored — this phase only needs FieldSet entries, not `getQueryPaths`.

**Validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass
- New test: for every existing `desugarSelectQuery` test case, assert `desugarFieldSetQuery` produces an identical `DesugaredSelectQuery`
- `fieldSetToSelectPath()` call count in QueryBuilder reduced to 0 (only used in deprecated/compat paths)

**Open questions:**
1. **Deprecate `fieldSetToSelectPath()` or remove?** It's used in 10 places currently. After this phase, QueryBuilder won't need it, but it may still be useful for debugging/inspection. **Recommendation:** Deprecate with `@deprecated` JSDoc — keep available but mark for future removal. Remove from QueryBuilder's imports.
2. **New function name: `desugarFieldSetQuery` or overload `desugarSelectQuery`?** An overload keeps one entry point. A new function is clearer about the two code paths. **Recommendation:** New function `desugarFieldSetQuery()` — clearer separation, easier to trace, and the old function stays untouched for backward compat.
3. **Should FieldSet carry `where`, `sortBy`, `limit`, `offset` directly?** Currently these live on QueryBuilder, not FieldSet. The new `RawFieldSetInput` still needs these from QueryBuilder. **Recommendation:** Keep them on QueryBuilder for now — FieldSet is the "what to select", QueryBuilder is the "how to query". Don't conflate concerns.

---

### Phase 19: Shape Factory Redesign + `as any` Reduction

**Effort: High | Impact: Type safety — addresses root cause of ~44 `as any` casts**

The root cause: `ShapeType<S>` (a class constructor `{ new(...args): S }`) and `typeof Shape` (the abstract base with static methods) don't align. Every `Shape.select()`, `.update()`, `.create()`, `.delete()` static method starts with `this as any` because TypeScript's `this` parameter in static methods doesn't carry the concrete subclass constructor type properly into the Builder generics.

**Current pattern (Shape.ts:148):**
```ts
static select<ShapeType extends Shape>(
  this: { new (...args: any[]): ShapeType },
  ...
) {
  let builder = QueryBuilder.from(this as any) as QueryBuilder<ShapeType, any, any>;
}
```

The `this as any` is needed because `this` is typed as `{ new(...args): ShapeType }` but `QueryBuilder.from()` expects `ShapeType<S>` which may have additional constraints.

**Cast clusters to address:**
- Shape.ts: 11 casts — all in static methods (`select`, `selectAll`, `update`, `create`, `delete`, `forShape`)
- SelectQuery.ts: 22 casts — proxy construction, generic coercion, shape instantiation
- QueryBuilder.ts: 12 casts — shape/subject/select coercion
- CreateBuilder.ts, UpdateBuilder.ts, DeleteBuilder.ts: 5 casts — `this._shape as any as typeof Shape`

| # | Task |
|---|---|
| 19.1 | Define a unified `ShapeConstructor<S>` type that satisfies both the Builder `from()` methods and the Shape static `this` parameter — e.g. `type ShapeConstructor<S extends Shape> = { new (...args: any[]): S } & { shape?: NodeShape }` |
| 19.2 | Update `QueryBuilder.from()`, `UpdateBuilder.from()`, `CreateBuilder.from()`, `DeleteBuilder.from()` to accept `ShapeConstructor<S>` |
| 19.3 | Update Shape static methods to use `ShapeConstructor` as the `this` type — eliminate `this as any` casts |
| 19.4 | Address SelectQuery.ts casts: categorize each cast as (a) fixable with better generics, (b) inherent to proxy/dynamic patterns, (c) noise from the Shape misalignment |
| 19.5 | Fix category (a) and (c) casts. Document category (b) casts with `// SAFETY:` comments explaining why the cast is necessary |
| 19.6 | Target: reduce from ~44 to ≤15 `as any` casts, all with SAFETY comments |

**Risks:**
- This touches the most foundational type in the system — every Shape subclass is affected
- Proxy construction (`new (shape as any)()`) may be inherently untyped — some casts are unavoidable
- Shape class hierarchy with decorators adds complexity

**Validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all tests pass
- Type probe files compile unchanged
- `grep -c 'as any' src/queries/*.ts src/shapes/Shape.ts` — total ≤ 15, each with `// SAFETY:` comment
- No new `@ts-ignore` or `@ts-expect-error` introduced

**Open questions:**
1. **`ShapeConstructor<S>` — single unified type or intersection?** We could define `ShapeConstructor<S> = { new (...args: any[]): S } & { shape?: NodeShape }` or use a more elaborate mapped type. **Recommendation:** Simple intersection — the `new` signature plus `shape` accessor is all the Builders need. Don't over-engineer.
2. **Target cast count — ≤15 or ≤10?** Some casts are inherently unavoidable (proxy construction via `new (shape as any)()`). **Recommendation:** Target ≤15 with SAFETY comments. Getting below 10 would require runtime type guards that add overhead for no real benefit.
3. **Tackle all Builder `from()` methods at once or one at a time?** QueryBuilder, UpdateBuilder, CreateBuilder, DeleteBuilder all have the same pattern. **Recommendation:** All at once — they share the same `ShapeConstructor` type and changing one without the others creates inconsistency.

---

### Future TODO (deferred — not part of current plan)

| Item | Reason to defer |
|---|---|
| **MutationQuery update functions** (MutationQuery.ts:33) — callback-style updates like `Shape.update(entity, e => { e.name = 'Bob' })` | Feature work, not cleanup. UpdateBuilder already handles object-style updates. The callback pattern needs a proxy-tracing approach similar to select(). Consider as separate feature plan. |
| **QueryContext NullQueryShape** (QueryContext.ts:8) | Feature work — needs design decision on what default/null query behavior should look like |
| **Async shape loading** (SelectQuery.ts:693–697) | Speculative — comment says "not sure if that's even possible with dynamic import paths known only at runtime". Needs shapes-only architecture first |
| **Generic naming consistency** (`QShapeType` vs `ShapeType` vs `T`) | Opportunistic — address during other refactors, not worth a dedicated pass |
