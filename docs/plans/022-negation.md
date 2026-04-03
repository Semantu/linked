---
summary: Plan for complete negation support — retire Evaluation, unify on ExpressionNode, add .none()
packages: [core]
---

# 022 — Negation: Implementation Plan

## Chosen Route

Retire the `Evaluation` class and unify all WHERE conditions on `ExpressionNode`. Add `.none()` on collections. See `docs/ideas/022-negation.md` for all decisions.

## Architecture Decisions

### AD-1: ExpressionNode replaces Evaluation for all WHERE paths

**Current state:** Two parallel paths exist for WHERE conditions:
1. **Evaluation path** (old): `.equals()` → `Evaluation` → `WherePath` → `DesugaredWhereComparison` → `CanonicalWhereComparison` → IR
2. **ExpressionNode path** (new): `.eq()` → `ExpressionNode` (already IR) → passed through directly

**Target state:** Only the ExpressionNode path exists. All WHERE methods (`.equals()`, `.some()`, `.every()`, `.none()`) return `ExpressionNode`.

### AD-2: .some()/.every() produce IRExistsExpression directly

Currently `.some()`/`.every()` go through `SetEvaluation` → desugar → canonicalize → lower to produce `IRExistsExpression`/`IRNotExpression`. After migration, they build these IR nodes directly inside ExpressionNode, skipping 4 pipeline stages.

### AD-3: .none() is sugar for .some().not()

`.none(fn)` on `QueryShapeSet` returns the same ExpressionNode as `.some(fn).not()` — an `IRNotExpression` wrapping `IRExistsExpression`.

## Expected File Changes

### Core changes (4 files):

| File | Change | Risk |
|------|--------|------|
| `src/queries/SelectQuery.ts` | Add `'equals'` to `EXPRESSION_METHODS`. Rewrite `.some()`/`.every()`/`.none()` on `QueryShapeSet` to return `ExpressionNode`. Remove `Evaluation`, `SetEvaluation`, `WhereMethods` enum, `WhereEvaluationPath`, `WhereAndOr`, `AndOrQueryToken`. Simplify `processWhereClause()`. | **High** — most changes, most test impact |
| `src/queries/IRDesugar.ts` | Remove `DesugaredWhereComparison`, `toWhereComparison()`, `toWhereArg()`, and the `where_comparison` / `where_boolean` handling from `toWhere()`. Only `DesugaredExpressionWhere` remains. | Medium |
| `src/queries/IRCanonicalize.ts` | Remove `CanonicalWhereComparison`, `CanonicalWhereExists`, `CanonicalWhereNot`, `CanonicalWhereLogical`, `toExists()`, `toComparison()`, `canonicalizeComparison()`, `flattenLogical()`. Expression WHERE passes through unchanged. | Medium |
| `src/queries/IRLower.ts` | Remove `where_binary`, `where_exists`, `where_not`, `where_logical` cases from `lowerWhere()`. Expression WHERE (which is already IR) passes through unchanged. | Medium |

### Supporting changes (3 files):

| File | Change | Risk |
|------|--------|------|
| `src/queries/WhereCondition.ts` | Remove `WhereOperator` if it references `WhereMethods` | Low |
| `src/queries/QueryBuilder.ts` | Update `.where()` / `.minus()` to only accept ExpressionNode-returning callbacks | Low |
| `src/expressions/ExpressionNode.ts` | Add static factory for EXISTS expression (used by `.some()`/`.every()`/`.none()`) | Low |

### Test changes (~10 files):

All tests that use `.equals()` in WHERE context continue to work unchanged (`.equals()` now goes through expression proxy, returns ExpressionNode, but the WHERE callback still returns it and `processWhereClause` still accepts it).

Tests that directly construct `Evaluation` objects or assert on `WhereEvaluationPath` types need updating:
- `src/tests/ir-desugar.test.ts` — update desugaring assertions
- `src/tests/ir-canonicalize.test.ts` — update or remove canonicalization tests
- `src/tests/core-utils.test.ts` — update if it constructs Evaluation directly
- `src/test-helpers/query-fixtures.ts` — no changes needed (DSL calls stay the same)

### Files NOT changing:

- `src/queries/IntermediateRepresentation.ts` — IR types stay the same
- `src/sparql/irToAlgebra.ts` — already handles `exists_expr` and `not_expr`
- `src/sparql/algebraToString.ts` — already serializes EXISTS/NOT EXISTS
- `src/sparql/SparqlStore.ts` — store interface unchanged
- `src/expressions/ExpressionMethods.ts` — interfaces already have all needed methods

## Pitfalls

1. **`.equals()` proxy interception order**: Adding `'equals'` to `EXPRESSION_METHODS` means the proxy intercepts it before `QueryPrimitive.equals()`. This changes the return type from `Evaluation` to `ExpressionNode`. Any code that calls `.getWherePath()` on the result will break — that's the point, but we need to catch all call sites.

2. **`.some()`/`.every()` chaining with `.and()`/`.or()`**: Currently `Evaluation.and()` calls `processWhereClause()` recursively. The ExpressionNode `.and()` takes an `ExpressionInput` directly. The chaining pattern `p.friends.some(f => f.name.equals('Jinx')).and(p.name.equals('Semmy'))` must still work — ExpressionNode `.and()` accepts ExpressionNode, so this works if the `.and()` argument also returns ExpressionNode (which it will after `.equals()` migration).

3. **Implicit `.some()` via nested path equality**: `p.friends.name.equals('Moa')` currently triggers implicit SOME behavior. This goes through the Evaluation path. After migration, this needs to still produce EXISTS semantics. The expression proxy on `QueryPrimitiveSet` handles this — need to verify the traced expression includes the collection traversal.

4. **`QueryShape.equals()` for reference comparison**: `p.bestFriend.equals({id: '...'})` compares a shape reference. After proxy interception, `.equals({id: '...'})` goes to ExpressionNode.eq() which creates `binary_expr` with `=`. Need to verify this handles `NodeReferenceValue` args correctly (it should — ExpressionNode.eq() accepts `ExpressionInput` which includes plain values).

5. **Test golden files**: IR golden tests (`ir-select-golden.test.ts`) compare exact IR output. The IR for `.equals()` WHERE should be identical (same `binary_expr` with `=`), but the pipeline path changes. Golden tests should pass if the IR output is the same.

## Contracts

### ExpressionNode factory for EXISTS

```typescript
// New static method on ExpressionNode or in Expr module
static exists(
  collectionPath: readonly string[],  // property shape IDs for the traversal
  predicate: ExpressionNode,          // the inner condition
): ExpressionNode
// Returns ExpressionNode wrapping IRExistsExpression
```

### .some()/.every()/.none() return type change

```typescript
// Before:
some(validation: WhereClause<S>): SetEvaluation
every(validation: WhereClause<S>): SetEvaluation

// After:
some(validation: WhereClause<S>): ExpressionNode
every(validation: WhereClause<S>): ExpressionNode
none(validation: WhereClause<S>): ExpressionNode
```

### processWhereClause() simplified

```typescript
// Before: accepts Evaluation | ExpressionNode | Function
// After: accepts ExpressionNode | Function (returns ExpressionNode)
export const processWhereClause = (
  validation: WhereClause<any>,
  shape?,
): ExpressionNode => { ... }
```

## Phases

### Phase 1: Migrate `.equals()` to ExpressionNode path

**Changes:**
- Add `'equals'` to `EXPRESSION_METHODS` set in `SelectQuery.ts:875`
- Verify `QueryPrimitive.equals()` is no longer called by the proxy (proxy intercepts first)
- Update `processWhereClause()` to handle ExpressionNode-only returns from callbacks
- Keep `Evaluation` class alive temporarily for `.some()`/`.every()` internals

**Validation:**
- All existing `.equals()` WHERE tests pass with identical IR/SPARQL output
- `npm test` passes
- Golden IR tests produce same output

### Phase 2: Migrate `.some()`/`.every()` to ExpressionNode

**Changes:**
- Add EXISTS expression factory to `ExpressionNode` (or `Expr` module)
- Rewrite `QueryShapeSet.some()` to build `IRExistsExpression` via ExpressionNode
- Rewrite `QueryShapeSet.every()` to build `IRNotExpression(IRExistsExpression(... IRNotExpression(predicate)))` via ExpressionNode
- The inner predicate comes from executing the validation callback against a proxy — same as today but returns ExpressionNode
- Verify `.and()`/`.or()` chaining still works (ExpressionNode.and() accepts ExpressionInput)

**Validation:**
- `whereSomeExplicit`, `whereEvery`, `whereSequences` fixtures produce identical IR/SPARQL
- `npm test` passes

### Phase 3: Add `.none()` on `QueryShapeSet`

**Changes:**
- Add `none(validation: WhereClause<S>): ExpressionNode` on `QueryShapeSet`
- Implementation: `return this.some(validation).not()`
- Add test fixtures and tests for `.none()`

**Validation:**
- `.none(fn)` produces `FILTER NOT EXISTS { ... }` in SPARQL
- `.none(fn)` and `.some(fn).not()` produce identical IR
- `npm test` passes

### Phase 4: Remove Evaluation class and old WHERE infrastructure

**Changes:**
- Remove from `SelectQuery.ts`: `Evaluation`, `SetEvaluation`, `WhereMethods` enum, `WhereEvaluationPath`, `WhereAndOr`, `AndOrQueryToken`, `isWhereEvaluationPath()`
- Remove from `IRDesugar.ts`: `DesugaredWhereComparison`, `DesugaredWhereBoolean`, `toWhereComparison()`, `toWhereArg()`, the `where_comparison`/`where_boolean` branches in `toWhere()`
- Remove from `IRCanonicalize.ts`: `CanonicalWhereComparison`, `CanonicalWhereLogical`, `CanonicalWhereExists`, `CanonicalWhereNot`, `toExists()`, `toComparison()`, `canonicalizeComparison()`, `flattenLogical()`
- Remove from `IRLower.ts`: `where_binary`, `where_exists`, `where_not`, `where_logical` cases in `lowerWhere()`
- Simplify `processWhereClause()` to only handle ExpressionNode
- Update any remaining imports/references
- Update tests that directly reference removed types

**Validation:**
- `npm test` passes — all tests green
- No references to `Evaluation`, `SetEvaluation`, `WhereMethods` remain in non-test code
- IR/SPARQL output unchanged for all query fixtures

### Dependency graph

```
Phase 1 ──→ Phase 2 ──→ Phase 3
                  │
                  └──→ Phase 4
```

Phase 3 and Phase 4 are independent of each other (both depend on Phase 2). Can be done in either order, but Phase 4 after Phase 3 is cleaner since we can remove everything at once.
