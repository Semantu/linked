# SHACL Shape RDF Serialization — Ideation

## Context

NodeShape and PropertyShape objects hold rich SHACL metadata: `class`, `datatype`, `nodeKind`, `minCount`, `maxCount`, `equals`, `disjoint`, `hasValue`, `in`, `lessThan`, `lessThanOrEquals`, `name`, `description`, `order`, `group`, `path` (including complex property path expressions), and `valueShape`.

Today this metadata is:
- Set via decorators (`@literalProperty`, `@objectProperty`, `@linkedShape`)
- Stored on `PropertyShape` instances
- Exposed via `nodeShape.properties` → `getResult()`
- Consumed by: nothing internal. External consumers read `getResult()` for form generation, UI, etc.

The metadata is **never serialized to actual SHACL RDF**. If a user wants to load these shapes into a SHACL-validation-enabled triplestore (GraphDB, Stardog, etc.), they must manually write the SHACL RDF — defeating the purpose of having the metadata in code.

### Related work

- `src/paths/serializePathToSHACL.ts` already serializes `PathExpr` to SHACL RDF triples (`sh:inversePath`, `sh:alternativePath`, etc.)
- `Shape.create(metadata)` uses the query engine's `CreateBuilder` to generate INSERT SPARQL for data instances
- The SHACL ontology is partially defined in `src/ontologies/shacl.ts` (exports `sh:NodeShape`, `sh:PropertyShape`, `sh:path`, etc.)

## Goals

1. Serialize any `NodeShape` (with its `PropertyShape`s) to SHACL-compliant RDF
2. Reuse the existing query/mutation infrastructure where possible (e.g., `CreateBuilder`, INSERT generation)
3. Support round-tripping: shapes defined in code → SHACL RDF → loadable into a triplestore for validation

## Routes

### Route A: Dedicated serializer function

A standalone `serializeNodeShapeToRDF(shape: NodeShape): Triple[]` function that walks the shape and its property shapes, producing RDF triples directly.

**Approach:**
- New file `src/shapes/serializeShapeToSHACL.ts`
- Maps each PropertyShape field to its SHACL predicate:
  - `path` → `sh:path` (delegates to existing `serializePathToSHACL`)
  - `class` → `sh:class`
  - `datatype` → `sh:datatype`
  - `nodeKind` → `sh:nodeKind`
  - `minCount` → `sh:minCount`
  - `maxCount` → `sh:maxCount`
  - `equals` → `sh:equals`
  - `disjoint` → `sh:disjoint`
  - `hasValue` → `sh:hasValue`
  - `in` → `sh:in` (RDF list)
  - `lessThan` → `sh:lessThan`
  - `lessThanOrEquals` → `sh:lessThanOrEquals`
  - `name` → `sh:name`
  - `description` → `sh:description`
  - `order` → `sh:order`
  - `group` → `sh:group`
  - `valueShape` → `sh:node`
- NodeShape level:
  - `rdf:type sh:NodeShape`
  - `sh:targetClass` → the shape's `targetClass`
  - `sh:property` → blank node per PropertyShape

**Pros:**
- Simple, explicit, easy to test
- No dependency on query engine internals
- Full control over blank node generation (for `sh:in` RDF lists, complex paths, etc.)

**Cons:**
- Doesn't reuse the existing mutation/query infrastructure
- Parallel triple-generation logic that could drift from the query engine

### Route B: Shape-as-data via `NodeShape.create()`

Define a SHACL meta-shape (a Shape class whose instances ARE NodeShapes) and use the existing `Shape.create()` / `CreateBuilder` pipeline to generate INSERT SPARQL for shape definitions.

**Approach:**
```ts
// A Shape class that describes SHACL NodeShapes themselves
@linkedShape({targetClass: shacl.NodeShape})
class SHACLNodeShape extends Shape {
  @objectProperty({path: shacl.targetClass})
  targetClass: NodeReferenceValue;

  @objectProperty({path: shacl.property, shape: SHACLPropertyShape})
  properties: SHACLPropertyShape[];
}

@linkedShape({targetClass: shacl.PropertyShape})
class SHACLPropertyShape extends Shape {
  @objectProperty({path: shacl.path})
  path: NodeReferenceValue;

  @literalProperty({path: shacl.minCount, datatype: xsd.integer})
  minCount: number;
  // ... etc
}

// Usage: serialize a shape by creating an instance of the meta-shape
const triples = SHACLNodeShape.create({
  targetClass: personShape.targetClass,
  properties: personShape.propertyShapes.map(ps => ({
    path: ps.path,
    minCount: ps.minCount,
    // ...
  }))
});
```

**Pros:**
- Reuses the engine's own mutation pipeline — dogfooding
- The SHACL shape definition IS a linked data shape, which is conceptually elegant
- Gets INSERT SPARQL for free — can directly push shapes to a triplestore
- Validates the engine's own capabilities (can it describe itself?)

**Cons:**
- Complex property paths (`PathExpr`) don't map cleanly to simple property values — `sh:path` can be a blank node tree (sequences, inverses, etc.), which `CreateBuilder` may not handle
- `sh:in` requires RDF lists (blank node chains), which `CreateBuilder` likely doesn't support
- The meta-shape approach may hit edge cases in the engine that aren't designed for self-description
- More complex to implement and test

### Route C: Hybrid — meta-shape for simple fields, serializer for complex ones

Use Route B's meta-shape approach for the straightforward scalar fields (`minCount`, `maxCount`, `name`, `class`, `datatype`, etc.) and fall back to the dedicated serializer (Route A) for complex structures (`sh:path` with property path expressions, `sh:in` with RDF lists).

**Pros:**
- Dogfoods the engine where it works well
- Handles complex RDF structures correctly
- Tests the engine's capabilities while acknowledging its current limits

**Cons:**
- Two code paths for one feature
- More complex than either pure approach

## Considerations

### What output format?

- **Triples array**: `{subject, predicate, object}[]` — most flexible, can be serialized to any RDF format
- **INSERT SPARQL**: Ready to execute against a triplestore — natural fit with `CreateBuilder`
- **Turtle string**: Human-readable, good for debugging and config files
- **JSON-LD**: Matches the library's JSON-oriented approach
- Could support multiple: generate triples internally, offer serializers to different formats

### Blank node handling

SHACL property shapes are typically blank nodes (anonymous). Complex paths, `sh:in` lists, and `sh:or`/`sh:and` groups all use blank node structures. The serializer needs a blank node ID generator.

### Named graph placement

SHACL shapes are often stored in a separate named graph (e.g., `<urn:shapes>`) so they don't mix with instance data. The serialization should support specifying a target graph.

### Incremental / partial serialization

Should users be able to serialize a single PropertyShape independently? Or always a full NodeShape with all its properties? Probably both — individual PropertyShape serialization is useful for testing and for adding constraints incrementally.

### The `sh:in` RDF list problem

`sh:in` values are serialized as RDF lists (linked blank nodes with `rdf:first`/`rdf:rest`). This is a common pain point. The serializer needs an RDF list builder utility. This same utility would be useful for `sh:path` sequences (which `serializePathToSHACL.ts` already handles).

### Completeness of `src/ontologies/shacl.ts`

The current SHACL ontology file may not export all needed predicates. Need to verify it covers: `sh:targetClass`, `sh:property`, `sh:path`, `sh:class`, `sh:datatype`, `sh:nodeKind`, `sh:minCount`, `sh:maxCount`, `sh:equals`, `sh:disjoint`, `sh:hasValue`, `sh:in`, `sh:lessThan`, `sh:lessThanOrEquals`, `sh:name`, `sh:description`, `sh:order`, `sh:group`, `sh:node`, `sh:closed`, `sh:ignoredProperties`.

## Open Questions

1. Should this be a method on NodeShape (`nodeShape.toSHACL()`) or a standalone function?
2. Should we support reading/importing SHACL RDF back into NodeShape objects (round-trip)?
3. Which output format(s) to support initially?
4. Should the serialized output include `sh:closed` / `sh:ignoredProperties` based on shape configuration?
5. How does this interact with shape inheritance (subclasses)?

---

## Extension: Shape Metadata Sync to Database

### Context

`lincd-server` had a `syncShapes()` function (`utils/Shapes.ts`) that built a shape metadata index on the backend at startup. It read all locally-registered `NodeShape` instances (populated by `@linkedShape` decorators) and converted their metadata (label, targetClass, properties with SHACL constraints) into a `Record<string, ShapeDetails>` index.

The DB sync portion (comparing local shapes against shapes stored in Fuseki, creating/updating/deleting to keep them in sync) was already mostly commented out before the `@_linked/core` migration. The old sync code used `resolveQueryPropertyPath`, `instanceof NamedNode`, `instanceof NodeSet` — all removed APIs.

### What's needed

A function in `@_linked/core` that takes all registered `NodeShape` instances and produces **update/create queries** that can be executed against any store (Fuseki, etc.) to sync shape metadata. This is the "code is source of truth → Fuseki is runtime cache" pattern described in ARCHITECTURE_REVIEW.md.

### Requirements

1. Read all `NodeShape` instances from `NodeShape.getLocalInstancesByType()`
2. For each shape, produce a `CreateQuery` or `UpdateQuery` containing:
   - Shape-level: `id`, `label`, `targetClass`, `description`, `type`, `extends`
   - Per-property: `id`, `label`, `path`, `valueShape`, `datatype`, `description`, `maxCount`, `minCount`, `nodeKind`, `name`, plus SHACL validation constraints (`pattern`, `minLength`, `maxLength`, `minInclusive`, `maxInclusive`, `minExclusive`, `maxExclusive`, `inList`)
3. Handle diffing: compare local metadata against what's in the database, only update what changed
4. Handle deletions: shapes/properties that exist in DB but not locally should be removed
5. Output should be executable via `LinkedStorage` (the standard query execution path)

### Relation to SHACL RDF serialization

This is complementary to Routes A/B/C above. The serialization routes produce SHACL-compliant RDF triples for external consumption (validation engines, triplestores). The sync function uses the **query engine's own mutation pipeline** (`CreateQuery`/`UpdateQuery`) to maintain shape metadata as queryable data in the project's store.

Both could share the shape-walking logic (iterating NodeShape properties, reading constraints), but the output format differs: raw RDF triples vs. query builder calls.

### Current state

The old `syncShapes()` in `lincd-server` is marked deprecated. The active code path just builds an in-memory index (no DB writes). The DB sync code is commented out. Once this feature is implemented in `@_linked/core`, the old code can be fully removed.
