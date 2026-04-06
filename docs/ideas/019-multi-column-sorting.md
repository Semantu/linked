---
summary: Expose multi-column orderBy with per-column direction in the DSL
packages: [core]
---

# Multi-Column Sorting — Ideation

## Context

The IR, SPARQL algebra, and serializer already fully support multi-column ORDER BY. The gap is only in the DSL — the `orderBy()` method accepts a single callback + direction pair.

### What exists today

**DSL layer** — `QueryBuilder.ts` (lines 224–226):
```typescript
orderBy<OR>(fn: QueryBuildFn<S, OR>, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder<S, R, Result> {
  return this.clone({sortByFn: fn as any, sortDirection: direction});
}
```
Stores a single `sortByFn` + `sortDirection`. A second `.orderBy()` call overwrites the first.

**Callback evaluation** — `SelectQuery.ts` (lines 915–934):
- `evaluateSortCallback()` can extract **multiple paths** from one callback (if an array is returned)
- Returns `SortByPath = { paths: PropertyPath[], direction }`
- But all paths share the same direction

**IR layer** — `IntermediateRepresentation.ts` (lines 24, 38–41):
```typescript
type IRSelectQuery = { ...; orderBy?: IROrderByItem[]; };
type IROrderByItem = { expression: IRExpression; direction: IRDirection; };
```
`orderBy` is already an **array** with per-item direction.

**IR lowering** — `IRLower.ts` (lines 402–407):
- Maps each path to an `IROrderByItem` — but all get the same direction from `canonical.sortBy.direction`

**SPARQL algebra** — `SparqlAlgebra.ts` (lines 162–167):
```typescript
type SparqlOrderCondition = { expression: SparqlExpression; direction: 'ASC' | 'DESC'; };
type SparqlSelectPlan = { ...; orderBy?: SparqlOrderCondition[]; };
```

**Serialization** — `algebraToString.ts` (lines 292–298):
```typescript
const orderParts = plan.orderBy.map(cond => `${cond.direction}(${serializeExpression(cond.expression, collector)})`);
clauses.push(`ORDER BY ${orderParts.join(' ')}`);
```
Outputs `ORDER BY ASC(?a0_name) DESC(?a0)`.

**Test evidence** — `sparql-serialization.test.ts` (lines 630–654):
- Tests multi-condition ORDER BY with different directions per condition — passes

### How other libraries do it

**SQLAlchemy:**
```python
select(User).order_by(User.name.asc(), User.balance.desc().nulls_last())
```

**Drizzle:**
```typescript
db.select().from(users).orderBy(asc(users.name), desc(users.age))
```

**Prisma:**
```typescript
prisma.user.findMany({ orderBy: [{ name: 'asc' }, { age: 'desc' }] })
```

## Goals

- Allow multiple sort keys with independent directions per key
- Minimal API change — extend existing `.orderBy()` rather than replacing it
- Zero changes needed in IR, algebra, or serialization layers

## Open Questions

- [ ] Should the API use direction methods on expressions (`p.name.asc()`, `p.age.desc()`) or a different pattern?
- [ ] Should it accept an array callback (`orderBy(p => [p.name.asc(), p.age.desc()])`) or use chaining (`.orderBy(p => p.name, 'ASC').thenBy(p => p.age, 'DESC')`)?
- [ ] Should the existing single-field `orderBy(p => p.name, 'DESC')` syntax remain as a shorthand?
- [ ] Where do `.asc()` / `.desc()` methods live? On ExpressionNode? On the query proxy?

## Decisions

| # | Decision | Chosen | Rationale |
|---|----------|--------|-----------|

## Notes

- This is primarily a DSL + desugaring change. The IR through SPARQL layers already work
- The `DesugaredSortBy` type has `direction` at the top level (shared for all paths) — needs to move to per-path
- Implementation estimate: small — mainly `QueryBuilder.orderBy()` signature, `evaluateSortCallback()`, and `DesugaredSortBy` type
- SPARQL also supports `nulls_first` / `nulls_last` via vendor extensions but this isn't standardized
