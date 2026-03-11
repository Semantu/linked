---
summary: Expression support for computed query fields and mutation updates, with fluent datatype-aware property methods as the default API.
packages: [core]
---

# Computed Expressions & Update Functions

## Summary

Add support for computed/derived fields in SELECT projections and expression-based updates in mutations. This covers two related capabilities:
1. **Computed fields in queries** — BIND expressions that produce derived values in SELECT results
2. **Update functions** — Expression-based mutations that compute new values from existing data (the existing TODO at `MutationQuery.ts:33`)

Both use the `SparqlExtend` (BIND) algebra type already defined in `SparqlAlgebra.ts`.

## Status snapshot (after merging `dev`, 2026-03-11)

Already implemented in `dev`:
- Bulk update targeting now exists via `Shape.update(data).forAll()` and `.where(...)` (no longer single-ID only).
- Related advanced query pattern work (`minus`, `deleteAll`, `deleteWhere`, `updateWhere`) is covered by tests and pending changeset.

Still pending for this ideation track:
- Datatype-aware fluent expression methods on value/property segments (`.plus`, `.gt`, `.concat`, etc.).
- Public `Expr` expression module for complex/non-fluent compositions.
- Expression-capable mutation values (accepting expressions in updates, not only literal field values).
- Functional callback update payloads (`Person.update(p => ({ ... }))`) with expression support.
- Nullish helper API exposure decisions now agreed (`defaultTo`, `firstDefined`) but not yet implemented.

## Agreed direction (2026-03-11)

- Expressions should work directly on property segments and this is the default API.
- `Expr` remains available for complex/composed cases, but should not be required for common operations.
- Comparison methods provide both short and long aliases (e.g., `.gt()` / `.greaterThan()`). Short forms for conciseness, long forms for readability and discoverability. `Expr` module uses short forms only.
- Chaining execution is left-to-right by default (no hidden precedence model across chained calls unless the user explicitly nests).

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

Operators still cannot be intercepted, so expression syntax must be method/function based.

## Expression API design

Default style is fluent methods on proxied property/value nodes:

```ts
Person.select(p => ({
  name: p.name,
  fullName: p.firstName.concat(" ", p.lastName),
  ageInMonths: p.age.times(12),
})).where(p => p.age.gt(18))
```

For complex cases (non-property-first, explicit grouping, helper composition), provide module functions via `Expr`:

```ts
import { Expr } from '@_linked/core';
```

Both fluent methods and `Expr.*` compile to the same `IRExpression` nodes.

### Complete expression catalog

#### Arithmetic (numeric → numeric)

| Fluent | Expr module | SPARQL | Notes |
|---|---|---|---|
| `.plus(n)` | `Expr.plus(a, b)` | `a + b` | |
| `.minus(n)` | `Expr.minus(a, b)` | `a - b` | |
| `.times(n)` | `Expr.times(a, b)` | `a * b` | |
| `.divide(n)` | `Expr.divide(a, b)` | `a / b` | |
| `.abs()` | `Expr.abs(a)` | `ABS(a)` | |
| `.round()` | `Expr.round(a)` | `ROUND(a)` | |
| `.ceil()` | `Expr.ceil(a)` | `CEIL(a)` | |
| `.floor()` | `Expr.floor(a)` | `FLOOR(a)` | |
| `.power(n)` | `Expr.power(a, b)` | repeated multiplication | Emitted as `a * a * ... * a` (b times). Exponent must be a positive integer ≤ 20; values > 20 throw a build-time error. No native SPARQL `POWER()`. |

#### Comparison (comparable → boolean)

Short and long fluent aliases both resolve to the same IR node. `Expr` module uses short names only.

| Fluent (short) | Fluent (long) | Expr module | SPARQL |
|---|---|---|---|
| `.eq(v)` | `.equals(v)` | `Expr.eq(a, b)` | `a = b` |
| `.neq(v)` | `.notEquals(v)` | `Expr.neq(a, b)` | `a != b` |
| `.gt(v)` | `.greaterThan(v)` | `Expr.gt(a, b)` | `a > b` |
| `.gte(v)` | `.greaterThanOrEqual(v)` | `Expr.gte(a, b)` | `a >= b` |
| `.lt(v)` | `.lessThan(v)` | `Expr.lt(a, b)` | `a < b` |
| `.lte(v)` | `.lessThanOrEqual(v)` | `Expr.lte(a, b)` | `a <= b` |

#### String

| Fluent | Expr module | SPARQL | Return |
|---|---|---|---|
| `.concat(...)` | `Expr.concat(a, b, ...)` | `CONCAT(...)` | string |
| `.contains(s)` | `Expr.contains(a, b)` | `CONTAINS(a, b)` | boolean |
| `.startsWith(s)` | `Expr.startsWith(a, b)` | `STRSTARTS(a, b)` | boolean |
| `.endsWith(s)` | `Expr.endsWith(a, b)` | `STRENDS(a, b)` | boolean |
| `.substr(start, len?)` | `Expr.substr(a, start, len?)` | `SUBSTR(a, s, l)` | string |
| `.before(s)` | `Expr.before(a, b)` | `STRBEFORE(a, b)` | string |
| `.after(s)` | `Expr.after(a, b)` | `STRAFTER(a, b)` | string |
| `.replace(pat, rep, flags?)` | `Expr.replace(a, pat, rep, flags?)` | `REPLACE(a, p, r, f)` | string |
| `.ucase()` | `Expr.ucase(a)` | `UCASE(a)` | string |
| `.lcase()` | `Expr.lcase(a)` | `LCASE(a)` | string |
| `.strlen()` | `Expr.strlen(a)` | `STRLEN(a)` | numeric |
| `.encodeForUri()` | `Expr.encodeForUri(a)` | `ENCODE_FOR_URI(a)` | string |
| `.matches(pat, flags?)` | `Expr.regex(a, pat, flags?)` | `REGEX(a, p, f)` | boolean |

Fluent uses `.matches()` for readability (`p.name.matches("^A.*")`); `Expr` module uses `regex()` for explicitness.

**Regex flags**: Common subset supported across SPARQL/SQL targets:
- `i` — case-insensitive matching
- `m` — multiline mode (`^`/`$` match line boundaries)
- `s` — dotAll mode (`.` matches newlines)

These three flags are portable across SPARQL (XPath regex), PostgreSQL, MySQL, and most SQL dialects. Extended flags (`x` for comments, `q` for literal mode) are not supported to avoid platform divergence.

#### Date/Time

| Fluent | Expr module | SPARQL | Return |
|---|---|---|---|
| — | `Expr.now()` | `NOW()` | dateTime |
| `.year()` | `Expr.year(a)` | `YEAR(a)` | numeric |
| `.month()` | `Expr.month(a)` | `MONTH(a)` | numeric |
| `.day()` | `Expr.day(a)` | `DAY(a)` | numeric |
| `.hours()` | `Expr.hours(a)` | `HOURS(a)` | numeric |
| `.minutes()` | `Expr.minutes(a)` | `MINUTES(a)` | numeric |
| `.seconds()` | `Expr.seconds(a)` | `SECONDS(a)` | numeric |
| `.timezone()` | `Expr.timezone(a)` | `TIMEZONE(a)` | duration |
| `.tz()` | `Expr.tz(a)` | `TZ(a)` | string |

Full SPARQL 1.1 date/time coverage. `TIMEZONE()` returns `xsd:dayTimeDuration`, `TZ()` returns a string literal (e.g., `"Z"`, `"+05:30"`).

#### Logical (boolean → boolean)

| Fluent | Expr module | SPARQL |
|---|---|---|
| `.and(expr)` | `Expr.and(a, b)` | `a && b` |
| `.or(expr)` | `Expr.or(a, b)` | `a \|\| b` |
| `.not()` | `Expr.not(a)` | `!a` |

#### Null-handling / Conditional

| Fluent | Expr module | SPARQL |
|---|---|---|
| `.isDefined()` | — | `BOUND(a)` |
| `.isNotDefined()` | — | `!BOUND(a)` |
| `.defaultTo(fallback)` | — | `COALESCE(a, fallback)` |
| — | `Expr.firstDefined(a, b, ...)` | `COALESCE(a, b, ...)` |
| — | `Expr.ifThen(cond, then, else)` | `IF(cond, then, else)` |
| — | `Expr.bound(a)` | `BOUND(a)` |

`isDefined()`/`isNotDefined()` are the fluent-friendly names for `BOUND`/`!BOUND`. `Expr.bound()` remains in the module for SPARQL-literate users.

#### RDF introspection

| Fluent | Expr module | SPARQL | Return |
|---|---|---|---|
| `.lang()` | `Expr.lang(a)` | `LANG(a)` | string |
| `.datatype()` | `Expr.datatype(a)` | `DATATYPE(a)` | IRI |

#### Type casting / checking

| Expr module | SPARQL | Return |
|---|---|---|
| `Expr.str(a)` | `STR(a)` | string |
| `Expr.iri(s)` | `IRI(s)` | IRI |
| `Expr.isIri(a)` | `isIRI(a)` | boolean |
| `Expr.isLiteral(a)` | `isLiteral(a)` | boolean |
| `Expr.isBlank(a)` | `isBLANK(a)` | boolean |
| `Expr.isNumeric(a)` | `isNUMERIC(a)` | boolean |

These are `Expr`-only (no fluent aliases) since they operate on RDF term types rather than datatype-specific values.

#### Hash functions

| Expr module | SPARQL | Return |
|---|---|---|
| `Expr.md5(a)` | `MD5(a)` | string |
| `Expr.sha256(a)` | `SHA256(a)` | string |
| `Expr.sha512(a)` | `SHA512(a)` | string |

### Type safety

The `Expr` module functions should be generically typed to preserve type information:

```ts
// Expr.times knows it returns a numeric expression
Expr.times(p.age, 12)  // type: NumericExpression

// Expr.concat knows it returns a string expression
Expr.concat(p.firstName, " ", p.lastName)  // type: StringExpression
```

## DSL examples

### Computed fields in SELECT

```ts
// Derived fields using fluent methods (default style)
Person.select(p => ({
  name: p.name,
  fullName: p.firstName.concat(" ", p.lastName),
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
// Filter with fluent method (default style)
Person.select(p => p.name).where(p => p.age.gt(18))

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
  age: p.age.plus(1),
  lastModified: Expr.now(),
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
Product.update({ price: p => p.price.times(0.9) })
  .where(p => p.price.gt(100))

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

- Value/property proxies need datatype-aware fluent method surfaces that produce `IRExpression` nodes
- The `Expr` module remains as fallback and must produce the same `IRExpression` nodes
- `irToAlgebra.ts` needs to convert `IRExpression` in projection items to `SparqlExtend` nodes
- For mutations: `IRUpdateMutation` currently expects `IRFieldValue` (literal data); needs to also accept `IRExpression` for computed values
- Functional callback payload form `Person.update(p => ({ ... }))` needs read-proxy evaluation (same tracing basis as selects)
- `MutationQuery.ts:33` TODO can be resolved by this feature
- Expression builder functions should validate argument types at build time where possible
- Chained fluent expressions should evaluate left-to-right unless explicit nested expression builders are used
- `power()` emits repeated multiplication (`a * a * ...`) since SPARQL has no native `POWER()`. Exponent must be a positive integer; values > 20 throw a build-time error to prevent query bloat.
- Regex/replace flags are limited to the portable subset (`i`, `m`, `s`) to ensure consistent behavior across SPARQL and SQL targets.

## Callback payload updates (functional style)

Currently `UpdateBuilder` supports object-style updates (pass a plain object with new values). For computed updates, we want callback payloads that return an object:

```ts
// Object-style (already works via UpdateBuilder)
Person.update(entity, { name: 'Bob', age: 30 })

// Functional callback payload (proposed primary form)
Person.update(entity, p => ({
  name: 'Bob',
  age: Expr.plus(p.age, 1), // combine with expressions
}))
```

### Why functional callback payloads matter

- **Read context for computations** — callback receives query proxy `p`, so updates can derive values from existing fields (`p.age.plus(1)`).
- **Keeps update shape declarative** — returned object remains close to existing `update({...})` API style.
- **Lower implementation complexity** — no write-tracing proxy/set-trap required for the first implementation.

### Implementation approach

The callback uses a **read-only proxy** (same tracing style as `select()`):
- Callback parameter reads (`p.age`) produce query value proxies that feed `Expr.*` or fluent expression methods.
- Callback return object entries are normalized into mutation fields.
- Each returned field value can be either literal data or expression IR.

This reuses the `ProxiedPathBuilder` infrastructure from query tracing without requiring `set` traps.

Deferred (future extension):
- Imperative callback writes (`p.age = ...`) with write-tracing proxy semantics.

## Open questions

### 1) Module naming for fallback functions

Decision (agreed): `Expr` only. Do not provide `L` alias.

### 2) Reuse comparisons in both `where` and `having`

Moved to dedicated ideation document:
`docs/ideas/012-aggregate-group-filtering.md`

### 3) Null/undefined behavior in computed expressions

Decision (agreed): Strict default plus explicit helpers.

Detailed semantics:
- Result mapping keeps missing/unbound values as `null` (never silently drops fields as `undefined`).
- Expression evaluation is strict by default:
  - Any non-null-handling operation receiving a null/unbound operand yields null/unbound output.
  - No implicit datatype defaults (no auto `""`, `0`, or `false`).
- Null-handling is explicit:
  - `Expr.firstDefined(a, b, c)` returns the first non-null/non-unbound argument.
  - `expr.defaultTo(fallback)` returns `fallback` only when `expr` is null/unbound.
  - If all candidates are null/unbound, result is null.
  - A provided fallback literal works exactly as expected as the final candidate.

Naming direction (agreed):
- Public API names are `defaultTo` and `firstDefined`.
- Do not expose `coalesce` in the public DSL API (no alias).

### 4) Bulk update API shape

Status after `dev` merge:
- Implemented as:
  - `Shape.update(data).forAll()` for global bulk updates
  - `Shape.update(data).where(fn)` for conditional bulk updates
- This resolves the core bulk-update capability for this ideation track.
- `updateAll(...)` sugar/alias excluded from scope.

### 5) Deleting properties in callback-style updates

Decision (agreed for now): Option A.

Decision details:
- Callback payload updates will use `null`/`undefined` as unset semantics for now.
- This keeps behavior consistent with existing plain-object update API.
- Revisit explicit sentinel API later if ambiguity becomes a practical issue.
