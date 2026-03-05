# Advanced Query Patterns (MINUS, DELETE WHERE & UPDATE WHERE)

## Summary

Add DSL support for three SPARQL 1.1 features:
1. **MINUS (set difference)** — Exclude results matching a pattern
2. **DELETE WHERE (bulk delete)** — Delete triples matching a pattern
3. **UPDATE WHERE (bulk update)** — Update triples matching a pattern

All use algebra types already defined in `SparqlAlgebra.ts`.

**Key insight:** `deleteWhere` and `updateWhere` can work with the existing `.equals()` evaluation system (no dependency on idea 006's expression builder). The chained expression methods from idea 006 enhance these later but aren't required.

---

## Part 1: MINUS (Set Difference)

### Motivation

MINUS allows excluding results that match a secondary pattern. This is useful for "all X that are not Y" queries, which are common in data quality checks, access control filtering, and set operations.

### DSL examples

```ts
// People who are NOT employees
Person.select(p => p.name).minus(Employee)

// Generated SPARQL:
// SELECT ?name WHERE {
//   ?s rdf:type ex:Person .
//   OPTIONAL { ?s ex:name ?name . }
//   MINUS { ?s rdf:type ex:Employee . }
// }
```

```ts
// Orders that haven't been shipped (no shippedDate property)
Order.select(o => o.id).minus(o => o.shippedDate)

// Generated SPARQL:
// SELECT ?s WHERE {
//   ?s rdf:type ex:Order .
//   MINUS { ?s ex:shippedDate ?shipped . }
// }
```

```ts
// People who don't have any pets
Person.select(p => p.name).minus(p => p.pets)

// Generated SPARQL:
// SELECT ?name WHERE {
//   ?s rdf:type ex:Person .
//   OPTIONAL { ?s ex:name ?name . }
//   MINUS { ?s ex:pets ?pets . }
// }
```

### Algebra mapping

Uses the existing `SparqlMinus` algebra node:

```ts
type SparqlMinus = {
  type: 'minus';
  left: SparqlAlgebraNode;
  right: SparqlAlgebraNode;
};
```

Already serialized by `algebraToString.ts` as `left\nMINUS {\n  right\n}`.

### MINUS vs NOT EXISTS

MINUS and NOT EXISTS (FILTER NOT EXISTS) serve similar purposes but have different semantics around unbound variables. The DSL should use MINUS for shape-level exclusion and NOT EXISTS for property-level checks. The existing `NOT EXISTS` support could be documented alongside MINUS to help users choose the right tool.

---

## Part 2: DELETE WHERE (Bulk Delete)

### Motivation

`DELETE WHERE` is a SPARQL shorthand where the delete pattern IS the where pattern. This avoids repeating patterns in both clauses. It's useful for:
- Bulk deletion of all entities of a type
- Removing all triples matching a simple pattern
- Cleaning up data without needing a separate WHERE clause

Currently the DSL has `Person.delete(id)` which deletes a specific entity by ID. There's no way to delete multiple entities matching a pattern or delete all entities of a type.

### DSL examples

```ts
// Delete all temporary records
TempRecord.deleteAll()

// Generated SPARQL:
// DELETE WHERE {
//   ?s rdf:type ex:TempRecord .
//   ?s ?p ?o .
// }
```

```ts
// Delete entities matching a condition — uses existing .equals() evaluation
Person.deleteWhere(p => p.status.equals('inactive'))

// Generated SPARQL:
// DELETE {
//   ?s ?p ?o .
// }
// WHERE {
//   ?s rdf:type ex:Person .
//   ?s ex:status ?status .
//   FILTER(?status = "inactive")
//   ?s ?p ?o .
// }
```

```ts
// With idea 006 expressions (later phase), richer filters become available:
Person.deleteWhere(p => p.lastLogin.lt('2024-01-01'))
```

Note: `.deleteWhere()` with a filter falls back to `DELETE { } WHERE { }` (not pure `DELETE WHERE`) since SPARQL's `DELETE WHERE` shorthand doesn't support FILTER. The DSL handles this transparently.

### Algebra mapping

Uses the existing `SparqlDeleteWherePlan` for the simple case:

```ts
type SparqlDeleteWherePlan = {
  type: 'delete_where';
  patterns: SparqlAlgebraNode;
  graph?: string;
};
```

Already serialized by `algebraToString.ts` as `DELETE WHERE { ... }`.

For filtered deletes, falls back to `SparqlDeleteInsertPlan` with no insert clause.

### When DELETE WHERE vs DELETE/INSERT/WHERE

| Scenario | Pattern |
|---|---|
| Delete entity by ID | Current `deleteToSparql` (DELETE/INSERT/WHERE) |
| Delete all entities of a type | `DELETE WHERE` via `.deleteAll()` |
| Delete entities matching a filter | `DELETE { } WHERE { }` via `.deleteWhere()` |

---

## Part 3: UPDATE WHERE (Bulk Update)

### Motivation

Currently `.update(id, data)` updates a single entity by ID. There's no way to update multiple entities matching a pattern. This is needed for bulk operations like "set all inactive users' status to archived" or "apply a discount to all products in a category".

Note: Removing a property from entities is just an update that sets the value to null — no special `deleteProperty` method is needed.

### DSL examples

```ts
// Set all inactive users to archived — works with current .equals() evaluation
Person.updateWhere(
  { status: 'archived' },
  p => p.status.equals('inactive')
)

// Generated SPARQL:
// DELETE { ?s ex:status ?old_status . }
// INSERT { ?s ex:status "archived" . }
// WHERE {
//   ?s rdf:type ex:Person .
//   ?s ex:status ?old_status .
//   FILTER(?old_status = "inactive")
// }
```

```ts
// Remove a property from all entities (set to null = delete the triple)
Person.updateWhere(
  { temporaryFlag: null },
  p => p.temporaryFlag.equals(true)
)

// Generated SPARQL:
// DELETE { ?s ex:temporaryFlag ?old_val . }
// WHERE {
//   ?s rdf:type ex:Person .
//   ?s ex:temporaryFlag ?old_val .
//   FILTER(?old_val = true)
// }
```

```ts
// With idea 006 expressions (later phase), computed updates become available:
Product.updateWhere(
  p => ({ price: p.price.times(0.9) }),
  p => p.price.gt(100)
)
```

### Algebra mapping

Uses the existing `SparqlDeleteInsertPlan`:

```ts
type SparqlDeleteInsertPlan = {
  type: 'delete_insert';
  deletePatterns: SparqlAlgebraNode;
  insertPatterns?: SparqlAlgebraNode;
  where: SparqlAlgebraNode;
  graph?: string;
};
```

---

## Pre-006 compatibility: `.equals()` evaluation

The existing DSL already has an evaluation system on proxied properties:

```ts
p.name.equals('Alice')    // creates an Evaluation with WhereMethods.EQUALS
```

This means **`deleteWhere` and `updateWhere` can ship before idea 006** with basic equality filters. The full expression methods (`.gt()`, `.lt()`, `.contains()`, etc.) from idea 006 will enrich these later, but the core pattern works now.

What works immediately (pre-006):
- `p.status.equals('inactive')` — equality check
- `p.name.equals('Alice').and(p.role.equals('admin'))` — chained AND/OR

What requires idea 006:
- `p.age.gt(18)` — comparison operators
- `p.price.times(0.9)` — arithmetic in update values
- `L.now()`, `L.concat(...)` — function expressions

---

## Implementation considerations

### MINUS
- Add `.minus()` method to the query builder chain
- `.minus(ShapeClass)` generates MINUS with type guard triple
- `.minus(p => p.property)` generates MINUS with property triple
- IR needs a new `IRMinusPattern` graph pattern kind
- `irToAlgebra.ts` converts to `SparqlMinus` algebra node

### DELETE WHERE
- Add `.deleteAll()` and `.deleteWhere()` methods to the Shape class
- `.deleteAll()` is unconditional — deletes all entities of the type
- `.deleteWhere(predicate)` accepts the same evaluation callbacks as `.where()`
- IR needs to distinguish between targeted delete (by ID) and pattern delete
- `irToAlgebra.ts` generates `SparqlDeleteWherePlan` for unconditional, `SparqlDeleteInsertPlan` (no insert) for filtered
- Result type for bulk deletes may differ from single-entity deletes (count only, no IDs)

### UPDATE WHERE
- Add `.updateWhere(data, predicate)` method to the Shape class
- First argument is the update data (same format as `.update()` second arg)
- Second argument is the filter predicate (same evaluation callbacks as `.where()`)
- IR needs a new `IRUpdateWhereMutation` kind with pattern + filter + data
- `irToAlgebra.ts` generates `SparqlDeleteInsertPlan` with filter in WHERE clause
- Setting a property to `null` in the data means "delete this triple" (no INSERT for that property)

---

## Implementation phases

This idea is part of a broader implementation plan alongside idea 006:

1. **Phase 1: MINUS** (~3-4 days)
   - Add `.minus()` to query builder
   - New `IRMinusPattern` in IR
   - Wire through `irToAlgebra.ts` → `SparqlMinus`
   - Self-contained, no dependencies

2. **Phase 2: deleteWhere / deleteAll / updateWhere** (~4-5 days)
   - Add `.deleteAll()`, `.deleteWhere()`, `.updateWhere()` to Shape class
   - New `IRDeleteWhereMutation` and `IRUpdateWhereMutation` IR types
   - Wire to `SparqlDeleteWherePlan` and `SparqlDeleteInsertPlan`
   - Uses existing `.equals()` evaluation — no dependency on idea 006

3. **Phase 3: Expression builder** (idea 006, ~5-7 days)
   - Chained methods (`.gt()`, `.times()`, etc.) on proxied properties
   - `L` module for complex expressions
   - Computed fields in SELECT

4. **Phase 4: Computed mutations** (idea 006, ~3-4 days)
   - Expression-based update values via `p => ({ price: p.price.times(0.9) })`
   - Enriches `updateWhere` from phase 2 with computed values

## Open questions

- Should `.minus()` accept multiple arguments (multiple MINUS clauses)?
- Should `.deleteAll()` require explicit confirmation / be marked as dangerous?
- How should `.deleteWhere()` and `.updateWhere()` interact with named graphs?
- Should bulk operations return a count of affected triples, or is fire-and-forget acceptable?
- For `.updateWhere()`, should the signature be `(data, predicate)` or `(predicate, data)` or chained like `.where(predicate).update(data)`?
