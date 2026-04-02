---
summary: Complete negation support — NOT operator, notEquals in WHERE, none() for collections
packages: [core]
---

# Negation — Ideation

## Context

Linked has partial negation support. The expression system has `neq()` / `notEquals()` / `.not()`, but there are gaps in how negation works through the query WHERE pipeline and on collections.

### What exists today

**Expression-level negation** — `ExpressionMethods.ts` (lines 6–15):
```typescript
interface BaseExpressionMethods {
  eq(v: ExpressionInput): ExpressionNode;
  equals(v: ExpressionInput): ExpressionNode;   // alias of eq
  neq(v: ExpressionInput): ExpressionNode;       // != comparison
  notEquals(v: ExpressionInput): ExpressionNode;  // alias of neq
  isDefined(): ExpressionNode;
  isNotDefined(): ExpressionNode;
  // ...
}

interface BooleanExpressionMethods {
  and(expr: ExpressionInput): ExpressionNode;
  or(expr: ExpressionInput): ExpressionNode;
  not(): ExpressionNode;                          // boolean negation
}
```

**ExpressionNode implementation** — `ExpressionNode.ts`:
- `neq(v)` (line 157): creates `binary_expr` with `operator: '!='`
- `notEquals(v)` (line 160): alias for `neq()`
- `not()` (line — on BooleanExpressionMethods): creates `unary_expr` with `operator: '!'`

**Query proxy** — `SelectQuery.ts` (lines 875–886):
- `EXPRESSION_METHODS` set includes: `'eq', 'neq', 'notEquals'`, `'not'`
- These are available on property proxies in query lambdas

**BUT `.equals()` is special** — `SelectQuery.ts` (lines 893–894):
```
Note: `.equals()` is intentionally excluded — it's an existing QueryPrimitive
method that returns an Evaluation (for WHERE clauses). Use `.eq()` for the...
```
- `.equals()` on query proxies creates an `Evaluation` (WHERE condition), not an ExpressionNode
- `.neq()` / `.notEquals()` create ExpressionNodes (expression-level `!=`)
- There is **no `.notEquals()` equivalent of `.equals()`** for WHERE conditions

**Collection-level negation:**
- `.some(fn)` exists — matches if ANY element satisfies the condition
- `.every(fn)` exists — matches if ALL elements satisfy the condition
- `.none(fn)` does **NOT exist** — no way to say "no elements match"
- `.minus(Shape)` exists on QueryBuilder — excludes by type (SPARQL MINUS)
- `.minus(fn)` exists on QueryBuilder — excludes by condition pattern

**IR-level negation** — `IntermediateRepresentation.ts`:
- `IRMinusPattern` (defined) — used by `.minus()`, maps to SPARQL MINUS
- `IRExistsExpression` (lines 183–187) — defined but not exposed in DSL:
  ```typescript
  type IRExistsExpression = { kind: 'exists_expr'; pattern: IRPattern; negated?: boolean; };
  ```
  The `negated` flag would produce `NOT EXISTS` in SPARQL

**SPARQL support:**
- `FILTER(!(...))` — negate any filter expression
- `FILTER NOT EXISTS { ... }` — pattern-level negation
- `MINUS { ... }` — set difference (already used by `.minus()`)
- `!=` — inequality (already used by `neq()`)

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

- [ ] Should WHERE-level negation be `p.name.notEquals('Alice')` (method on proxy) or `.where(p => Expr.not(p.name.equals('Alice')))` (wrapper)?
- [ ] Should `.none()` be added to collection proxies (e.g., `p.friends.none(f => f.hobby.equals('Chess'))`)? What SPARQL does this map to?
- [ ] Is the asymmetry between `.equals()` (Evaluation for WHERE) and `.neq()` (ExpressionNode) a problem? Should there be a unified approach?
- [ ] Should `.where()` support a `.not()` modifier: `.where(p => p.name.equals('Alice')).not()` or `.whereNot(p => ...)`?
- [ ] Should `IRExistsExpression.negated` be exposed through a DSL method?
- [ ] How should `.none()` interact with `.every()` — is `none(fn)` equivalent to `every(x => not(fn(x)))`?

## Decisions

| # | Decision | Chosen | Rationale |
|---|----------|--------|-----------|

## Notes

- **The `.equals()` / `.neq()` asymmetry is the core issue.** `.equals()` on a query proxy returns an Evaluation (used in WHERE), but `.neq()` returns an ExpressionNode (used in expressions). These are different code paths. Either:
  1. Add a `.notEquals()` that returns an Evaluation (parallel to `.equals()`), or
  2. Make `.equals()` also return an ExpressionNode and unify the WHERE handling

- For `.none()`, the SPARQL mapping would be:
  ```sparql
  FILTER NOT EXISTS { ?person <knows> ?friend . ?friend <hobby> "Chess" }
  ```
  This uses `IRExistsExpression` with `negated: true`

- `.minus()` already handles type-based and pattern-based exclusion. `.none()` would add condition-based collection negation — different semantics (FILTER NOT EXISTS vs MINUS)

- Quick wins vs deeper changes:
  - **Quick**: Add `.none()` on collections using existing `IRExistsExpression` with `negated: true`
  - **Quick**: Add `.notEquals()` on query proxies returning Evaluation
  - **Deeper**: Unify `.equals()` / `.eq()` code paths so WHERE and expression negation are symmetric
