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

### Route B: Separate `Shape.updateWhere()` static method

```ts
Person.updateWhere(p => p.status.equals('inactive'), { status: 'archived' })
```

**Pros:**
- Clear separation from ID-based updates
- Harder to accidentally trigger

**Cons:**
- Doesn't follow the builder pattern
- Less composable

### Route C: Require two-step (select then update)

Don't add `.where()` to `UpdateBuilder`. Instead, users fetch IDs first:

```ts
const inactive = await Person.select(p => p.id).where(p => p.status.equals('inactive'))
await Promise.all(inactive.map(p => Person.update({ status: 'archived' }).for(p.id)))
```

**Pros:**
- Zero new mutation code
- Explicit, no surprises

**Cons:**
- N+1 problem — one update per entity
- Not atomic — race conditions between select and update
- Verbose for a common pattern

---

## Open questions for discussion

### Feature 1: MINUS / NOT EXISTS
1. **Which route?** Given that NOT EXISTS already works via `.every()`, is `.minus()` worth adding? Or is it redundant API surface?
2. **If we add `.minus()`**, should it emit MINUS or NOT EXISTS? Does engine compatibility matter for your use cases?
3. **Should `.minus()` accept multiple patterns?** e.g. `.minus(Employee).minus(Contractor)` via chaining (which already works with immutable builders)?

### Feature 2: Bulk Delete
4. **Route A vs B vs C?** Extending `DeleteBuilder` with `.all()` + `.where()` (Route A) fits the 2.0 builder pattern best, but needs the signature change. Thoughts?
5. **Safety:** Should `.delete().all()` require an explicit opt-in (e.g. `.delete().all({ confirm: true })`) to prevent accidental mass deletes?
6. **Return type:** Should bulk delete return `{ deletedCount: number }` or just `void`? (SPARQL endpoints vary in what they report back.)

### Feature 3: Conditional Update
7. **Is this needed for 2.0?** It's the most complex of the three features. Should it be deferred?
8. **Route A vs C?** Route A (`.where()` on UpdateBuilder) is powerful but complex. Route C (select-then-update) works today with no code changes. Is the ergonomic gain worth the complexity?
9. **Field-level scoping:** For `Person.update({ status: 'archived' }).where(…)`, should the generated SPARQL delete *only* the `status` triples and insert new ones? Or should it touch all triples of matching entities? (The former is more surgical and safer.)

### Cross-cutting
10. **Named graphs:** How should `.where()` and `.all()` interact with named graphs? Scope to default graph only?
11. **Priority order:** If we do all three, what's the implementation order? (Suggested: bulk delete → minus → conditional update, by ascending complexity.)
