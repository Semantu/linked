---
summary: Implement and refine selectAll across shape, sub-query, inheritance dedupe, and typing behavior
packages: [core]
---

## Key considerations and choices

- `selectAll` was kept explicit (`Shape.selectAll()` and nested `p.friends.selectAll()` / `p.bestFriend.selectAll()`) and implemented by reusing existing `select(...)` internals.
- Inherited properties are included, with label-based dedupe so subclass overrides win and appear once.
- Unique-property-shape behavior was added to metadata as `NodeShape.getUniquePropertyShapes(): PropertyShape[]` so callers can inspect selected metadata directly.
- `getPropertyShapes(true)` semantics were preserved; dedupe behavior is isolated to `getUniquePropertyShapes()`.
- Nested `selectAll` type inference was improved enough to expose common nested fields in compile tests without changing runtime query behavior.
- `selectAll` key filtering was tightened to exclude base `Shape` instance keys from inferred property unions.
- Override validation was finalized as tighten-only for `minCount`, `maxCount`, and `nodeKind`, with omitted override fields inheriting base constraints silently.
- Property-shape count parsing was fixed to preserve explicit `0` values for `minCount`/`maxCount`.

## Problems addressed

- Inheritance-chain regressions were avoided by not changing `getPropertyShapes(true)` and adding a separate dedupe API.
- Override precedence is stable: dedupe order follows subclass-first traversal so overridden labels resolve to subclass property shapes.
- Over-broad override constraints are now blocked at registration time with explicit errors for lowered `minCount`, raised `maxCount`, and widened `nodeKind`.
- Mixed override cases (partial explicit override + inherited fields) are covered and validated in metadata tests.

## Remaining limits

- Compatibility checks for override fields like `datatype`, `class`, and `pattern` are not enforced yet.
- `selectAll` key inference is stricter than before but may still include non-decorated subclass members in some cases due to current `keyof`-based inference bounds.
- Shapes with no decorated properties still produce empty select projections (current intended behavior).
- Decorator-level contradictions like `required: true` with `minCount: 0` still follow existing precedence (`required` wins).

## Phases

1. **Initial `selectAll` implementation** ✅
   - Add `Shape.selectAll(...)` and reuse `select(...)` internals.
   - Validate with query generation tests.
2. **Nested sub-query support** ✅
   - Add `selectAll()` on `QueryShapeSet` and `QueryShape`.
   - Validate query object shape for `p.friends.selectAll()` and `p.bestFriend.selectAll()`.
3. **Inherited override dedupe** ✅
   - Ensure overridden labels appear once and subclass override wins.
   - Add regression fixture/tests with subclass overrides.
4. **Move unique-property API onto `NodeShape`** ✅
   - Add `NodeShape.getUniquePropertyShapes()` and migrate `selectAll` call sites.
   - Keep `getPropertyShapes(true)` semantics unchanged.
5. **Simplify API + improve nested typing** ✅
   - Make `getUniquePropertyShapes()` always use inheritance (remove boolean flag).
   - Improve nested `selectAll` typing and add type tests for nested fields.
6. **Docs/changelog consolidation** ✅
   - Update README examples, type-inference notes, and changelog entries.
   - Consolidate all selectAll planning history into this document.
7. **Registration-time override guard (tighten-only)** ✅
   - Enforce override checks for minCount/maxCount/nodeKind in property registration.
   - Keep omitted override fields inheriting silently from super property shape.
   - Add metadata tests for allowed and rejected override cases, including positive tighten cases and mixed inheritance.
8. **Docs cleanup + key-filter tightening follow-up** ✅
   - Trim intro `README` `selectAll` examples to one concise, shape-consistent example.
   - Tighten `selectAll` key filtering to exclude base `Shape` instance keys from inferred property unions.
9. **Count parsing regression fix (`0` values)** ✅
   - Treat `minCount: 0` and `maxCount: 0` as explicit values in `createPropertyShape`.
   - Add metadata tests for explicit zero-count persistence and override guarding from `0 -> 1`.

## Implementation summary

- Added top-level `Shape.selectAll(...)` and nested `selectAll()` support on `QueryShape` and `QueryShapeSet`.
- Added `NodeShape.getUniquePropertyShapes()` for deduped inherited property shape resolution with subclass-first precedence.
- Updated all `selectAll` paths to derive property labels from `getUniquePropertyShapes()`.
- Added runtime query tests for top-level and nested `selectAll`, plus dedupe regression coverage using subclass overrides.
- Added compile-only type tests for top-level and nested `selectAll` field inference.
- Tightened `selectAll` key filtering to exclude base `Shape` instance keys from inferred result unions.
- Added registration-time tighten-only override guards (`minCount`, `maxCount`, `nodeKind`) with explicit metadata test coverage for reject and allow cases.
- Fixed `createPropertyShape` count parsing to preserve explicit `0` values for `minCount`/`maxCount`.
- Updated `README.md` examples/changelog and documented current override-compatibility scope.
