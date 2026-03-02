---
"@_linked/core": minor
---

Add SPARQL conversion layer — compiles Linked IR queries into executable SPARQL and maps results back to typed DSL objects.

**New exports from `@_linked/core/sparql`:**

- **`SparqlStore`** — abstract base class for SPARQL-backed stores. Extend it and implement two methods to connect any SPARQL 1.1 endpoint:
  ```ts
  import {SparqlStore} from '@_linked/core/sparql';

  class MyStore extends SparqlStore {
    protected async executeSparqlSelect(sparql: string): Promise<SparqlJsonResults> { /* ... */ }
    protected async executeSparqlUpdate(sparql: string): Promise<void> { /* ... */ }
  }
  ```

- **IR → SPARQL string** convenience functions (full pipeline in one call):
  - `selectToSparql(query, options?)` — SelectQuery → SPARQL string
  - `createToSparql(query, options?)` — CreateQuery → SPARQL string
  - `updateToSparql(query, options?)` — UpdateQuery → SPARQL string
  - `deleteToSparql(query, options?)` — DeleteQuery → SPARQL string

- **IR → SPARQL algebra** (for stores that want to inspect/optimize the algebra before serialization):
  - `selectToAlgebra(query, options?)` — returns `SparqlSelectPlan`
  - `createToAlgebra(query, options?)` — returns `SparqlInsertDataPlan`
  - `updateToAlgebra(query, options?)` — returns `SparqlDeleteInsertPlan`
  - `deleteToAlgebra(query, options?)` — returns `SparqlDeleteInsertPlan`

- **Algebra → SPARQL string** serialization:
  - `selectPlanToSparql(plan, options?)`, `insertDataPlanToSparql(plan, options?)`, `deleteInsertPlanToSparql(plan, options?)`, `deleteWherePlanToSparql(plan, options?)`
  - `serializeAlgebraNode(node)`, `serializeExpression(expr)`, `serializeTerm(term)`

- **Result mapping** (SPARQL JSON results → typed DSL objects):
  - `mapSparqlSelectResult(json, query)` — handles flat/nested/aggregated results with XSD type coercion
  - `mapSparqlCreateResult(uri, query)` — echoes created fields with generated URI
  - `mapSparqlUpdateResult(query)` — echoes updated fields

- **All algebra types** re-exported: `SparqlTerm`, `SparqlTriple`, `SparqlAlgebraNode`, `SparqlExpression`, `SparqlSelectPlan`, `SparqlInsertDataPlan`, `SparqlDeleteInsertPlan`, `SparqlDeleteWherePlan`, `SparqlPlan`, `SparqlOptions`, etc.

**Bug fixes included:**
- Fixed `isNodeReference()` in MutationQuery.ts — nested creates with predefined IDs (e.g., `{id: '...', name: 'Bestie'}`) now correctly insert entity data instead of only creating the link.

See [SPARQL Algebra Layer docs](./documentation/sparql-algebra.md) for the full type reference, conversion rules, and store implementation guide.
