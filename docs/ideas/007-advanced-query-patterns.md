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

### API alternatives

There are several possible API shapes for updateWhere. Each has tradeoffs around readability, consistency with the existing DSL, and how naturally it extends to computed values (idea 006).

#### Alternative A: Static method — `updateWhere(predicate).set(data)` (recommended)

```ts
Person.updateWhere(p => p.status.equals('inactive')).set({ status: 'archived' })
```

Pros:
- Reads naturally: "update persons where status=inactive, set status=archived"
- The `.set()` chaining mirrors how `.select()` chains with `.where()` — consistent pattern
- Clean separation: filter logic in `updateWhere()`, data in `.set()`
- Extends naturally to computed values: `.set(p => ({ price: p.price.times(0.9) }))`

Cons:
- Two-step call (but this matches the existing `.select().where()` pattern)

#### Alternative B: Static method — `updateWhere(data, predicate)`

```ts
Person.updateWhere({ status: 'archived' }, p => p.status.equals('inactive'))
```

Pros:
- Single call, concise
- Data first feels natural for simple cases

Cons:
- Argument order is debatable — "update what? where?" vs "update where? to what?"
- When data becomes a callback (idea 006), both args are callbacks — confusing
- Doesn't match any existing DSL pattern

#### Alternative C: Static method — `updateWhere(predicate, data)`

```ts
Person.updateWhere(p => p.status.equals('inactive'), { status: 'archived' })
```

Pros:
- More SQL-like: `UPDATE ... WHERE ... SET ...`
- Filter first means you always know what you're scoping

Cons:
- Same two-callback confusion when data becomes computed
- The "important part" (what changes) is buried as second arg

#### Alternative D: Chained from `.where()` — `where(predicate).update(data)`

```ts
Person.where(p => p.status.equals('inactive')).update({ status: 'archived' })
Person.where(p => p.status.equals('inactive')).delete()
```

Pros:
- Very consistent: `.where()` becomes a shared entry point for filtered operations
- `.where().select()`, `.where().update()`, `.where().delete()` — unified pattern
- Naturally extends: `.where().update(p => ({ price: p.price.times(0.9) }))`

Cons:
- Requires adding `.where()` as a static method on Shape (currently only on query result)
- Changes the existing API surface more significantly
- `.where()` alone returns an intermediate object — what type is it?

#### Comparison table

| | A: `updateWhere().set()` | B: `(data, pred)` | C: `(pred, data)` | D: `where().update()` |
|---|---|---|---|---|
| Readability | Good | OK | OK | Great |
| Consistency with DSL | Good (chains) | Low | Low | Great (unified) |
| Extends to 006 | Clean | Confusing | Confusing | Clean |
| Implementation cost | Medium | Low | Low | Higher |
| deleteWhere parallel | `deleteWhere(pred)` | `deleteWhere(pred)` | `deleteWhere(pred)` | `where(pred).delete()` |

**Recommendation:** Alternative A (`updateWhere().set()`) — it reads well, chains naturally, and when idea 006 lands, `.set()` can accept a callback cleanly. Alternative D is the most elegant long-term design but requires more upfront API changes.

### Full examples (using Alternative A)

#### Basic literal updates (pre-006, works with `.equals()`)

```ts
// Set all inactive users to archived
Person.updateWhere(p => p.status.equals('inactive')).set({ status: 'archived' })

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
// Update multiple fields at once
Person.updateWhere(p => p.role.equals('intern')).set({
  role: 'employee',
  probation: true,
})

// Generated SPARQL:
// DELETE { ?s ex:role ?old_role . }
// INSERT { ?s ex:role "employee" . ?s ex:probation true . }
// WHERE {
//   ?s rdf:type ex:Person .
//   ?s ex:role ?old_role .
//   FILTER(?old_role = "intern")
// }
```

```ts
// Compound filter with AND
Person.updateWhere(
  p => p.status.equals('inactive').and(p.role.equals('guest'))
).set({ status: 'archived' })

// Generated SPARQL:
// DELETE { ?s ex:status ?old_status . }
// INSERT { ?s ex:status "archived" . }
// WHERE {
//   ?s rdf:type ex:Person .
//   ?s ex:status ?old_status .
//   ?s ex:role ?role .
//   FILTER(?old_status = "inactive" && ?role = "guest")
// }
```

```ts
// Compound filter with OR
Order.updateWhere(
  o => o.status.equals('cancelled').or(o.status.equals('expired'))
).set({ archived: true })

// Generated SPARQL:
// INSERT { ?s ex:archived true . }
// WHERE {
//   ?s rdf:type ex:Order .
//   ?s ex:status ?status .
//   FILTER(?status = "cancelled" || ?status = "expired")
// }
```

```ts
// Remove a property (set to null = delete the triple)
Person.updateWhere(p => p.temporaryFlag.equals(true)).set({ temporaryFlag: null })

// Generated SPARQL:
// DELETE { ?s ex:temporaryFlag ?old_val . }
// WHERE {
//   ?s rdf:type ex:Person .
//   ?s ex:temporaryFlag ?old_val .
//   FILTER(?old_val = true)
// }
```

```ts
// Set relations — replace a reference
Task.updateWhere(t => t.assignee.equals(entity('user-old'))).set({
  assignee: entity('user-new'),
})

// Generated SPARQL:
// DELETE { ?s ex:assignee ?old_assignee . }
// INSERT { ?s ex:assignee <user-new> . }
// WHERE {
//   ?s rdf:type ex:Task .
//   ?s ex:assignee ?old_assignee .
//   FILTER(?old_assignee = <user-old>)
// }
```

```ts
// Modify sets — add/remove from multi-value properties
Person.updateWhere(p => p.role.equals('employee')).set({
  tags: { add: ['veteran'], remove: ['newbie'] },
})

// Generated SPARQL:
// DELETE { ?s ex:tags "newbie" . }
// INSERT { ?s ex:tags "veteran" . }
// WHERE {
//   ?s rdf:type ex:Person .
//   ?s ex:role ?role .
//   FILTER(?role = "employee")
// }
```

#### With idea 006 expressions (later phase)

```ts
// Apply 10% discount to expensive products
Product.updateWhere(p => p.price.gt(100)).set(
  p => ({ price: p.price.times(0.9) })
)

// Generated SPARQL:
// DELETE { ?s ex:price ?old_price . }
// INSERT { ?s ex:price ?new_price . }
// WHERE {
//   ?s rdf:type ex:Product .
//   ?s ex:price ?old_price .
//   FILTER(?old_price > 100)
//   BIND((?old_price * 0.9) AS ?new_price)
// }
```

```ts
// Increment login count and set timestamp
Person.updateWhere(p => p.status.equals('active')).set(p => ({
  loginCount: p.loginCount.plus(1),
  lastSeen: L.now(),
}))

// Generated SPARQL:
// DELETE { ?s ex:loginCount ?old_count . ?s ex:lastSeen ?old_seen . }
// INSERT { ?s ex:loginCount ?new_count . ?s ex:lastSeen ?now . }
// WHERE {
//   ?s rdf:type ex:Person .
//   ?s ex:status ?status . FILTER(?status = "active")
//   OPTIONAL { ?s ex:loginCount ?old_count . }
//   OPTIONAL { ?s ex:lastSeen ?old_seen . }
//   BIND((?old_count + 1) AS ?new_count)
//   BIND(NOW() AS ?now)
// }
```

```ts
// Combine computed filter + computed value
Employee.updateWhere(
  e => L.gt(L.minus(L.now(), e.hireDate), 365)  // hired > 1 year ago
).set(e => ({
  salary: e.salary.times(1.05),
  seniorityLevel: e.seniorityLevel.plus(1),
}))
```

```ts
// Conditional computed value
Product.updateWhere(p => p.category.equals('seasonal')).set(p => ({
  price: L.ifThen(p.stock.gt(100), p.price.times(0.7), p.price.times(0.9)),
}))
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
- `.set({ field: literal })` — literal update values
- `.set({ field: null })` — property removal
- `.set({ field: entity('id') })` — reference updates
- `.set({ field: { add: [...], remove: [...] } })` — set modifications

What requires idea 006:
- `p.age.gt(18)` — comparison operators beyond equality
- `.set(p => ({ price: p.price.times(0.9) }))` — computed update values
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
- `updateWhere(predicate)` returns an intermediate object with `.set(data)` method
- `.set()` accepts an object (literal values) or — with idea 006 — a callback `p => ({...})`
- Reuses the existing proxy + Evaluation mechanism from SelectQuery's `.where()`
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
   - Add `.deleteAll()`, `.deleteWhere()`, `.updateWhere().set()` to Shape class
   - New `IRDeleteWhereMutation` and `IRUpdateWhereMutation` IR types
   - Wire to `SparqlDeleteWherePlan` and `SparqlDeleteInsertPlan`
   - Uses existing `.equals()` evaluation — no dependency on idea 006
   - `.set()` accepts plain objects only in this phase

3. **Phase 3: Expression builder** (idea 006, ~5-7 days)
   - Chained methods (`.gt()`, `.times()`, etc.) on proxied properties
   - `L` module for complex expressions
   - Computed fields in SELECT
   - Enriches `updateWhere` / `deleteWhere` filters with comparison operators

4. **Phase 4: Computed mutations** (idea 006, ~3-4 days)
   - `.set()` accepts callback form: `.set(p => ({ price: p.price.times(0.9) }))`
   - Resolves `MutationQuery.ts:33` TODO
   - Enriches `updateWhere` from phase 2 with computed values

## Open questions

- Should `.minus()` accept multiple arguments (multiple MINUS clauses)?
- Should `.deleteAll()` require explicit confirmation / be marked as dangerous?
- How should `.deleteWhere()` and `.updateWhere()` interact with named graphs?
- Should bulk operations return a count of affected triples, or is fire-and-forget acceptable?
- Should we pursue Alternative D (`where().update()` / `where().delete()`) as a longer-term unified pattern?
