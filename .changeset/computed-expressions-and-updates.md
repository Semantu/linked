---
"@_linked/core": minor
---

Properties in `select()` and `update()` now support expressions — you can compute values dynamically instead of just reading or writing raw fields.

### What's new

- **Computed fields in queries** — chain expression methods on properties to derive new values: string manipulation (`.strlen()`, `.ucase()`, `.concat()`), arithmetic (`.plus()`, `.times()`, `.abs()`), date extraction (`.year()`, `.month()`, `.hours()`), and comparisons (`.gt()`, `.eq()`, `.contains()`).

  ```typescript
  await Person.select(p => ({
    name: p.name,
    nameLen: p.name.strlen(),
    ageInMonths: p.age.times(12),
  }));
  ```

- **Expression-based WHERE filters** — filter using computed conditions, not just equality checks. Works on queries, updates, and deletes.

  ```typescript
  await Person.select(p => p.name).where(p => p.name.strlen().gt(5));
  await Person.update({ verified: true }).where(p => p.age.gte(18));
  ```

- **Computed updates** — when updating data, calculate new values based on existing ones instead of providing static values. Pass a callback to `update()` to reference current field values.

  ```typescript
  await Person.update(p => ({ age: p.age.plus(1) })).for(entity);
  await Person.update(p => ({ label: p.firstName.concat(' ').concat(p.lastName) })).for(entity);
  ```

- **`Expr` module** — for expressions that don't start from a property, like the current timestamp, conditional logic, or coalescing nulls.

  ```typescript
  await Person.update({ lastSeen: Expr.now() }).for(entity);
  await Person.select(p => ({
    displayName: Expr.firstDefined(p.nickname, p.name),
  }));
  ```

Update expression callbacks are fully typed — `.plus()` only appears on number properties, `.strlen()` only on strings, etc.

### New exports

`ExpressionNode`, `Expr`, `ExpressionInput`, `PropertyRefMap`, `ExpressionUpdateProxy<S>`, `ExpressionUpdateResult<S>`, and per-type method interfaces (`NumericExpressionMethods`, `StringExpressionMethods`, `DateExpressionMethods`, `BooleanExpressionMethods`, `BaseExpressionMethods`).

See the [README](./README.md#computed-expressions) for the full method reference and more examples.
