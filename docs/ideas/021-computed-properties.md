---
summary: Reusable expression fragments defined on Shape classes (computed/derived properties)
packages: [core]
---

# Computed Properties — Ideation

## Context

Linked has a powerful expression system for computed values in queries, but there's no way to define reusable computed properties on a Shape class. Every query must inline its expressions. SQLAlchemy solves this with `hybrid_property` — a property that works both in Python and in SQL queries.

### What exists today

**Inline computed fields in queries:**
```typescript
const result = await Person.select(p => ({
  fullName: p.firstName.concat(' ', p.lastName),
  ageInMonths: p.age.times(12),
  isAdult: p.age.gte(18),
}));
```
These work but are not reusable — every query must repeat the expression.

**Decorator system** — `SHACL.ts`:
- `@literalProperty()` / `@objectProperty()` decorators register PropertyShapes (lines 729–750)
- `createPropertyShape()` (lines 577–661) handles registration with the class hierarchy
- Properties are resolved via `getPropertyShapeByLabel()` during query proxy interception

**Query proxy** — `SelectQuery.ts` (lines 1237–1279):
- `proxifyQueryShape()` intercepts property access
- Looks up PropertyShape by label → returns `QueryBuilderObject` with expression proxy
- Expression methods (`.concat()`, `.plus()`, etc.) create traced `ExpressionNode` objects

**Expression nodes** — `ExpressionNode.ts`:
- `tracedPropertyExpression()` (lines 372–384) creates IR placeholder with property reference map
- `resolveExpressionRefs()` (lines 391–433) resolves placeholders during IR lowering
- All expression methods return new ExpressionNode instances (immutable, composable)

**FieldSet integration** — `FieldSet.ts`:
- `FieldSetEntry` (line 70) has `expressionNode?: ExpressionNode` for computed values
- Detection at lines 596–602: if proxy result is ExpressionNode, capture it as computed field

**Reusable expressions (current workaround):**
```typescript
// Works, but not attached to the Shape
const fullName = (p: any) => p.firstName.concat(' ', p.lastName);

const result = await Person.select(p => ({ fullName: fullName(p) }));
const filtered = await Person.select(p => p.name).where(p => fullName(p).equals('Alice Smith'));
```

### How SQLAlchemy does it

```python
class User(Base):
    first_name: Mapped[str] = mapped_column(String(50))
    last_name: Mapped[str] = mapped_column(String(50))
    balance: Mapped[Decimal] = mapped_column(Numeric(10, 2))

    @hybrid_property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"   # Python-side

    @full_name.expression
    @classmethod
    def full_name(cls):
        return cls.first_name + " " + cls.last_name    # SQL-side

# Works in queries:
stmt = select(User).where(User.full_name == "Alice Smith")
stmt = select(User).order_by(User.full_name)
```

Key insight: the hybrid property has two implementations — one for in-memory objects, one for SQL expressions. Linked doesn't have in-memory object instances during queries, so we only need the expression side.

## Goals

- Define reusable computed properties on Shape classes
- Use them in `select()`, `where()`, `orderBy()` — anywhere expressions work
- Type-safe — computed property result type should be inferred
- Composable — computed properties should be usable in further expressions
- No runtime overhead for shapes that don't use computed properties

## Open Questions

- [ ] Should computed properties use a decorator (`@computedProperty()`) or a static field pattern?
- [ ] Should computed properties be accessible via the same proxy mechanism as regular properties (e.g., `p.fullName` in a query lambda)?
- [ ] How should TypeScript types work? Should computed properties appear in the Shape's type alongside regular properties?
- [ ] Should computed properties support parameters (like SQLAlchemy's `hybrid_method`)?
- [ ] Should computed properties be serializable in FieldSet/QueryBuilder JSON?
- [ ] Can computed properties reference other computed properties (composition)?

## Decisions

| # | Decision | Chosen | Rationale |
|---|----------|--------|-----------|

## Notes

- Since Linked doesn't instantiate Shape objects with live data during queries (it uses proxies), we only need the "expression side" of SQLAlchemy's hybrid pattern
- The simplest approach: a static method or property on the Shape class that returns an ExpressionNode when called with a query proxy
- The proxy handler (`proxifyQueryShape`) would need to check for computed properties after checking regular PropertyShapes
- Possible API designs:

  **Option A: Decorator**
  ```typescript
  @linkedShape
  class Person extends Shape {
    @literalProperty({ path: ex.firstName, maxCount: 1 })
    declare firstName: string;
    @literalProperty({ path: ex.lastName, maxCount: 1 })
    declare lastName: string;

    @computedProperty()
    static fullName = (p: Person) => p.firstName.concat(' ', p.lastName);
  }
  ```

  **Option B: Static getter with explicit registration**
  ```typescript
  @linkedShape
  class Person extends Shape {
    static computed = {
      fullName: (p: Person) => p.firstName.concat(' ', p.lastName),
      isAdult: (p: Person) => p.age.gte(18),
    };
  }
  ```

  **Option C: Method on Shape (no decorator)**
  ```typescript
  @linkedShape
  class Person extends Shape {
    static fullName = computedProperty((p: Person) => p.firstName.concat(' ', p.lastName));
  }
  ```

- None of the major SQL ORMs (Prisma, Drizzle, TypeORM) have this feature. SQLAlchemy's hybrid_property is one of its unique strengths. This would be a significant differentiator for Linked
- Computed properties could also power "default field sets" — `Person.selectAll()` could include computed properties
