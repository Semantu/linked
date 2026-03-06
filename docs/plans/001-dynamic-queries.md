---
summary: Implement FieldSet, QueryBuilder, and DSL alignment for dynamic query construction.
source: 003-dynamic-ir-construction
packages: [core]
---

# Plan: Dynamic Queries (FieldSet + QueryBuilder + DSL alignment)

## Goal

Replace the mutable `SelectQueryFactory` + `PatchedQueryPromise` + `nextTick` system with an immutable `QueryBuilder` + `FieldSet` architecture. The DSL (`Person.select(...)`) becomes sugar over QueryBuilder. A new public API enables CMS-style runtime query building.

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

### 5. FieldSet as the composable primitive

FieldSet is a named, immutable, serializable collection of property paths rooted at a shape. It supports:
- Construction: `FieldSet.for(shape, fields)`, `FieldSet.for(shape).select(fields)`, `FieldSet.all(shape)`, callback form with proxy
- Composition: `.add()`, `.remove()`, `.set()`, `.pick()`, `FieldSet.merge()`
- Scoped filters: conditions that attach to a specific traversal
- Serialization: `.toJSON()` / `FieldSet.fromJSON()`
- Nesting: `{ friends: personSummary }` and `{ hobbies: ['label', 'description'] }`

### 6. Bridge to existing pipeline: `toRawInput()`

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

  // Where clause helpers
  equals(value: any): WhereCondition;
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

---

## Files Expected to Change

### New files
- `src/queries/PropertyPath.ts` — PropertyPath value object + walkPropertyPath utility
- `src/queries/FieldSet.ts` — FieldSet class
- `src/queries/QueryBuilder.ts` — QueryBuilder class
- `src/queries/WhereCondition.ts` — WhereCondition type + comparison helpers (may be extracted from existing code)
- `src/tests/field-set.test.ts` — FieldSet composition, merging, scoped filters, serialization
- `src/tests/query-builder.test.ts` — QueryBuilder chain, immutability, IR output equivalence

### Modified files
- `src/queries/SelectQuery.ts` (~72 KB, ~2100 lines) — Largest change. Contains `SelectQueryFactory`, `QueryShape`, `QueryShapeSet`, `QueryBuilderObject`, proxy handlers (lines ~1018, ~1286, ~1309). Refactor to delegate to QueryBuilder internally. `PatchedQueryPromise` replaced. Proxy creation extracted into shared `ProxiedPathBuilder`.
- `src/queries/QueryFactory.ts` (~5.5 KB) — Currently contains an empty `abstract class QueryFactory` (extended by `SelectQueryFactory` and `MutationQueryFactory` as a marker) plus mutation-related type utilities (`UpdatePartial`, `SetModification`, `NodeReferenceValue`, etc.) imported by ~10 files. The empty abstract class should be removed (QueryBuilder replaces it). The types stay; file may be renamed to `MutationTypes.ts` later.
- `src/queries/IRDesugar.ts` (~12 KB) — Owns `RawSelectInput` type definition (lines ~22-31). Type may need extension if QueryBuilder adds new fields. Also defines `DesugaredSelectQuery` and step types.
- `src/queries/IRPipeline.ts` (~1 KB) — Orchestrates desugar → canonicalize → lower. May need minor adjustments if `buildSelectQuery` input types change.
- `src/shapes/Shape.ts` — Update `Shape.select()` (line ~125), `Shape.query()` (line ~95), `Shape.selectAll()` (line ~211) to return QueryBuilder. Add `.for()`, `.forAll()`, `.delete()`, `.deleteAll()`, `.update()` with targeting requirement.
- `src/index.ts` — Export new public API (`QueryBuilder`, `FieldSet`, `PropertyPath`) alongside existing `SelectQuery` namespace.

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

1. **Result typing** — Dynamic queries can't infer result types statically. Use generic `ResultRow` type for now, potentially add `QueryBuilder.from<T>(shape)` type parameter later.

2. **Mutation builders** — The codebase already has mutation support (`MutationQueryFactory` in `MutationQuery.ts`, `CreateQuery.ts`, `UpdateQuery.ts`, `DeleteQuery.ts`) that powers `Person.create({...})`, `Person.update(id, {...})`, `Person.delete(id)`. The ideation doc (003, phase 6) proposed wrapping these in fluent QueryBuilder-style chains with targeting (e.g. `Person.update({name: 'X'}).for(id)`, `Person.create({...}).exec()`). **Decision needed:** include mutation builder alignment in this plan, or defer to a separate ideation doc?

3. **Scoped filter merging** — When two FieldSets have scoped filters on the same traversal and are merged, AND is the default. OR support and conflict detection are deferred. **Note:** this needs resolution before this plan is considered complete — either handle it as a late addition or capture it in a follow-up ideation document.

4. **Immutability implementation** — Shallow clone is sufficient for typical queries. Structural sharing deferred unless benchmarks show need.

---

## Scope boundaries

**In scope (this plan):**
- PropertyPath, walkPropertyPath, ProxiedPathBuilder extraction
- FieldSet (construction, composition, scoped filters, serialization)
- QueryBuilder (fluent chain, immutable, PromiseLike, toRawInput bridge)
- DSL alignment (Person.select → returns QueryBuilder, .for()/.forAll() pattern)
- Tests verifying DSL and QueryBuilder produce identical IR

**Out of scope (separate plans, already have ideation docs):**
- Shared variable bindings / `.as()` activation → 008
- Shape remapping / ShapeAdapter → 009
- Computed expressions / L module → 006
- Raw IR helpers (Option A) → future
- Mutation builders (create/update/delete) → future
- CONSTRUCT / MINUS query types → 004, 007
