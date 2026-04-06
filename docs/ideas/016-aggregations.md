---
summary: Expose sum/avg/min/max aggregate methods in DSL and explore explicit groupBy API
packages: [core]
---

# Aggregations — Ideation

## Context

Linked currently exposes only `.size()` (COUNT) as an aggregate in the DSL. The IR, SPARQL algebra, and serializer layers already support `sum`, `avg`, `min`, `max` — they're just not wired to the query surface.

### What exists today

**DSL layer** — `SelectQuery.ts`:
- `QueryShapeSet.size()` (line 1138) and `QueryPrimitiveSet.size()` (line 1511) return a `SetSize` object
- `SetSize` class (lines 1517–1549) builds a `SizeStep` with count metadata

**IR layer** — `IntermediateRepresentation.ts`:
- `IRAggregateExpression` (lines 177–181) already defines all five aggregate names:
  ```typescript
  type IRAggregateExpression = {
    kind: 'aggregate_expr';
    name: 'count' | 'sum' | 'avg' | 'min' | 'max';
    args: IRExpression[];
  };
  ```

**SPARQL algebra** — `SparqlAlgebra.ts`:
- `SparqlAggregateExpr` (lines 137–142) supports any aggregate name + `distinct` flag
- `SparqlSelectPlan` (lines 174–185) has `groupBy?: string[]`, `having?: SparqlExpression`, `aggregates?: SparqlAggregateBinding[]`

**IR → Algebra** — `irToAlgebra.ts`:
- Lines 423–500: projection handling detects aggregate expressions, builds aggregates array, infers GROUP BY from non-aggregate projected variables
- Lines 765–772: converts `aggregate_expr` IR nodes to `SparqlAggregateExpr`

**Serialization** — `algebraToString.ts`:
- Lines 134–140: serializes `count(...)`, `sum(...)`, etc. with optional DISTINCT prefix
- Lines 292–298: serializes GROUP BY clause

**Existing idea doc** — `docs/ideas/012-aggregate-group-filtering.md`:
- Discusses HAVING semantics and whether `.groupBy()` should be public or remain implicit
- Proposes `count().where(c => c.gt(10))` as aggregate-local filtering syntax

**Pipeline flow for `.size()`:**
```
DSL: p.friends.size()
  → FieldSetEntry { path: ['friends'], aggregation: 'count' }
  → DesugaredCountStep { kind: 'count_step', path: [...] }
  → IRProjectionItem { expression: { kind: 'aggregate_expr', name: 'count', args: [...] } }
  → SparqlAggregateExpr → "COUNT(?a0_friends)"
  → auto GROUP BY on non-aggregate variables
```

**Test coverage:**
- `query-fixtures.ts`: `countFriends`, `countNestedFriends`, `countLabel`, `countValue`, `countEquals`
- Golden SPARQL tests confirm `(count(?a0_friends) AS ?a1)` with `GROUP BY ?a0`

### How other libraries do it

**SQLAlchemy:**
```python
select(func.count(User.id), func.avg(User.balance)).group_by(User.name).having(func.count() > 5)
```

**Drizzle:**
```typescript
db.select({ count: count(), avg: avg(users.age) }).from(users).groupBy(users.name)
```

**Prisma:**
```typescript
prisma.user.groupBy({ by: ['role'], _count: true, _avg: { balance: true }, having: { balance: { _avg: { gt: 100 } } } })
```

## Goals

- Expose `sum`, `avg`, `min`, `max` in the DSL alongside existing `size()` (count)
- Decide whether to add explicit `.groupBy()` or keep implicit grouping
- Maintain type safety — aggregate results should infer as `number`
- Keep the fluent expression style consistent with the rest of the DSL

## Open Questions

- [ ] Should aggregate methods live on collections (`.friends.age.avg()`) or as standalone Expr functions (`Expr.avg(p.friends.age)`)?
- [ ] Should `.size()` be aliased to `.count()` for consistency with sum/avg/min/max naming?
- [ ] Should explicit `.groupBy()` be introduced, or should grouping remain implicit from aggregate usage?
- [ ] How should aggregates on scalar properties work (e.g., `p.age.avg()` across all persons vs `p.friends.age.avg()` per person)?
- [ ] Should DISTINCT aggregates be supported (e.g., `p.friends.hobby.countDistinct()`)?
- [ ] How does this interact with the HAVING semantics from idea 012?

## Decisions

| # | Decision | Chosen | Rationale |
|---|----------|--------|-----------|

## Notes

- The IR and SPARQL layers are ready — this is primarily a DSL surface + desugaring task
- The `FieldSetEntry.aggregation` field currently only accepts `'count'` — would need to expand to `'sum' | 'avg' | 'min' | 'max'`
- `SetSize` class pattern could be generalized to a `SetAggregate` class
- SPARQL natively supports all five aggregates: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, plus `GROUP_CONCAT` and `SAMPLE`
- Implicit GROUP BY (current behavior) keeps simple cases clean but may confuse when mixing aggregates with non-aggregate projections
