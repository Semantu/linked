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

### Phase 1 — ProxiedPathBuilder extraction + DSL rewire

Extract the proxy machinery from `SelectQuery.ts` into a standalone `ProxiedPathBuilder`. Rewire the existing DSL (`Person.select(...)`) to use it. All existing golden tests must pass — they validate correctness during this refactor.

**Delivers:**
- `src/queries/ProxiedPathBuilder.ts` — shared proxy, extracted from SelectQuery.ts
- `src/queries/PropertyPath.ts` — PropertyPath value object (needed by ProxiedPathBuilder)
- `src/queries/WhereCondition.ts` — WhereCondition type (needed by PropertyPath comparisons)
- Modified `SelectQuery.ts` — delegates to ProxiedPathBuilder instead of inline proxy logic
- All existing tests pass (ir-select-golden, sparql-select-golden, query.types)

**Exit criteria:** `npm test` green, no behavioral changes.

### Phase 2 — QueryBuilder (select queries)

Build `QueryBuilder` on top of the extracted `ProxiedPathBuilder`. DSL becomes a thin wrapper — `Person.select()` returns a `QueryBuilder`. Introduce `walkPropertyPath` for string-based field resolution.

**Delivers:**
- `src/queries/QueryBuilder.ts` — immutable, fluent, PromiseLike
- `src/queries/PropertyPath.ts` — add `walkPropertyPath` utility
- Modified `Shape.ts` — `.select()`, `.selectAll()`, `.query()` return QueryBuilder
- `src/tests/query-builder.test.ts` — chain, immutability, IR output equivalence with DSL
- Shape resolution by prefixed IRI string (`QueryBuilder.from('my:PersonShape')`)
- `PatchedQueryPromise` / `nextTick` removed

**Exit criteria:** `QueryBuilder.from(Shape).select(...)` and `Shape.select(...)` produce identical IR. All existing + new tests pass.

### Phase 3 — FieldSet

Build `FieldSet` as a composable, serializable collection of property paths. Integrate with QueryBuilder (`.select(fieldSet)`, `.setFields()`, `.addFields()`, `.removeFields()`).

**Delivers:**
- `src/queries/FieldSet.ts` — construction, composition (`.add()`, `.remove()`, `.set()`, `.pick()`, `FieldSet.merge()`), nesting, `FieldSet.all()`, scoped filters
- `src/tests/field-set.test.ts` — composition, merging, scoped filters, serialization
- QueryBuilder integration (accepts FieldSet in `.select()` and field mutation methods)

**Exit criteria:** FieldSet composes correctly, serializes/deserializes, and integrates with QueryBuilder.

### Phase 4 — Mutation builders

Replace mutable `CreateQueryFactory` / `UpdateQueryFactory` / `DeleteQueryFactory` with immutable builders following the same pattern as QueryBuilder.

**Delivers:**
- `src/queries/CreateBuilder.ts` — immutable, PromiseLike
- `src/queries/UpdateBuilder.ts` — immutable, PromiseLike, `.for()`/`.forAll()` required
- `src/queries/DeleteBuilder.ts` — immutable, PromiseLike
- Modified `Shape.ts` — `.create()`, `.update()`, `.delete()`, `.deleteAll()` return builders
- `src/tests/mutation-builder.test.ts`

**Exit criteria:** All mutation operations work through builders. Old factory classes removed or reduced to internal helpers.

### Phase 5 — Serialization

Add `toJSON()` / `fromJSON()` to QueryBuilder and FieldSet for CMS-style persistence and transport.

**Delivers:**
- QueryBuilder serialization (`toJSON()` / `QueryBuilder.fromJSON()`)
- FieldSet serialization (`toJSON()` / `FieldSet.fromJSON()`)
- Updated `src/index.ts` — full public API exports

**Exit criteria:** Round-trip serialization produces identical IR. All tests pass.

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
