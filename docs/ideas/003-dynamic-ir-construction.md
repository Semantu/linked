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

### Key architectural decision: DSL and QueryBuilder are the same system

The DSL (`Person.select(p => [p.name])`) is **syntactic sugar over QueryBuilder + FieldSet**. They share the same proxy PathBuilder, the same pipeline, and the same IR. The relationship:

```
DSL entry point                    Dynamic entry point
Person.select(p => [p.name])       QueryBuilder.from(PersonShape).setFields(p => [p.name])
         ↓ internally creates               ↓ same thing
         QueryBuilder + FieldSet
         ↓
         toRawInput() → RawSelectInput
         ↓
         buildSelectQuery() → IR → SPARQL
```

The proxy (`p`) is the **same PathBuilder** in both cases. In DSL callbacks and in QueryBuilder/FieldSet callbacks, you get the same proxy with the same methods. `.path('string')` is an escape hatch on the proxy for when the path comes from runtime data:

```ts
// These use the same proxy, same PathBuilder, same code:
Person.select(p => [p.name, p.hobbies.select(h => [h.label])])
FieldSet.for(PersonShape, p => [p.name, p.hobbies.select(h => [h.label])])
QueryBuilder.from(PersonShape).setFields(p => [p.name, p.hobbies.select(h => [h.label])])

// .path() is an escape hatch for dynamic strings — available on the same proxy:
Person.select(p => [p.name, p.path(dynamicField)])
FieldSet.for(PersonShape, p => [p.name, p.path(dynamicField)])
```

This means:
- **One proxy implementation** shared between DSL and dynamic builder
- Every DSL feature (`.select()` for sub-selection, `.where()` for scoped filters, `.as()` for bindings) works in QueryBuilder callbacks too
- String forms on QueryBuilder (`.setFields(['name'])`, `.where('age', '>', 18)`) are convenience shortcuts that produce the same internal structures

### Current DSL: `.select()` vs `.query()` — and the execution model

The DSL currently has two entry points:
- **`Person.select(p => ...)`** — executes immediately via `nextTick`, returns `PatchedQueryPromise` (a Promise with chainable `.where()`, `.limit()`, `.sortBy()`, `.one()` that mutate the underlying factory before the tick fires)
- **`Person.query(p => ...)`** — returns a `SelectQueryFactory` (deferred, not executed until `.build()` is called)

**Decided: PromiseLike execution model.** QueryBuilder implements `PromiseLike`. No more `nextTick` hack. The chain is evaluated synchronously (each method returns a new immutable builder), and execution happens only when `.then()` is called (which `await` does automatically):

```ts
class QueryBuilder implements PromiseLike<ResultRow[]> {
  then<T>(onFulfilled?, onRejected?): Promise<T> {
    return this.exec().then(onFulfilled, onRejected);
  }
}

// Await triggers execution (PromiseLike)
const result = await QueryBuilder.from(PersonShape).setFields(p => [p.name]).where(p => p.age.gt(18));

// Same thing via DSL sugar
const result = await Person.select(p => [p.name]).where(p => p.age.gt(18));

// Deferred — no await, just a builder
const builder = Person.query(p => [p.name]).where(p => p.age.gt(18));
const result = await builder;        // execute when ready
const result = await builder.exec(); // explicit alternative
```

This means:
- `Person.select(...)` returns a QueryBuilder (PromiseLike). Backward compatible — existing `await Person.select(...)` still works.
- `Person.query(...)` also returns a QueryBuilder. Both return the same type. `.query()` is just a signal of intent ("I'll execute this later").
- `.where()`, `.limit()`, etc. are immutable (return new builder), not mutable. Chaining works because JS evaluates the full chain before `await`.
- No more `nextTick`. No more mutable `PatchedQueryPromise`. Cleaner internals.
- `.exec()` is available for explicit execution without `await`.

**Open for discussion**: Should the DSL adopt the `.for(id)` chainable pattern instead of passing subjects as arguments?

```ts
// Current DSL
Person.select(id, p => [p.name])              // subject as first arg

// Proposed: chainable .for() — matches QueryBuilder
Person.select(p => [p.name]).for(id)           // chainable, same as QueryBuilder
Person.select(p => [p.name]).for([id1, id2])   // array of IDs
Person.query(p => [p.name]).for(id).exec()     // deferred

// Mutations too
Person.update({ age: 31 }).for(id)
Person.delete().for(id)
Person.delete().for([id1, id2])
```

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

**Suggested approach: B + C layered, with E-style composability baked into the core `FieldSet` primitive.**

Build the fluent builder (B) as the core engine. Layer the string-resolving convenience API (C) on top. But instead of treating composability as a separate concern (Option E), make it a first-class feature of the builder via **`FieldSet`** — a named, reusable, composable collection of selections that any query can use.

> **Note on method names:** Earlier conceptual sections (Options A–E) may use `.include()` as a placeholder. The decided naming is `.setFields()` / `.addFields()` / `.removeFields()` on QueryBuilder and `.set()` / `.add()` / `.remove()` / `.pick()` on FieldSet. The authoritative examples are in the CMS Surface Examples section.

Option A (raw IR helpers) can come later as a power-user escape hatch.

---

## Composability: Why, When, and How

### Shapes define structure. Selections define views.

SHACL shapes already give you composability of *structure* — `AddressShape` knows its properties, `PersonShape.address` points to `AddressShape`, and `NodeShape.getPropertyShapes(true)` walks the inheritance chain. But your CMS doesn't always want *all* properties of a shape. Different surfaces need different **views** of the same shape:

| CMS Surface | What it needs from PersonShape |
|---|---|
| **Table overview** | `name`, `email`, `address.city` (summary columns) |
| **Edit form** | All direct properties + nested address fields |
| **Person card component** | `name`, `avatar`, `address.city` (compact display) |
| **Person detail page** | Everything the card needs + `bio`, `age`, `friends.name`, `hobbies.label` |
| **NL chat: "people in Amsterdam"** | `name`, `email` + filter on `address.city` |
| **Drag-drop builder** | Union of whatever each dropped component needs |

The static DSL handles this fine — each component writes its own `Person.select(p => [...])`. But in a dynamic CMS, those selections aren't hardcoded. They come from:
- **Table column configs** (stored as data: `["name", "email", "address.city"]`)
- **Form field definitions** (derived from shape metadata at runtime)
- **Component data requirements** (each component declares what fields it needs)
- **LLM output** (the chat generates a field list + filter from a prompt)
- **User customization** (user adds/removes columns, reorders fields)

### The composability problem

Without a composable primitive, every surface builds its own flat field list. This leads to:

1. **Duplication** — The PersonCard needs `name + avatar + address.city`. The PersonDetail also needs those, plus more. If you change the card's fields, you have to remember to update the detail page too.

2. **No query merging** — In the drag-drop builder, a user drops a PersonCard and a HobbyList onto a page. Each component has its own query. Ideally the system merges them into one SPARQL query that fetches everything needed for both. Without a composable selection type, merging is ad-hoc.

3. **No incremental building** — The NL chat wants to start with "show people" (basic fields), then the user says "also show their hobbies" — you need to extend the selection, not rebuild it from scratch.

### Solution: `FieldSet` — a composable, reusable selection set

A `FieldSet` is a named collection of property paths rooted at a shape. It's the E-style path object idea, but designed as a *set of paths* rather than individual paths, because in practice you almost always want a group.

```ts
import { FieldSet } from 'lincd/queries';

// ── Define reusable field sets ──────────────────────────────────

// A concise summary of a person — used in cards, table rows, autocompletes
const personSummary = FieldSet.for(PersonShape, [
  'name',
  'email',
  'avatar',
]);

// Full address — used in forms, detail pages, map components
const fullAddress = FieldSet.for(AddressShape, [
  'street',
  'city',
  'postalCode',
  'country',
]);

// Person's address, using a nested FieldSet
const personAddress = FieldSet.for(PersonShape, {
  address: fullAddress,        // nest: person.address.{street, city, ...}
});

// Person card = summary + address city only
const personCard = FieldSet.for(PersonShape, [
  personSummary,               // include another FieldSet
  'address.city',              // plus one extra path
]);

// Person detail = card + more
const personDetail = FieldSet.for(PersonShape, [
  personCard,                  // everything the card needs
  'bio',
  'age',
  { friends: personSummary },  // friends, using the same summary view
  'hobbies.label',
]);
```

### CMS surface examples

#### 1. Table overview — columns as FieldSet

```ts
// Table config (could be stored as JSON, loaded from DB, or user-customized)
const tableColumns = FieldSet.for(PersonShape, [
  'name', 'email', 'address.city', 'friends.size',
]);

// Query is one line
const rows = await QueryBuilder
  .from(PersonShape)
  .include(tableColumns)
  .limit(50)
  .exec();

// User adds a column in the UI → extend the FieldSet
const extendedColumns = tableColumns.extend(['age']);
```

#### 2. Edit form — shape-derived FieldSet with `all()`

```ts
// Select ALL properties of the shape (walks getPropertyShapes(true))
const formFields = FieldSet.all(PersonShape);

// Or: all direct + expand nested shapes one level
const formFieldsExpanded = FieldSet.all(PersonShape, { depth: 2 });

// Use in an update query
const person = await QueryBuilder
  .from(PersonShape)
  .include(formFields)
  .one(personId)
  .exec();
```

#### 3. Drag-and-drop builder — merging component requirements

Each component declares its data requirements as a `FieldSet`. When the user drops components onto a page, the builder merges them.

```ts
// Component declarations (could be decorators, static props, or metadata)
const personCardFields = FieldSet.for(PersonShape, ['name', 'avatar', 'address.city']);
const hobbyListFields = FieldSet.for(PersonShape, ['hobbies.label', 'hobbies.description']);
const friendGraphFields = FieldSet.for(PersonShape, [
  'name',
  { friends: FieldSet.for(PersonShape, ['name', 'avatar']) },
]);

// User drops PersonCard + HobbyList onto a page
// Builder merges their field sets into one query
const merged = FieldSet.merge([personCardFields, hobbyListFields]);
// merged = ['name', 'avatar', 'address.city', 'hobbies.label', 'hobbies.description']

const results = await QueryBuilder
  .from(PersonShape)
  .include(merged)
  .exec();

// Each component receives the full result and picks what it needs —
// no over-fetching because we only selected the union of what's needed
```

#### 4. NL chat — incremental query building

```ts
// LLM generates initial query spec from "show me people in Amsterdam"
let fields = FieldSet.for(PersonShape, ['name', 'email']);
let query = QueryBuilder
  .from(PersonShape)
  .include(fields)
  .where('address.city', '=', 'Amsterdam');

let results = await query.exec();

// User: "also show their hobbies"
// LLM extends the existing field set
fields = fields.extend(['hobbies.label']);
results = await query.include(fields).exec();

// User: "only people over 30"
results = await query.where('age', '>', 30).exec();

// User: "show this as a detail view"
// Switch to a pre-defined field set
results = await query.include(personDetail).exec();
```

#### 5. Shape-level defaults — `shape.all()` / `shape.summary()`

Since shapes already know their properties, `FieldSet` can derive selections from shape metadata:

```ts
// All properties of a shape (direct + inherited)
FieldSet.all(PersonShape)
// → ['name', 'email', 'age', 'bio', 'avatar', 'address', 'friends', 'hobbies']

// All properties, expanding nested shapes to a given depth
FieldSet.all(PersonShape, { depth: 2 })
// → ['name', 'email', 'age', 'bio', 'avatar',
//    'address.street', 'address.city', 'address.postalCode', 'address.country',
//    'friends.name', 'friends.email', ...,
//    'hobbies.label', 'hobbies.description']

// "Summary" — properties marked with a specific group or order, or a convention
// e.g. properties with order < 5, or a custom 'summary' group
FieldSet.summary(PersonShape)
// → ['name', 'email'] (only the first few ordered properties)
```

This is the insight you were getting at: shapes themselves *can* define the field set, and `FieldSet.all(AddressShape)` is effectively the `address.all()` you were imagining. The difference is that `FieldSet` is *detached* from the shape — it's a value you can store, pass around, merge, extend, and serialize.

### Scoped filters in FieldSets

A FieldSet entry can carry a **scoped filter** — a condition that applies to a specific traversal, not to the root query. This is the difference between "only active friends" (scoped to the `friends` traversal) and "only people over 30" (top-level query filter).

```ts
// ── FieldSet with scoped filters ────────────────────────────────

// "Active friends" — the filter is part of the reusable field definition
const activeFriends = FieldSet.for(PersonShape, [
  { path: 'friends.name', where: { 'friends.isActive': true } },
  'friends.email',
]);

// Equivalently, using the fluent path builder
const activeFriends2 = FieldSet.for(PersonShape, (p) => [
  p.path('friends').where('isActive', '=', true).fields([
    'name',
    'email',
  ]),
]);

// Using it — the scoped filter travels with the FieldSet
const results = await QueryBuilder
  .from(PersonShape)
  .include(activeFriends)             // friends are filtered to active
  .where('age', '>', 30)              // top-level: only people over 30
  .exec();
```

This maps naturally to the existing IR — `IRTraversePattern` already has an optional `filter` field. The scoped filter gets lowered into that, while the top-level `.where()` becomes the query-level `IRExpression`.

**The rule:** Scoped filters on FieldSet entries attach to the traversal they scope. Top-level `.where()` on QueryBuilder attaches to the query root. When FieldSets are merged, scoped filters on the same traversal are AND-combined.

```ts
// Merging scoped filters
const set1 = FieldSet.for(PersonShape, [
  { path: 'friends.name', where: { 'friends.isActive': true } },
]);
const set2 = FieldSet.for(PersonShape, [
  { path: 'friends.email', where: { 'friends.age': { '>': 18 } } },
]);

const merged = FieldSet.merge([set1, set2]);
// merged friends traversal has: isActive = true AND age > 18
// merged selections: friends.name + friends.email
```

### FieldSet design

```ts
class FieldSet {
  readonly shape: NodeShape;
  readonly entries: FieldSetEntry[];

  // ── Construction ──
  static for(shape: NodeShape | string, fields: FieldSetInput[]): FieldSet;
  static for(shape: NodeShape | string, fn: (p: ProxiedPathBuilder) => FieldSetInput[]): FieldSet;
  static all(shape: NodeShape | string, opts?: { depth?: number }): FieldSet;
  static summary(shape: NodeShape | string): FieldSet;

  // ── Composition (all return new FieldSet — immutable) ──
  add(fields: FieldSetInput[]): FieldSet;         // returns new FieldSet with added fields
  remove(fields: string[]): FieldSet;             // returns new FieldSet without named fields
  set(fields: FieldSetInput[]): FieldSet;         // returns new FieldSet with exactly these fields (replaces)
  pick(fields: string[]): FieldSet;               // returns new FieldSet with only the named fields from existing
  static merge(sets: FieldSet[]): FieldSet;       // union of multiple FieldSets (deduped, filters AND-combined)

  // ── Introspection ──
  paths(): PropertyPath[];                        // resolved PropertyPath objects
  labels(): string[];                             // flat list of dot-paths: ['name', 'address.city']
  toJSON(): FieldSetJSON;                         // serializable form (for storage/transport)
  static fromJSON(json: FieldSetJSON): FieldSet;  // deserialize

  // ── Query integration ──
  // QueryBuilder.setFields() / .addFields() accept FieldSet directly
}

type FieldSetInput =
  | string                                    // 'name' or 'address.city'
  | PropertyShape                             // direct reference
  | PropertyPath                              // pre-built path
  | FieldSet                                  // include another FieldSet
  | ScopedFieldEntry                          // path + scoped filter
  | Record<string, FieldSetInput[]>           // nested: { 'hobbies': ['label', 'description'] }
  | Record<string, FieldSet>;                 // nested with FieldSet: { 'friends': personSummary }
```

#### Nested selection (avoiding path repetition)

When selecting multiple properties under a deep path, flat strings repeat the prefix:

```ts
// Repetitive — 'hobbies' appears 3 times
FieldSet.for(PersonShape, [
  'hobbies.label',
  'hobbies.description',
  'hobbies.category.name',
]);
```

Use the nested object form to avoid this. The key is the traversal, the array value is sub-selections relative to that traversal's shape:

```ts
// Nested — 'hobbies' appears once
FieldSet.for(PersonShape, [
  { 'hobbies': ['label', 'description', 'category.name'] },
]);

// Deeper nesting composes:
FieldSet.for(PersonShape, [
  'name',
  { 'friends': [
    'name',
    'avatar',
    { 'hobbies': ['label', 'description'] },
  ]},
]);
```

Both flat and nested forms produce identical FieldSets. The nested form is what `toJSON()` could produce for compact serialization.

#### Callback form — uses the same proxy as DSL

The callback form passes a **ProxiedPathBuilder** — the same proxy used in the DSL. Property access (`p.name`) works via proxy. `.path('string')` is an escape hatch for dynamic paths. `.select()` for sub-selection matches the DSL exactly:

```ts
// Callback form — proxy access, same as DSL
FieldSet.for(PersonShape, (p) => [
  p.name,
  p.hobbies.select(h => [h.label, h.description, h.category.name]),
]);

// Callback form — .path() for dynamic strings, freely mixed with proxy
FieldSet.for(PersonShape, (p) => [
  p.name,
  p.path('hobbies').select(h => [h.label, h.path(dynamicField)]),
]);

// Scoped filter — same as DSL
FieldSet.for(PersonShape, (p) => [
  p.friends.where(f => f.isActive.equals(true)).select(f => [f.name, f.email]),
]);

// Variable binding
FieldSet.for(PersonShape, (p) => [
  p.bestFriend.favoriteHobby.as('hobby'),
  p.hobbies.as('hobby'),
]);
```

type ScopedFieldEntry = {
  path: string | PropertyPath;
  where: WhereConditionInput;                 // scoped to the traversal in this path
};

type FieldSetEntry = {
  path: PropertyPath;
  alias?: string;                             // custom result key name
  scopedFilter?: WhereCondition;              // filter on the deepest traversal
};
```

### When composability matters vs when shapes suffice

| Situation | Shapes suffice? | FieldSet needed? |
|---|---|---|
| "Show all fields of Address" | Yes — `FieldSet.all(AddressShape)` | Technically uses FieldSet but derives from shape |
| "Table with name, email, city" | No — partial selection across shapes | Yes |
| "Card = summary; Detail = card + more" | No — incremental/layered views | Yes — `add()` |
| "Merge two component requirements" | No — union of partial views | Yes — `merge()` |
| "NL chat adds fields incrementally" | No — runtime extension | Yes — `add()` |
| "Store column config as JSON" | No — need serialization | Yes — `toJSON()`/`fromJSON()` |
| "Form with all editable fields" | Yes — `FieldSet.all(shape)` | Derives from shape, but FieldSet is the API |

The pattern: **shapes suffice when you want everything. FieldSet is needed when you want a subset, a union, or an evolving view.**

### Immutability of FieldSets

Like QueryBuilder, **FieldSets are immutable**. Every `.add()`, `.remove()`, `.set()`, `.pick()` returns a new FieldSet. The original is never modified.

```ts
const personSummary = FieldSet.for(PersonShape, ['name', 'email']);
const withAge = personSummary.add(['age']);
// personSummary is still ['name', 'email']
// withAge is ['name', 'email', 'age']

const noEmail = personSummary.remove(['email']);
// → ['name']

const replaced = personSummary.set(['avatar', 'bio']);
// → ['avatar', 'bio'] — completely replaced

const nameOnly = withAge.pick(['name']);
// → ['name'] — pick from existing entries
```

This matters when the same FieldSet is shared across components. A table extends it with a column — that doesn't affect the card component using the original.

### Filtering on selected paths

A path like `age` can be both **selected** and **filtered** — they're independent concerns that happen to touch the same traversal. Under the hood, the IR reuses the same alias for both (via `LoweringContext.getOrCreateTraversal()` which deduplicates `(fromAlias, propertyShapeId)` pairs). So selecting `age` and filtering `age > 30` naturally share a variable — no extra traversal.

```ts
// FieldSet with age selected AND filtered
const adults = FieldSet.for(PersonShape, [
  'name',
  'email',
  { path: 'age', where: { 'age': { '>=': 18 } } },
  // ↑ selects age AND filters it — same traversal, same ?variable in SPARQL
]);

// The top-level .where() can ALSO filter on age — they AND-combine
const results = await QueryBuilder
  .from(PersonShape)
  .setFields(adults)          // has scoped filter: age >= 18
  .where('age', '<', 65)     // additional top-level filter: age < 65
  .exec();
// → SPARQL: WHERE { ... FILTER(?age >= 18 && ?age < 65) }
// → the ?age variable is shared between select, scoped filter, and top-level filter
```

This works because the existing pipeline already handles variable deduplication:
- `LoweringContext.getOrCreateTraversal()` returns the same alias when traversing the same `(from, property)` twice
- `VariableRegistry` in `irToAlgebra.ts` maps `(alias, property)` → SPARQL variable name, reusing variables automatically
- A `property_expr` in the projection and a `property_expr` in a where clause that refer to the same `(sourceAlias, property)` resolve to the same `?variable`

### Variable reuse and shared bindings — forward-compatibility

> Full design: [008-shared-variable-bindings.md](./008-shared-variable-bindings.md)

Some SPARQL queries need two property paths to end at the same node (shared variable). Example: "people whose hobbies include their best friend's favorite hobby" — both `bestFriend.favoriteHobby` and `hobbies` must resolve to the same `?hobby` variable.

The agreed API is **`.as('name')`** — label a path endpoint. If multiple paths use the same name, they share a SPARQL variable. `.matches('name')` is sugar for `.as('name')` (reads better when referencing an existing name). No type checking, no declare/consume distinction, no shape compatibility enforcement. Same name = same variable, period.

**What v1 must do to prepare:**

Reserve optional fields in the v1 types. These cost nothing — they're ignored by `toRawInput()` until binding support is implemented. But they ensure FieldSets and QueryBuilders created now can carry `.as()` declarations that activate later.

```ts
class PropertyPath {
  readonly bindingName?: string;       // reserved for .as()
  as(name: string): PropertyPath { ... }
  matches(name: string): PropertyPath { return this.as(name); }  // sugar
}

type FieldSetEntry = {
  path: PropertyPath;
  alias?: string;
  scopedFilter?: WhereCondition;
  bindingName?: string;                // reserved: .as() on this entry
};

type WhereConditionValue =
  | string | number | boolean | Date
  | NodeReferenceValue
  | { $ref: string };                  // reserved: binding reference

class QueryBuilder {
  private _bindings: Map<string, PropertyPath>;  // reserved
}
```

**QueryBuilder string API** (also reserved for later):
- `{ path: 'hobbies', as: 'hobby' }` — inline in field entry arrays
- In callback form: `p.hobbies.as('hobby')` — same proxy as DSL, no separate method needed

**IR change** (when activated): one optional `bindingName?: string` on `IRTraversePattern`, one `Map<string, string>` on `LoweringContext`. Everything downstream already works with aliases.

---

## Query Derivation, Extension, and Shape Remapping

Queries need to be **derived** from other queries — not just FieldSets from FieldSets. A QueryBuilder should be a value you can fork, extend, narrow, and remap.

### Query extension (fork + modify)

QueryBuilder is immutable-by-default: every modifier returns a new builder. This makes forking natural.

```ts
// Base query — reusable template
const allPeople = QueryBuilder
  .from(PersonShape)
  .setFields(personSummary);

// Fork for different pages
const peoplePage = allPeople
  .limit(20)
  .offset(0);

const activePeople = allPeople
  .where('isActive', '=', true);

const peopleInAmsterdam = allPeople
  .where('address.city', '=', 'Amsterdam');

// Further fork
const youngPeopleInAmsterdam = peopleInAmsterdam
  .where('age', '<', 30)
  .setFields(personDetail);     // switch view to detail (replace fields)

// All of these are independent builders — allPeople is unchanged
```

This is like a query "prototype chain." Each `.where()`, `.setFields()`, `.addFields()`, `.limit()` returns a new builder that inherits from the parent. Cheap to create (just clone the config), no side effects.

### Query narrowing (`.one()` / `.for()`)

```ts
// From a list query to a single-entity query
const personQuery = allPeople;

// Narrow to a specific person (returns singleResult: true)
const alice = await personQuery.one(aliceId).exec();

// Or: narrow to a set of IDs
const subset = await personQuery.for([aliceId, bobId]).exec();
```

### Shape remapping — forward-compatibility

> Full design: [009-shape-remapping.md](./009-shape-remapping.md)

Shape remapping lets the same FieldSet/QueryBuilder target a different SHACL shape via declarative `ShapeAdapter` mappings. Components stay portable across ontologies — result keys use original labels, only SPARQL changes.

**v1 requires no special preparation.** Shape remapping operates on the FieldSet/QueryBuilder public API. As long as `PropertyPath` exposes its `steps` and `rootShape`, and types are immutable/cloneable, the adapter can walk and remap them when it's implemented later.

---

## CMS Surface Examples

Three real CMS surfaces showing QueryBuilder + FieldSet with decided method names.

```ts
import { FieldSet, QueryBuilder } from 'lincd/queries';

// ═══════════════════════════════════════════════════════
// Shared FieldSets — defined once, reused across surfaces
// ═══════════════════════════════════════════════════════

// PersonShape has properties: name, email, avatar, age, bio,
//   address.city, address.country, hobbies.label, hobbies.description,
//   friends.name, friends.avatar, friends.email, friends.isActive

const personSummary = FieldSet.for(PersonShape, ['name', 'email', 'avatar']);

// Using proxy callback — matches DSL syntax exactly
const personDetail = FieldSet.for(PersonShape, (p) => [
  personSummary,                                  // includes summary fields
  p.bio, p.age,
  p.address.select(a => [a.city, a.country]),     // sub-selection (same as DSL)
  p.hobbies.select(h => [h.label, h.description]),
  p.friends.select(() => personSummary),          // sub-FieldSet under traversal
]);

// Scoped filter — same syntax as DSL
const activeFriendsList = FieldSet.for(PersonShape, (p) => [
  p.friends.where(f => f.isActive.equals(true)).select(f => [f.name, f.email]),
]);

// String form — equivalent, for dynamic/runtime use
const personDetailStrings = FieldSet.for(PersonShape, [
  personSummary,
  'bio', 'age',
  { 'address': ['city', 'country'] },             // nested selection
  { 'hobbies': ['label', 'description'] },
  { 'friends': personSummary },
]);
```

### Surface 1: Grid/table view — add/remove columns, filter, switch view mode

```ts
// ── Base query: all people, summary columns ─────────────

const gridQuery = QueryBuilder
  .from(PersonShape)
  .setFields(personSummary)               // start with summary columns
  .orderBy('name')
  .limit(50);

// ── User adds a column (hobbies) → ADD fields ──────────

const withHobbies = gridQuery
  .addFields({ 'hobbies': ['label'] });   // adds hobbies.label to existing columns
// Still: name, email, avatar + now hobbies.label
// Still: ordered by name, limit 50

// ── User filters to Amsterdam → adds a constraint ───────

const filtered = withHobbies
  .where('address.city', '=', 'Amsterdam');
// Or equivalently: .where(p => p.address.city.equals('Amsterdam'))
// Still: name, email, avatar, hobbies.label
// Now: WHERE address.city = 'Amsterdam', ordered by name, limit 50

// ── User switches to "detail card" view mode → REPLACE fields ──
// The user is still browsing the same filtered result SET,
// but wants to see each item rendered differently (more fields).
// Filters, ordering, and pagination are preserved.

const detailView = filtered
  .setFields(personDetail);               // REPLACE: swap summary → detail
// Now: name, email, avatar, bio, age, address, hobbies, friends
// Still: WHERE address.city = 'Amsterdam', ordered by name, limit 50

// ── User switches back to table view → REPLACE again ────

const backToTable = detailView
  .setFields(personSummary);              // back to summary
// Filters still intact

// ── User removes the hobbies column ─────────────────────

const noHobbies = withHobbies
  .removeFields(['hobbies']);
```

### Surface 2: Drag-and-drop page builder — merge component requirements

```ts
// Each component on the page declares its data needs as a FieldSet
const simplePersonCard = FieldSet.for(PersonShape, ['name', 'avatar']);
const hobbyList = FieldSet.for(PersonShape, [
  { 'hobbies': ['label', 'description'] },
]);
const friendGraph = activeFriendsList;

// User drops components onto the page → MERGE all their fields into one query
const activeComponents = [simplePersonCard, hobbyList, friendGraph];

const pageQuery = QueryBuilder
  .from(PersonShape)
  .setFields(FieldSet.merge(activeComponents))
  .limit(20);

// One SPARQL query fetches everything all three components need.
// If the user removes hobbyList and adds a new component, the page builder
// rebuilds from the current component list:
const updatedComponents = [simplePersonCard, friendGraph, newComponent.fields];
const updatedPageQuery = QueryBuilder
  .from(PersonShape)
  .setFields(FieldSet.merge(updatedComponents))
  .limit(20);
```

### Surface 3: NL chat — incremental query refinement

```ts
// "Show me people in Amsterdam"
let q = QueryBuilder
  .from(PersonShape)
  .setFields(personSummary)
  .where('address.city', '=', 'Amsterdam');

// "Also show their hobbies"  →  ADD fields
q = q.addFields({ 'hobbies': ['label'] });

// "Only people over 30"  →  adds another filter (accumulates)
q = q.where('age', '>', 30);
// Or: q = q.where(p => p.age.gt(30));   ← same proxy as DSL

// "Only show me their active friends"  →  ADD scoped FieldSet
q = q.addFields(activeFriendsList);

// "Show the full profile view"  →  REPLACE fields, keep both filters
q = q.setFields(personDetail);
// Still has: WHERE city = 'Amsterdam' AND age > 30
// But now shows all detail fields instead of summary + hobbies

// "Remove the age filter" (future: .removeWhere() or similar)
// "Show me page 2" → q = q.offset(20)
```

### Summary: when to use each method

| Action | Method | What changes | What's preserved |
|---|---|---|---|
| Set initial fields | `.setFields(fields)` | Selection set | — |
| Add a column/component | `.addFields(fields)` | Selection grows | Filters, ordering, pagination |
| Switch view mode | `.setFields(fields)` | Selection replaced entirely | Filters, ordering, pagination |
| Add a filter | `.where(...)` | Constraints grow | Selection, ordering, pagination |
| Remove fields | `.removeFields('hobbies')` | Selection shrinks | Filters, ordering, pagination |

**`.setFields()` for switching view modes** — the user is browsing the same filtered/sorted result set, but wants to see the items rendered differently (table → cards → detail). Filters and pagination stay because the *dataset* hasn't changed, only the *view*.

---

## Method Naming — decided

### Naming pattern: `set` / `add` / `remove` / `pick`

Consistent across FieldSet and QueryBuilder:

| Operation | FieldSet | QueryBuilder | Description |
|---|---|---|---|
| Replace all | `.set(fields)` | `.setFields(fields)` | Set to exactly these fields |
| Add to existing | `.add(fields)` | `.addFields(fields)` | Merge additional fields |
| Remove from existing | `.remove(fields)` | `.removeFields(fields)` | Remove named fields |
| Keep only named | `.pick(fields)` | — | Filter existing to subset |
| Union of multiple | `FieldSet.merge([...])` | — | Deduped union, scoped filters AND-combined |

QueryBuilder uses the `Fields` suffix because the builder has other methods too (`.where()`, `.orderBy()`, etc.). FieldSet is already about fields, so the short form is clear.

### Where clauses — proxy form matches DSL, string form is convenience

```ts
// Proxy form (same as DSL — callback with proxied path builder)
.where(p => p.age.gt(18))
.where(p => p.address.city.equals('Amsterdam'))
.where(p => p.isActive.equals(true))        // type-validated: isActive is boolean, .equals() is valid
.where(p => L.gt(L.times(p.age, 12), 216))  // L module for computed expressions

// String shorthand (convenience for simple comparisons)
.where('age', '>', 18)
.where('address.city', '=', 'Amsterdam')

// Both produce the same WhereCondition internally.
// Type validation: string form resolves PropertyShape first, then validates operator vs datatype.
```

> **Shape remapping** → see [009-shape-remapping.md](./009-shape-remapping.md)

---

## Detailed Design Sketch

### Core: `PropertyPath` and `ProxiedPathBuilder`

```ts
// PropertyPath — immutable value object representing a traversal path
class PropertyPath {
  constructor(
    public readonly steps: PropertyShape[],
    public readonly rootShape: NodeShape,
    public readonly bindingName?: string,     // reserved for .as()
  ) {}

  prop(property: PropertyShape): PropertyPath {
    return new PropertyPath([...this.steps, property], this.rootShape);
  }

  // Variable binding
  as(name: string): PropertyPath {
    return new PropertyPath(this.steps, this.rootShape, name);
  }
  matches(name: string): PropertyPath { return this.as(name); }  // sugar

  // Where clause helpers — return WhereCondition objects
  // These are type-validated against the PropertyShape's sh:datatype
  equals(value: any): WhereCondition { ... }
  notEquals(value: any): WhereCondition { ... }
  gt(value: any): WhereCondition { ... }    // only for numeric/date types
  gte(value: any): WhereCondition { ... }
  lt(value: any): WhereCondition { ... }
  lte(value: any): WhereCondition { ... }
  contains(value: string): WhereCondition { ... }  // only for string types

  // Sub-selection (matching DSL)
  select(fn: (p: ProxiedPathBuilder) => FieldSetInput[]): FieldSetInput { ... }
  select(fields: FieldSetInput[]): FieldSetInput { ... }
}

// ProxiedPathBuilder — the `p` in callbacks. Uses Proxy to intercept property access.
// This is the SAME proxy used by the DSL. Property access (p.name) creates PropertyPaths.
// .path('string') is an escape hatch for dynamic/runtime strings.
class ProxiedPathBuilder {
  constructor(private rootShape: NodeShape) {}

  // Explicit string-based path (escape hatch for dynamic use)
  path(input: string | PropertyShape): PropertyPath { ... }

  // Property access via Proxy — p.name, p.friends, etc.
  // Implemented via Proxy handler, same as DSL
}
```

### Core: `QueryBuilder` class

```ts
class QueryBuilder {
  private _shape: NodeShape;
  private _fieldSet: FieldSet;
  private _where: WhereCondition[] = [];
  private _limit?: number;
  private _offset?: number;
  private _orderBy?: { path: PropertyPath; direction: 'ASC' | 'DESC' };
  private _forIds?: string[];               // narrowed to specific IDs
  private _bindings: Map<string, PropertyPath> = new Map();  // reserved for variable bindings

  // ── Construction ──
  static from(shape: NodeShape | string): QueryBuilder;  // string = prefixed IRI (my:PersonShape)

  // ── Field selection ──
  setFields(fields: FieldSet | FieldSetInput[] | ((p: ProxiedPathBuilder) => FieldSetInput[])): QueryBuilder;
  addFields(fields: FieldSet | FieldSetInput[] | ((p: ProxiedPathBuilder) => FieldSetInput[])): QueryBuilder;
  removeFields(fields: string[]): QueryBuilder;

  // ── Filtering ── (proxy form or string shorthand)
  where(fn: (p: ProxiedPathBuilder) => WhereCondition): QueryBuilder;  // proxy: p => p.age.gt(18)
  where(path: string, op: string, value: any): QueryBuilder;          // string: 'age', '>', 18

  // ── Ordering & pagination ──
  orderBy(path: string, direction?: 'asc' | 'desc'): QueryBuilder;
  limit(n: number): QueryBuilder;
  offset(n: number): QueryBuilder;

  // ── Narrowing ──
  for(id: string | string[]): QueryBuilder;       // single ID or array
  one(id: string): QueryBuilder;                   // alias: .for(id) + singleResult

  // ── Introspection ──
  fields(): FieldSet;                              // current FieldSet

  // ── Execution ──
  build(): IRSelectQuery;
  exec(): Promise<ResultRow[]>;

  // ── Serialization ──
  toJSON(): QueryBuilderJSON;
  static fromJSON(json: QueryBuilderJSON, shapeRegistry: ShapeRegistry): QueryBuilder;

  // ── Reserved for variable bindings ──
  // String API form of .as() — for when paths are strings
  // .as('hobby', 'hobbies') → label endpoint of 'hobbies' path as 'hobby'
  // Not needed in callback form (use p.hobbies.as('hobby') directly)
  // Future: may add .as(name, path) if needed for string API
}
```

Every method returns a **new QueryBuilder** (immutable). The proxy `p` in callbacks is the same `ProxiedPathBuilder` used by the DSL.

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

3. **~~Validation~~ — RESOLVED (yes):** The builder validates property shapes against the root shape (and traversed valueShapes). Any invalid string/path throws an error since the base shape is known. Operator validation against `sh:datatype` too (boolean → only `=`/`!=`, numeric → all comparisons, etc.).

4. **~~Where clause composition~~ — RESOLVED:** QueryBuilder supports two forms:
   - **Proxy callback** (matches DSL): `.where(p => p.age.gt(18))` — same proxy as DSL, type-validated
   - **String shorthand** (convenience): `.where('age', '>', 18)` — resolves PropertyShape, validates operator vs datatype
   - Both produce the same `WhereCondition`. JSON serialization uses plain-object form: `{ path: 'age', op: '>', value: 18 }`.
   - L module (006) works in callbacks for computed expressions: `.where(p => L.gt(L.times(p.age, 12), 216))`

5. **Path reuse across queries:** If paths are first-class (Option E influence), they could be defined once in a CMS schema config and reused across list views, detail views, filters, etc.

6. **Scoped filter merging strategy:** When two FieldSets have scoped filters on the same traversal and are merged, AND is the safe default. But should we support OR? What about conflicting filters (one says `isActive = true`, another says `isActive = false`)? Detect and warn?

7. **QueryBuilder immutability:** If every `.where()` / `.setFields()` / `.addFields()` returns a new builder, do we shallow-clone or use structural sharing? For typical CMS queries (< 20 paths, < 5 where clauses) shallow clone is fine. But for NL chat where queries evolve over many turns, structural sharing could matter.

8. **Shape adapter scope:** Should adapters map just property labels, or also handle value transforms (e.g. `age` → compute from `birthDate`)? Value transforms require post-processing results, which is a different layer. Probably keep adapters as pure structural mapping and handle value transforms separately.

9. **~~FieldSet serialization format~~ — RESOLVED:** Serialize at the QueryBuilder/FieldSet level (not the IR level). The IR is an internal compilation target, not a storage format.

   **Shape/property identifiers use prefixed IRIs** (e.g. `"my:PersonShape"`, not `"http://data.my-app.com/shapes/Person"`). Prefixes are resolved through the existing prefix registry. Unprefixed strings resolve as property labels on the base shape — any invalid string/path throws an error since the base shape is known.

   **QueryBuilder.toJSON()** format:
   ```json
   {
     "shape": "my:PersonShape",
     "fields": [
       { "path": "name" },
       { "path": "friends.name" },
       { "path": "hobbies.label", "as": "hobby" }
     ],
     "where": [
       { "path": "address.city", "op": "=", "value": "Amsterdam" },
       { "path": "age", "op": ">=", "value": 18 }
     ],
     "orderBy": [{ "path": "name", "direction": "asc" }],
     "limit": 20,
     "offset": 0
   }
   ```

   **QueryBuilder.fromJSON(json, shapeRegistry)** resolves prefixed IRIs → NodeShape/PropertyShape references, throws on unknown shapes/properties.

   **FieldSet.toJSON() / FieldSet.fromJSON()** independently serializable with the same format (just `shape` + `fields`).

10. **Immutability implementation for FieldSet:** FieldSet entries are an array of `FieldSetEntry`. Extend/omit/pick create new arrays. But the entries themselves reference PropertyShapes (which are mutable objects in the current codebase). Should FieldSet deep-freeze its entries? Or is it sufficient that the FieldSet *array* is new (so you can't accidentally mutate the list), while PropertyShape references are shared? Probably the latter — PropertyShapes are effectively singletons registered on NodeShapes.

11. **Shared variable bindings** — moved to [008-shared-variable-bindings.md](./008-shared-variable-bindings.md). For 003, just reserve optional `bindingName` fields in v1 types (see "forward-compatibility" section above).

12. **ShapeAdapter property format — string vs reference resolution:** When the adapter `properties` map uses strings, the string is resolved as a property label on the respective shape (`from` shape for keys, `to` shape for values). When the adapter uses `{id: someIRI}` references, those are used directly. But what about dotted paths like `'address.city'`? These imply chained resolution: first resolve `address` on the `from` shape, then `city` on `address`'s valueShape. The target side similarly resolves `'address.addressLocality'` step by step. This makes dotted path mapping work, but should the adapter also support structural differences where one shape has a flat property and the other has a nested path? (e.g. `'city'` → `'address.addressLocality'`). Probably yes, but that's a later extension.

---

## Implementation Plan

### Phase 1: Core primitives
- [ ] `PropertyPath` value object with `.prop()` chaining, comparison methods (`.equals()`, `.gt()`, etc.), `.as()`, `.matches()`, `.select()` for sub-selection
- [ ] `walkPropertyPath(shape, 'friends.name')` — string path → `PropertyPath` resolution using `NodeShape.getPropertyShape(label)` + `PropertyShape.valueShape` walking
- [ ] `ProxiedPathBuilder` — shared proxy between DSL and dynamic builder. Property access creates PropertyPaths. `.path('string')` escape hatch for dynamic paths.
- [ ] Type validation: comparison methods validate operator against `sh:datatype` (boolean: only `=`/`!=`, numeric: all comparisons, string: `=`/`!=`/`contains`/`startsWith`)
- [ ] `FieldSet` with `.for()`, `.all()`, `.add()`, `.remove()`, `.set()`, `.pick()`, `FieldSet.merge()`
- [ ] `FieldSet` scoped filters: `ScopedFieldEntry` type, filter attachment to entries
- [ ] `FieldSet.toJSON()` / `FieldSet.fromJSON()` serialization (prefixed IRIs via prefix registry)
- [ ] `QueryBuilder.toJSON()` / `QueryBuilder.fromJSON(json, shapeRegistry)` — full query serialization (shape, fields, where, orderBy, limit, offset)
- [ ] Tests: FieldSet composition (add, merge, remove, pick), path resolution, scoped filter merging

### Phase 2: QueryBuilder
- [ ] `QueryBuilder` with `.from()`, `.setFields()`, `.addFields()`, `.removeFields()`, `.where()`, `.limit()`, `.offset()`, `.one()`, `.for()`, `.orderBy()`, `.build()`, `.exec()`
- [ ] Immutable builder pattern — every modifier returns a new builder
- [ ] Callback overloads using shared `ProxiedPathBuilder`: `.setFields(p => [...])`, `.where(p => p.age.gt(18))`
- [ ] String shorthand overloads: `.setFields(['name', 'friends.name'])`, `.where('age', '>=', 18)`
- [ ] Shape resolution by prefixed IRI: `.from('my:PersonShape')`
- [ ] Internal `toRawInput()` bridge — produce `RawSelectInput` from PropertyPaths, lower scoped filters into `QueryStep.where`
- [ ] `.fields()` accessor — returns the current FieldSet for introspection
- [ ] Reserved: `_bindings` Map, `.as()` string-form (for variable bindings, see 008)
- [ ] Tests: verify builder-produced IR matches DSL-produced IR for equivalent queries
- [ ] Tests: query forking — verify parent query is unchanged after derivation
- [ ] Tests: string-based queries produce correct IR

### Phase 3: DSL alignment
- [ ] Refactor DSL to use QueryBuilder internally (DSL becomes sugar over QueryBuilder + FieldSet)
- [ ] `.for(id)` / `.for([id1, id2])` chainable pattern on DSL (replacing subject-as-first-arg)
- [ ] `Person.selectAll({ depth: 2 })` — depth-limited all-fields selection
- [ ] Verify DSL and QueryBuilder produce identical IR for equivalent queries

### Phase 4: Shape remapping → [009-shape-remapping.md](./009-shape-remapping.md)

### Phase 5: Raw IR helpers (Option A)
- [ ] `ir.select()`, `ir.shapeScan()`, `ir.traverse()`, `ir.project()`, `ir.prop()` helpers
- [ ] Export from `lincd/queries`
- [ ] Tests: hand-built IR passes through pipeline correctly

### Phase 6: Mutation builders
- [ ] `MutationBuilder.create(shape).set(prop, value).exec()`
- [ ] `MutationBuilder.update(shape, id).set(prop, value).exec()`
- [ ] `MutationBuilder.delete(shape, ids).exec()`
- [ ] `.for(id)` pattern on mutations: `Person.update({ age: 31 }).for(id)`
