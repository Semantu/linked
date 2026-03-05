---
summary: Shared variable bindings — let multiple property paths end at the same SPARQL variable via `.as()` naming, enabling structural joins without FILTER.
packages: [core]
depends_on: [003-dynamic-ir-construction]
---

# Shared Variable Bindings

## Status: design (nothing implemented yet — v1 type reservations are part of 003)

## Problem

Some queries need **two different property paths to end at the same node**. Example: "people whose hobbies include their best friend's favorite hobby."

In SPARQL this is expressed by reusing a variable across triple patterns:

```sparql
SELECT ?person ?name ?hobby WHERE {
  ?person a ex:Person .
  ?person ex:name ?name .
  ?person ex:bestFriend ?bf .
  ?bf ex:favoriteHobby ?hobby .      ←─┐
  ?person ex:hobbies ?hobby .         ←─┘ same ?hobby = same node
}
```

`?hobby` appears in two triple patterns. Path A (`person → bestFriend → favoriteHobby`) and path B (`person → hobbies`) both end at the **same variable**. The SPARQL engine only returns results where both paths reach the same node. No `FILTER` needed — it's a structural constraint.

### Why it matters

- **More efficient** than `FILTER(?x = ?y)` — SPARQL engines use index lookups instead of post-filtering
- **Enables patterns** that filters can't express (e.g. joins across OPTIONAL branches)
- **Common in real CMS queries**: "articles by my friends", "products in the same category as my wishlist", "people who share hobbies"

### How it differs from today's `.equals()`

Today the DSL generates `FILTER(?x = ?y)` — two separate variables compared after the fact:

```ts
// Today: generates FILTER(?bestFriend_favoriteHobby = ?hobbies)
Person.select(p => [p.name, p.bestFriend.favoriteHobby])
  .where(p => p.bestFriend.favoriteHobby.equals(p.hobbies));
```

```sparql
-- Two separate variables, post-compared:
SELECT ?name ?favHobby ?hobbies WHERE {
  ?person ex:name ?name .
  ?person ex:bestFriend/ex:favoriteHobby ?favHobby .
  ?person ex:hobbies ?hobbies .
  FILTER(?favHobby = ?hobbies)
}
```

With shared variable binding, both paths use **one variable** — fewer variables, no `FILTER`, better performance.

---

## Design Decisions (agreed)

### 1. Only `.as()` — no separate declare/consume distinction

The primitive is **`.as('name')`** — "label the node at the end of this path." If multiple paths use `.as()` with the same name, they share a SPARQL variable automatically. That's it.

There is no separate "exporter" vs "consumer" concept. The FieldSet author doesn't need to know what other FieldSets exist. Two independently authored FieldSets that happen to use `.as('hobby')` will automatically share the `?hobby` variable when merged into one query.

### 2. `.matches()` is sugar for `.as()`

`.matches('name')` is semantically identical to `.as('name')`. It exists for readability when you *know* you're referencing an existing name from another FieldSet:

```ts
const bestFriendHobby = FieldSet.for(PersonShape, (p) => [
  p.path('bestFriend.favoriteHobby').as('hobby'),     // labels endpoint
]);

const matchingHobbies = FieldSet.for(PersonShape, (p) => [
  p.path('hobbies').matches('hobby'),                  // reads naturally
]);
```

Under the hood, `.matches('hobby')` produces the exact same output as `.as('hobby')`.

### 3. No type/shape compatibility checks

A node can be a valid instance of multiple unrelated SHACL shapes simultaneously. Checking `valueShape` compatibility would reject valid patterns. The rule is simple: **same name = same variable, no questions asked.** If the paths can't actually reach the same node, you get zero results — which is correct SPARQL behavior.

### 4. Binding scope is per-query

All FieldSets included in a query share one binding namespace. When `.as('x')` appears in any included FieldSet, all paths with `.as('x')` or `.matches('x')` share the same variable.

### 5. Validate at build time

When `build()` is called, warn if a binding name appears only once (probably a mistake — the user intended a shared variable but forgot the other side). Not an error, since a single `.as()` is valid SPARQL.

### 6. Naming: `.as()` everywhere — DSL and QueryBuilder share the same proxy

Since the DSL and QueryBuilder share the same `ProxiedPathBuilder`, `.as('name')` works the same in both:

| Context | API | Example |
|---|---|---|
| DSL callback | `.as('name')` | `p.hobbies.as('hobby')` |
| DSL callback (readable) | `.matches('name')` | `p.hobbies.matches('hobby')` |
| QueryBuilder callback | `.as('name')` | `p.hobbies.as('hobby')` — same proxy |
| QueryBuilder callback + `.path()` | `.as('name')` | `p.path('hobbies').as('hobby')` — dynamic escape |
| FieldSet callback | `.as('name')` | `p.hobbies.as('hobby')` — same proxy |
| QueryBuilder string form | `{ path, as }` in field entry | `{ path: 'hobbies', as: 'hobby' }` |

All produce the same IR. The string-form `{ path, as }` is only needed when using string arrays (no proxy).

---

## API Examples

### Static DSL

```ts
Person.select(p => {
  const hobby = p.bestFriend.favoriteHobby.as('hobby');
  return [
    p.name,
    hobby,                        // path A → ?hobby
    p.hobbies.matches(hobby),     // path B → ?hobby (same node)
  ];
});
```

### Dynamic QueryBuilder — callback style (same proxy as DSL)

```ts
const query = QueryBuilder
  .from(PersonShape)
  .setFields(p => {
    const hobby = p.bestFriend.favoriteHobby.as('hobby');
    return [
      p.name,
      hobby,
      p.hobbies.matches(hobby),
    ];
  });

// Or mixing proxy + .path() for dynamic paths:
const query2 = QueryBuilder
  .from(PersonShape)
  .setFields(p => [
    p.name,
    p.path('bestFriend.favoriteHobby').as('hobby'),
    p.path('hobbies').matches('hobby'),
  ]);
```

### Dynamic QueryBuilder — string style

```ts
const query = QueryBuilder
  .from(PersonShape)
  .setFields([
    'name',
    { path: 'bestFriend.favoriteHobby', as: 'hobby' },
    { path: 'hobbies', as: 'hobby' },
  ])
  .exec();
```

### All produce the same SPARQL:

```sparql
SELECT ?name ?hobby ?hobbyLabel WHERE {
  ?person a ex:Person .
  ?person ex:name ?name .
  ?person ex:bestFriend ?bf .
  ?bf ex:favoriteHobby ?hobby .          ← path A ends at ?hobby
  ?hobby ex:label ?hobbyLabel .
  ?person ex:hobbies ?hobby .            ← path B ends at ?hobby (same node)
}
```

---

## Composing Bindings with FieldSets

FieldSets can carry `.as()` declarations. When merged, matching names auto-connect.

```ts
// Two independently authored FieldSets
const bestFriendHobby = FieldSet.for(PersonShape, (p) => [
  p.path('bestFriend.favoriteHobby').as('hobby'),
]);

const matchingHobbies = FieldSet.for(PersonShape, (p) => [
  p.path('hobbies').as('hobby'),       // same name → same variable
]);

// Merge connects them automatically
const query = QueryBuilder
  .from(PersonShape)
  .setFields(FieldSet.merge([bestFriendHobby, matchingHobbies]))
  .exec();
// → one ?hobby variable in SPARQL
```

Because FieldSets are immutable, bindings are safe across forks:

```ts
const base = FieldSet.for(PersonShape, (p) => [
  p.bestFriend.favoriteHobby.as('hobby'),
]);

const withMore = base.add(['age', 'email']);
// withMore still carries the 'hobby' binding — base unchanged
```

---

## CMS Examples

### Products in user's wishlist category (cross-shape)

```ts
const wishlistCategory = FieldSet.for(UserShape, (p) => [
  p.path('wishlist.category').as('cat'),
]);

const productsInCategory = FieldSet.for(ProductShape, (p) => [
  p.path('category').as('cat'),      // same name → same ?cat
  p.path('name'),
  p.path('price'),
]);

// SPARQL:
// ?user ex:wishlist/ex:category ?cat .
// ?product ex:category ?cat .          ← same ?cat
// ?product ex:name ?productName .
// ?product ex:price ?productPrice .
```

Note: requires multi-shape queries (separate feature). Bindings are designed shape-agnostic so they "just work" when that lands.

### Articles by friends

```ts
const userFriends = FieldSet.for(UserShape, (p) => [
  p.path('friends').as('friend'),
]);

const articlesByFriends = FieldSet.for(ArticleShape, (p) => [
  p.path('author').as('friend'),     // same name → same ?friend
  p.path('title'),
  p.path('publishedAt'),
]);
```

### NL chat — incremental binding

```ts
// "Show me people and their hobbies"
let chatQuery = QueryBuilder.from(PersonShape)
  .setFields(['name', 'hobbies.label']);

// "Now show friends who share the same hobbies"
chatQuery = chatQuery
  .addFields([
    'friends.name',
    { path: 'hobbies', as: 'hobby' },
    { path: 'friends.hobbies', as: 'hobby' },
  ]);
```

### Drag-drop builder — component-declared bindings

```ts
const categoryFilter = FieldSet.for(ProductShape, (p) => [
  p.path('category').as('selectedCat'),
  p.path('category.name'),
]);

const relatedProducts = FieldSet.for(ProductShape, (p) => [
  p.path('relatedTo.category').as('selectedCat'),  // same name
  p.path('relatedTo.name'),
]);

// Merge auto-connects
const pageFields = FieldSet.merge([categoryFilter, relatedProducts]);
```

---

## IR Changes Required

### LoweringContext — one new map

When two paths declare the same binding name, `LoweringContext` gives them the same alias → same SPARQL variable.

```
Today (no bindings):
  person → bestFriend → a1 → favoriteHobby → a2    ?a2 = ?hobby1
  person → hobbies → a3                              ?a3 = ?hobby2 (different!)

With bindings:
  person → bestFriend → a1 → favoriteHobby → a2     a2 is named 'hobby'
  person → hobbies → a2                              reuses a2 → same ?variable!
```

```ts
class LoweringContext {
  private namedBindings = new Map<string, string>();  // bindingName → alias

  getOrCreateTraversal(from: string, property: string, bindingName?: string): string {
    if (bindingName) {
      if (this.namedBindings.has(bindingName)) {
        return this.namedBindings.get(bindingName);   // reuse alias
      }
      const alias = this.nextAlias();
      this.namedBindings.set(bindingName, alias);
      // ... create traverse pattern as normal
      return alias;
    }
    // ... existing dedup logic unchanged
  }

  resolveBinding(name: string): string {
    const alias = this.namedBindings.get(name);
    if (!alias) throw new Error(`Unknown binding: ${name}`);
    return alias;
  }
}
```

### IRTraversePattern — one optional field

```ts
type IRTraversePattern = {
  kind: 'traverse';
  from: IRAlias;
  to: IRAlias;
  property: string;
  filter?: IRExpression;
  bindingName?: string;    // ← new: names this endpoint for reuse
};
```

Everything downstream (`irToAlgebra`, `algebraToString`) already works with aliases. If two patterns share a `to` alias, they produce the same `?variable`. The binding system just makes that intentional.

---

## v1 Type Reservations (for 003 dynamic query construction)

The v1 types in 003 should reserve optional fields so bindings "just work" later:

```ts
class PropertyPath {
  readonly bindingName?: string;       // reserved for .as()
}

type FieldSetEntry = {
  bindingName?: string;                // reserved: .as() on this entry
};

type WhereConditionValue =
  | string | number | boolean | Date
  | NodeReferenceValue
  | { $ref: string };                  // reserved: binding reference in where clauses

class QueryBuilder {
  private _bindings: Map<string, PropertyPath>;  // reserved
}
```

These fields are optional and ignored by `toRawInput()` until binding support is implemented. FieldSets created in v1 can carry `.as()` declarations that activate when bindings land.

---

## Open Questions

1. **Warning on solo bindings**: Should `build()` warn when a binding name appears only once? It's valid SPARQL but probably a mistake. Recommendation: warn, don't error.

2. **Binding + OPTIONAL**: If a path with `.as()` is inside an OPTIONAL block, the shared variable semantics change — the binding only applies when the OPTIONAL matches. Document this? Warn?

3. **Serialization format**:
   ```json
   { "path": "bestFriend.favoriteHobby", "as": "hobby" }
   { "path": "hobbies", "as": "hobby" }
   ```
   Simple. Both sides use `"as"` since there's no declare/consume distinction.

4. **Cross-shape bindings timing**: Design is shape-agnostic, but implementation requires multi-shape queries. Ship binding types now (reserved), implement when multi-shape lands?

5. **~~`.bind()` / `.constrain()` vs unified `.as()`~~ — RESOLVED**: Since DSL and QueryBuilder share the same proxy, `.as()` is the only API needed:
   - **Callback form**: `p.hobbies.as('hobby')` — directly on the proxy path (same as DSL)
   - **String form**: `{ path: 'hobbies', as: 'hobby' }` — inline in field entry arrays
   - No separate `.bind()`/`.constrain()` methods needed. The string form's `{ path, as }` is the equivalent.

---

## Implementation Plan

### Phase 1: Type reservations (part of 003 implementation)
- [ ] Add `bindingName?: string` to `PropertyPath`
- [ ] Add `bindingName?: string` to `FieldSetEntry`
- [ ] Add `{ $ref: string }` to `WhereConditionValue` union
- [ ] Add `_bindings: Map` to `QueryBuilder`
- [ ] `.as()` method on `PropertyPath` (returns new PropertyPath with name set)
- [ ] `.matches()` alias for `.as()`
- [ ] Ignore binding fields in `toRawInput()` — pass through silently

### Phase 2: IR support
- [ ] Add `bindingName?: string` to `IRTraversePattern`
- [ ] Add `namedBindings` map to `LoweringContext`
- [ ] Modify `getOrCreateTraversal()` to check/register binding names
- [ ] Add `resolveBinding()` to `LoweringContext`

### Phase 3: Activation
- [ ] Wire `toRawInput()` to pass binding names through to IR
- [ ] FieldSet merge: collect all `.as()` names across merged sets
- [ ] String-form support: `{ path: 'hobbies', as: 'hobby' }` in field entry arrays
- [ ] Validation at `build()`: warn on solo binding names
- [ ] Tests: shared variable produces correct SPARQL (no FILTER)
- [ ] Tests: FieldSet merge auto-connects matching binding names
- [ ] Tests: immutability — forking preserves bindings without mutation
