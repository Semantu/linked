---
'@_linked/core': major
---

## Breaking Changes

### `Shape.select()` and `Shape.update()` no longer accept an ID as the first argument

Use `.for(id)` to target a specific entity instead.

**Select:**
```typescript
// Before
const result = await Person.select({id: '...'}, p => p.name);

// After
const result = await Person.select(p => p.name).for({id: '...'});
```

`.for(id)` unwraps the result type from array to single object, matching the old single-subject overload behavior.

**Update:**
```typescript
// Before
const result = await Person.update({id: '...'}, {name: 'Alice'});

// After
const result = await Person.update({name: 'Alice'}).for({id: '...'});
```

`Shape.selectAll(id)` also no longer accepts an id — use `Person.selectAll().for(id)`.

### `ShapeType` renamed to `ShapeConstructor`

The type alias for concrete Shape subclass constructors has been renamed. Update any imports or references:

```typescript
// Before
import type {ShapeType} from '@_linked/core/shapes/Shape';

// After
import type {ShapeConstructor} from '@_linked/core/shapes/Shape';
```

### `QueryString`, `QueryNumber`, `QueryBoolean`, `QueryDate` classes removed

These have been consolidated into a single generic `QueryPrimitive<T>` class. If you were using `instanceof` checks against these classes, use `instanceof QueryPrimitive` instead and check the value's type.

### Internal IR types removed

The following types and functions have been removed from `SelectQuery`. These were internal pipeline types — if you were using them for custom store integrations, the replacement is `FieldSetEntry[]` (available from `FieldSet`):

- Types: `SelectPath`, `QueryPath`, `CustomQueryObject`, `SubQueryPaths`, `ComponentQueryPath`
- Functions: `fieldSetToSelectPath()`, `entryToQueryPath()`
- Methods: `QueryBuilder.getQueryPaths()`, `BoundComponent.getComponentQueryPaths()`
- `RawSelectInput.select` field renamed to `RawSelectInput.entries` (type changed from `SelectPath` to `FieldSetEntry[]`)

### `getPackageShape()` return type is now nullable

Returns `ShapeConstructor | undefined` instead of `typeof Shape`. Code that didn't null-check the return value will now get TypeScript errors.

## New Features

### `.for(id)` and `.forAll(ids)` chaining

Consistent API for targeting entities across select and update operations:

```typescript
// Single entity (result is unwrapped, not an array)
await Person.select(p => p.name).for({id: '...'});
await Person.select(p => p.name).for('https://...');

// Multiple specific entities
await QueryBuilder.from(Person).select(p => p.name).forAll([{id: '...'}, {id: '...'}]);

// All instances (default — no .for() needed)
await Person.select(p => p.name);
```

### Dynamic Query Building with `QueryBuilder` and `FieldSet`

Build queries programmatically at runtime — for CMS dashboards, API endpoints, configurable reports. See the [Dynamic Query Building](./README.md#dynamic-query-building) section in the README for full documentation and examples.

Key capabilities:
- `QueryBuilder.from(Person)` or `QueryBuilder.from('https://schema.org/Person')` — fluent, chainable, immutable query construction
- `FieldSet.for(Person, ['name', 'knows'])` — composable field selections with `.add()`, `.remove()`, `.pick()`, `FieldSet.merge()`
- `FieldSet.all(Person, {depth: 2})` — select all decorated properties with optional depth
- JSON serialization: `query.toJSON()` / `QueryBuilder.fromJSON(json)` and `fieldSet.toJSON()` / `FieldSet.fromJSON(json)`
- All builders are `PromiseLike` — `await` them directly or call `.build()` to inspect the IR

### Mutation Builders

`CreateBuilder`, `UpdateBuilder`, and `DeleteBuilder` provide the programmatic equivalent of `Person.create()`, `Person.update()`, and `Person.delete()`, accepting Shape classes or shape IRI strings. See the [Mutation Builders](./README.md#mutation-builders) section in the README.

### `PropertyPath` exported

The `PropertyPath` value object is now a public export — a type-safe representation of a sequence of property traversals through a shape graph.

```typescript
import {PropertyPath, walkPropertyPath} from '@_linked/core';
```

### `ShapeConstructor<S>` type

New concrete constructor type for Shape subclasses. Eliminates ~30 `as any` casts across the codebase and provides better type safety at runtime boundaries (builder `.from()` methods, Shape static methods).
