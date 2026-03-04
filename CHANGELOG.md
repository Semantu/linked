# Changelog

## 1.3.0

### Minor Changes

- [#20](https://github.com/Semantu/linked/pull/20) [`33e9fb0`](https://github.com/Semantu/linked/commit/33e9fb0205343eca8c84723cbabc3f3342e40be5) Thanks [@flyon](https://github.com/flyon)! - **Breaking:** `QueryParser` has been removed. If you imported `QueryParser` directly, replace with `getQueryDispatch()` from `@_linked/core/queries/queryDispatch`. The Shape DSL (`Shape.select()`, `.create()`, `.update()`, `.delete()`) and `SelectQuery.exec()` are unchanged.

  **New:** `getQueryDispatch()` and `setQueryDispatch()` are now exported, allowing custom query dispatch implementations (e.g. for testing or alternative storage backends) without subclassing `LinkedStorage`.

## 1.2.1

### Patch Changes

- [#17](https://github.com/Semantu/linked/pull/17) [`0654780`](https://github.com/Semantu/linked/commit/06547807a7bae56e992eba73263f83e092b7788b) Thanks [@flyon](https://github.com/flyon)! - Preserve nested array sub-select branches in canonical IR so `build()` emits complete traversals, projection fields, and `resultMap` entries for nested selections.

  This fixes cases where nested branches present in `toRawInput().select` were dropped during desugar/lowering (for example nested `friends.select([name, hobby])` branches under another sub-select).

  Also adds regression coverage for desugar preservation, IR lowering completeness, and updated SPARQL golden output for nested query fixtures.

## 1.2.0

### Minor Changes

- [#9](https://github.com/Semantu/linked/pull/9) [`381067b`](https://github.com/Semantu/linked/commit/381067b0fbc25f4a0446c5f8cc0eec57ddded466) Thanks [@flyon](https://github.com/flyon)! - Replaced internal query representation with a canonical backend-agnostic IR AST. `SelectQuery`, `CreateQuery`, `UpdateQuery`, and `DeleteQuery` are now typed IR objects with `kind` discriminators, compact shape/property ID references, and expression trees — replacing the previous ad-hoc nested arrays. The public Shape DSL is unchanged; what changed is what `IQuadStore` implementations receive. Store result types (`ResultRow`, `SelectResult`, `CreateResult`, `UpdateResult`) are now exported. All factories expose `build()` as the primary method. See `documentation/intermediate-representation.md` for the full IR reference and migration guidance.

- [#14](https://github.com/Semantu/linked/pull/14) [`b65e156`](https://github.com/Semantu/linked/commit/b65e15688ac173478e58e1dbb9f26dbaf5fc5a37) Thanks [@flyon](https://github.com/flyon)! - Add SPARQL conversion layer — compiles Linked IR queries into executable SPARQL and maps results back to typed DSL objects.

  **New exports from `@_linked/core/sparql`:**

  - **`SparqlStore`** — abstract base class for SPARQL-backed stores. Extend it and implement two methods to connect any SPARQL 1.1 endpoint:

    ```ts
    import { SparqlStore } from "@_linked/core/sparql";

    class MyStore extends SparqlStore {
      protected async executeSparqlSelect(
        sparql: string
      ): Promise<SparqlJsonResults> {
        /* ... */
      }
      protected async executeSparqlUpdate(sparql: string): Promise<void> {
        /* ... */
      }
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

## 1.1.0

### Minor Changes

- [#4](https://github.com/Semantu/linked/pull/4) [`c35e686`](https://github.com/Semantu/linked/commit/c35e6861600d7aa8683b4b288fc4d1dc74c4aff2) Thanks [@flyon](https://github.com/flyon)! - - Added `Shape.selectAll()` plus nested `selectAll()` support on sub-queries.
  - Added inherited property deduplication via `NodeShape.getUniquePropertyShapes()` so subclass overrides win by label and are selected once.
  - Improved `selectAll()` type inference (including nested queries) and excluded base `Shape` keys from inferred results.
  - Added registration-time override guards: `minCount` cannot be lowered, `maxCount` cannot be increased, and `nodeKind` cannot be widened.
  - Fixed `createPropertyShape` to preserve explicit `minCount: 0` / `maxCount: 0`.
  - Expanded tests and README documentation for `selectAll`, CRUD return types, and multi-value update semantics.

## 1.0.0

### Major Changes

This is a rebranding + extraction release. It moves the core query/shape system into `@_linked/core` and removes RDF models and React-specific code.

Key changes:

- **New package name:** import from `@_linked/core` instead of `lincd`.
- **Node references everywhere:** use `NodeReferenceValue = {id: string}` everywhere. `NamedNode` does not exist in this package.
  - **Before (LINCD.js):**
    ```typescript
    import { NamedNode } from "lincd/models";
    const name = NamedNode.getOrCreate("https://schema.org/name");
    ```
  - **After (`@_linked/core`):**
    ```typescript
    import { createNameSpace } from "@_linked/core/utils/NameSpace";
    const schema = createNameSpace("https://schema.org/");
    const name = schema("name"); // {id: 'https://schema.org/name'}
    ```
- **Decorator paths:** property decorators now require `NodeReferenceValue` paths (no strings, no `NamedNode`).
  - **Before:**
    ```typescript
    @literalProperty({path: foaf.name})
    ```
  - **After:**
    ```typescript
    const name = schema('name');
    @literalProperty({path: name})
    ```
- **Target class and node kinds:** `targetClass`, `datatype`, `nodeKind`, etc. now take `NodeReferenceValue`.
  - **Before:**
    ```typescript
    static targetClass = foaf.Person; // NamedNode
    ```
  - **After:**
    ```typescript
    static targetClass = schema('Person'); // {id: string}
    ```
- **Query context:** context values are `NodeReferenceValue` (or QResults) instead of RDF nodes.
  - **Before:**
    ```typescript
    setQueryContext("user", NamedNode.getOrCreate(userId), Person);
    ```
  - **After:**
    ```typescript
    setQueryContext("user", { id: userId }, Person);
    ```
- **No RDF models in core:** `NamedNode`, `Literal`, `BlankNode`, `Quad`, `Graph`, and all RDF collections are not available in `@_linked/core`. Use a store package (e.g. `@_linked/rdf-mem-store`) if you need RDF models or quad-level access.
- **Shape instances:** shape classes no longer carry RDF nodes or instance graph APIs. Decorated accessors register SHACL metadata but do not implement runtime get/set behavior.
- **Query tracing:** query tracing is proxy-based (no `TestNode`/`TraceShape`).
- **SHACL metadata:** node/property shapes are plain JS objects (`QResult`), not RDF triples.
- **Package registration:** `linkedPackage` now stores package metadata as plain JS (`PackageMetadata`) and keeps legacy URI ids for compatibility.
- **Storage routing:** `LinkedStorage` routes queries to an `IQuadStore` implementation (e.g. `@_linked/rdf-mem-store`).
- **Imports updated:** ontology namespaces now return `NodeReferenceValue` objects, and decorators require `NodeReferenceValue` paths.
