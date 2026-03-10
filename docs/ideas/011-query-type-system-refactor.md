---
summary: Decompose the deeply nested conditional types (CreateQResult, GetQueryObjectResultType, CreateShapeSetQResult) into smaller, testable helper types. Add result typing for dynamic queries.
packages: [core]
depends_on: []
---

# Query Type System Refactor

## Status: idea

## Why

The result-type inference pipeline (`GetQueryObjectResultType` → `CreateQResult` / `CreateShapeSetQResult`) is the most complex part of the type system. It works correctly and is covered by type probes, but the deep nesting makes it hard to read, debug, and extend. A refactor would improve maintainability without changing runtime behavior.

Additionally, dynamic queries built via `QueryBuilder` currently use a generic `ResultRow` type — there's no way to carry static result types through the builder chain. Adding a type parameter (e.g. `QueryBuilder.from<T>(shape)`) would let TypeScript infer result shapes for dynamic queries the same way it does for the DSL.

Both efforts are best done together since they touch the same type machinery.

## Current State

### Type: `GetQueryObjectResultType` (SelectQuery.ts ~line 324)

A 9-branch linear cascade that pattern-matches query value types:

```
QV extends SetSize           → SetSizeToQueryResult
QV extends QueryPrimitive    → CreateQResult(Source, Primitive, Property)
QV extends QueryShape        → CreateQResult(Source, ShapeType, Property)
QV extends BoundComponent    → recurse with merged SubProperties
QV extends QueryShapeSet     → CreateShapeSetQResult
QV extends QueryPrimitiveSet → recurse on inner primitive (with PrimitiveArray=true)
QV extends Array             → UnionToIntersection<QueryResponseToResultType>
QV extends QueryPrimitive<boolean> → 'bool'
_                            → never & {__error}
```

**Note:** The `QueryPrimitive<boolean>` branch (second-to-last) is unreachable — `QV extends QueryPrimitive` already matches all primitives including booleans. This branch is dead code and can be removed in any cleanup.

**Nesting depth:** 9 levels (linear chain — each condition is in the previous one's false branch).

### Type: `CreateQResult` (SelectQuery.ts ~line 415)

Walks the QueryShape/QueryShapeSet source chain upward to build nested `QResult<Shape, {...}>` objects:

```
Source extends QueryShape(_, ParentSource, _)
  ParentSource extends null
    HasName extends true       → Value (unwrapped)
    HasName extends false
      Value extends null       → QResult<Shape, {[Property]: recurse} & SubProperties>
      Value !extends null      → QResult<Shape, {[Property]: recurse}>
  ParentSource !extends null   → recurse(ParentSource, QResult<Shape, {[P]: recurse}>, SourceProperty)
Source extends QueryShapeSet(ShapeType, ParentSource, _)
  → recurse(ParentSource, QResult<ShapeType, {[P]: recurse}>[], SourceProperty)
Value extends Shape            → QResult<Value, SubProperties>
_                              → NormaliseBoolean<Value>
```

**Nesting depth:** 4 levels. Contains an inline TODO: "this must be simplified and rewritten — it is likely the most complex part of the type system currently."

### Type: `CreateShapeSetQResult` (SelectQuery.ts ~line 497)

Handles array/set results specifically. Similar structure to `CreateQResult` but specialized for `QueryShapeSet` values:

```
Source extends QueryShape(SourceShapeType, ParentSource)
  [HasName, ParentSource] extends [true, null]  → CreateQResult[]
  ParentSource extends null                      → QResult<Shape, {[P]: CreateQResult[]}>
  ParentSource !extends null                     → CreateQResult with SubProperties array
Source extends QueryShapeSet(ShapeType, ParentSource, SourceProperty)
  → CreateQResult(ParentSource, QResult<ShapeType, {[P]: CreateQResult[]}>[], SourceProperty)
_ → CreateQResult<ShapeType>
```

**Nesting depth:** 3 levels, 5 branches.

### Supporting types

- `NormaliseBoolean<T>` — prevents `true | false` from staying as a union; collapses to `boolean`
- `SetSizeToQueryResult<Source, HasName>` — handles `.count()` results
- `ObjectToPlainResult<T>` — converts custom object keys in `.select({...})` calls
- `QueryResponseToResultType<T>` — top-level entry point that delegates to `GetQueryObjectResultType`

## Existing Safety Net

Type probes that exercise these types:
- `src/tests/type-probe-deep-nesting.ts` — 20 test cases for deep nesting, nested sub-selects, polymorphism
- `src/tests/type-probe-4.4a.ts` — 4 probes for `QueryResponseToResultType`, `.one()` unwrapping, PromiseLike
- `src/tests/query.types.test.ts` — compile-only Jest tests for property selection types

## Proposed Approach

### Strategy: Extract helper types from the linear cascades

**Phase A: Factor `GetQueryObjectResultType` into 3 helpers**

This is the lowest-risk refactor since it's a flat cascade (easy to split):

```typescript
// Helper 1: Primitives and counts
type ResolveQResultPrimitive<QV, PrimitiveArray, HasName> = ...

// Helper 2: Single objects (QueryShape, BoundComponent)
type ResolveQResultObject<QV, SubProperties, HasName> = ...

// Helper 3: Collections (QueryShapeSet, QueryPrimitiveSet, Array)
type ResolveQResultCollection<QV, SubProperties, PrimitiveArray, HasName> = ...

// Recomposed:
type GetQueryObjectResultType<QV, SubProperties, PrimitiveArray, HasName> =
  ResolveQResultPrimitive<QV, PrimitiveArray, HasName> extends infer R
    ? [R] extends [never] ? ResolveQResultObject<QV, SubProperties, HasName> extends infer R2
      ? [R2] extends [never] ? ResolveQResultCollection<QV, SubProperties, PrimitiveArray, HasName>
        : R2 : never : R : never;
```

**Phase B: Simplify `CreateQResult` (higher risk)**

The key insight from the inline TODO: sub-`.select()` on a `QueryShapeSet` arrives with `Value = null` (SubProperties go on the QResult itself), while sub-`.select()` on a `QueryShape` arrives with `Value` defined (SubProperties go on the inner QResult). This fork could be extracted into a helper:

```typescript
type CreateQResultLeaf<SourceShapeType, Value, Property, SubProperties> =
  Value extends null
    ? QResult<SourceShapeType, {[P in Property]: CreateQResult<Value, Value>} & SubProperties>
    : QResult<SourceShapeType, {[P in Property]: CreateQResult<Value, Value, '', SubProperties>}>;
```

**Phase C: Merge `CreateShapeSetQResult` into `CreateQResult`**

`CreateShapeSetQResult` is structurally very similar to `CreateQResult` — consider merging them with an `IsArray` type parameter flag.

### Validation approach

1. Before any change: `npx tsc --declaration --emitDeclarationOnly --outDir /tmp/before`
2. Make changes
3. After: `npx tsc --declaration --emitDeclarationOnly --outDir /tmp/after`
4. `diff /tmp/before/queries/SelectQuery.d.ts /tmp/after/queries/SelectQuery.d.ts` — should show only helper type additions
5. All type probes compile
6. All tests pass

### Quick win: Remove dead branch

The `QV extends QueryPrimitive<boolean>` branch in `GetQueryObjectResultType` (line ~368) is unreachable — `QV extends QueryPrimitive` on line ~333 already catches all primitives including booleans. This can be safely removed as a standalone cleanup.

## Result typing for dynamic queries

Currently `QueryBuilder.from(Person).select(...)` returns untyped results. The goal is to support a type parameter that threads through the builder chain:

```ts
// Future API — typed dynamic queries
const qb = QueryBuilder.from<Person>(Person)
  .select(p => [p.name, p.age]);

const results = await qb; // type: { name: string; age: number }[]
```

This requires `QueryBuilder` to carry a generic `R` (result type) that gets refined by `.select()`, `.where()`, and other builder methods — similar to how `FieldSet<R>` already carries its response type.

### Key challenges

- `.select()` with a callback already produces a typed `FieldSet<R>` — the gap is threading `R` up through `QueryBuilder<R>` and into the `PromiseLike<R>` return
- String-based `.select('name', 'age')` calls would need mapped types to infer result shape from property names
- Chained `.where()` / `.orderBy()` should preserve `R` without narrowing it

## QueryContext null handling

`getQueryContext()` in `QueryContext.ts` currently returns `null` when a context name isn't found. The TODO suggests returning a `NullQueryShape` or similar sentinel so that queries built against a missing context still produce valid (empty) results instead of runtime errors. This is a small related improvement — the null sentinel type would need to be recognized by the result type machinery above.

## Risks

- **Silent type degradation:** If a refactored type resolves differently, TypeScript may widen to `any` without compile errors. The `.d.ts` diff is the only reliable way to catch this.
- **Recursive type depth:** TypeScript has a recursion limit (~50 levels). Splitting types adds indirection; verify the `.d.ts` output still resolves fully (no `any` where there shouldn't be).
- **Interdependency:** `CreateQResult` and `CreateShapeSetQResult` call each other recursively. Merging or splitting them requires careful attention to the recursion paths.
