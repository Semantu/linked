# Advanced Query Patterns

## Summary

Add DSL support for three features:
1. **MINUS / NOT EXISTS (set exclusion)** — Exclude results matching a pattern
2. **Bulk Delete (DELETE WHERE)** — Delete all entities of a type, or matching a condition
3. **Conditional Update (update().where())** — Update entities matching a condition without pre-fetching IDs

All three build on algebra types already defined in `SparqlAlgebra.ts` and the existing builder pattern from 2.0.

---

## Codebase status (as of 2.0 pending changesets)

### What's changed since the original 007 draft

| Area | Original assumption | Actual 2.0 state |
|------|---------------------|-------------------|
| `Shape.delete()` | Accepts `(id: string)` | Now accepts `(id: NodeId \| NodeId[] \| NodeReferenceValue[])`, returns `DeleteBuilder` |
| `Shape.update()` | Accepts `(id, data)` | Now accepts `(data?)`, returns `UpdateBuilder`; `.for(id)` is chained |
| `.for()` / `.forAll()` | Not discussed | `QueryBuilder` has both `.for(id)` and `.forAll(ids?)`. `UpdateBuilder` has `.for(id)` only (single). `DeleteBuilder` has `.for(ids)` (multi). |
| `.where()` | Not discussed | Exists on `QueryBuilder` only. Not on `UpdateBuilder` or `DeleteBuilder`. |
| `.deleteAll()` | Proposed | Does NOT exist yet |
| NOT EXISTS | Mentioned briefly | Fully working via `.every()` in the DSL, through `IRExistsExpression` + `IRNotExpression` |
| MINUS algebra | Proposed | `SparqlMinus` type + serialization exist. No IR node, no DSL method. |
| IR graph patterns | - | Union of: `shape_scan`, `traverse`, `join`, `optional`, `union`, `exists` |

### Key architecture notes

- **Builders are immutable** — every method returns a new builder instance via `.clone()`
- **PromiseLike** — all builders implement PromiseLike so `await Person.update({…}).for(id)` works
- **IR → Algebra → String** — three-layer pipeline: DSL → IR AST → SPARQL Algebra → SPARQL string
- **QueryDispatch** — mutations execute via `getQueryDispatch().deleteQuery(ir)` / `.updateQuery(ir)`

---

## Feature 1: MINUS / NOT EXISTS (Set Exclusion)

### Background: MINUS vs FILTER NOT EXISTS

In SPARQL, these are *similar but not identical*:

```sparql
-- MINUS: set difference based on shared variables
SELECT ?name WHERE {
  ?s a ex:Person . ?s ex:name ?name .
  MINUS { ?s a ex:Employee . }
}

-- FILTER NOT EXISTS: filter that checks pattern non-existence
SELECT ?name WHERE {
  ?s a ex:Person . ?s ex:name ?name .
  FILTER NOT EXISTS { ?s a ex:Employee . }
}
```

**Key semantic difference:** MINUS computes set difference — if the MINUS pattern has *no variables in common* with the outer pattern, it excludes nothing (MINUS is a no-op). FILTER NOT EXISTS evaluates the inner pattern with variable bindings from the outer scope, so it always works as expected.

**In practice:** For the common case (same subject variable), they produce identical results. They diverge only when variable scoping differs. Some SPARQL engines optimize one better than the other (e.g. Virtuoso prefers MINUS; Fuseki handles both well).

### Current state

- **NOT EXISTS** is already fully supported via `.every()` on QueryProxy properties → generates `FILTER NOT EXISTS { … }`
- **MINUS** has algebra + serialization support (`SparqlMinus`) but no IR pattern and no DSL method

### Proposed DSL

```ts
// People who are NOT employees — exclude by type
Person.select(p => p.name).minus(Employee)

// Orders without a shippedDate — exclude by property
Order.select(o => o.id).minus(o => o.shippedDate)
```

### Route A: Single `.minus()` method, always emit SPARQL MINUS

Add `.minus()` to `QueryBuilder` that always generates the SPARQL `MINUS { … }` pattern.

**Pros:**
- Simple 1:1 mapping from DSL to SPARQL
- MINUS is the more intuitive keyword for users ("all X minus Y")
- Straightforward to implement — new `IRMinusPattern`, convert to `SparqlMinus`

**Cons:**
- MINUS has the variable-scoping gotcha (no shared vars = no exclusion)
- Some engines may optimize FILTER NOT EXISTS better

**Implementation:**
- Add `IRMinusPattern` to `IRGraphPattern` union
- Add `.minus()` to `QueryBuilder` (accepts `ShapeConstructor` or property lambda)
- `irToAlgebra.ts`: convert `IRMinusPattern` → `SparqlMinus`

### Route B: Single `.minus()` method, but emit FILTER NOT EXISTS under the hood

Use the familiar `.minus()` name in the DSL, but generate `FILTER NOT EXISTS` in SPARQL since the semantics are more predictable.

**Pros:**
- Avoids the variable-scoping pitfall
- NOT EXISTS already has full IR support (`IRExistsExpression` + `IRNotExpression`)
- Less new code — reuses existing pipeline

**Cons:**
- DSL says "minus" but SPARQL says "NOT EXISTS" — could confuse users debugging SPARQL output
- Doesn't expose the actual MINUS pattern for users who specifically need it

**Implementation:**
- Add `.minus()` to `QueryBuilder`
- Internally construct an `IRExistsExpression` wrapped in `IRNotExpression`
- No new IR types needed

### Route C: `.minus()` emits MINUS, and document `.every()` as the NOT EXISTS equivalent

Keep both patterns available. `.minus()` for SPARQL MINUS, `.every()` (already exists) for NOT EXISTS. Document the difference.

**Pros:**
- Full SPARQL coverage — both patterns available
- No semantic mismatch between DSL name and generated SPARQL
- Power users can choose the right tool

**Cons:**
- Two ways to do the same thing — could confuse beginners
- Need to document when to use which

**Implementation:**
- Same as Route A (new `IRMinusPattern` etc.)
- Add documentation comparing `.minus()` vs `.every()` with negation

### Route D: Skip `.minus()` entirely, rely on existing NOT EXISTS via `.where()`

Since NOT EXISTS is already supported and covers the common cases, defer MINUS and instead document how to express exclusions with the existing `.where()` + `.every()` API.

**Pros:**
- Zero new code
- Avoids API surface bloat

**Cons:**
- `.every()` for negation isn't obvious — `.minus()` reads more naturally
- Doesn't expose the SPARQL MINUS pattern at all

### Decision: Route A — emit SPARQL MINUS

**Chosen:** Route A with extended callback support.

`.minus()` accepts `ShapeConstructor` or `WhereClause<S>` (same callback types as `.select()`):

```ts
// By shape
Person.select(p => p.name).minus(Employee)

// Single property existence
Order.select(o => o.id).minus(o => o.shippedDate)

// Multi property (AND — both must exist)
Person.select(p => p.name).minus(p => [p.email, p.phone])

// Boolean condition
Person.select(p => p.name).minus(p => p.status.equals('inactive'))

// Nested
Person.select(p => p.name).minus(p => p.friends.some(f => f.name.equals('Moa')))
```

**Implementation:**
- Reuses existing callback processing from `.select()` — only the Shape overload is new
- New `IRMinusPattern` through the pipeline, lands on existing `SparqlMinus` algebra + serialization
- Chainable: `.minus(A).minus(B)` produces two separate `MINUS { }` blocks

---

## Feature 2: Bulk Delete (DELETE WHERE)

### Current state

- `Shape.delete(ids)` → `DeleteBuilder.from(shape, ids)` → requires explicit IDs
- `DeleteBuilder.for(ids)` — chainable, but still requires IDs
- No way to delete "all entities of type X" or "entities matching condition Y"
- `SparqlDeleteWherePlan` algebra type exists and serializes correctly
- `deleteToAlgebra()` currently generates per-ID DELETE patterns with wildcard `?p ?o`

### Proposed DSL

```ts
// Delete all temporary records
TempRecord.delete().all()
// or: TempRecord.deleteAll()

// Delete inactive people (conditional)
Person.delete().where(p => p.status.equals('inactive'))
```

~~`deleteProperty` is out of scope — property removal should use `.update()` with unset semantics.~~

### Route A: Extend `DeleteBuilder` with `.all()` and `.where()`

Add new chainable methods to the existing `DeleteBuilder`:

```ts
Person.delete().all()                              // delete all of type
Person.delete().where(p => p.status.equals('x'))   // conditional delete
Person.delete('id-1')                              // existing by-ID (unchanged)
```

**Pros:**
- Consistent with existing builder pattern
- `.all()` and `.where()` are familiar from `QueryBuilder`
- Single entry point (`Shape.delete()`) with different chaining paths

**Cons:**
- `Shape.delete()` currently requires IDs — making IDs optional is a breaking signature change
- Need to handle mutual exclusivity: `.for(ids)` vs `.all()` vs `.where()` can't be combined arbitrarily
- `.where()` on mutations is a new pattern — may need `WhereClause` type adapted for mutation context

**Implementation:**
- Make `ids` optional in `DeleteBuilder.from()`
- Add `.all()` method (sets a flag, no IDs needed)
- Add `.where(fn)` method (stores a WhereClause)
- New IR variant: `IRDeleteWhereMutation` (kind: `'delete_where'`, shape, whereFn?)
- `irToAlgebra.ts`: generate `SparqlDeleteWherePlan` for `.all()`, or `SparqlDeleteInsertPlan` with WHERE filters for `.where()`

### Route B: Separate static methods on Shape

```ts
TempRecord.deleteAll()
Person.deleteWhere(p => p.status.equals('inactive'))
```

**Pros:**
- Clear distinction from ID-based `Shape.delete(id)`
- No need to make `delete()` overloaded
- Explicit naming prevents accidental bulk deletes

**Cons:**
- Adds more static methods to Shape class
- Less composable than builder pattern
- Inconsistent with the 2.0 builder approach (`.select()`, `.update()`, `.delete()`)

### Route C: Use `.delete()` + `.where()` only (no `.all()`)

```ts
Person.delete().where(p => p.status.equals('inactive'))  // conditional
Person.delete().where(() => true)                         // all (explicit)
// or: Person.delete().where()                            // all (no arg = match all)
```

**Pros:**
- Single new method (`.where()`) instead of two
- Forces user to think about what they're deleting
- `.where()` with no arg or always-true is explicit enough for "delete all"

**Cons:**
- "Delete all" is a common operation and `.where(() => true)` is awkward
- Missing a `.where()` call accidentally could be confusing (should it error or delete all?)

### Decision: `.deleteAll()` + `.delete().where()`, schema-aware blank node cleanup

**Chosen:** Hybrid of Route A and B.

- `Shape.deleteAll()` — explicit bulk delete, no safety gate needed
- `Shape.delete().where(cb)` — conditional delete
- `Shape.deleteWhere(cb)` — optional sugar for `.delete().where(cb)`
- `Shape.delete(id)` — existing by-ID (unchanged)
- Returns `void`

**SPARQL generation — schema-aware blank node cleanup:**

Uses explicit property paths from the shape tree to navigate to blank nodes, then wildcards their properties. Recursively walks as deep as blank-node-typed properties nest. `FILTER(isBlank())` always present (essential for `sh:BlankNodeOrIRI`).

Example for `Person` with `address: BlankNode → Address { street, city, geo: BlankNodeOrIRI → GeoPoint { lat, lon } }`:

```sparql
DELETE {
  ?a0 ?p ?o .
  ?addr ?p1 ?o1 .
  ?geo ?p2 ?o2 .
}
WHERE {
  ?a0 a <Person> .
  ?a0 ?p ?o .
  OPTIONAL {
    ?a0 <address> ?addr . FILTER(isBlank(?addr)) .
    ?addr ?p1 ?o1 .
    OPTIONAL {
      ?addr <geo> ?geo . FILTER(isBlank(?geo)) .
      ?geo ?p2 ?o2 .
    }
  }
}
```

- Root: `?a0 ?p ?o` catches everything including `rdf:type` — no need for explicit `?a0 a <Person>` in DELETE
- Blank node traversal: explicit property paths (`<address>`, `<geo>`) — efficient, no scanning
- Blank node cleanup: `?addr ?p1 ?o1` wildcard — catches all properties on the blank node
- Recursion depth: determined at codegen by walking the shape tree

---

## Feature 3: Conditional Update (`update().where()`)

### Current state

- `Shape.update(data).for(id)` — updates a single, known entity
- No `.where()` on `UpdateBuilder`
- No `.forAll()` on `UpdateBuilder` (only on `QueryBuilder`)
- The SPARQL layer already generates `DELETE { old } INSERT { new } WHERE { match }` patterns

### Proposed DSL

```ts
// Set all inactive people's status to 'archived'
Person.update({ status: 'archived' }).where(p => p.status.equals('inactive'))

// Bulk update all entities of a type
Person.update({ verified: true }).all()
```

### Route A: Add `.where()` and `.all()` to `UpdateBuilder`

```ts
Person.update({ status: 'archived' }).where(p => p.status.equals('inactive'))
Person.update({ verified: true }).all()
Person.update({ name: 'Bob' }).for('id-1')  // existing (unchanged)
```

**Pros:**
- Mirrors the pattern proposed for `DeleteBuilder` — consistent API
- Powerful — enables bulk updates without pre-fetching
- Natural SPARQL mapping to `DELETE/INSERT WHERE { … FILTER(…) }`

**Cons:**
- **Significantly more complex** than delete — update needs to generate DELETE for old values AND INSERT for new values, all within a WHERE that also filters
- The current `updateToAlgebra()` assumes a single known entity ID — the WHERE pattern generation would need a fundamentally different approach
- `.where()` updates can't use OPTIONAL to handle missing old values the same way ID-based updates do
- Risk of unintended mass updates if `.where()` is too broad

**Implementation:**
- Make `.for(id)` optional in `UpdateBuilder`
- Add `.where(fn)` and `.all()` methods
- New IR variant: `IRUpdateWhereMutation` (kind: `'update_where'`, shape, data, whereFn?)
- `irToAlgebra.ts`: generate new algebra plan for pattern-matched updates
- Need careful handling: for each field in `data`, generate DELETE for old value + INSERT for new value, within a WHERE that includes the filter condition

### Decision: `.update().where()` + `.forAll()` — thin layer over existing SPARQL generation

**Chosen:** Route A — add `.where()` and `.forAll()` to `UpdateBuilder`. No `.updateWhere()` sugar.

- `Person.update(data).where(cb)` — conditional update
- `Person.update(data).forAll()` — bulk update all instances of type
- `Person.update(data).for(id)` — existing by-ID (unchanged)

**Key insight:** The existing `updateToAlgebra()` already generates the full `DELETE { old } INSERT { new } WHERE { OPTIONAL { old bindings } }` pattern. Conditional update is a thin addition — swap the hardcoded `<entity-id>` subject for a `?a0` variable, add `?a0 a <Type>` to WHERE, and append the filter conditions from the `.where()` callback.

**Field-level scoping:** Only touches fields in the update data — surgical. Does NOT delete/reinsert unrelated triples.

**Example — `.where()`:**

```ts
Person.update({ status: 'archived' }).where(p => p.status.equals('inactive'))
```

```sparql
DELETE { ?a0 <status> ?old_status . }
INSERT { ?a0 <status> "archived" . }
WHERE  {
  ?a0 a <Person> .
  ?a0 <status> ?old_status .
  FILTER(?old_status = "inactive")
}
```

**Example — `.forAll()`:**

```ts
Person.update({ verified: true }).forAll()
```

```sparql
DELETE { ?a0 <verified> ?old_verified . }
INSERT { ?a0 <verified> true . }
WHERE  {
  ?a0 a <Person> .
  OPTIONAL { ?a0 <verified> ?old_verified . }
}
```

Note: `.forAll()` keeps the OPTIONAL for old value bindings (entity may not have the field yet). `.where()` drops the OPTIONAL since the filter condition implies the field exists.

**Implementation:**
- Add `.where(fn)` and `.forAll()` to `UpdateBuilder`
- Make `.for(id)` optional (require one of `.for()`, `.forAll()`, or `.where()` before `.build()`)
- New IR variant: `IRUpdateWhereMutation` (kind: `'update_where'`, shape, data, whereFn?)
- `updateToAlgebra`: parameterize subject — `iriTerm(id)` for `.for()`, variable for `.where()`/`.forAll()`, add type triple + filter conditions to WHERE

---

## Open questions (resolved)

### Feature 1: MINUS / NOT EXISTS
- **Chosen:** Route A with extended callback support — `.minus()` emitting SPARQL `MINUS`

### Feature 2: Bulk Delete
- **Chosen:** `.deleteAll()` + `.delete().where()` — schema-aware blank node cleanup, returns `void`

### Feature 3: Conditional Update
- **Chosen:** `.update().where()` + `.forAll()` — thin layer over existing SPARQL generation, field-level scoping

### Cross-cutting (resolved)
1. **Named graphs:** Deferred — not in scope for now.
2. **Priority order:** To be determined during planning.
