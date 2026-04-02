---
"@_linked/core": patch
---

Fix single-value object property traversals returning arrays instead of single values

Properties decorated with `@objectProperty({maxCount: 1})` (e.g. `bestFriend`) now return a single `ResultRow` (or `null` when absent) instead of `ResultRow[]` when accessed via traversal queries like `Person.select(p => p.bestFriend.name)`.

**Behavioral change:** If your code accesses single-value traversal results as arrays (e.g. `result.bestFriend[0]`), update it to access the value directly (e.g. `result.bestFriend`). Multi-value properties without `maxCount` constraints are unaffected and continue to return arrays.

The `maxCount` metadata from `PropertyShape` is now propagated through the full IR pipeline (`IRTraversePattern.maxCount`) and used during SPARQL result mapping to unwrap single-value nested groups.
