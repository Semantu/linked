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
Phase 2 (QueryBuilder)
    ↓
Phase 3a (FieldSet)  ←→  Phase 3b (Mutation builders)   [parallel after Phase 2]
    ↓                         ↓
Phase 4 (Serialization + integration)                    [after 3a and 3b]
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

### Phase 2 — QueryBuilder (select queries)

Build `QueryBuilder` on top of `ProxiedPathBuilder`. The DSL becomes a thin wrapper — `Person.select()` returns a `QueryBuilder`. Remove `nextTick`/`PatchedQueryPromise`.

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

### Phase 3a — FieldSet

Build `FieldSet` as an immutable, composable collection of property paths. Integrate with QueryBuilder.

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

### Phase 3b — Mutation builders

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

### Phase 4 — Serialization + integration

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

**4.4 — Dead code cleanup**
- Remove `PatchedQueryPromise` type from SelectQuery.ts
- Remove `patchResultPromise()` from SelectQueryFactory
- Remove `onQueriesReady` / DOMContentLoaded logic from SelectQuery.ts
- Remove `next-tick` from `package.json` dependencies if no longer imported anywhere
- Remove empty `abstract class QueryFactory` from QueryFactory.ts if nothing extends it after mutation builder refactor

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

## Scope boundaries

**In scope (this plan):**
- PropertyPath (value object, segments, comparison helpers with `sh:datatype` validation)
- walkPropertyPath (string path → PropertyPath resolution)
- ProxiedPathBuilder extraction (shared proxy between DSL and dynamic builders, `.path()` escape hatch)
- FieldSet (construction, composition, scoped filters, nesting, serialization, `FieldSet.all()`)
- QueryBuilder (fluent chain, immutable, PromiseLike, toRawInput bridge, serialization)
- Mutation builders: CreateBuilder, UpdateBuilder, DeleteBuilder (immutable, PromiseLike, reuse existing IR pipeline)
- DSL alignment (Person.select/create/update/delete → returns builders, .for()/.forAll() pattern)
- Shape resolution by prefixed IRI string (for `.from('my:PersonShape')` and JSON deserialization)
- `Person.selectAll({ depth })` — FieldSet.all with depth exposed on DSL
- Tests verifying DSL and builders produce identical IR

**Out of scope (separate plans, already have ideation docs):**
- `FieldSet.summary()` — CMS-layer concern, not core
- Shared variable bindings / `.as()` activation → 008
- Shape remapping / ShapeAdapter → 009
- Computed expressions / L module → 006
- Raw IR helpers (Option A) → future
- CONSTRUCT / MINUS query types → 004, 007
