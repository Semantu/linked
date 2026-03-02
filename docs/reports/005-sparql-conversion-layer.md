# Report: SPARQL Conversion Layer

## What changed

Added a complete SPARQL conversion pipeline to `@_linked/core` that compiles the canonical IR into executable SPARQL and maps results back to typed DSL objects.

### New files

| File | Purpose |
|---|---|
| `src/sparql/SparqlAlgebra.ts` | Algebra type definitions aligned with SPARQL 1.1 spec §18 |
| `src/sparql/irToAlgebra.ts` | IR → SPARQL algebra conversion |
| `src/sparql/algebraToString.ts` | Algebra → SPARQL string serialization with automatic PREFIX generation |
| `src/sparql/resultMapping.ts` | SPARQL JSON results → typed DSL result objects |
| `src/sparql/SparqlStore.ts` | Abstract base class wiring the full pipeline |
| `src/sparql/sparqlUtils.ts` | Shared helpers (URI formatting, literal escaping, prefix collection) |
| `src/sparql/index.ts` | Public API re-exports |
| `documentation/sparql-algebra.md` | Full layer documentation |

### Modified files

| File | Change |
|---|---|
| `src/queries/MutationQuery.ts` | Removed dead commented code |
| `src/sparql/irToAlgebra.ts` | Uses ontology imports instead of hardcoded URIs; `as never` for exhaustive switches |
| `src/sparql/resultMapping.ts` | Uses ontology imports; explicit `ResultRow[]` cast |
| `src/index.ts` | Added sparql exports |
| `documentation/intermediate-representation.md` | Updated reference implementations to mention SparqlStore |
| `README.md` | Added pipeline walkthrough, type inference highlight, SparqlStore section |

### Test files (new)

10 test files with ~200 unit tests + 80 Fuseki integration tests covering all query types, golden SPARQL comparison, algebra structure, result mapping, negative cases, and full end-to-end through SparqlStore.

## Key decisions

1. **Three-layer architecture**: IR → algebra (typed AST) → string. The algebra layer is an inspectable data structure that stores can optimize before serialization.
2. **SparqlStore base class**: Concrete stores only implement `executeSparqlSelect()` and `executeSparqlUpdate()`. The base class orchestrates the full pipeline.
3. **OPTIONAL for all properties**: Property triples are wrapped in LeftJoin so missing values produce nulls rather than eliminating rows.
4. **Ontology imports over hardcoded URIs**: XSD/RDF constants come from `src/ontologies/xsd.ts` and `src/ontologies/rdf.ts`.
5. **VariableRegistry with collision detection**: Maps `(alias, property)` pairs to SPARQL variables with counter-based deduplication.
6. **Fully inferred result types**: Highlighted as a top-level feature — the TypeScript return type is automatically inferred from selected paths.

## Deferred work (ideation docs)

- `docs/ideas/005-named-graph-support.md` — DSL `.from()` / `.into()` for GRAPH clauses
- `docs/ideas/006-computed-expressions-and-update-functions.md` — BIND expressions, `L.times()` expression builder, expression-based mutations
- `docs/ideas/007-advanced-query-patterns.md` — MINUS set difference, DELETE WHERE bulk delete

## PR

- PR #14: https://github.com/Semantu/linked/pull/14
- Target: `dev`
- Changeset: major bump for `@_linked/core`
