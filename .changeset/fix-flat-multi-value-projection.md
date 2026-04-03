---
"@_linked/core": patch
---

Fix flat multi-value property projections returning single values instead of arrays

Multi-value object properties (e.g. `friends`, without `maxCount`) now correctly return `ResultRow[]` arrays when selected via flat projections like `Person.select(p => p.friends)`. Previously, only the first entity reference was returned; additional values were discarded.

**Behavioral change:** If your code expects `result.friends` to be a single `{id: "..."}` object from a flat select, update it to handle an array: `result.friends[0]`. Properties with `maxCount: 1` are unaffected and continue to return single values.

The `maxCount` metadata from `PropertyShape` is now also propagated to `IRPropertyExpression.maxCount`, enabling the result mapping layer to distinguish single-value from multi-value flat fields.
