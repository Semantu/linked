---
summary: Design utilities for dynamically building IR queries — variable shapes, variable property paths, shared path endpoints, and programmatic query construction.
packages: [core]
---

# Dynamic IR Construction

## Status: design (expanded from placeholder)

## Problem

The Shape DSL (e.g. `Person.select(p => [p.name, p.friends.name])`) is ergonomic for static, compile-time queries. But a CMS (or any data-driven UI) needs to build queries **at runtime**: the user picks which shape to query, which properties to include, possibly chains like `person.friends.name`, all from configuration or UI state. Today the only way to do this is to construct raw IR objects by hand — verbose, error-prone, and requires deep knowledge of the IR types.

We need a **public, dynamic query-building API** that sits between the static DSL and the raw IR.

---

## Architecture Recap

The current pipeline looks like:

```
Shape DSL (proxy tracing)
    ↓  produces RawSelectInput (select/where/sortBy paths)
IRDesugar
    ↓  DesugaredSelectQuery
IRCanonicalize
    ↓  CanonicalDesugaredSelectQuery
IRLower
    ↓  IRSelectQuery (final IR)
buildSelectQuery()  ←  IRPipeline.ts orchestrates the above
    ↓
irToAlgebra → algebraToString → SPARQL
```

The `SelectQueryFactory` wraps the proxy-tracing DSL and calls `buildSelectQuery(rawInput)`. But `buildSelectQuery` also accepts a pre-built `IRSelectQuery` directly (pass-through). That's two possible injection points.

---

## Proposals

### Option A: Low-level IR Builder (direct IR construction)

Expose helper functions that produce `IRSelectQuery` objects directly. No proxy tracing, no desugar/canonicalize/lower — you build the final IR yourself with helpers that reduce boilerplate.

```ts
import { ir } from 'lincd/queries';

const query = ir.select({
  root: ir.shapeScan(PersonShape),            // → IRShapeScanPattern
  patterns: [
    ir.traverse('a0', 'a1', namePropertyShape),  // → IRTraversePattern
    ir.traverse('a0', 'a2', friendsPropertyShape),
    ir.traverse('a2', 'a3', namePropertyShape),
  ],
  projection: [
    ir.project('name', ir.prop('a1', namePropertyShape)),
    ir.project('friendName', ir.prop('a3', namePropertyShape)),
  ],
  limit: 10,
});

// query is a valid IRSelectQuery — pass to store directly
const results = await store.selectQuery(query);
```

**Pros:** Full control. No magic. Easily serializable. Works for any query the IR supports (including future MINUS, CONSTRUCT, etc.).

**Cons:** Verbose. Alias management is manual. Feels like writing assembly. No type inference on results.

**Best for:** Migration scripts, code generators, admin tooling, advanced one-offs.

---

### Option B: Mid-level Query Builder (fluent chain API)

A builder that knows about shapes and property shapes, auto-manages aliases, and produces IR via the existing pipeline. This is the "one layer up" from raw IR — it uses `NodeShape` / `PropertyShape` objects but doesn't require a Shape class or proxy tracing.

```ts
import { QueryBuilder } from 'lincd/queries';

const results = await QueryBuilder
  .from(PersonShape)                     // root shape scan
  .select(p => [                         // p is a dynamic path builder
    p.prop(namePropertyShape),           // select name
    p.prop(friendsPropertyShape)         // traverse to friends
     .prop(namePropertyShape),           //   then select their name
  ])
  .where(p =>
    p.prop(agePropertyShape).gte(18)
  )
  .limit(10)
  .exec();
```

Under the hood, `.from(PersonShape)` creates a root context. `.prop(propertyShape)` appends a step. The builder produces a `RawSelectInput`-equivalent and feeds it through `buildSelectQuery()`.

**Pros:** Familiar fluent pattern. Shape-aware (validates property belongs to shape). Auto-alias management. Can leverage existing pipeline passes. Mid-complexity.

**Cons:** New API surface. Need to design the chain types carefully. Result types would be `ResultRow[]` (no static type inference unless we layer generics).

**Best for:** CMS-style dynamic queries where you know the shapes at runtime.

---

### Option C: "Dynamic DSL" — runtime shape + property path resolution

Keep the existing DSL patterns but accept string-based or reference-based shape/property lookups. The API looks almost identical to the static DSL but everything is resolved at runtime.

```ts
import { DynamicQuery } from 'lincd/queries';

// By shape + property shape references (most reliable)
const results = await DynamicQuery
  .shape(PersonShape)
  .select([
    namePropertyShape,                                // simple property
    [friendsPropertyShape, namePropertyShape],        // chained path: friends.name
    { hobby: [hobbiesPropertyShape, labelPropertyShape] }, // aliased path
  ])
  .where(agePropertyShape, '>=', 18)
  .limit(10)
  .exec();

// Or by string labels (convenient, resolves via shape metadata)
const results = await DynamicQuery
  .shape('Person')
  .select(['name', 'friends.name', { hobby: 'hobbies.label' }])
  .where('age', '>=', 18)
  .exec();
```

Internally this would:
1. Resolve shape name → `NodeShape`
2. Parse property paths (string or reference arrays) → walk `NodeShape.properties` to find each `PropertyShape`
3. Build a `RawSelectInput` from the resolved paths
4. Feed into `buildSelectQuery()`

**Pros:** Extremely CMS-friendly. Accepts strings (for config files, URL params, user input). Path chains are intuitive (`'friends.name'`). Minimal API surface.

**Cons:** String resolution adds a lookup cost and error surface. No compile-time type safety (result is `ResultRow[]`). Need to handle ambiguous/missing property names.

**Best for:** Config-driven CMS queries, REST/GraphQL endpoint generation, admin UIs.

---

### Option D: Hybrid — Extend `SelectQueryFactory` to accept dynamic inputs

Instead of a new API, extend the existing `SelectQueryFactory` to accept property shapes directly, bypassing proxy tracing. The factory already has all the machinery (`toRawInput()`, `build()`, `exec()`).

```ts
import { Shape } from 'lincd';

// New static method on Shape — mirrors .select() but with explicit property shapes
const results = await Shape.dynamicSelect(PersonShape, {
  select: [
    namePropertyShape,
    [friendsPropertyShape, namePropertyShape],
  ],
  where: {
    property: agePropertyShape,
    operator: '>=',
    value: 18,
  },
  limit: 10,
});

// Or: use the existing factory with a new input mode
const factory = new SelectQueryFactory(PersonShape);
factory.addSelection(namePropertyShape);
factory.addSelection([friendsPropertyShape, namePropertyShape]);
factory.setWhereClause(agePropertyShape, '>=', 18);
factory.setLimit(10);
const results = await factory.exec();
```

**Pros:** Reuses existing `SelectQueryFactory` infrastructure. Minimal new code. Familiar patterns.

**Cons:** `SelectQueryFactory` is already complex (1800+ lines). Adding more modes increases complexity. May conflict with proxy-based initialization.

**Best for:** Incremental adoption. Keeps everything in one place.

---

### Option E: Composable Path Objects (standalone, composable, reusable)

Define a `PropertyPath` value object that can be composed, stored, and reused. Queries are built by combining paths.

```ts
import { path, select } from 'lincd/queries';

// Define reusable paths
const name = path(PersonShape, namePropertyShape);
const friendsName = path(PersonShape, friendsPropertyShape, namePropertyShape);
const age = path(PersonShape, agePropertyShape);

// Compose into a query
const query = select(PersonShape)
  .fields(name, friendsName)
  .where(age.gte(18))
  .limit(10);

const results = await query.exec();

// Paths are reusable across queries
const otherQuery = select(PersonShape)
  .fields(name)
  .where(friendsName.equals('Alice'));
```

**Pros:** Maximally composable. Paths are first-class values — store them, pass them around, derive from them. Good for CMS schemas where paths are defined in config.

**Cons:** New concept (path objects). Need to design path composition carefully (what happens when you extend a path from one shape into another?).

**Best for:** Schema-driven systems where field selections are defined as data.

---

## Comparison Matrix

| Concern | A (Raw IR) | B (Fluent Builder) | C (Dynamic DSL) | D (Extend Factory) | E (Path Objects) |
|---|---|---|---|---|---|
| Verbosity | High | Medium | Low | Medium | Low |
| Type safety | None | Partial | None | Partial | Partial |
| Learning curve | Steep | Medium | Low | Low | Medium |
| CMS friendliness | Low | High | Highest | Medium | High |
| String-based input | No | No | Yes | No | No |
| Composability | Manual | Chain only | Limited | Chain only | Excellent |
| New API surface | Small (helpers) | Medium (new class) | Medium (new class) | Small (extends existing) | Medium (new types) |
| Reuses pipeline | No (bypass) | Yes | Yes | Yes | Yes |
| Mutation support | Separate | Could extend | Could extend | Could extend | Separate |

---

## Recommendation for CMS

For a CMS, **Option C (Dynamic DSL)** is the fastest path to productivity:
- You already have `NodeShape` / `PropertyShape` metadata at runtime
- String paths like `'friends.name'` map naturally to CMS field configs
- The implementation can resolve strings via existing `getPropertyShapeByLabel()`
- Feeds directly into the existing pipeline — minimal new code

**Option B (Fluent Builder)** is the best long-term investment:
- Clean separation of concerns
- Works well as the backbone that Option C delegates to
- Can be extended for mutations (create/update builders)

**Suggested approach: B + C layered.** Build the fluent builder (B) first as the core engine. Then add the string-resolving convenience layer (C) on top. Option A (raw IR helpers) is useful too but can come later as a power-user escape hatch.

---

## Detailed Design Sketch: Option B + C

### Core: `QueryBuilder` class

```ts
// New file: src/queries/QueryBuilder.ts

class PropertyPath {
  constructor(
    public readonly steps: PropertyShape[],
    public readonly rootShape: NodeShape,
  ) {}

  /** Extend this path with another property */
  prop(property: PropertyShape): PropertyPath {
    return new PropertyPath([...this.steps, property], this.rootShape);
  }

  // Where clause helpers — return WhereCondition objects
  equals(value: any): WhereCondition { ... }
  notEquals(value: any): WhereCondition { ... }
  gt(value: any): WhereCondition { ... }
  gte(value: any): WhereCondition { ... }
  lt(value: any): WhereCondition { ... }
  lte(value: any): WhereCondition { ... }
  some(predicate: (p: PathBuilder) => WhereCondition): WhereCondition { ... }
}

class PathBuilder {
  constructor(private rootShape: NodeShape) {}

  prop(property: PropertyShape): PropertyPath {
    return new PropertyPath([property], this.rootShape);
  }
}

type SelectionInput =
  | PropertyShape                           // single property
  | PropertyPath                            // chained path
  | PropertyShape[]                         // chained path (array form)
  | Record<string, PropertyShape | PropertyPath | PropertyShape[]>; // aliased

class QueryBuilder {
  private _shape: NodeShape;
  private _selections: SelectionInput[] = [];
  private _where: WhereCondition[] = [];
  private _limit?: number;
  private _offset?: number;
  private _orderBy?: { path: PropertyPath; direction: 'ASC' | 'DESC' };

  static from(shape: NodeShape): QueryBuilder {
    const qb = new QueryBuilder();
    qb._shape = shape;
    return qb;
  }

  select(fn: (p: PathBuilder) => SelectionInput[]): this;
  select(selections: SelectionInput[]): this;
  select(input: any): this {
    if (typeof input === 'function') {
      this._selections = input(new PathBuilder(this._shape));
    } else {
      this._selections = input;
    }
    return this;
  }

  where(fn: (p: PathBuilder) => WhereCondition): this;
  where(condition: WhereCondition): this;
  where(input: any): this {
    const condition = typeof input === 'function'
      ? input(new PathBuilder(this._shape))
      : input;
    this._where.push(condition);
    return this;
  }

  limit(n: number): this { this._limit = n; return this; }
  offset(n: number): this { this._offset = n; return this; }

  /** Build to IR via the existing pipeline */
  build(): IRSelectQuery {
    const rawInput = this.toRawInput(); // convert selections/where to RawSelectInput
    return buildSelectQuery(rawInput);
  }

  async exec(): Promise<ResultRow[]> {
    return getQueryDispatch().selectQuery(this.build());
  }
}
```

### Convenience layer: string resolution (Option C on top)

```ts
// Extends QueryBuilder with string-based input

class DynamicQuery {
  static shape(shape: NodeShape | string): DynamicQueryBuilder { ... }
}

class DynamicQueryBuilder extends QueryBuilder {
  select(paths: (string | string[] | Record<string, string>)[]): this {
    // resolve 'friends.name' → [friendsPropertyShape, namePropertyShape]
    // via walkPropertyPath(this._shape, 'friends.name')
    const resolved = paths.map(p => this.resolvePath(p));
    return super.select(resolved);
  }

  private resolvePath(input: string): PropertyPath {
    const parts = input.split('.');
    let currentShape = this._shape;
    const steps: PropertyShape[] = [];
    for (const part of parts) {
      const prop = getPropertyShapeByLabel(currentShape, part);
      if (!prop) throw new Error(`Property '${part}' not found on ${currentShape.label}`);
      steps.push(prop);
      if (prop.valueShape) {
        currentShape = prop.valueShape; // walk into nested shape
      }
    }
    return new PropertyPath(steps, this._shape);
  }
}
```

### Key internal bridge: `toRawInput()`

The `QueryBuilder` needs to produce a `RawSelectInput` that the existing pipeline can consume. The trick is that `RawSelectInput.select` expects `SelectPath` — which is `QueryPath[] | CustomQueryObject`. A `QueryPath` is an array of `QueryStep` objects, where each step has a `.property` (PropertyShape).

This means `QueryBuilder.toRawInput()` can produce the same structure directly:

```ts
// Inside QueryBuilder
private toRawInput(): RawSelectInput {
  const select: QueryPath[] = this._selections.map(sel => {
    const steps = this.selectionToSteps(sel);
    return steps.map(prop => ({ property: prop })); // QueryStep
  });

  return {
    select,
    shape: this._shape,
    limit: this._limit,
    offset: this._offset,
    singleResult: false,
    where: this._where.length ? this.buildWherePath() : undefined,
  };
}
```

This is the key insight: **we don't need to create new pipeline stages.** We produce the same `RawSelectInput` that proxy tracing produces, but we build it from explicit property shape references instead of proxy interception.

---

## Open Questions

1. **Result typing:** Dynamic queries can't infer result types statically. Should we provide a generic `ResultRow` type, or allow users to pass a type parameter (`QueryBuilder.from<MyResultType>(PersonShape)`)?

2. **Mutation builders:** Should `QueryBuilder` also support `.create()`, `.update()`, `.delete()` methods? The mutation IR (`IRCreateMutation`, etc.) is simpler — it might be easier to just expose the existing `buildCanonicalCreateMutationIR()` etc. directly.

3. **Validation:** Should the builder validate that property shapes actually belong to the root shape (or its traversed shapes)? This catches errors early but adds overhead.

4. **Where clause composition:** The static DSL uses proxy chaining for where clauses (`p.name.equals('John').and(p.age.gte(18))`). The builder needs a different pattern. Options:
   - Condition objects: `where(age.gte(18))` — simple and explicit
   - Nested callback: `where(p => p.prop(age).gte(18).and(p.prop(name).equals('John')))` — closer to DSL feel
   - Plain objects: `where({ property: age, operator: '>=', value: 18 })` — most serializable (good for CMS configs stored as JSON)

5. **Path reuse across queries:** If paths are first-class (Option E influence), they could be defined once in a CMS schema config and reused across list views, detail views, filters, etc.

---

## Implementation Plan

### Phase 1: Core builder (Option B)
- [ ] `PropertyPath` value object
- [ ] `PathBuilder` with `.prop()` and comparison methods
- [ ] `QueryBuilder` with `.from()`, `.select()`, `.where()`, `.limit()`, `.offset()`, `.build()`, `.exec()`
- [ ] Internal `toRawInput()` bridge to existing pipeline
- [ ] Tests: verify builder-produced IR matches DSL-produced IR for equivalent queries

### Phase 2: String resolution (Option C)
- [ ] `DynamicQuery` wrapper with string path resolution
- [ ] `walkPropertyPath(shape, 'friends.name')` utility
- [ ] Error handling for missing/ambiguous property names
- [ ] Tests: string-based queries produce correct IR

### Phase 3: Raw IR helpers (Option A)
- [ ] `ir.select()`, `ir.shapeScan()`, `ir.traverse()`, `ir.project()`, `ir.prop()` helpers
- [ ] Export from `lincd/queries`
- [ ] Tests: hand-built IR passes through pipeline correctly

### Phase 4: Mutation builders
- [ ] `MutationBuilder.create(shape).set(prop, value).exec()`
- [ ] `MutationBuilder.update(shape, id).set(prop, value).exec()`
- [ ] `MutationBuilder.delete(shape, ids).exec()`
