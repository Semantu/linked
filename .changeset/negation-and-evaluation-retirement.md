---
"@_linked/core": minor
---

### New: `.none()` collection quantifier

Added `.none()` on `QueryShapeSet` for filtering where no elements match a condition:

```typescript
// "People who have NO friends that play chess"
Person.select(p => p.name)
  .where(p => p.friends.none(f => f.hobby.equals('Chess')))
```

Generates `FILTER(NOT EXISTS { ... })` in SPARQL. Equivalent to `.some(fn).not()`.

### Changed: `.equals()` now returns `ExpressionNode` (was `Evaluation`)

`.equals()` on query proxies now returns `ExpressionNode` instead of `Evaluation`, enabling `.not()` chaining:

```typescript
// Now works — .equals() chains with .not()
.where(p => p.name.equals('Alice').not())
.where(p => Expr.not(p.name.equals('Alice')))
```

### Changed: `.some()` / `.every()` now return `ExistsCondition` (was `SetEvaluation`)

`.some()` and `.every()` on collections now return `ExistsCondition` which supports `.not()`:

```typescript
.where(p => p.friends.some(f => f.name.equals('Alice')).not()) // same as .none()
```

### Breaking: `Evaluation` class removed

The `Evaluation` class and related types (`SetEvaluation`, `WhereMethods`, `WhereEvaluationPath`) have been removed. Code that imported or depended on these types must migrate to `ExpressionNode` / `ExistsCondition`. The `WhereClause` type now accepts `ExpressionNode | ExistsCondition | callback`.

### New exports

- `ExistsCondition` — from `@_linked/core/expressions/ExpressionNode`
- `isExistsCondition()` — type guard for ExistsCondition
