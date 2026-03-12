---
summary: Scope and API options for aggregate group filtering (HAVING semantics) separate from computed expression core work.
packages: [core]
---

# Aggregate Group Filtering (HAVING Semantics)

## Why this is split from 006

Idea `006` focuses on computed expressions and expression-based updates.
Aggregate group filtering introduces a separate design branch:
- grouping semantics
- aggregate result filtering semantics
- potential public API additions (`groupBy`, aggregate-local filter methods, or both)

Keeping this in a dedicated ideation doc avoids expanding 006 scope.

## Confirmed current state in codebase

- There is no public query-builder `.having()` method currently exposed.
- There is no public query-builder `.groupBy()` method currently exposed.
- Aggregate filtering can already occur implicitly via existing DSL patterns:
  - `Person.select().where((p) => p.friends.size().equals(2))`
  - This currently lowers to SPARQL with `GROUP BY` + `HAVING(...)` in tests.
- The SPARQL algebra and serializer already support `groupBy` and `having` fields internally.

## Current example and interpretation

Proposed syntax:

```ts
Person
  .select(p => ({ city: p.city, n: p.id.count().where(c => c.gt(10)) }))
  .groupBy(p => p.city)
```

Interpretation to validate:
- `count().where(...)` is a post-aggregate group filter (HAVING-like), not a row-level pre-aggregate filter.
- If accepted, this can be treated as an aggregate-local filter API.

## Options to evaluate next

1. No new public `.having()`; use aggregate-local filtering only.
2. Introduce explicit public `.having()` callback for grouped queries.
3. Support both, where aggregate-local filtering is sugar that compiles to HAVING.
4. Defer all new aggregate filtering API work to a later phase and keep existing implicit behavior only.

## Evaluation criteria

- Fits fluent default style from idea 006.
- Avoids ambiguous semantics between row filtering and group filtering.
- Type-safety and error clarity.
- Minimal API surface increase for v1.
- Keeps query intent readable at call-site.

## Pending decisions

- Whether aggregate-local filter should be named `.where(...)` or `.filter(...)`.
- Whether public `.groupBy(...)` is needed, or grouping remains implicit from aggregate usage.
- Whether aggregate filters should be accepted only in grouped contexts.
- How multiple aggregate filters combine (expected default: logical AND).
