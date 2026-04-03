---
"@_linked/core": patch
---

Fix maxCount-aware result mapping for single-value and multi-value properties

**Single-value properties** (`maxCount: 1`, e.g. `bestFriend`) now return a single `ResultRow` (or `null` when absent) instead of `ResultRow[]` when accessed via traversal queries like `Person.select(p => p.bestFriend.name)`.

**Multi-value object properties** (e.g. `friends`, without `maxCount`) now correctly return `ResultRow[]` arrays when selected via flat projections like `Person.select(p => p.friends)`. Previously, only the first entity reference was returned.

**Multi-value literal properties** (e.g. `nickNames: string[]`) now correctly return typed arrays (e.g. `string[]`). Previously, values were silently dropped and an empty array was returned.

**Behavioral changes:**
- If your code accesses single-value traversal results as arrays (e.g. `result.bestFriend[0]`), update to access the value directly (`result.bestFriend`).
- If your code expects multi-value flat select results as single objects (e.g. `result.friends.id`), update to handle arrays (`result.friends[0].id`).

The `maxCount` metadata from `PropertyShape` is now propagated through the full IR pipeline (`IRTraversePattern.maxCount`, `IRPropertyExpression.maxCount`) and used during SPARQL result mapping.
