---
summary: Design the storage configuration layer — mapping shapes to named graphs, graphs to datasets, datasets to graph databases, and inference rules.
packages: [core, sparql]
---

# Storage Config and Graph Management

## Status: placeholder

This ideation doc is a placeholder for future design work. The storage config layer will determine how shapes, named graphs, datasets, and graph databases relate to each other.

## Key questions to explore

1. **Shape → Graph mapping**: How does the config declare which shapes live in which named graphs?
2. **Graph → Dataset mapping**: How do named graphs compose into datasets?
3. **Dataset → Store mapping**: How does a dataset map to a physical graph database (Fuseki endpoint, Virtuoso, etc.)?
4. **Inference rules**: Which engines support inference and how does the config express that?
5. **GRAPH clause generation**: Given the storage config, how do the SPARQL conversion utilities decide when and how to emit `GRAPH <uri> { ... }` blocks?
6. **Cross-graph queries**: Queries that span multiple named graphs — how does the config support this?
7. **Default graph behavior**: Different engines treat the default graph differently (union of all named graphs vs empty vs explicit). How does the config handle this?

## Relationship to SPARQL conversion (001)

The SPARQL conversion utilities (Decision 4 in 001) currently take an optional `defaultGraph` in `SparqlOptions`. Once this storage config is designed, that option will be driven by the config rather than manually passed by each store. For now, SPARQL conversion generates no GRAPH wrapping by default.

## Prior art

The OLD implementation used `SPARQLStore.setDefaultGraph(graphIRI)` — a single global graph for all queries. The new design should support per-shape and per-query graph resolution.
