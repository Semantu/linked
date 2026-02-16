---
"@_linked/core": minor
---

- Added `Shape.selectAll()` plus nested `selectAll()` support on sub-queries.
- Added inherited property deduplication via `NodeShape.getUniquePropertyShapes()` so subclass overrides win by label and are selected once.
- Improved `selectAll()` type inference (including nested queries) and excluded base `Shape` keys from inferred results.
- Added registration-time override guards: `minCount` cannot be lowered, `maxCount` cannot be increased, and `nodeKind` cannot be widened.
- Fixed `createPropertyShape` to preserve explicit `minCount: 0` / `maxCount: 0`.
- Expanded tests and README documentation for `selectAll`, CRUD return types, and multi-value update semantics.
