---
summary: Design the storage configuration layer — mapping shapes to named graphs, graphs to datasets, datasets to graph databases, and inference rules.
packages: [core, sparql]
---

# Storage Config and Graph Management

## Status: placeholder

This ideation doc is a placeholder for future design work. The storage config layer will determine how shapes, named graphs, datasets, and graph databases relate to each other.

## Prerequisite work completed

The dispatch registry refactoring (plan 001) broke the circular dependency `Shape → QueryParser → LinkedStorage → Shape` and established a clean architectural boundary:

```
Shape ──────────→ queryDispatch.ts ←──────── LinkedStorage
  (calls dispatch)      (leaf)        (registers as dispatch)

LinkedStorage ──→ ShapeClass.ts  (string-based shape lookups)
```

Key changes relevant to storage config:

- **LinkedStorage no longer imports Shape**. Store routing uses `Function` prototype-chain walking + `ShapeClass.getShapeClass()` for string-based shape resolution. This means routing metadata (targetGraph, targetDataset) can be added to `ShapeClass` or to `NodeShape`/`PropertyShape` objects without touching Shape or the dispatch boundary.
- **QueryParser removed**. All query dispatch goes through `queryDispatch.ts`, a single interception point where routing decisions can be made.
- **`shapeToStore` map accepts `Function` keys**. Currently maps shape classes to `IQuadStore` instances. This map (or a parallel one) can be extended to include graph/dataset metadata per shape.

## Key questions to explore

1. **Shape → Graph mapping**: How does the config declare which shapes live in which named graphs? The `ShapeClass` registry already maps shape IDs to classes — could extend with graph URIs.
2. **Graph → Dataset mapping**: How do named graphs compose into datasets?
3. **Dataset → Store mapping**: How does a dataset map to a physical graph database (Fuseki endpoint, Virtuoso, etc.)? `LinkedStorage.shapeToStore` already does shape→store; this would add dataset as an intermediate level.
4. **Inference rules**: Which engines support inference and how does the config express that?
5. **GRAPH clause generation**: Given the storage config, how do the SPARQL conversion utilities decide when and how to emit `GRAPH <uri> { ... }` blocks?
6. **Cross-graph queries**: Queries that span multiple named graphs — how does the config support this?
7. **Default graph behavior**: Different engines treat the default graph differently (union of all named graphs vs empty vs explicit). How does the config handle this?

## Where routing logic would live

The dispatch registry provides a natural interception point. Two viable approaches:

- **Option A: Routing in LinkedStorage** — `LinkedStorage.selectQuery()` already resolves the store via `resolveStoreForQueryShape()`. Extend this to also resolve graph/dataset metadata and pass it through to the store. The dispatch boundary doesn't change.
- **Option B: Routing in dispatch** — Replace the simple dispatch with a routing-aware dispatch that resolves graph/dataset/store before calling the store. This would let different dispatch implementations handle routing differently (e.g. a SPARQL dispatch vs an in-memory dispatch).

## Relationship to SPARQL conversion (001)

The SPARQL conversion utilities (Decision 4 in plan 001) currently take an optional `defaultGraph` in `SparqlOptions`. Once this storage config is designed, that option will be driven by the config rather than manually passed by each store. For now, SPARQL conversion generates no GRAPH wrapping by default.

## Prior art

The OLD implementation used `SPARQLStore.setDefaultGraph(graphIRI)` — a single global graph for all queries. The new design should support per-shape and per-query graph resolution.
