---
"@_linked/core": minor
---

Add computed expressions and expression-based updates to the DSL.

**New exports:**

- **`ExpressionNode`** — fluent IR builder for computed expressions. Returned by property proxy methods; chainable left-to-right.
- **`Expr`** module — static builders for non-property-first expressions (`Expr.now()`, `Expr.ifThen()`, `Expr.firstDefined()`, `Expr.bound()`).
- **Type interfaces** — `NumericExpressionMethods`, `StringExpressionMethods`, `DateExpressionMethods`, `BooleanExpressionMethods`, `BaseExpressionMethods` describe available methods per property type.
- **`ExpressionUpdateProxy<S>`**, **`ExpressionUpdateResult<S>`** — fully-typed proxy types for expression-based update callbacks.

**Computed SELECT projections:**

Use expression methods directly on property proxies inside `select()`:

```typescript
const result = await Person.select(p => ({
  name: p.name,
  nameLen: p.name.strlen(),
  ageInMonths: p.age.times(12),
  greeting: p.name.concat(' is ').concat(p.age.str()).concat(' years old'),
}));
```

Available methods include: `.plus()`, `.minus()`, `.times()`, `.dividedBy()`, `.abs()`, `.ceil()`, `.floor()`, `.round()`, `.power()`, `.strlen()`, `.ucase()`, `.lcase()`, `.substr()`, `.concat()`, `.contains()`, `.startsWith()`, `.endsWith()`, `.replace()`, `.regex()`, `.str()`, `.year()`, `.month()`, `.day()`, `.hours()`, `.minutes()`, `.seconds()`, `.gt()`, `.gte()`, `.lt()`, `.lte()`, `.eq()`, `.neq()`, `.not()`, `.and()`, `.or()`, `.lang()`, `.datatype()`, `.isIRI()`, `.isBlank()`, `.isLiteral()`.

**Expression-based WHERE filters:**

```typescript
const adults = await Person.select(p => p.name)
  .where(p => p.age.gt(18));

const longNames = await Person.select(p => p.name)
  .where(p => p.name.strlen().gt(5));
```

Expression WHERE works in queries, updates (`.update(data).where(fn)`), and deletes (`.deleteWhere(fn)`).

**`Expr` module for standalone expressions:**

```typescript
await Person.update({ lastSeen: Expr.now() }).for(entity);

const result = await Person.select(p => ({
  name: p.name,
  displayName: Expr.firstDefined(p.nickname, p.name),
}));
```

**Expression-based mutations via callback:**

```typescript
// Increment age
await Person.update(p => ({ age: p.age.plus(1) })).for(entity);

// Mix literal values and expressions
await Person.update(p => ({
  age: p.age.plus(1),
  name: 'Updated Name',
})).for(entity);

// Reference related entity properties
await Person.update(p => ({
  bestFriendName: p.bestFriend.name.ucase(),
})).for(entity);
```

The callback receives a read-only proxy typed as `ExpressionUpdateProxy<S>` — expression methods are type-safe per property type (`.plus()` only on numbers, `.strlen()` only on strings, etc.).

See the [Computed expressions](./README.md#computed-expressions) and [Expression-based updates](./README.md#update) sections in the README for the full reference.
