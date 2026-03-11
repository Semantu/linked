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

## Remaining Decisions

None — all feature decisions are recorded in the ideation doc. Implementation order will be determined in tasks mode.
