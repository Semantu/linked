# Computed Expressions & Update Functions

## Summary

Add support for computed/derived fields in SELECT projections and expression-based updates in mutations. This covers two related capabilities:
1. **Computed fields in queries** — BIND expressions that produce derived values in SELECT results
2. **Update functions** — Expression-based mutations that compute new values from existing data (the existing TODO at `MutationQuery.ts:33`)

Both use the `SparqlExtend` (BIND) algebra type already defined in `SparqlAlgebra.ts`.

## Motivation

Currently the DSL only supports projecting stored properties and updating with literal values. Real applications need:
- Derived fields (full name from first + last, age in months from age in years)
- Conditional values (if/else logic in projections)
- Relative updates (increment a counter, apply a discount)
- Timestamp injection (set `lastModified` to current time)

## Proxy limitation

JavaScript proxies cannot intercept operators (`+`, `-`, `*`, `/`, `>`, `<`, `===`). This means:

```ts
// WILL NOT WORK — proxy can't intercept * operator
Person.select(p => ({ ageInMonths: p.age * 12 }))

// WILL NOT WORK — proxy can't intercept > operator
Person.select(p => p.name).where(p => p.age > 18)
```

All computed expressions must use **function-call syntax** through an expression builder module.

## Expression builder module design

A short-named module (e.g., `L` for Linked expressions) that provides typed builder functions:

```ts
import { L } from '@_linked/core';

// Arithmetic
L.plus(a, b)       // a + b
L.minus(a, b)      // a - b
L.times(a, b)      // a * b
L.divide(a, b)     // a / b

// Comparison (for WHERE/FILTER)
L.eq(a, b)         // a = b
L.neq(a, b)        // a != b
L.gt(a, b)         // a > b
L.gte(a, b)        // a >= b
L.lt(a, b)         // a < b
L.lte(a, b)        // a <= b

// String
L.concat(a, b, c)  // CONCAT(a, b, c)
L.strlen(a)        // STRLEN(a)
L.substr(a, start, len)  // SUBSTR(a, start, len)
L.ucase(a)         // UCASE(a)
L.lcase(a)         // LCASE(a)
L.contains(a, b)   // CONTAINS(a, b)

// Date/time
L.now()            // NOW()
L.year(a)          // YEAR(a)
L.month(a)         // MONTH(a)

// Conditional
L.ifThen(cond, thenVal, elseVal)  // IF(cond, then, else)
L.coalesce(a, b)   // COALESCE(a, b)
L.bound(a)         // BOUND(a)
```

Each function returns an `IRExpression` node that the IR pipeline can process.

### Type safety

The `L` module functions should be generically typed to preserve type information:

```ts
// L.times knows it returns a numeric expression
L.times(p.age, 12)  // type: NumericExpression

// L.concat knows it returns a string expression
L.concat(p.firstName, " ", p.lastName)  // type: StringExpression
```

## DSL examples

### Computed fields in SELECT

```ts
// Derived field using BIND
Person.select(p => ({
  name: p.name,
  fullName: L.concat(p.firstName, " ", p.lastName),
  ageInMonths: L.times(p.age, 12),
}))

// Generated SPARQL:
// SELECT ?name (CONCAT(?firstName, " ", ?lastName) AS ?fullName)
//              ((?age * 12) AS ?ageInMonths)
// WHERE {
//   ?s rdf:type ex:Person .
//   OPTIONAL { ?s ex:name ?name . }
//   OPTIONAL { ?s ex:firstName ?firstName . }
//   OPTIONAL { ?s ex:lastName ?lastName . }
//   OPTIONAL { ?s ex:age ?age . }
// }
```

### Computed filters in WHERE

```ts
// Filter with expression function
Person.select(p => p.name).where(p => L.gt(p.age, 18))

// Generated SPARQL:
// SELECT ?name WHERE {
//   ?s rdf:type ex:Person .
//   OPTIONAL { ?s ex:name ?name . }
//   OPTIONAL { ?s ex:age ?age . }
//   FILTER(?age > 18)
// }
```

### Expression-based mutations (update functions)

```ts
// Increment age and set lastModified to now
Person.update(p1, p => ({
  age: L.plus(p.age, 1),
  lastModified: L.now(),
}))

// Generated SPARQL:
// DELETE { ?s ex:age ?old_age . ?s ex:lastModified ?old_lastModified . }
// INSERT { ?s ex:age ?new_age . ?s ex:lastModified ?now . }
// WHERE {
//   ?s rdf:type ex:Person . FILTER(?s = <p1-uri>)
//   OPTIONAL { ?s ex:age ?old_age . }
//   OPTIONAL { ?s ex:lastModified ?old_lastModified . }
//   BIND((?old_age + 1) AS ?new_age)
//   BIND(NOW() AS ?now)
// }
```

```ts
// Apply 10% discount to products over $100
Product.updateAll(p => ({
  price: L.times(p.price, 0.9),
})).where(p => L.gt(p.price, 100))

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

## Algebra mapping

Uses the existing `SparqlExtend` algebra node:

```ts
type SparqlExtend = {
  type: 'extend';
  inner: SparqlAlgebraNode;
  variable: string;
  expression: SparqlExpression;
};
```

Already serialized by `algebraToString.ts` as `BIND(expr AS ?var)`.

## Implementation considerations

- The `L` module needs to produce `IRExpression` nodes that flow through the existing IR pipeline
- `irToAlgebra.ts` needs to convert `IRExpression` in projection items to `SparqlExtend` nodes
- For mutations: `IRUpdateMutation` currently expects `IRFieldValue` (literal data); needs to also accept `IRExpression` for computed values
- The callback form `Person.update(id, p => ...)` needs proxy tracking (already exists for selects)
- `MutationQuery.ts:33` TODO can be resolved by this feature
- Expression builder functions should validate argument types at build time where possible

## Callback-style mutation updates

Currently `UpdateBuilder` only supports object-style updates (pass a plain object with new values). The TODO at `MutationQuery.ts:33` also envisions a **callback-style** API where a proxy lets you assign properties imperatively:

```ts
// Object-style (already works via UpdateBuilder)
Person.update(entity, { name: 'Bob', age: 30 })

// Callback-style (not yet implemented)
Person.update(entity, p => {
  p.name = 'Bob';
  p.age = L.plus(p.age, 1);  // combine with expressions
})
```

### Why callback-style matters

- **Reads + writes in one callback** — the proxy can trace which properties are read (for DELETE old values) and which are written (for INSERT new values), generating correct DELETE/INSERT WHERE in one pass
- **Natural fit with expressions** — `p.age = L.plus(p.age, 1)` reads the current value and writes a computed new value, which is awkward to express in a plain object
- **Consistency with select** — `Person.select(p => ...)` already uses proxy callbacks; mutations should follow the same pattern

### Implementation approach

The callback needs a **write-tracing proxy** (unlike the read-only proxy used in `select()`):
- Property **reads** (`p.age`) produce the same `QueryPrimitive` / `QueryShape` proxies as in select, which can be passed to `L.*` functions
- Property **writes** (`p.name = 'Bob'`) are intercepted via the proxy `set` trap and recorded as mutation entries
- After the callback executes, the recorded writes are converted to `IRFieldValue` or `IRExpression` entries in the mutation IR

This reuses the `ProxiedPathBuilder` infrastructure from the query cleanup — the main new work is the `set` trap and wiring mutations into `UpdateBuilder`.

## Open questions

- Should `L` be the module name, or something more descriptive? (`Expr`, `Fn`, `Q`?)
- Should comparison functions be usable both in `.where()` and in HAVING clauses?
- How should null/undefined handling work for computed expressions (COALESCE automatically)?
- Should there be a `.updateAll()` method for bulk expression-based updates, separate from `.update(id, ...)`?
- For callback-style updates: should the proxy support deleting properties (`delete p.name`) to generate triple removal?
