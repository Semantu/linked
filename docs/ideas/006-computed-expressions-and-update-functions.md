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

However, proxies **can** intercept method calls. This gives us two complementary approaches.

## Two expression syntaxes

### 1. Chained method syntax (preferred for simple expressions)

Since proxy objects can intercept method calls, we can add expression methods directly to the proxied property objects. This gives the most natural, readable DSL:

```ts
// Comparison — clean and readable
p.age.gt(18)           // FILTER(?age > 18)
p.age.gte(18)          // FILTER(?age >= 18)
p.age.lt(5)            // FILTER(?age < 5)
p.age.lte(5)           // FILTER(?age <= 5)
p.name.eq('Alice')     // FILTER(?name = "Alice")
p.name.neq('Bob')      // FILTER(?name != "Bob")

// Arithmetic — works well for single operations
p.age.times(12)        // (?age * 12)
p.age.plus(1)          // (?age + 1)
p.price.minus(10)      // (?price - 10)
p.total.divide(2)      // (?total / 2)

// String
p.name.contains('foo') // CONTAINS(?name, "foo")
p.name.strlen()        // STRLEN(?name)
```

Each method returns an expression node, so results can be used anywhere an expression is expected (projections, filters, mutation values).

### 2. `L` module syntax (needed for complex expressions)

Chained arithmetic has a **precedence problem**: `p.age.plus(5).times(12)` always evaluates left-to-right as `(age + 5) * 12`. There's no way to express `age + (5 * 12)` or combine values from multiple properties. The `L` module handles these cases:

```ts
import { L } from '@_linked/core';

// Multi-property expressions
L.concat(p.firstName, " ", p.lastName)    // CONCAT(?firstName, " ", ?lastName)
L.plus(p.basePrice, p.tax)               // (?basePrice + ?tax)

// Explicit precedence control
L.plus(p.age, L.times(5, 12))            // (?age + (5 * 12))

// Functions with no property context
L.now()                                   // NOW()
L.coalesce(p.nickname, p.name)           // COALESCE(?nickname, ?name)
L.ifThen(p.age.gt(18), 'adult', 'minor') // IF(?age > 18, "adult", "minor")
```

### When to use which

| Scenario | Syntax | Example |
|---|---|---|
| Simple comparison | Chained | `p.age.gt(18)` |
| Single arithmetic op | Chained | `p.age.times(12)` |
| Multi-property math | `L` module | `L.plus(p.basePrice, p.tax)` |
| Nested precedence | `L` module | `L.plus(p.age, L.times(5, 12))` |
| String concat (multi) | `L` module | `L.concat(p.first, " ", p.last)` |
| No-arg functions | `L` module | `L.now()` |
| Conditionals | `L` module | `L.ifThen(cond, a, b)` |

Both syntaxes produce the same `IRExpression` nodes internally, so they're fully interchangeable and composable:

```ts
// Mix and match — chained result used inside L
L.ifThen(p.age.gte(18), p.salary.times(1.1), p.salary)
```

## `L` module reference

```ts
import { L } from '@_linked/core';

// Arithmetic
L.plus(a, b)       // a + b
L.minus(a, b)      // a - b
L.times(a, b)      // a * b
L.divide(a, b)     // a / b

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

Both syntaxes should be generically typed to preserve type information:

```ts
// Chained — return type matches operation
p.age.times(12)                  // type: NumericExpression
p.name.contains('foo')           // type: BooleanExpression

// L module — return type inferred from function
L.times(p.age, 12)              // type: NumericExpression
L.concat(p.firstName, " ", p.lastName)  // type: StringExpression
```

## DSL examples

### Computed fields in SELECT

```ts
// Derived fields using both syntaxes
Person.select(p => ({
  name: p.name,
  fullName: L.concat(p.firstName, " ", p.lastName),
  ageInMonths: p.age.times(12),
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
// Chained syntax — preferred for simple filters
Person.select(p => p.name).where(p => p.age.gt(18))

// L module — for complex filters
Person.select(p => p.name).where(p =>
  L.ifThen(p.age.gte(18), p.salary.gt(0), L.bound(p.allowance))
)

// Generated SPARQL (simple):
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
  age: p.age.plus(1),
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
// Apply 10% discount to products over $100 (uses bulk update from idea 007)
Product.update(p => ({
  price: p.price.times(0.9),
})).where(p => p.price.gt(100))

// or filter-first:
Product.where(p => p.price.gt(100)).update(p => ({
  price: p.price.times(0.9),
}))

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

- Chained methods (`.gt()`, `.times()`, etc.) are added to the proxied `QueryPrimitive` / `QueryBuilderObject` classes
- Both chained and `L` module produce the same `IRExpression` nodes — they're just two entry points
- The `L` module needs to produce `IRExpression` nodes that flow through the existing IR pipeline
- `irToAlgebra.ts` needs to convert `IRExpression` in projection items to `SparqlExtend` nodes
- For mutations: `IRUpdateMutation` currently expects `IRFieldValue` (literal data); needs to also accept `IRExpression` for computed values
- The callback form `Person.update(id, p => ...)` needs proxy tracking (already exists for selects)
- `MutationQuery.ts:33` TODO can be resolved by this feature
- Expression builder functions should validate argument types at build time where possible

## Implementation phases

This idea is part of a broader implementation plan alongside idea 007. See the phased approach:

1. **Phase 1** — MINUS support (idea 007, no dependency on this idea)
2. **Phase 2** — `deleteWhere` / `deleteAll` / `updateWhere` (idea 007, uses existing `.equals()` evaluation — no dependency on this idea)
3. **Phase 3** — Expression builder: chained methods + `L` module, computed fields in SELECT (~5-7 days)
4. **Phase 4** — Update functions / computed mutations via expressions (~3-4 days)

Phases 3-4 are this idea. Phases 1-2 (idea 007) can proceed first without any expression infrastructure.

## Open questions

- Should `L` be the module name, or something more descriptive? (`Expr`, `Fn`, `Q`?)
- Should comparison functions be usable both in `.where()` and in HAVING clauses?
- How should null/undefined handling work for computed expressions (COALESCE automatically)?
- Should chained arithmetic methods return an object that supports further chaining? (e.g., `p.age.plus(5).times(12)` — always left-to-right, documented as such)
