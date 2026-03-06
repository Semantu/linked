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

- `.for(id)` — single ID
- `.forAll(ids?)` — specific list or all instances (no args)
- `.one(id)` — `.for(id)` + singleResult
- **Update requires targeting** — `Person.update({...})` without `.for()`/`.forAll()` is a type error.
- **Delete takes id directly** — `Person.delete(id)`, `Person.deleteAll(ids?)`.

### 5. FieldSet as the composable primitive

FieldSet is a named, immutable, serializable collection of property paths rooted at a shape. It supports:
- Construction: `FieldSet.for(shape, fields)`, `FieldSet.all(shape)`, callback form with proxy
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
  readonly steps: PropertyShape[];
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
  static all(shape: NodeShape | string, opts?: { depth?: number }): FieldSet;
  static merge(sets: FieldSet[]): FieldSet;

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

  for(id: string): QueryBuilder;
  forAll(ids?: string[]): QueryBuilder;
  one(id: string): QueryBuilder;

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
- `src/queries/SelectQuery.ts` (currently ~2100 lines) — Refactor `SelectQueryFactory` to delegate to QueryBuilder internally. `PatchedQueryPromise` replaced. Proxy creation (lines ~1018, ~1286) to be extracted into shared `ProxiedPathBuilder`.
- `src/queries/IRPipeline.ts` — May need minor adjustments if `buildSelectQuery` input types change
- `src/shapes/Shape.ts` — Update `Shape.select()` (line ~125), `Shape.query()` (line ~95) to return QueryBuilder. Add `.for()`, `.forAll()`, `.delete()`, `.deleteAll()`, `.update()` with targeting requirement.
- `src/index.ts` — Export new public API (`QueryBuilder`, `FieldSet`, `PropertyPath`) alongside existing `SelectQuery` namespace

### Existing pipeline (no changes expected)
- `src/queries/IntermediateRepresentation.ts` — IR types stay as-is
- `src/queries/IRLower.ts` — no changes (consumes same structures)
- `src/sparql/irToAlgebra.ts` — no changes
- `src/sparql/algebraToString.ts` — no changes

---

## Potential Pitfalls

1. **SelectQueryFactory complexity** — It's ~1800 lines with complex proxy tracing, `toRawInput()`, and mutable state. Refactoring it to use QueryBuilder internally without breaking existing behavior is the highest-risk change. Strategy: keep old code paths working alongside new ones initially, validate with existing tests, then swap.

2. **ProxiedPathBuilder extraction** — The proxy is currently embedded in SelectQueryFactory. Extracting it into a shared module that both the DSL and QueryBuilder use requires understanding all proxy trap behaviors and edge cases (`.select()` for sub-selection, `.where()` for scoped filters, `.as()` for bindings, `.path()` escape hatch).

3. **PromiseLike backward compatibility** — Existing code does `await Person.select(p => [...]).where(...)`. The `.where()` currently mutates the factory before `nextTick` fires. Switching to immutable builders that chain before `await` should be backward compatible (JS evaluates the full chain before calling `.then()`), but edge cases where users store intermediate references may break.

4. **Scoped filter representation** — FieldSet entries can carry scoped filters. These must be correctly lowered into `IRTraversePattern.filter` fields. The existing proxy-based scoped `.where()` already does this — need to ensure the FieldSet path produces identical IR.

5. **String path resolution** — `walkPropertyPath('friends.name')` must walk `NodeShape.getPropertyShape('friends')` → get valueShape → `getPropertyShape('name')`. Need to handle cases where property labels are ambiguous or the valueShape isn't a NodeShape.

---

## Open Questions (remaining from ideation)

1. **Result typing** — Dynamic queries can't infer result types statically. Use generic `ResultRow` type for now, potentially add `QueryBuilder.from<T>(shape)` type parameter later.

2. **Mutation builders** — Phase 6 in ideation. Not part of this plan's scope. The current plan covers select queries + DSL alignment only.

3. **Scoped filter merging** — When two FieldSets have scoped filters on the same traversal and are merged, AND is the default. OR support and conflict detection are deferred.

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
