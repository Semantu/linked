# Plan: Advanced Query Patterns

Implements three features from [ideation doc](../ideas/007-advanced-query-patterns.md):
1. **MINUS** — `.minus()` on `QueryBuilder`
2. **Bulk Delete** — `.deleteAll()` + `.delete().where()`
3. **Conditional Update** — `.update().where()` + `.update().forAll()`

Named graphs: deferred (out of scope).

---

## Architecture Overview

All three features follow the same pipeline:

```
DSL (Builder) → IR AST → SPARQL Algebra → SPARQL String
```

Each feature adds:
- **Builder method(s)** — new chainable methods on existing builders
- **IR type(s)** — new variant(s) in the IR union
- **Algebra conversion** — new case(s) in `irToAlgebra.ts`
- **Serialization** — reuses existing `algebraToString.ts` (no changes needed for any feature)

### Files that change

| File | F1 | F2 | F3 |
|------|----|----|-----|
| `src/queries/QueryBuilder.ts` | `.minus()` | | |
| `src/queries/DeleteBuilder.ts` | | `.where()`, `.all()` | |
| `src/queries/UpdateBuilder.ts` | | | `.where()`, `.forAll()` |
| `src/shapes/Shape.ts` | | `.deleteAll()`, `.deleteWhere()` | |
| `src/queries/IntermediateRepresentation.ts` | `IRMinusPattern` | `IRDeleteWhereMutation`, `IRDeleteAllMutation` | `IRUpdateWhereMutation` |
| `src/queries/IRMutation.ts` | | `buildCanonicalDeleteWhereMutationIR`, `buildCanonicalDeleteAllMutationIR` | `buildCanonicalUpdateWhereMutationIR` |
| `src/sparql/irToAlgebra.ts` | minus in `selectToAlgebra` | `deleteWhereToAlgebra`, `deleteAllToAlgebra` | `updateWhereToAlgebra` |
| `src/queries/queryDispatch.ts` | | new dispatch methods | new dispatch methods |
| `src/queries/DeleteQuery.ts` | | new factory methods | |
| `src/queries/UpdateQuery.ts` | | | new factory methods |
| `src/tests/sparql-mutation-golden.test.ts` | | golden tests | golden tests |
| `src/tests/sparql-select-golden.test.ts` | golden tests | | |
| `src/tests/mutation-builder.test.ts` | | builder equiv tests | builder equiv tests |

---

## Feature 1: MINUS (`QueryBuilder.minus()`)

### DSL

```ts
// By shape — exclude entities that are also of another type
Person.select(p => p.name).minus(Employee)

// By property existence
Order.select(o => o.id).minus(o => o.shippedDate)

// By condition
Person.select(p => p.name).minus(p => p.status.equals('inactive'))

// Chained — produces two separate MINUS { } blocks
Person.select(p => p.name).minus(Employee).minus(Contractor)
```

### IR Contract

```ts
// New pattern added to IRGraphPattern union
export type IRMinusPattern = {
  kind: 'minus';
  pattern: IRGraphPattern;       // The pattern to subtract
  filter?: IRExpression;         // Optional filter within the MINUS block
};

// Updated union:
export type IRGraphPattern =
  | IRShapeScanPattern
  | IRTraversePattern
  | IRJoinPattern
  | IROptionalPattern
  | IRUnionPattern
  | IRExistsPattern
  | IRMinusPattern;              // ← new
```

### Builder → IR

`QueryBuilder.minus()` accepts:
- `ShapeConstructor` — creates an `IRShapeScanPattern` for the shape's type triple
- `WhereClause<S>` callback — reuses `processWhereClause()` to produce `IRTraversePattern` + `IRExpression`

Stored as `_minusPatterns: IRMinusPattern[]` on the builder. Each `.minus()` call appends to the array (immutable clone).

In `build()`, minus patterns are added to `IRSelectQuery.patterns[]`.

### Algebra Conversion (`selectToAlgebra`)

When processing `IRSelectQuery.patterns`, an `IRMinusPattern` converts to:

```ts
// Wraps current algebra in SparqlMinus
algebra = {
  type: 'minus',
  left: algebra,         // everything so far
  right: minusAlgebra,   // the MINUS block's content
} satisfies SparqlMinus;
```

The right side is built by converting the inner `IRGraphPattern` + optional `IRExpression` to algebra, same as any other pattern.

### Serialization

Already exists in `algebraToString.ts`:
```ts
case 'minus':
  return `${left}\nMINUS {\n${indent(right)}\n}`;
```

No changes needed.

### SPARQL output

```sparql
SELECT ?name WHERE {
  ?a0 a <Person> .
  ?a0 <name> ?name .
  MINUS {
    ?a0 a <Employee> .
  }
}
```

---

## Feature 2: Bulk Delete

### DSL

```ts
// Delete all instances of a type
TempRecord.deleteAll()                                    // static sugar
TempRecord.delete().all()                                 // builder equivalent

// Conditional delete
Person.delete().where(p => p.status.equals('inactive'))
Person.deleteWhere(p => p.status.equals('inactive'))      // static sugar

// Existing by-ID (unchanged)
Person.delete('id-1')
```

### IR Contract

```ts
// New mutation types
export type IRDeleteAllMutation = {
  kind: 'delete_all';
  shape: string;                 // shape IRI
};

export type IRDeleteWhereMutation = {
  kind: 'delete_where';
  shape: string;                 // shape IRI
  where: IRExpression;           // filter condition from callback
  wherePatterns: IRGraphPattern[]; // traverse patterns needed by the filter
};

// Note: both need the shape ID to:
// 1. Generate `?a0 a <ShapeType>` in WHERE
// 2. Walk the shape tree for blank node cleanup
```

### Builder changes (`DeleteBuilder`)

New fields on `DeleteBuilderInit`:
```ts
interface DeleteBuilderInit<S extends Shape> {
  shape: ShapeConstructor<S>;
  ids?: NodeId[];
  mode?: 'ids' | 'all' | 'where';    // mutual exclusivity
  whereFn?: WhereClause<S>;
}
```

New methods:
```ts
all(): DeleteBuilder<S>         // sets mode = 'all'
where(fn: WhereClause<S>): DeleteBuilder<S>  // sets mode = 'where', stores fn
```

`build()` dispatches by mode:
- `'ids'` (default) → existing `DeleteQueryFactory`
- `'all'` → `buildCanonicalDeleteAllMutationIR()`
- `'where'` → `buildCanonicalDeleteWhereMutationIR()`

### Shape static methods

```ts
// Shape.ts additions
static deleteAll<S extends Shape>(this: ShapeConstructor<S>): DeleteBuilder<S> {
  return DeleteBuilder.from(this).all();
}

static deleteWhere<S extends Shape>(
  this: ShapeConstructor<S>,
  fn: WhereClause<S>,
): DeleteBuilder<S> {
  return DeleteBuilder.from(this).where(fn);
}
```

`Shape.delete()` signature unchanged — still requires IDs. `Shape.delete()` with no args is NOT supported (prevents accidental bulk delete).

### Algebra Conversion

#### `deleteAllToAlgebra(ir: IRDeleteAllMutation)` → `SparqlDeleteInsertPlan`

Walks the shape tree to generate schema-aware blank node cleanup:

```ts
function deleteAllToAlgebra(
  ir: IRDeleteAllMutation,
  options?: SparqlOptions,
): SparqlDeleteInsertPlan {
  const shape = resolveShapeById(ir.shape);

  // 1. Root: ?a0 ?p ?o (catches all triples including rdf:type)
  const deletePatterns = [triple(var('a0'), var('p'), var('o'))];
  const whereRequired = [
    triple(var('a0'), iriTerm(rdf.type), iriTerm(ir.shape)),
    triple(var('a0'), var('p'), var('o')),
  ];

  // 2. Walk shape tree for blank node properties
  const optionalBlocks = walkBlankNodeTree(shape, 'a0', deletePatterns);

  // 3. Build WHERE: required BGP + nested OPTIONALs for blank nodes
  let whereAlgebra = buildWhereWithOptionals(whereRequired, optionalBlocks);

  return {
    type: 'delete_insert',
    deletePatterns,
    insertPatterns: [],
    whereAlgebra,
  };
}
```

#### `walkBlankNodeTree(shape, parentVar, deletePatterns)` — recursive helper

```ts
// For each property with nodeKind containing BlankNode:
//   1. Add to deletePatterns: ?bN ?pN ?oN
//   2. Create OPTIONAL block: { ?parent <property> ?bN . FILTER(isBlank(?bN)) . ?bN ?pN ?oN }
//   3. If property has valueShape, recurse into that shape
// Returns array of optional blocks to nest
```

Uses existing APIs:
- `NodeShape.getPropertyShapes(true)` — all properties including inherited
- `PropertyShape.nodeKind` + `nodeKindToAtomics()` — detect blank node properties
- `PropertyShape.valueShape` + `getShapeClass()` — follow nested shapes

#### `deleteWhereToAlgebra(ir: IRDeleteWhereMutation)` → `SparqlDeleteInsertPlan`

Same blank node cleanup as `deleteAllToAlgebra`, plus filter conditions appended to WHERE:

```ts
function deleteWhereToAlgebra(
  ir: IRDeleteWhereMutation,
  options?: SparqlOptions,
): SparqlDeleteInsertPlan {
  // Same as deleteAll, but wrap whereAlgebra in SparqlFilter
  // with the converted IRExpression from ir.where
}
```

### SPARQL output — `.deleteAll()`

```sparql
DELETE {
  ?a0 ?p ?o .
  ?addr ?p1 ?o1 .
}
WHERE {
  ?a0 a <Person> .
  ?a0 ?p ?o .
  OPTIONAL {
    ?a0 <address> ?addr . FILTER(isBlank(?addr)) .
    ?addr ?p1 ?o1 .
  }
}
```

### SPARQL output — `.delete().where()`

```sparql
DELETE {
  ?a0 ?p ?o .
}
WHERE {
  ?a0 a <Person> .
  ?a0 ?p ?o .
  ?a0 <status> ?status .
  FILTER(?status = "inactive")
}
```

### QueryDispatch

`deleteQuery()` currently accepts `DeleteQuery` (which is `IRDeleteMutation`). Need to widen the type:

```ts
export type DeleteQuery = IRDeleteMutation | IRDeleteAllMutation | IRDeleteWhereMutation;
```

The dispatch implementation routes by `kind`:
- `'delete'` → existing `deleteToAlgebra` → `deleteInsertPlanToSparql`
- `'delete_all'` → `deleteAllToAlgebra` → `deleteInsertPlanToSparql`
- `'delete_where'` → `deleteWhereToAlgebra` → `deleteInsertPlanToSparql`

---

## Feature 3: Conditional Update

### DSL

```ts
// Conditional update
Person.update({ status: 'archived' }).where(p => p.status.equals('inactive'))

// Bulk update all instances
Person.update({ verified: true }).forAll()

// Existing by-ID (unchanged)
Person.update({ name: 'Bob' }).for('id-1')
```

### IR Contract

```ts
export type IRUpdateWhereMutation = {
  kind: 'update_where';
  shape: string;                 // shape IRI
  data: IRNodeData;              // same data format as IRUpdateMutation
  where?: IRExpression;          // filter condition (absent for forAll)
  wherePatterns?: IRGraphPattern[]; // traverse patterns needed by the filter
};
```

### Builder changes (`UpdateBuilder`)

New fields on `UpdateBuilderInit`:
```ts
interface UpdateBuilderInit<S extends Shape> {
  shape: ShapeConstructor<S>;
  data?: UpdatePartial<S>;
  targetId?: string;
  mode?: 'id' | 'all' | 'where';    // mutual exclusivity
  whereFn?: WhereClause<S>;
}
```

New methods:
```ts
forAll(): UpdateBuilder<S, U>                    // sets mode = 'all'
where(fn: WhereClause<S>): UpdateBuilder<S, U>   // sets mode = 'where', stores fn
```

`build()` dispatches by mode:
- `'id'` (default) → existing `UpdateQueryFactory`
- `'all'` or `'where'` → `buildCanonicalUpdateWhereMutationIR()`

### Algebra Conversion

#### `updateWhereToAlgebra(ir: IRUpdateWhereMutation)` → `SparqlDeleteInsertPlan`

Key insight: reuses the same field-level DELETE/INSERT logic from existing `updateToAlgebra()`, but parameterizes the subject.

```ts
function updateWhereToAlgebra(
  ir: IRUpdateWhereMutation,
  options?: SparqlOptions,
): SparqlDeleteInsertPlan {
  const subjectVar = variable('a0');

  // 1. Type triple in WHERE: ?a0 a <Shape>
  const typeTriple = triple(subjectVar, iriTerm(rdf.type), iriTerm(ir.shape));

  // 2. For each field in ir.data, generate:
  //    DELETE: ?a0 <property> ?old_property .
  //    INSERT: ?a0 <property> "newValue" .
  //    WHERE:  ?a0 <property> ?old_property .  (OPTIONAL for forAll, required for where)

  // 3. If ir.where exists, convert to SparqlFilter wrapping WHERE
  //    If ir.where absent (forAll), wrap old-value bindings in OPTIONAL

  // 4. Return SparqlDeleteInsertPlan
}
```

The field processing logic should be extracted from `updateToAlgebra()` into a shared helper that takes a subject term (either IRI or variable).

### SPARQL output — `.where()`

```sparql
DELETE { ?a0 <status> ?old_status . }
INSERT { ?a0 <status> "archived" . }
WHERE  {
  ?a0 a <Person> .
  ?a0 <status> ?old_status .
  FILTER(?old_status = "inactive")
}
```

### SPARQL output — `.forAll()`

```sparql
DELETE { ?a0 <verified> ?old_verified . }
INSERT { ?a0 <verified> true . }
WHERE  {
  ?a0 a <Person> .
  OPTIONAL { ?a0 <verified> ?old_verified . }
}
```

### QueryDispatch

`updateQuery()` type widens:

```ts
export type UpdateQuery = IRUpdateMutation | IRUpdateWhereMutation;
```

Dispatch routes by `kind`:
- `'update'` → existing `updateToAlgebra` → `deleteInsertPlanToSparql`
- `'update_where'` → `updateWhereToAlgebra` → `deleteInsertPlanToSparql`

---

## Inter-Component Contracts

### IR ↔ Algebra boundary

New conversion functions exported from `irToAlgebra.ts`:

```ts
export function deleteAllToAlgebra(ir: IRDeleteAllMutation, options?: SparqlOptions): SparqlDeleteInsertPlan;
export function deleteWhereToAlgebra(ir: IRDeleteWhereMutation, options?: SparqlOptions): SparqlDeleteInsertPlan;
export function updateWhereToAlgebra(ir: IRUpdateWhereMutation, options?: SparqlOptions): SparqlDeleteInsertPlan;
```

All return `SparqlDeleteInsertPlan` — reuses existing `deleteInsertPlanToSparql()` serialization.

### Builder ↔ IR boundary

Builders produce IR via factory functions in `IRMutation.ts`:

```ts
export function buildCanonicalDeleteAllMutationIR(input: { shape: NodeShape }): IRDeleteAllMutation;
export function buildCanonicalDeleteWhereMutationIR(input: { shape: NodeShape; where: ... }): IRDeleteWhereMutation;
export function buildCanonicalUpdateWhereMutationIR(input: { shape: NodeShape; data: ...; where?: ... }): IRUpdateWhereMutation;
```

### WHERE clause reuse

Both `DeleteBuilder.where()` and `UpdateBuilder.where()` accept `WhereClause<S>` — the same type used by `QueryBuilder.where()`. Processing uses the existing `processWhereClause()` from `SelectQuery.ts`.

### Shared blank node tree walker

New utility for Feature 2, potentially reusable:

```ts
// irToAlgebra.ts or new utility file
function walkBlankNodeTree(
  shape: NodeShape,
  parentVar: string,
  deletePatterns: SparqlTriple[],
  depth?: number,
): OptionalBlock[];
```

---

## Potential Pitfalls

1. **WHERE callback in mutation context**: `processWhereClause()` currently creates a proxy via `createProxiedPathBuilder(shape)`. This works because it only needs the shape definition, not a query context. Should work as-is for mutations, but needs verification.

2. **Variable naming conflicts**: `updateWhereToAlgebra` uses `?a0` as subject (matching query convention) and `?old_*` for old values (matching existing update convention). These must not collide with variables generated by WHERE filter processing.

3. **Blank node cleanup depth**: Recursive shape tree walking could theoretically be unbounded if shapes have circular references. Should cap recursion depth (e.g., 10 levels) with a clear error.

4. **`updateToAlgebra` refactoring**: Extracting field processing into a shared helper is the riskiest change — it touches working code. The existing tests in `sparql-mutation-golden.test.ts` provide a safety net, but should be run after every refactor step.

5. **DeleteBuilder.from() signature**: Currently `from(shape, ids?)` — making `ids` truly optional means `DeleteBuilder.from(Shape)` returns a builder with no IDs and no mode set. `build()` must validate that exactly one of `ids`/`all`/`where` is specified.

---

## Implementation Phases

### Dependency graph

```
Phase 1 (IR types)
    ├── Phase 2 (MINUS)         ─┐
    ├── Phase 3 (Bulk Delete)    ├── Phase 5 (Integration)
    └── Phase 4 (Cond. Update)  ─┘
```

Phases 2, 3, 4 can theoretically run in parallel after Phase 1, but all three touch `irToAlgebra.ts` (different sections). To avoid merge conflicts on shared files, execute sequentially: 1 → 2 → 3 → 4 → 5.

---

### Phase 1: IR Types & Contracts — COMPLETED

**Goal:** Add all new IR types, mutation type unions, and canonical IR builder stubs. No logic — types only. Unblocks all subsequent phases.

**Status:** Done. `tsc --noEmit` passes. All 633 tests pass.

**Files:**
- `src/queries/IntermediateRepresentation.ts` — add `IRMinusPattern` to `IRGraphPattern` union
- `src/queries/IRMutation.ts` — add `IRDeleteAllMutation`, `IRDeleteWhereMutation`, `IRUpdateWhereMutation` types + stub `buildCanonical*` functions
- `src/queries/DeleteQuery.ts` — widen `DeleteQuery` type union
- `src/queries/UpdateQuery.ts` — widen `UpdateQuery` type union

**Tasks:**
1. Add `IRMinusPattern` type and extend `IRGraphPattern` union.
2. Add `IRDeleteAllMutation`, `IRDeleteWhereMutation`, `IRUpdateWhereMutation` types.
3. Add stub `buildCanonicalDeleteAllMutationIR()`, `buildCanonicalDeleteWhereMutationIR()`, `buildCanonicalUpdateWhereMutationIR()` — return correct typed objects from input params.
4. Widen `DeleteQuery` to `IRDeleteMutation | IRDeleteAllMutation | IRDeleteWhereMutation`.
5. Widen `UpdateQuery` to `IRUpdateMutation | IRUpdateWhereMutation`.

**Validation:**
- `npx tsc -p tsconfig-esm.json --noEmit` exits 0
- `npm test` — all existing tests still pass (no regressions)

---

### Phase 2: MINUS on QueryBuilder — COMPLETED

**Goal:** Full `.minus()` support: builder method → IR → algebra → SPARQL string.

**Status:** Done. 3 new golden tests pass. All 636 tests pass.

**Files:**
- `src/queries/QueryBuilder.ts` — add `.minus()` method
- `src/sparql/irToAlgebra.ts` — handle `IRMinusPattern` in `selectToAlgebra`
- `src/test-helpers/query-fixtures.ts` — add minus fixture factories
- `src/tests/sparql-select-golden.test.ts` — add golden tests

**Tasks:**
1. Add `.minus()` method to `QueryBuilder` accepting `ShapeConstructor | WhereClause<S>`. Store as `_minusPatterns` array on builder init. Clone appends.
2. In `build()` / `buildSelectQuery()`, convert minus patterns to `IRMinusPattern` entries in `IRSelectQuery.patterns[]`.
3. In `selectToAlgebra`, add case for `'minus'` pattern kind: wrap current algebra in `SparqlMinus { left, right }`.
4. Add query fixture factories: `minusShape`, `minusProperty`, `minusCondition`, `minusChained`.
5. Add golden tests asserting exact SPARQL output.

**Fixtures & golden tests:**

| Fixture | DSL | Expected SPARQL contains |
|---------|-----|--------------------------|
| `minusShape` | `Person.select(p => p.name).minus(Employee)` | `MINUS { ?a0 a <Employee> . }` |
| `minusProperty` | `Person.select(p => p.name).minus(p => p.hobby)` | `MINUS { ?a0 <hobby> ?a0_hobby . }` |
| `minusCondition` | `Person.select(p => p.name).minus(p => p.hobby.equals('Chess'))` | `MINUS { ?a0 <hobby> ?a0_hobby . FILTER(?a0_hobby = "Chess") }` |
| `minusChained` | `Person.select(p => p.name).minus(Employee).minus(p => p.hobby)` | Two separate `MINUS { }` blocks |

**Validation:**
- `npx tsc -p tsconfig-esm.json --noEmit` exits 0
- `npm test` — all existing tests pass + 4 new minus golden tests pass
- Assert each golden test uses exact `toBe` matching on full SPARQL string

---

### Phase 3: Bulk Delete — COMPLETED

**Goal:** `.deleteAll()`, `.delete().all()`, `.delete().where()`, `.deleteWhere()` — full pipeline.

**Files:**
- `src/queries/DeleteBuilder.ts` — add `mode`, `whereFn`, `.all()`, `.where()` methods, dispatch in `build()`
- `src/shapes/Shape.ts` — add `deleteAll()`, `deleteWhere()` static methods
- `src/queries/IRMutation.ts` — implement `buildCanonicalDeleteAllMutationIR()`, `buildCanonicalDeleteWhereMutationIR()` (replace stubs)
- `src/sparql/irToAlgebra.ts` — add `deleteAllToAlgebra()`, `deleteWhereToAlgebra()`, `walkBlankNodeTree()` helper, export `deleteAllToSparql()`, `deleteWhereToSparql()` convenience wrappers
- `src/test-helpers/query-fixtures.ts` — add delete fixture factories
- `src/tests/sparql-mutation-golden.test.ts` — add golden tests

**Tasks:**
1. Add `mode` and `whereFn` to `DeleteBuilderInit`. Add `.all()` and `.where(fn)` methods.
2. Update `build()` to dispatch by mode: `'ids'` → existing factory, `'all'` → `buildCanonicalDeleteAllMutationIR`, `'where'` → `buildCanonicalDeleteWhereMutationIR`. Validate mutual exclusivity.
3. Add `Shape.deleteAll()` and `Shape.deleteWhere(fn)` static methods.
4. Implement `buildCanonicalDeleteAllMutationIR()` — returns `{ kind: 'delete_all', shape: shape.id }`.
5. Implement `buildCanonicalDeleteWhereMutationIR()` — processes WHERE callback via `processWhereClause`, converts to IR expressions/patterns.
6. Implement `deleteAllToAlgebra()` with `walkBlankNodeTree()` for schema-aware blank node cleanup.
7. Implement `deleteWhereToAlgebra()` — same base as deleteAll + filter conditions from WHERE.
8. Add convenience wrappers `deleteAllToSparql()`, `deleteWhereToSparql()`.
9. Add fixtures and golden tests.

**Fixtures & golden tests:**

| Fixture | DSL | Key assertions |
|---------|-----|----------------|
| `deleteAll` | `Person.deleteAll()` | `DELETE { ?a0 ?p ?o . }` + `WHERE { ?a0 a <Person> . ?a0 ?p ?o . }` |
| `deleteAllBuilder` | `Person.delete().all()` | Same SPARQL as `deleteAll` (builder equivalence) |
| `deleteWhere` | `Person.delete().where(p => p.hobby.equals('Chess'))` | `FILTER` with hobby equals in WHERE |
| `deleteWhereSugar` | `Person.deleteWhere(p => p.hobby.equals('Chess'))` | Same SPARQL as `deleteWhere` |

**Validation:**
- `npx tsc -p tsconfig-esm.json --noEmit` exits 0
- `npm test` — all existing tests pass + new delete golden tests pass
- Assert `deleteAll` and `deleteAllBuilder` produce identical SPARQL
- Assert `deleteWhere` and `deleteWhereSugar` produce identical SPARQL

---

### Phase 4: Conditional Update — COMPLETED

**Goal:** `.update().where()` and `.update().forAll()` — full pipeline.

**Files:**
- `src/queries/UpdateBuilder.ts` — add `mode`, `whereFn`, `.forAll()`, `.where()` methods, dispatch in `build()`
- `src/queries/IRMutation.ts` — implement `buildCanonicalUpdateWhereMutationIR()` (replace stub)
- `src/sparql/irToAlgebra.ts` — add `updateWhereToAlgebra()`, extract shared field processing helper from `updateToAlgebra()`, export `updateWhereToSparql()` convenience wrapper
- `src/test-helpers/query-fixtures.ts` — add update fixture factories
- `src/tests/sparql-mutation-golden.test.ts` — add golden tests

**Tasks:**
1. Add `mode` and `whereFn` to `UpdateBuilderInit`. Add `.forAll()` and `.where(fn)` methods.
2. Update `build()` to dispatch by mode: `'id'` → existing factory, `'all'`/`'where'` → `buildCanonicalUpdateWhereMutationIR`. Validate: require data via `.set()` before `.forAll()`/`.where()`.
3. Implement `buildCanonicalUpdateWhereMutationIR()` — processes WHERE callback, builds IR.
4. Extract shared field processing from `updateToAlgebra()` into a helper that takes a subject term (IRI or variable). Ensure existing `updateToAlgebra()` calls the helper (refactor, not rewrite). Run existing tests after this step.
5. Implement `updateWhereToAlgebra()` using the shared helper with `?a0` variable subject + type triple + filter.
6. Add convenience wrapper `updateWhereToSparql()`.
7. Add fixtures and golden tests.

**Fixtures & golden tests:**

| Fixture | DSL | Key assertions |
|---------|-----|----------------|
| `updateWhere` | `Person.update({hobby: 'Chess'}).where(p => p.hobby.equals('Jogging'))` | `DELETE { ?a0 <hobby> ?old_hobby . }` + `INSERT { ?a0 <hobby> "Chess" . }` + `FILTER` in WHERE |
| `updateForAll` | `Person.update({hobby: 'Chess'}).forAll()` | Same DELETE/INSERT + `OPTIONAL` for old binding in WHERE, no FILTER |
| `updateWhereMultiField` | `Person.update({hobby: 'Chess', name: 'Bob'}).where(p => p.hobby.equals('Jogging'))` | Two DELETE + two INSERT + FILTER |

**Validation:**
- `npx tsc -p tsconfig-esm.json --noEmit` exits 0
- `npm test` — ALL existing tests pass (critical: refactored `updateToAlgebra` must not regress) + new update golden tests pass
- After step 4 (refactor), run `npm test` before proceeding — this is the safety gate

---

### Phase 5: Integration Verification — COMPLETED

**Goal:** Full compile, full test suite, verify all features work together.

**Tasks:**
1. Run `npm run compile` — both CJS and ESM must succeed.
2. Run `npm test` — full test suite, 0 failures.
3. Verify barrel exports: new types and functions are importable from the package entry point if applicable.

**Validation:**
- `npm run compile` exits 0
- `npm test` exits 0 with 0 failures
- No TypeScript errors in any configuration

---

### Phase 6: MINUS Multi-Property Existence

**Goal:** Support `.minus(p => [p.hobby, p.name])` — exclude entities where ALL listed properties exist.

**Semantics:**
```ts
// Exclude any Person that has BOTH a hobby AND a name
Person.select(p => p.name).minus(p => [p.hobby, p.name])
```
Generates:
```sparql
SELECT ?a0 ?a0_name WHERE {
  ?a0 a <Person> . ?a0 <name> ?a0_name .
  MINUS { ?a0 <hobby> ?m0 . ?a0 <name> ?m1 . }
}
```

**Architecture:**

The `.minus()` callback currently only accepts `WhereClause<S>` (returns `Evaluation`). We need a third callback return type: an **array of `QueryBuilderObject`** instances representing property existence.

The key insight: we do NOT need to change the WhereClause type or processWhereClause. Instead, we add a **new callback type** to `.minus()` specifically, and process it at the `QueryBuilder.toRawInput()` level — converting property paths into `RawMinusEntry` objects with a new `propertyPaths` field that carries the raw property URIs. This new field then flows through desugar → canonicalize → lower → algebra as a simple BGP of `?a0 <prop> ?varN` triples.

**Data flow:**

```
QueryBuilder.minus(p => [p.hobby, p.name])
  ↓ toRawInput(): detect array, extract property paths from QueryBuilderObjects
RawMinusEntry { propertyPaths: ['linked://tmp/props/hobby', 'linked://tmp/props/name'] }
  ↓ desugarSelectQuery(): pass through (no desugaring needed for plain property URIs)
DesugaredMinusEntry { propertyPaths: [...] }
  ↓ canonicalizeDesugaredSelectQuery(): pass through
CanonicalMinusEntry { propertyPaths: [...] }
  ↓ lowerSelectQuery(): convert to IRMinusPattern with traverse patterns
IRMinusPattern { kind: 'minus', pattern: { kind: 'join', patterns: [traverse, traverse] } }
  ↓ irToAlgebra step 5b: existing code handles it — no filter, just inner pattern
SparqlMinus { left: ..., right: { bgp: [?a0 <hobby> ?m0, ?a0 <name> ?m1] } }
```

**Files:**

| File | Change |
|------|--------|
| `src/queries/QueryBuilder.ts` | Widen `.minus()` to accept array-returning callbacks; detect array in `toRawInput()` and extract property URIs |
| `src/queries/IRDesugar.ts` | Add `propertyPaths?: string[]` to `RawMinusEntry` and `DesugaredMinusEntry`; thread through |
| `src/queries/IRCanonicalize.ts` | Add `propertyPaths?: string[]` to `CanonicalMinusEntry`; thread through |
| `src/queries/IRLower.ts` | Handle `propertyPaths` case: generate `IRTraversePattern[]` with fresh aliases, wrap in join |
| `src/test-helpers/query-fixtures.ts` | Add `minusPropertyExists` fixture |
| `src/tests/sparql-select-golden.test.ts` | Add golden test |

**Tasks:**

1. **QueryBuilder.ts** — Widen the `.minus()` callback type:
   - Change signature to `minus(shapeOrFn: ShapeConstructor<any> | WhereClause<S> | MinusPropertyCallback<S>)`
   - Where `MinusPropertyCallback<S> = (s: ToQueryBuilderObject<S>) => QueryBuilderObject[]`
   - In `toRawInput()`, after calling the callback, check `Array.isArray(result)`:
     - If array: extract property URI from each `QueryBuilderObject` via `.property.path[0].id`
     - Store as `propertyPaths: string[]` on the `RawMinusEntry`
   - Single property `.minus(p => p.hobby)` should also work — detect `result instanceof QueryBuilderObject` and wrap in array

2. **IRDesugar.ts** — Add `propertyPaths` to entry types:
   - `RawMinusEntry`: add `propertyPaths?: string[]`
   - `DesugaredMinusEntry`: add `propertyPaths?: string[]`
   - In `desugarSelectQuery()`: thread `propertyPaths` through (no transformation needed)

3. **IRCanonicalize.ts** — Add `propertyPaths` to canonical entry:
   - `CanonicalMinusEntry`: add `propertyPaths?: string[]`
   - In `canonicalizeDesugaredSelectQuery()`: thread through

4. **IRLower.ts** — Handle `propertyPaths` in minus lowering:
   - In the `canonical.minusEntries` loop, add a new branch: `if (entry.propertyPaths)`
   - For each property URI, create an `IRTraversePattern` from `rootAlias` to a fresh `m0`, `m1`, etc. alias
   - Wrap in `IRJoinPattern` if multiple, push as `IRMinusPattern` with no filter

5. **Fixtures + golden tests**:
   - `minusPropertyExists: () => Person.select(p => p.name).minus(p => [p.hobby, p.name])`
   - `minusSingleProperty: () => Person.select(p => p.name).minus(p => p.hobby)` (single, no array)
   - Assert SPARQL output contains `MINUS { ?a0 <hobby> ?m0 . ?a0 <name> ?m1 . }`

**Potential issues:**

1. **Type widening**: The `.minus()` callback type must accept `(p) => QueryBuilderObject | QueryBuilderObject[] | Evaluation`. TypeScript overloads or a union return type handle this. The processing in `toRawInput()` does runtime detection (`instanceof Evaluation` vs `Array.isArray` vs `instanceof QueryBuilderObject`).

2. **Nested property paths**: `.minus(p => [p.bestFriend.name])` — what should this mean? The ideation only shows flat properties. For now, we support only direct properties of the root shape. If `p.bestFriend.name` is passed, the `property.path[0].id` gives the property on the last segment. We should instead walk `getPropertyPath()` and only support single-segment paths, throwing for multi-segment.

3. **Variable naming in MINUS block**: Fresh variables are needed that don't collide with the outer query. Using `m0`, `m1`, ... prefix avoids collision with the `a0` root alias.

**Validation:**
- `npx tsc --noEmit` exits 0
- `npm test` — all existing tests pass + new minus property golden tests pass
- Verify SPARQL output manually: `MINUS { ?a0 <prop1> ?m0 . ?a0 <prop2> ?m1 . }`
