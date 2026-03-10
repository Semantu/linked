---
summary: Shape remapping — let the same FieldSet/QueryBuilder target a different SHACL shape via declarative ShapeAdapter mappings.
packages: [core]
depends_on: [003-dynamic-ir-construction]
---

# Shape Remapping (ShapeAdapter)

## Status: design (nothing implemented yet)

## Problem

A component is built to display data from `PersonShape`. In a different deployment, the data uses `schema:Person` (Schema.org) instead of `ex:Person`. Property names differ. Graph structure differs. But the component's *intent* is the same: show a person's name, avatar, and friends.

We need a way to **remap** a FieldSet or QueryBuilder from one shape to another so components stay portable across different ontologies.

---

## Design

### Option 1: Shape mapping at the FieldSet level

Map from one shape's property labels to another's. The FieldSet stays the same, the underlying resolution changes.

```ts
// Original component expects PersonShape with properties: name, avatar, friends
const personCard = FieldSet.for(PersonShape, ['name', 'avatar', 'friends.name']);

// In a different graph environment, data uses SchemaPersonShape
// with properties: givenName, image, knows
const mapping = FieldSet.mapShape(personCard, SchemaPersonShape, {
  'name': 'givenName',        // PersonShape.name → SchemaPersonShape.givenName
  'avatar': 'image',          // PersonShape.avatar → SchemaPersonShape.image
  'friends': 'knows',         // PersonShape.friends → SchemaPersonShape.knows
});
// mapping is a new FieldSet rooted at SchemaPersonShape,
// selecting [givenName, image, knows.givenName]

// The query uses SchemaPersonShape but returns results with the ORIGINAL keys
const results = await QueryBuilder
  .from(SchemaPersonShape)
  .include(mapping)
  .exec();

// results[0] = { id: '...', name: 'Alice', avatar: 'http://...', friends: [{ name: 'Bob' }] }
//                            ↑ original key names preserved!
```

Key insight: **result keys** stay as the original shape's labels, so the component doesn't need to know about the remapping. Only the SPARQL changes.

### Option 2: Shape mapping at the QueryBuilder level

```ts
// A component exports its query template
const personCardQuery = QueryBuilder
  .from(PersonShape)
  .include(personCard)
  .limit(10);

// Remap the entire query to a different shape
const remapped = personCardQuery.remapShape(SchemaPersonShape, {
  'name': 'givenName',
  'avatar': 'image',
  'friends': 'knows',
});

// remapped is a new QueryBuilder targeting SchemaPersonShape
// with the same structure but different property traversals
const results = await remapped.exec();
```

### Option 3: ShapeAdapter — declarative, reusable mapping object (recommended)

For larger-scale interop, define a `ShapeAdapter` that maps between two shapes. Use it across all queries.

The `properties` object maps from source → target. Keys and values can be:
- **Strings** — matched by property label (convenient, human-readable)
- **PropertyShape references** — matched by `{id: someIRI}` (precise, no ambiguity)
- **NodeShape references** — for the `from`/`to` shapes themselves
- Mixed — strings on one side, references on the other

```ts
// Defined once, used everywhere
const schemaPersonAdapter = ShapeAdapter.create({
  from: PersonShape,            // or: { id: 'http://example.org/PersonShape' }
  to: SchemaPersonShape,        // or: { id: 'http://schema.org/PersonShape' }

  properties: {
    'name': 'givenName',
    'email': 'email',            // same label, different PropertyShape IDs
    'avatar': 'image',
    'friends': 'knows',
    'age': 'birthDate',
    'address.city': 'address.addressLocality',
    'address.country': 'address.addressCountry',
  },
});

// ...or PropertyShape references for precision
const schemaPersonAdapterExact = ShapeAdapter.create({
  from: PersonShape,
  to: SchemaPersonShape,
  properties: {
    [PersonShape.getPropertyShape('name').id]: SchemaPersonShape.getPropertyShape('givenName'),
    [PersonShape.getPropertyShape('friends').id]: { id: 'http://schema.org/knows' },
    'avatar': SchemaPersonShape.getPropertyShape('image'),
  },
});

// Use anywhere
const remapped = personCardQuery.adapt(schemaPersonAdapter);
const remappedFields = personCard.adapt(schemaPersonAdapter);

// Or: register globally so all queries auto-resolve
QueryBuilder.registerAdapter(schemaPersonAdapter);
```

Internally, string labels are resolved to PropertyShape references via `NodeShape.getPropertyShape(label)` on the respective `from`/`to` shapes. The adapter stores the mapping as `Map<PropertyShape.id, PropertyShape.id>` after resolution — so at execution time it's just IRI-to-IRI lookup, no string matching.

### Where remapping fits in the pipeline

Shape remapping happens at the **FieldSet/QueryBuilder level** — before IR construction. The remapper walks each `PropertyPath`, swaps out the PropertyShapes using the mapping, and produces a new FieldSet/QueryBuilder rooted at the target shape. Everything downstream (desugar → canonicalize → lower → SPARQL) works unchanged.

```
Original FieldSet (PersonShape)
    ↓  remapShape / adapt
Remapped FieldSet (SchemaPersonShape)  ← result keys still use original labels
    ↓  QueryBuilder.include()
    ↓  toRawInput()
    ↓  buildSelectQuery()
    ↓  irToAlgebra → algebraToString
    ↓  SPARQL (uses SchemaPersonShape's actual property IRIs)
```

---

## CMS Example

```ts
// Client A uses PersonShape (custom ontology)
// Client B uses SchemaPersonShape (schema.org)

const adapter = ShapeAdapter.create({
  from: PersonShape,
  to: SchemaPersonShape,
  properties: {
    'name': 'givenName',
    'email': 'email',
    'avatar': 'image',
    'friends': 'knows',
    'address': 'address',
    'address.city': 'address.addressLocality',
    'hobbies': 'interestIn',
    'hobbies.label': 'interestIn.name',
  },
});

// The SAME page query, remapped to Schema.org
const schemaPageQuery = pageQuery.adapt(adapter);
const schemaPageData = await schemaPageQuery.exec();
// → results use original keys (name, email, ...) but SPARQL uses schema.org IRIs
// → components render identically, no code changes

// Or: register globally for auto-resolution
QueryBuilder.registerAdapter(adapter);
```

---

## What v1 (003) needs to prepare

Nothing — shape remapping operates on the FieldSet/QueryBuilder public API and doesn't require reserved fields. As long as `PropertyPath` exposes its `steps: PropertyShape[]` and `rootShape: NodeShape`, the adapter can walk and remap them.

The only consideration: ensure `PropertyPath` and `FieldSetEntry` are cloneable with different shapes (which they already are since they're immutable value types).

---

## Implementation Plan

- [ ] `ShapeAdapter.create({ from, to, properties })` — declarative property mapping
- [ ] String-to-PropertyShape resolution during adapter creation
- [ ] `FieldSet.adapt(adapter)` — remap a FieldSet to a different shape, preserving result key aliases
- [ ] `QueryBuilder.adapt(adapter)` — remap an entire query (selections + where + orderBy)
- [ ] `QueryBuilder.registerAdapter()` — global adapter registry for auto-resolution
- [ ] Tests: remapped query produces correct SPARQL with target shape's IRIs
- [ ] Tests: result keys match source shape labels after remapping

---

## Open Questions

1. **Unmapped properties**: If the source FieldSet has a property not in the adapter's mapping, should we error, skip it, or pass through? Recommendation: error — explicit is better than silent data loss.

2. **Bidirectional adapters**: Should `ShapeAdapter` be usable in reverse (`to → from`)? Useful but complex — property mappings might not be bijective. Recommendation: separate adapters for each direction.

3. **Nested shape adapters**: If `PersonShape.friends` has `valueShape: PersonShape`, and the adapter maps to `SchemaPersonShape.knows` with `valueShape: SchemaPersonShape`, does the adapter recurse automatically? Recommendation: yes, when both sides of a property mapping have valueShapes, apply the same adapter recursively.

4. **Adapter composition**: Can you chain adapters (`A → B → C`)? Useful for multi-hop ontology mappings. Recommendation: defer, manual chaining is fine for now.
