---
summary: Unified WHERE pipeline on ExpressionNode, retired Evaluation class, added .none() collection quantifier
packages: [core]
---

# 013 — Negation and Evaluation Retirement

## What was built

Complete negation support for the query DSL, achieved by unifying all WHERE conditions on `ExpressionNode` and retiring the legacy `Evaluation` class. Added `.none()` collection quantifier.

### New user-facing API

```typescript
// .none() — "no elements match" (new)
Person.select(p => p.name)
  .where(p => p.friends.none(f => f.hobby.equals('Chess')))
// SPARQL: FILTER(!(EXISTS { ?a0 <friends> ?a1 . ?a1 <hobby> ?a1_hobby . FILTER(?a1_hobby = "Chess") }))

// .some().not() — equivalent to .none() (now works)
Person.select(p => p.name)
  .where(p => p.friends.some(f => f.hobby.equals('Chess')).not())

// .equals() chains with .and() / .or() / .not() (was Evaluation, now ExpressionNode)
Person.select(p => p.name)
  .where(p => p.name.equals('Alice').and(p.age.gt(18)).not())

// Expr.not() prefix (already existed, now works with all WHERE forms)
Person.select(p => p.name)
  .where(p => Expr.not(p.name.equals('Alice')))
```

### Key design decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Retire Evaluation, unify on ExpressionNode | ExpressionNode is already IR, works in both select and where, supports .not(). Evaluation added 4 pipeline stages to reach the same IR output. |
| 2 | .none() as first-class method + .some().not() | .none() reads naturally and parallels .some()/.every(). After ExpressionNode migration, .some().not() works for free. |
| 3 | Expr.not() and .not() suffice for general negation | No .whereNot() needed. Both prefix and postfix already exist. |
| 4 | Skip prefix f.age.not().gt() | Ambiguous scope, would need deferred negation. Use inverse operators or Expr.not() instead. |
| 5 | Keep .minus() alongside .none() | Different SPARQL semantics (MINUS vs NOT EXISTS). .minus() for simple exclusion, .none() for composable conditions. |

## Architecture

### Before: Two parallel WHERE paths

```
.equals() → Evaluation → WherePath → DesugaredWhereComparison → CanonicalWhere → IR
.eq()     → ExpressionNode (already IR) → passthrough → IR
```

### After: Single ExpressionNode path

```
.equals() / .eq() / .neq() → ExpressionNode → passthrough → IR
.some() / .every() / .none() → ExistsCondition → lowerExistsCondition → IRExistsExpression
```

### Pipeline changes

The desugar → canonicalize → lower pipeline was simplified:

- **IRDesugar**: `toWhere()` only handles `where_expression` and `where_exists_condition` (passthrough)
- **IRCanonicalize**: `canonicalizeWhere()` is now a passthrough — both types pass through unchanged
- **IRLower**: `lowerWhere()` handles two cases: ExpressionNode (resolve refs) and ExistsCondition (build IRExistsExpression)

### New types and functions

**ExpressionNode.ts:**
- `ExistsCondition` — represents EXISTS quantifier with `.and()` / `.or()` / `.not()` chaining, used by `.some()` / `.every()` / `.none()`
- `tracedAliasExpression(segmentIds)` — creates expression that resolves to an alias reference (for root shape equality, inline where)
- `resolveExpressionRefs` extended with `alias_expr` and `aggregate_expr` resolution

**SelectQuery.ts:**
- `toExpressionNode(qbo)` — bridges QueryBuilderObject → ExpressionNode by extracting property segments
- `findContextId(qbo)` — detects query context references by walking the QBO chain
- `InlineWhereProxy` — wrapper for inline `.where()` on primitives that produces alias expressions
- `'equals'` added to `EXPRESSION_METHODS` set for proxy interception
- `.none()` method on `QueryShapeSet`

**IRLower.ts:**
- `lowerExistsCondition()` — builds `IRExistsExpression` with traversal patterns from `ExistsCondition`

### Edge cases handled

| Case | Approach |
|------|----------|
| Root shape equality (`p.equals(entity)`) | `tracedAliasExpression([])` resolves to root alias |
| Inline where on primitives (`p.hobby.where(h => h.equals(...))`) | `InlineWhereProxy` produces alias expression for bound value |
| SetSize comparison (`p.friends.size().equals(2)`) | Builds `aggregate_expr(count, ...)` ExpressionNode directly |
| Context root (`getQueryContext('user')`) | Produces `reference_expr` with context IRI |
| Context property (`getQueryContext('user').name`) | Produces `context_property_expr` |

## Removed code (~550 lines)

- `Evaluation` class, `SetEvaluation` class
- `WhereMethods` enum, `WhereEvaluationPath`, `WhereAndOr`, `AndOrQueryToken` types
- `DesugaredWhereComparison`, `DesugaredWhereBoolean`, `DesugaredWhereArg`, `DesugaredEvaluationSelect` types
- `CanonicalWhereComparison`, `CanonicalWhereLogical`, `CanonicalWhereExists`, `CanonicalWhereNot` types
- `toWhereComparison()`, `toWhereArg()`, `toExists()`, `toComparison()`, `canonicalizeComparison()`, `flattenLogical()`, `isDesugaredWhere()`, `lowerWhereArg()` functions
- `isEvaluation()` from FieldSet, evaluation serialization from FieldSet JSON

## Test coverage

| Test file | What it covers | Count |
|-----------|---------------|-------|
| `ir-select-golden.test.ts` | IR structure for all query fixtures including whereNone | 69 tests |
| `sparql-select-golden.test.ts` | SPARQL output for all fixtures including whereNone | 84 tests |
| `sparql-algebra.test.ts` | Algebra conversion for some/every/where patterns | 20+ tests |
| `ir-canonicalize.test.ts` | Canonicalization passthrough for expression/exists | 6 tests |
| `ir-desugar.test.ts` | Desugaring of where clauses, selections | 25+ tests |
| `query-builder.test.ts` | QueryBuilder API including where chaining | 40+ tests |
| `query-builder.types.test.ts` | Type inference for negation features | 15 new compile-only tests |
| `expression-node.test.ts` | ExpressionNode methods | existing tests |

**Total: 929 passing tests** (3 Fuseki integration suites skipped — need Docker)

### Type inference tests added

- `.equals()` returns chainable type in where (chains with .and()/.or()/.not())
- `.equals()` in select() infers boolean result
- `.neq()` / `.notEquals()` accepted in where
- `.some()` / `.every()` / `.none()` accepted in where
- `.some().and()` chains with ExpressionNode
- `.some().not()` accepted in where
- `.none().and()` chains correctly
- `Expr.not()` accepted in where
- `.size().equals()` accepted in where
- `.none()` preserves select result type

## Known limitations

- The empty `Evaluation` class stub was removed. External code importing `Evaluation` will break (unlikely — it was internal).
- `ExpressionNode → boolean` type mapping uses structural check `{readonly ir: {kind: string}; readonly _refs: ReadonlyMap<string, any>}` to avoid false matches. This is precise but fragile — if ExpressionNode's shape changes, the type mapping may need updating.
- `.none()` generates `FILTER(!(EXISTS {...}))` which is semantically correct but some SPARQL engines may optimize `FILTER NOT EXISTS` differently than `FILTER(!(EXISTS ...))`.

## Deferred work

- Full aggregation DSL (sum/avg/min/max/groupBy) — see `docs/ideas/016-aggregations.md`
- Upsert — see `docs/ideas/017-upsert.md`
- Transactions — see `docs/ideas/018-transactions.md`
- Multi-column sorting — see `docs/ideas/019-multi-column-sorting.md`
- Distinct control — see `docs/ideas/020-distinct.md`
- Computed properties on shapes — see `docs/ideas/021-computed-properties.md`
