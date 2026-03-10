# Plan: `.minus()` on select queries + `.delete().where()`

## 1. `.minus()` — Exclude results matching a pattern

### DSL (proposed)

```ts
// "Select persons who are NOT friends with someone named 'Moa'"
Person.select().minus((p) => p.friends.some((f) => f.name.equals('Moa')))

// Equivalent to .where() but negated — reuses the same WhereClause callback
```

### Generated SPARQL

```sparql
SELECT DISTINCT ?a0
WHERE {
  ?a0 rdf:type <Person> .
  MINUS {
    ?a0 <Person/friends> ?a1 .
    ?a1 <Person/name> "Moa" .
  }
}
```

### Implementation

| Layer | File | Change |
|-------|------|--------|
| **DSL entry** | `SelectQuery.ts` | Add `.minus(callback)` method on `QueryProxy` / builder, stores a `WhereClause` marked as minus |
| **IR** | `IntermediateRepresentation.ts` | Add `IRMinusPattern` type: `{ kind: 'minus', pattern: IRTraversePattern[], filter?: IRExpression }` |
| **IR Desugar** | `IRDesugar.ts` | Process minus clauses the same way as where clauses but tag them as minus |
| **IR Canonicalize** | `IRCanonicalize.ts` | New canonical node `where_minus` wrapping the inner pattern |
| **IR Lower** | `IRLower.ts` | Lower `where_minus` → `minus_expr` in the IR plan |
| **Algebra** | `SparqlAlgebra.ts` | Add `SparqlMinus` node type: `{ type: 'minus', left: SparqlAlgebraNode, right: SparqlAlgebraNode }` |
| **irToAlgebra** | `irToAlgebra.ts` | Convert `minus_expr` → `SparqlMinus` |
| **algebraToString** | `algebraToString.ts` | Serialize `SparqlMinus` as `MINUS { … }` block |
| **Tests** | `query-fixtures.ts`, golden tests | Add fixtures + golden SPARQL assertions |

### Key design decisions

- `.minus()` takes the same `WhereClause<S>` callback as `.where()`, so users already know the API
- Unlike `.where(NOT EXISTS {…})`, SPARQL `MINUS` does not share variable bindings — it's a **set difference**. This is the correct semantic for "exclude matching shapes"
- `.minus()` can be chained: `Person.select().where(…).minus(…).minus(…)`

---

## 2. `.delete().where()` — Delete by query instead of by ID

### DSL (proposed)

```ts
// Delete all persons named 'Moa'
Person.delete().where((p) => p.name.equals('Moa'))

// Delete friends of a specific person
Person.delete().where((p) => p.friends.some((f) => f.name.equals('Jinx')))
```

### Generated SPARQL

```sparql
DELETE {
  ?a0 ?p ?o .
  ?s ?p2 ?a0 .
  ?a0 rdf:type <Person> .
}
WHERE {
  ?a0 rdf:type <Person> .
  ?a0 <Person/name> "Moa" .
  ?a0 ?p ?o .
  OPTIONAL { ?s ?p2 ?a0 . }
}
```

### Implementation

| Layer | File | Change |
|-------|------|--------|
| **Builder** | `DeleteBuilder.ts` | Add `.where(callback)` method that stores a `WhereClause`, make `.for()` OR `.where()` required (not both) |
| **IR** | `IntermediateRepresentation.ts` | Extend `IRDeleteMutation` with optional `where?: CanonicalWhereExpression` and remove `ids` requirement (make it `ids?: …`) |
| **DeleteQuery** | `DeleteQuery.ts` | Add `DeleteWhereQueryFactory` that builds delete IR from a where clause instead of IDs |
| **irToAlgebra** | `irToAlgebra.ts` | Update `deleteToAlgebra` to handle where-based deletes: generate WHERE block from the where expression instead of fixed ID patterns |
| **Tests** | fixtures + golden tests | Add `deleteWhere` fixtures |

### Key design decisions

- `.for(ids)` and `.where(callback)` are mutually exclusive — `.build()` throws if both or neither are specified
- The cascade pattern (delete outgoing + incoming + type) is preserved, but subjects come from the WHERE match instead of literal IRIs
- This reuses the existing select-query WHERE pipeline (desugar → canonicalize → lower) so all `.equals()`, `.some()`, `.every()` predicates work inside `.delete().where()`

---

## Phase order

1. **Phase 1: `.minus()` on select** — self-contained, new node type through the full pipeline
2. **Phase 2: `.delete().where()`** — builds on existing where infrastructure, extends DeleteBuilder
