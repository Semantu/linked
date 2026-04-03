---
summary: Complete negation support — NOT operator, notEquals in WHERE, none() for collections
packages: [core]
---

# Negation — Ideation

## Context

Linked has partial negation support. The expression system has `neq()` / `notEquals()` / `.not()`, but there are gaps in how negation works through the query WHERE pipeline and on collections.

### What exists today

**Two code paths for WHERE conditions:**

1. **Evaluation path** (old) — `QueryPrimitive.equals()` returns an `Evaluation` object with `.and()` / `.or()` chaining. Goes through 4 pipeline stages: Evaluation → WherePath → DesugaredWhere → CanonicalWhere → IR. Used by `.equals()`, `.some()`, `.every()`.

2. **ExpressionNode path** (new) — `.eq()`, `.neq()`, `.gt()` etc. go through the expression proxy, return `ExpressionNode` containing IR directly. `processWhereClause()` detects ExpressionNode and passes it through as-is.

**Expression-level negation** — `ExpressionMethods.ts` (lines 6–15):
```typescript
interface BaseExpressionMethods {
  eq(v: ExpressionInput): ExpressionNode;
  equals(v: ExpressionInput): ExpressionNode;   // alias of eq
  neq(v: ExpressionInput): ExpressionNode;       // != comparison
  notEquals(v: ExpressionInput): ExpressionNode;  // alias of neq
  isDefined(): ExpressionNode;
  isNotDefined(): ExpressionNode;
}

interface BooleanExpressionMethods {
  and(expr: ExpressionInput): ExpressionNode;
  or(expr: ExpressionInput): ExpressionNode;
  not(): ExpressionNode;                          // boolean negation
}
```

**Query proxy** — `SelectQuery.ts` (lines 875–886):
- `EXPRESSION_METHODS` set includes: `'eq', 'neq', 'notEquals'`, `'not'`
- `.equals()` is **intentionally excluded** from `EXPRESSION_METHODS` — it falls through to `QueryPrimitive.equals()` which returns an `Evaluation`

**The asymmetry:**
- `.equals('x')` → `Evaluation` (old path, WHERE-only, has `.and()`/`.or()` but no `.not()`)
- `.eq('x')` → `ExpressionNode` (new path, works everywhere, has `.and()`/`.or()`/`.not()`)
- `.neq('x')` → `ExpressionNode` (new path)
- No `.notEquals()` equivalent of `.equals()` for WHERE conditions

**Collection-level:**
- `.some(fn)` exists — returns `SetEvaluation extends Evaluation` → canonicalizes to `EXISTS`
- `.every(fn)` exists — returns `SetEvaluation` → canonicalizes to `NOT EXISTS { ... NOT(...) }` (double negation)
- `.none(fn)` — **missing**
- `.minus(Shape | fn)` exists on QueryBuilder → `IRMinusPattern` → SPARQL `MINUS { ... }`

**IR support:**
- `IRExistsExpression` (lines 183–187) has `negated?: boolean` but nothing in the DSL produces it
- `IRNotExpression` wraps any expression in `NOT(...)`
- `IRMinusPattern` maps to SPARQL `MINUS`
- `IRBinaryExpression` with `!=` operator for inequality

**SPARQL negation constructs:**
- `FILTER(!(...))` — negate any filter expression
- `FILTER NOT EXISTS { ... }` — pattern-level negation
- `MINUS { ... }` — set difference
- `!=` — inequality

### How other libraries do it

**SQLAlchemy:**
```python
select(User).where(not_(User.name == 'Alice'))     # general NOT
select(User).where(User.name != 'Alice')            # != operator
select(User).where(~exists().where(Post.user_id == User.id))  # NOT EXISTS
```

**Drizzle:**
```typescript
db.select().from(users).where(not(eq(users.name, 'Alice')))
db.select().from(users).where(ne(users.name, 'Alice'))
db.select().from(users).where(notExists(subquery))
```

**Prisma:**
```typescript
prisma.user.findMany({ where: { NOT: { name: 'Alice' } } })
prisma.user.findMany({ where: { friends: { none: { hobby: 'Chess' } } } })
```

## Goals

- Complete the negation story: equality negation in WHERE, boolean NOT, collection none()
- Make negation feel consistent with existing positive patterns
- Map naturally to SPARQL's negation constructs

## Open Questions

- [x] Should WHERE-level negation be `p.name.notEquals('Alice')` (method on proxy) or `.where(p => Expr.not(p.name.equals('Alice')))` (wrapper)?
- [x] Should `.none()` be added to collection proxies (e.g., `p.friends.none(f => f.hobby.equals('Chess'))`)? What SPARQL does this map to?
- [x] Is the asymmetry between `.equals()` (Evaluation for WHERE) and `.neq()` (ExpressionNode) a problem? Should there be a unified approach?
- [x] Should `.where()` support a `.not()` modifier: `.where(p => p.name.equals('Alice')).not()` or `.whereNot(p => ...)`?
- [x] Should `IRExistsExpression.negated` be exposed through a DSL method?
- [x] How should `.none()` interact with `.every()` — is `none(fn)` equivalent to `every(x => not(fn(x)))`?
- [x] Should `.minus()` change or coexist with `.none()`?
- [x] Should prefix negation `f.age.not().gt(16)` be supported?

## Decisions

| # | Decision | Chosen | Rationale |
|---|----------|--------|-----------|
| 1 | Unify WHERE expression paths | **Retire Evaluation, use ExpressionNode for everything** (Option C) | ExpressionNode is already IR, works in both select and where, supports `.not()`, and is the more general/powerful path. Evaluation adds 4 pipeline stages to reach the same IR. `.some()` / `.every()` need to be migrated to return ExpressionNode. After migration: `equals` = `eq`, `notEquals` = `neq` — all synonyms, all return ExpressionNode. |
| 2 | Add `.none()` on collections | **Yes — `.none()` as first-class method, `.some().not()` also works** (Option C) | `.none()` reads naturally, parallels `.some()` / `.every()`, maps to `FILTER NOT EXISTS { ... }`. After ExpressionNode migration, `.some().not()` works for free as an alternative. `.none()` is sugar for `.some().not()`. |
| 3 | General NOT wrapper | **No new API needed** — `Expr.not()` prefix and `.not()` postfix both already exist | After ExpressionNode migration, every WHERE callback returns ExpressionNode, so `.not()` always works. `Expr.not(condition)` provides prefix style. `.whereNot()` is unnecessary surface. |
| 4 | Prefix `f.age.not().gt(16)` | **Skip** — use inverse operators or `Expr.not()` instead | `.not()` on a non-boolean value has no meaning; would require deferred negation or operator inversion. Ambiguous scope with chaining. Use `p.age.lte(16)`, `Expr.not(p.age.gt(16))`, or `p.age.gt(16).not()` instead. |
| 5 | `.minus()` vs `.none()` coexistence | **Keep both, document the difference** | Different SPARQL semantics: `MINUS` = set difference (usually faster for simple exclusion), `FILTER NOT EXISTS` = pattern test (more flexible, composes with `.and()`/`.or()`). Recommend `.minus()` for simple type/property exclusion, `.none()` / `Expr.not()` for condition-based filtering that needs composition. |

## Implementation Summary

### What changes

1. **Retire `Evaluation` class** — migrate `.equals()`, `.some()`, `.every()` to return `ExpressionNode`
   - Add `'equals'` to `EXPRESSION_METHODS` set so proxy intercepts it
   - Rewrite `.some()` / `.every()` on `QueryShapeSet` to produce `IRExistsExpression` directly
   - `processWhereClause()` only needs to handle ExpressionNode (simplifies)
   - Remove `Evaluation`, `SetEvaluation`, `WhereMethods` enum, `WhereEvaluationPath` type

2. **Add `.none()` on `QueryShapeSet`** — produces `IRExistsExpression` with wrapping `IRNotExpression`
   - Equivalent to `.some(fn).not()` but more readable

3. **Ensure `.not()` chains correctly** after `.and()` / `.or()` / `.some()` / `.every()`

### What doesn't change

- `ExpressionNode` and all expression methods (already correct)
- `Expr.not()` (already exists and works)
- `.minus()` on QueryBuilder (stays as-is, different semantics)
- IR types (`IRExistsExpression`, `IRNotExpression`, `IRMinusPattern`)
- SPARQL algebra and serialization layers

### Syntax after implementation

```typescript
// Equality negation — all equivalent:
.where(p => p.name.notEquals('Alice'))
.where(p => p.name.neq('Alice'))
.where(p => p.name.equals('Alice').not())
.where(p => Expr.not(p.name.equals('Alice')))

// Collection negation:
.where(p => p.friends.none(f => f.hobby.equals('Chess')))
.where(p => p.friends.some(f => f.hobby.equals('Chess')).not())

// General NOT:
.where(p => p.age.gt(18).and(p.name.equals('Alice')).not())
.where(p => Expr.not(p.age.gt(18).and(p.name.equals('Alice'))))

// Simple exclusion (unchanged):
Person.select(p => p.name).minus(Employee)
Person.select(p => p.name).minus(p => p.hobby.equals('Chess'))
```

## Notes

- **Performance guidance**: `MINUS` is generally faster for simple pattern exclusion (set operation). `FILTER NOT EXISTS` is more flexible but evaluates per-row. Modern SPARQL engines often optimize them to the same plan when semantically equivalent. Recommend `.minus()` for simple exclusion, `.none()` / `Expr.not()` for composable conditions.
- `.every(fn)` currently desugars to double negation: `NOT EXISTS { ... NOT(predicate) }`. After migration it becomes `none(x => fn(x).not())` semantically, but the IR/SPARQL output stays the same.
- The three quantifiers are all derivable: `.none(fn)` is the primitive, `.some(fn)` = `.none(fn).not()`, `.every(fn)` = `.none(x => fn(x).not())`
