# Plan: 007 — Advanced Query Patterns (MINUS, DELETE WHERE, UPDATE WHERE)

## Chosen architecture

Three features following the same layering as existing queries: **DSL → Factory → IR → Algebra → SPARQL**.

API design: **Alternative E + D** (both action-first and filter-first). All bulk mutation operations return `Promise<void>`. Existing by-ID signatures are unchanged.

Pre-006 scope: only `.equals()` and `.and()`/`.or()` filters — no expression builder, no computed update values.

---

## Architecture decisions

### 1. MINUS uses the existing select pipeline

`.minus()` is a select-chain modifier, not a mutation. It flows through the existing `desugar → canonicalize → lower` pipeline as a new `IRMinusPattern` graph pattern, then converts to the already-defined `SparqlMinus` algebra node.

Two overloads:
- `.minus(ShapeClass)` — excludes entities of a type (generates `?s rdf:type ex:Shape` in MINUS block)
- `.minus(p => p.prop)` — excludes entities that have a property (generates `?s ex:prop ?prop` in MINUS block)

### 2. Bulk mutations bypass the select IR pipeline

Bulk delete/update don't need the full select pipeline (no projections, no ordering, no subqueries). They build their IR directly in their factory classes, similar to existing `UpdateQueryFactory` and `DeleteQueryFactory`.

The one piece they need from the select pipeline is **WherePath → IRExpression conversion**. This logic currently lives split across `IRDesugar.ts` (WherePath → DesugaredWhere) and `IRCanonicalize.ts` + `IRLower.ts` (DesugaredWhere → IRExpression). Extract this into a reusable function.

### 3. Deferred execution via nextTick

Same pattern as `.select()`: the factory creates a `Promise` that defers execution to `nextTick`, giving the user a microtask window to chain `.where()`. The `.where()` call mutates the factory before execution fires.

### 4. `FilteredShape<T>` is a thin intermediate

`Shape.where(pred)` returns a `FilteredShape<T>` that stores the predicate and shape class. Its `.update()`, `.delete()`, `.select()` methods create the appropriate factory, apply the stored predicate, and execute. It's not a promise — it's a builder entry point.

---

## Files expected to change

### New files

| File | Purpose |
|---|---|
| `src/queries/DeleteWhereQuery.ts` | `DeleteWhereQueryFactory` + `IRDeleteWhereMutation` builder |
| `src/queries/UpdateWhereQuery.ts` | `UpdateWhereQueryFactory` + `IRUpdateWhereMutation` builder |
| `src/queries/FilteredShape.ts` | `FilteredShape<T>` intermediate for Alternative D |
| `src/queries/MutationPromise.ts` | `PatchedMutationPromise` type + `patchMutationPromise()` helper |
| `src/queries/IRWhereConverter.ts` | Extracted `wherePathToIRExpression()` reusable function |

### Modified files

| File | Changes |
|---|---|
| `src/queries/IntermediateRepresentation.ts` | Add `IRMinusPattern`, `IRDeleteWhereMutation`, `IRUpdateWhereMutation` to unions |
| `src/shapes/Shape.ts` | Overloads on `.update()` and `.delete()`, new `.deleteAll()` and `.where()` statics |
| `src/queries/SelectQuery.ts` | Add `.minus()` to `PatchedQueryPromise` type and `patchResultPromise()` |
| `src/queries/queryDispatch.ts` | Add `deleteWhereQuery`, `updateWhereQuery` methods |
| `src/interfaces/IQuadStore.ts` | Add `deleteWhereQuery`, `updateWhereQuery` methods |
| `src/sparql/irToAlgebra.ts` | Add `deleteWhereToAlgebra`, `updateWhereToAlgebra`, MINUS IR conversion |
| `src/sparql/index.ts` | Export new conversion functions |
| `src/queries/IRDesugar.ts` | Extract `toWhere()` / `toWhereArg()` to `IRWhereConverter.ts`, re-export for backwards compat |
| `src/queries/IRLower.ts` | Extract where-lowering logic to `IRWhereConverter.ts` |
| `src/utils/LinkedStorage.ts` | Wire new dispatch methods to store |

---

## Inter-component contracts

### New IR types

```ts
// IntermediateRepresentation.ts

export type IRMinusPattern = {
  kind: 'minus';
  pattern: IRGraphPattern;
};
// Add to IRGraphPattern union

export type IRDeleteWhereMutation = {
  kind: 'delete_where';
  shape: string;
  where?: IRExpression;
};

export type IRUpdateWhereMutation = {
  kind: 'update_where';
  shape: string;
  data: IRNodeData;
  where?: IRExpression;
};
// Add both to IRQuery union
```

### WherePath → IRExpression converter

```ts
// IRWhereConverter.ts

import type { WherePath } from './SelectQuery.js';
import type { IRExpression, IRGraphPattern } from './IntermediateRepresentation.js';

/**
 * Converts a DSL WherePath (from proxy evaluation) into an IRExpression.
 * Reused by both the select pipeline and bulk mutation factories.
 *
 * shapeAlias: the IR alias of the root shape being filtered (e.g. 's0')
 * Returns the IRExpression and any additional graph patterns needed
 * (e.g. traverse patterns for the filtered properties).
 */
export function wherePathToIR(
  path: WherePath,
  shapeAlias: string,
  shapeId: string,
): {
  expression: IRExpression;
  patterns: IRGraphPattern[];
};
```

### PatchedMutationPromise

```ts
// MutationPromise.ts

import type { Shape } from '../shapes/Shape.js';
import type { WhereClause } from './SelectQuery.js';

export type PatchedMutationPromise<ShapeType extends Shape> = {
  where(validation: WhereClause<ShapeType>): PatchedMutationPromise<ShapeType>;
} & Promise<void>;

/**
 * Patches a deferred Promise<void> with .where(), same pattern as SelectQueryFactory.patchResultPromise().
 */
export function patchMutationPromise<ShapeType extends Shape>(
  promise: Promise<void>,
  applyWhere: (validation: WhereClause<ShapeType>) => void,
): PatchedMutationPromise<ShapeType>;
```

### QueryDispatch / IQuadStore additions

```ts
// queryDispatch.ts — add to QueryDispatch interface
deleteWhereQuery(query: IRDeleteWhereMutation): Promise<void>;
updateWhereQuery(query: IRUpdateWhereMutation): Promise<void>;

// IQuadStore.ts — add as optional methods
deleteWhereQuery?(query: IRDeleteWhereMutation): Promise<void>;
updateWhereQuery?(query: IRUpdateWhereMutation): Promise<void>;
```

### Shape.ts overload signatures

```ts
// Existing (unchanged)
static update<ShapeType extends Shape, U extends UpdatePartial<ShapeType>>(
  this: { new (...args: any[]): ShapeType },
  id: string | NodeReferenceValue | QShape<ShapeType>,
  updateObjectOrFn?: U,
): Promise<AddId<U>>;

// New bulk overload
static update<ShapeType extends Shape, U extends UpdatePartial<ShapeType>>(
  this: { new (...args: any[]): ShapeType },
  updateObject: U,
): PatchedMutationPromise<ShapeType>;

// Existing (unchanged)
static delete<ShapeType extends Shape>(
  this: { new (...args: any[]): ShapeType },
  id: NodeId | NodeId[] | NodeReferenceValue[],
): Promise<DeleteResponse>;

// New bulk overload
static delete<ShapeType extends Shape>(
  this: { new (...args: any[]): ShapeType },
): PatchedMutationPromise<ShapeType>;

// New
static deleteAll<ShapeType extends Shape>(
  this: { new (...args: any[]): ShapeType },
): Promise<void>;

// New
static where<ShapeType extends Shape>(
  this: { new (...args: any[]): ShapeType },
  predicate: WhereClause<ShapeType>,
): FilteredShape<ShapeType>;
```

### FilteredShape

```ts
// FilteredShape.ts

export class FilteredShape<ShapeType extends Shape> {
  constructor(
    private shapeClass: typeof Shape,
    private predicate: WhereClause<ShapeType>,
  );

  update<U extends UpdatePartial<ShapeType>>(data: U): Promise<void>;
  delete(): Promise<void>;
  select<S>(selectFn: QueryBuildFn<ShapeType, S>):
    Promise<QueryResponseToResultType<S, ShapeType>[]> &
    PatchedQueryPromise<QueryResponseToResultType<S, ShapeType>[], ShapeType>;
}
```

### Algebra output contracts

```ts
// MINUS: IRMinusPattern → SparqlMinus (already defined)
// Unfiltered deleteAll → SparqlDeleteWherePlan (already defined)
// Filtered delete/update → SparqlDeleteInsertPlan (already defined)
```

No new algebra types needed — all map to existing types in `SparqlAlgebra.ts`.

---

## Overload disambiguation logic

In `Shape.update()` implementation:
```ts
// If first arg is string → by-ID path (existing)
// If first arg has .id and is the only key → by-ID path (NodeReferenceValue)
// If first arg is QShape (has __queryContextId) → by-ID path
// If first arg is a plain object (and no second arg) → bulk path (new)
// If two args → by-ID path (existing)
```

In `Shape.delete()` implementation:
```ts
// If args.length > 0 → by-ID path (existing)
// If no args → bulk path (new)
```

---

## Pitfalls

1. **WherePath extraction**: The where-conversion logic in `IRDesugar.ts` / `IRLower.ts` is interleaved with select-specific concerns (alias scoping, traverse pattern generation). Extracting it cleanly without breaking the select pipeline requires care. The extracted function needs to produce both the `IRExpression` and any additional `IRGraphPattern`s (traverse patterns for the filtered properties).

2. **nextTick race**: If the user doesn't chain `.where()` synchronously, the promise fires without a filter. For `.delete()` this means deleting all entities — same risk as `deleteAll()`. The ideation doc flags this as an open question. Current recommendation: `.delete()` without `.where()` acts as `deleteAll()`, but `deleteAll()` exists as the explicit-intent API.

3. **Overload type inference**: TypeScript overloads resolve top-to-bottom. The by-ID overload must come first so that `update('some-id', data)` doesn't accidentally match the bulk overload. The bulk overload's first-arg type (`U extends UpdatePartial<ShapeType>`) overlaps with string in some edge cases — may need a runtime check + explicit generic constraints.

4. **Set modifications in bulk update**: `{ tags: { add: ['x'], remove: ['y'] } }` in a bulk update generates different DELETE/INSERT patterns than a simple field update. The `updateWhereToAlgebra` function must handle all the same value types that `updateToAlgebra` already handles, just without a specific subject ID.

5. **Named graphs**: The ideation doc flags graph interaction as an open question. For now, bulk mutations should work on the default graph only, matching existing by-ID behavior. Graph support can be added later.

---

## Remaining open questions

1. Should `.delete()` with no args and no `.where()` silently delete all, or throw? (Current recommendation: silently delete all — `deleteAll()` is the explicit API, but both work.)
2. Should `.minus()` accept multiple arguments for multiple MINUS clauses, or require chaining `.minus().minus()`?
3. How should bulk operations interact with named graphs? (Deferred to later.)
