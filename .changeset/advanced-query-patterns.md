---
"@_linked/core": patch
---

Add MINUS support on QueryBuilder with multiple call styles:
- `.minus(Shape)` — exclude by shape type
- `.minus(p => p.prop.equals(val))` — exclude by condition
- `.minus(p => p.prop)` — exclude by property existence
- `.minus(p => [p.prop1, p.nested.prop2])` — exclude by multi-property existence with nested path support

Add bulk delete operations:
- `Shape.deleteAll()` / `DeleteBuilder.from(Shape).all()` — delete all instances with schema-aware blank node cleanup
- `Shape.deleteWhere(fn)` / `DeleteBuilder.from(Shape).where(fn)` — conditional delete

Add conditional update operations:
- `.update(data).where(fn)` — update matching instances
- `.update(data).forAll()` — update all instances

API cleanup:
- Deprecate `sortBy()` in favor of `orderBy()`
- Remove `DeleteBuilder.for()` — use `DeleteBuilder.from(shape, ids)` instead
- Require `data` parameter in `Shape.update(data)`
