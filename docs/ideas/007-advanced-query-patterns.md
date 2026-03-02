# Advanced Query Patterns (MINUS & DELETE WHERE)

## Summary

Add DSL support for two SPARQL 1.1 features:
1. **MINUS (set difference)** — Exclude results matching a pattern
2. **DELETE WHERE (bulk delete)** — Delete triples matching a pattern without a separate WHERE clause

Both use algebra types already defined in `SparqlAlgebra.ts`.

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
// Delete all triples of a specific property from all persons
Person.deleteProperty(p => p.temporaryFlag)

// Generated SPARQL:
// DELETE WHERE {
//   ?s rdf:type ex:Person .
//   ?s ex:temporaryFlag ?val .
// }
```

```ts
// Delete entities matching a condition (combine with WHERE)
Person.deleteWhere(p => L.eq(p.status, 'inactive'))

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
// Note: This falls back to DELETE/INSERT/WHERE since it has a filter,
// but the DSL method makes the intent clear.
```

### Algebra mapping

Uses the existing `SparqlDeleteWherePlan`:

```ts
type SparqlDeleteWherePlan = {
  type: 'delete_where';
  patterns: SparqlAlgebraNode;
  graph?: string;
};
```

Already serialized by `algebraToString.ts` as `DELETE WHERE { ... }`.

### When DELETE WHERE vs DELETE/INSERT/WHERE

| Scenario | Pattern |
|---|---|
| Delete entity by ID | Current `deleteToSparql` (DELETE/INSERT/WHERE) |
| Delete all entities of a type | `DELETE WHERE` |
| Delete specific property from entities | `DELETE WHERE` |
| Delete entities matching a filter | `DELETE { } WHERE { }` (not pure DELETE WHERE) |

---

## Implementation considerations

### MINUS
- Add `.minus()` method to the query builder chain
- `.minus(ShapeClass)` generates MINUS with type guard triple
- `.minus(p => p.property)` generates MINUS with property triple
- IR needs a new `IRMinusPattern` graph pattern kind
- `irToAlgebra.ts` converts to `SparqlMinus` algebra node

### DELETE WHERE
- Add `.deleteAll()` and `.deleteProperty()` methods to the Shape class
- IR needs to distinguish between targeted delete (by ID) and pattern delete
- `irToAlgebra.ts` generates `SparqlDeleteWherePlan` for pattern-based deletes
- Result type for bulk deletes may differ from single-entity deletes (count only, no IDs)

## Open questions

- Should `.minus()` accept multiple arguments (multiple MINUS clauses)?
- Should `.deleteAll()` require explicit confirmation / be marked as dangerous?
- How should `.deleteWhere()` interact with named graphs?
- Should bulk delete return a count of deleted triples, or is fire-and-forget acceptable?
