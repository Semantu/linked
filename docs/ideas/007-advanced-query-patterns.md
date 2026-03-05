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
// or: TempRecord.delete()  — no args, no .where()

// Generated SPARQL:
// DELETE WHERE {
//   ?s rdf:type ex:TempRecord .
//   ?s ?p ?o .
// }
```

```ts
// Delete entities matching a condition — uses existing .equals() evaluation
Person.delete().where(p => p.status.equals('inactive'))
// or filter-first: Person.where(p => p.status.equals('inactive')).delete()

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
Person.delete().where(p => p.lastLogin.lt('2024-01-01'))
```

Note: Filtered delete falls back to `DELETE { } WHERE { }` (not pure `DELETE WHERE`) since SPARQL's `DELETE WHERE` shorthand doesn't support FILTER. The DSL handles this transparently.

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

### API design (recommended: E + D)

The key insight is that `.select()` already returns a `Promise & PatchedQueryPromise` — the promise is patched with `.where()`, `.limit()`, `.sortBy()` methods that mutate the underlying factory before execution. The same pattern applies naturally to `.update()` and `.delete()`:

```ts
// Existing pattern — .select() returns promise with .where() patched on
Person.select(p => p.name).where(p => p.age.equals(30))

// Same pattern — .update() returns promise with .where() patched on
Person.update({ status: 'archived' }).where(p => p.status.equals('inactive'))

// Same pattern — .delete() returns promise with .where() patched on
Person.delete().where(p => p.status.equals('inactive'))
```

This is **Alternative E**: chain `.where()` off `.update(data)` and `.delete()`, using the same `PatchedQueryPromise` mechanism that `.select()` already uses.

Additionally, **Alternative D** adds `Person.where(pred)` as a shared entry point:

```ts
Person.where(p => p.status.equals('inactive')).update({ status: 'archived' })
Person.where(p => p.status.equals('inactive')).delete()
Person.where(p => p.status.equals('inactive')).select(p => p.name)
```

Both approaches work together. Convenience shortcuts like `deleteWhere()` can be sugar on top.

#### Alternative E: `.update(data).where(pred)` / `.delete().where(pred)` (recommended)

```ts
Person.update({ status: 'archived' }).where(p => p.status.equals('inactive'))
Person.delete().where(p => p.status.equals('inactive'))
```

Pros:
- **Directly mirrors `.select().where()`** — identical chaining pattern
- Uses the same `PatchedQueryPromise` mechanism already implemented for `.select()`
- `.update()` and `.delete()` without `.where()` maintain current by-ID behavior
- Natural reading order: "update status to archived, where status is inactive"
- Extends cleanly to 006: `.update(p => ({ price: p.price.times(0.9) })).where(p => p.price.gt(100))`

Cons:
- `.update(data)` without an `id` is a new overload (currently requires `id` as first arg)
- `.delete()` without args is a new overload (currently requires `id`)

Overload design:
```ts
// Existing — single entity by ID
Person.update(id, { status: 'archived' })     // → Promise<UpdateResult>
Person.delete(id)                              // → Promise<DeleteResponse>

// New — bulk with .where()
Person.update({ status: 'archived' })          // → PatchedMutationPromise (must chain .where())
  .where(p => p.status.equals('inactive'))

Person.delete()                                // → PatchedMutationPromise (must chain .where() or becomes deleteAll)
  .where(p => p.status.equals('inactive'))
```

TypeScript can distinguish overloads: if the first arg to `.update()` is a string/NodeRef, it's the existing by-ID path. If it's a plain object, it's the bulk path. `.delete()` with no args returns a bulk-capable promise.

#### Alternative D: `Person.where(pred).update(data)` / `.delete()` / `.select()`

```ts
Person.where(p => p.status.equals('inactive')).update({ status: 'archived' })
Person.where(p => p.status.equals('inactive')).delete()
Person.where(p => p.status.equals('inactive')).select(p => p.name)
```

Pros:
- Unified entry point — `.where()` becomes the start of any filtered operation
- Very readable: "persons where X → do Y"
- Makes the scope explicit before the action

Cons:
- `.where()` returns an intermediate `FilteredShape<T>` object, not a promise
- Adds a new static method to Shape
- Slightly more implementation work

#### How they work together

E and D are complementary, not competing. Both should be supported:

```ts
// E: action-first (mirrors .select().where())
Person.update({ status: 'archived' }).where(p => p.status.equals('inactive'))
Person.delete().where(p => p.status.equals('inactive'))

// D: filter-first (unified entry point)
Person.where(p => p.status.equals('inactive')).update({ status: 'archived' })
Person.where(p => p.status.equals('inactive')).delete()
Person.where(p => p.status.equals('inactive')).select(p => p.name)

// Convenience shortcuts (sugar over E)
Person.deleteAll()  // = Person.delete() with no .where() — deletes all of type
```

#### Comparison with previous alternatives

| | E: `.update(data).where()` | D: `.where().update()` | A: `updateWhere().set()` | B/C: two-arg |
|---|---|---|---|---|
| Readability | Great | Great | Good | OK |
| Mirrors `.select().where()` | Identical | Different direction | Different | No |
| Implementation via PatchedQueryPromise | Direct reuse | New intermediate type | New intermediate type | N/A |
| Extends to 006 | Clean | Clean | Clean | Confusing |
| New API surface | Overloads on existing methods | New static `.where()` | New methods | New methods |

### Full examples (using E and D)

#### Basic literal updates (pre-006, works with `.equals()`)

```ts
// Set all inactive users to archived
Person.update({ status: 'archived' }).where(p => p.status.equals('inactive'))

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
// Same thing, filter-first style
Person.where(p => p.status.equals('inactive')).update({ status: 'archived' })
// Generates identical SPARQL
```

```ts
// Update multiple fields at once
Person.update({
  role: 'employee',
  probation: true,
}).where(p => p.role.equals('intern'))

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
Person.update({ status: 'archived' }).where(
  p => p.status.equals('inactive').and(p.role.equals('guest'))
)

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
Order.update({ archived: true }).where(
  o => o.status.equals('cancelled').or(o.status.equals('expired'))
)

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
Person.update({ temporaryFlag: null }).where(p => p.temporaryFlag.equals(true))

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
Task.update({ assignee: entity('user-new') }).where(
  t => t.assignee.equals(entity('user-old'))
)

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
Person.update({
  tags: { add: ['veteran'], remove: ['newbie'] },
}).where(p => p.role.equals('employee'))

// Generated SPARQL:
// DELETE { ?s ex:tags "newbie" . }
// INSERT { ?s ex:tags "veteran" . }
// WHERE {
//   ?s rdf:type ex:Person .
//   ?s ex:role ?role .
//   FILTER(?role = "employee")
// }
```

#### Bulk delete examples

```ts
// Delete all temporary records
TempRecord.deleteAll()
// or equivalently:
TempRecord.delete()  // no args, no .where() = delete all

// Generated SPARQL:
// DELETE WHERE {
//   ?s rdf:type ex:TempRecord .
//   ?s ?p ?o .
// }
```

```ts
// Delete entities matching a condition
Person.delete().where(p => p.status.equals('inactive'))

// or filter-first:
Person.where(p => p.status.equals('inactive')).delete()

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

#### With idea 006 expressions (later phase)

```ts
// Apply 10% discount to expensive products
Product.update(p => ({ price: p.price.times(0.9) })).where(p => p.price.gt(100))

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
Person.update(p => ({
  loginCount: p.loginCount.plus(1),
  lastSeen: L.now(),
})).where(p => p.status.equals('active'))

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
// Conditional computed value
Product.where(p => p.category.equals('seasonal')).update(p => ({
  price: L.ifThen(p.stock.gt(100), p.price.times(0.7), p.price.times(0.9)),
}))
```

```ts
// Delete old records
Person.delete().where(p => p.lastLogin.lt('2024-01-01'))
```

#### Full API summary

```ts
// === Existing (unchanged) ===
Person.select(p => p.name)                          // select all
Person.select(p => p.name).where(p => ...)          // select with filter
Person.update(id, { name: 'Alice' })                // update by ID
Person.delete(id)                                   // delete by ID

// === New: Alternative E (action-first) ===
Person.update({ status: 'archived' }).where(p => ...)  // bulk update
Person.delete().where(p => ...)                         // bulk delete
Person.deleteAll()                                      // delete all of type (sugar)

// === New: Alternative D (filter-first) ===
Person.where(p => ...).update({ status: 'archived' })  // bulk update
Person.where(p => ...).delete()                         // bulk delete
Person.where(p => ...).select(p => p.name)              // select (alternative to .select().where())
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
- `.update({ field: literal }).where(...)` — literal update values
- `.update({ field: null }).where(...)` — property removal
- `.update({ field: entity('id') }).where(...)` — reference updates
- `.update({ field: { add: [...], remove: [...] } }).where(...)` — set modifications
- `.delete().where(...)` — filtered bulk delete

What requires idea 006:
- `p.age.gt(18)` — comparison operators beyond equality
- `.update(p => ({ price: p.price.times(0.9) })).where(...)` — computed update values
- `L.now()`, `L.concat(...)` — function expressions

---

## Implementation considerations

### MINUS
- Add `.minus()` method to the query builder chain
- `.minus(ShapeClass)` generates MINUS with type guard triple
- `.minus(p => p.property)` generates MINUS with property triple
- IR needs a new `IRMinusPattern` graph pattern kind
- `irToAlgebra.ts` converts to `SparqlMinus` algebra node

### DELETE WHERE / UPDATE WHERE
- Add `.where()` to the promise returned by `.update(data)` (no id) and `.delete()` (no args), using the same `PatchedQueryPromise` pattern as `.select()`
- Add `.deleteAll()` as sugar for `.delete()` with no `.where()` — deletes all entities of the type
- Add static `.where()` on Shape returning a `FilteredShape<T>` intermediate with `.update()`, `.delete()`, `.select()` methods
- TypeScript overloads on `.update()`: first arg is string/NodeRef → by-ID (existing); first arg is object → bulk (new)
- TypeScript overloads on `.delete()`: has args → by-ID (existing); no args → bulk (new)
- IR needs new `IRUpdateWhereMutation` and `IRDeleteWhereMutation` kinds with filter + data/patterns
- `irToAlgebra.ts` generates `SparqlDeleteWherePlan` for unconditional delete, `SparqlDeleteInsertPlan` for filtered delete and all updates
- Setting a property to `null` in update data means "delete this triple" (no INSERT for that property)
- Reuses the existing proxy + Evaluation mechanism from SelectQuery's `.where()`

---

## Implementation phases

This idea is part of a broader implementation plan alongside idea 006:

1. **Phase 1: MINUS** (~3-4 days)
   - Add `.minus()` to query builder
   - New `IRMinusPattern` in IR
   - Wire through `irToAlgebra.ts` → `SparqlMinus`
   - Self-contained, no dependencies

2. **Phase 2: `.update(data).where()` / `.delete().where()` / `.where()`** (~4-5 days)
   - Add `.where()` to update/delete promises via `PatchedQueryPromise` (same pattern as select)
   - Add `.deleteAll()`, overloads on `.update()` and `.delete()`
   - Add static `.where()` on Shape → `FilteredShape<T>` with `.update()`, `.delete()`, `.select()`
   - New `IRDeleteWhereMutation` and `IRUpdateWhereMutation` IR types
   - Wire to `SparqlDeleteWherePlan` and `SparqlDeleteInsertPlan`
   - Uses existing `.equals()` evaluation — no dependency on idea 006

3. **Phase 3: Expression builder** (idea 006, ~5-7 days)
   - Chained methods (`.gt()`, `.times()`, etc.) on proxied properties
   - `L` module for complex expressions
   - Computed fields in SELECT
   - Enriches `.where()` filters on update/delete with comparison operators beyond `.equals()`

4. **Phase 4: Computed mutations** (idea 006, ~3-4 days)
   - `.update()` accepts callback form: `.update(p => ({ price: p.price.times(0.9) })).where(...)`
   - Resolves `MutationQuery.ts:33` TODO
   - Enriches bulk updates from phase 2 with computed values

## Open questions

- Should `.minus()` accept multiple arguments (multiple MINUS clauses)?
- Should `.deleteAll()` require explicit confirmation / be marked as dangerous?
- How should bulk `.update().where()` and `.delete().where()` interact with named graphs?
- Should bulk operations return a count of affected triples, or is fire-and-forget acceptable?
- Should `.delete()` with no args and no `.where()` be equivalent to `.deleteAll()`, or should it require the explicit `.deleteAll()` call to prevent accidents?
