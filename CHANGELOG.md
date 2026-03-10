# Changelog

## 2.0.0

### Major Changes

- [#23](https://github.com/Semantu/linked/pull/23) [`d2d1eca`](https://github.com/Semantu/linked/commit/d2d1eca3517af11f39348dc83ba5e60703ef86d2) Thanks [@flyon](https://github.com/flyon)! - ## Breaking Changes

  ### `Shape.select()` and `Shape.update()` no longer accept an ID as the first argument

  Use `.for(id)` to target a specific entity instead.

  **Select:**

  ```typescript
  // Before
  const result = await Person.select({ id: "..." }, (p) => p.name);

  // After
  const result = await Person.select((p) => p.name).for({ id: "..." });
  ```

  `.for(id)` unwraps the result type from array to single object, matching the old single-subject overload behavior.

  **Update:**

  ```typescript
  // Before
  const result = await Person.update({ id: "..." }, { name: "Alice" });

  // After
  const result = await Person.update({ name: "Alice" }).for({ id: "..." });
  ```

  `Shape.selectAll(id)` also no longer accepts an id — use `Person.selectAll().for(id)`.

  ### `ShapeType` renamed to `ShapeConstructor`

  The type alias for concrete Shape subclass constructors has been renamed. Update any imports or references:

  ```typescript
  // Before
  import type { ShapeType } from "@_linked/core/shapes/Shape";

  // After
  import type { ShapeConstructor } from "@_linked/core/shapes/Shape";
  ```

  ### `QueryString`, `QueryNumber`, `QueryBoolean`, `QueryDate` classes removed

  These have been consolidated into a single generic `QueryPrimitive<T>` class. If you were using `instanceof` checks against these classes, use `instanceof QueryPrimitive` instead and check the value's type.

  ### Internal IR types removed

  The following types and functions have been removed from `SelectQuery`. These were internal pipeline types — if you were using them for custom store integrations, the replacement is `FieldSetEntry[]` (available from `FieldSet`):

  - Types: `SelectPath`, `QueryPath`, `CustomQueryObject`, `SubQueryPaths`, `ComponentQueryPath`
  - Functions: `fieldSetToSelectPath()`, `entryToQueryPath()`
  - Methods: `QueryBuilder.getQueryPaths()`, `BoundComponent.getComponentQueryPaths()`
  - `RawSelectInput.select` field renamed to `RawSelectInput.entries` (type changed from `SelectPath` to `FieldSetEntry[]`)

  ### `getPackageShape()` return type is now nullable

  Returns `ShapeConstructor | undefined` instead of `typeof Shape`. Code that didn't null-check the return value will now get TypeScript errors.

  ## New Features

  ### `.for(id)` and `.forAll(ids)` chaining

  Consistent API for targeting entities across select and update operations:

  ```typescript
  // Single entity (result is unwrapped, not an array)
  await Person.select((p) => p.name).for({ id: "..." });
  await Person.select((p) => p.name).for("https://...");

  // Multiple specific entities
  await QueryBuilder.from(Person)
    .select((p) => p.name)
    .forAll([{ id: "..." }, { id: "..." }]);

  // All instances (default — no .for() needed)
  await Person.select((p) => p.name);
  ```

  ### Dynamic Query Building with `QueryBuilder` and `FieldSet`

  Build queries programmatically at runtime — for CMS dashboards, API endpoints, configurable reports. See the [Dynamic Query Building](./README.md#dynamic-query-building) section in the README for full documentation and examples.

  Key capabilities:

  - `QueryBuilder.from(Person)` or `QueryBuilder.from('https://schema.org/Person')` — fluent, chainable, immutable query construction
  - `FieldSet.for(Person, ['name', 'knows'])` — composable field selections with `.add()`, `.remove()`, `.pick()`, `FieldSet.merge()`
  - `FieldSet.all(Person, {depth: 2})` — select all decorated properties with optional depth
  - JSON serialization: `query.toJSON()` / `QueryBuilder.fromJSON(json)` and `fieldSet.toJSON()` / `FieldSet.fromJSON(json)`
  - All builders are `PromiseLike` — `await` them directly or call `.build()` to inspect the IR

  ### Mutation Builders

  `CreateBuilder`, `UpdateBuilder`, and `DeleteBuilder` provide the programmatic equivalent of `Person.create()`, `Person.update()`, and `Person.delete()`, accepting Shape classes or shape IRI strings. See the [Mutation Builders](./README.md#mutation-builders) section in the README.

  ### `PropertyPath` exported

  The `PropertyPath` value object is now a public export — a type-safe representation of a sequence of property traversals through a shape graph.

  ```typescript
  import { PropertyPath, walkPropertyPath } from "@_linked/core";
  ```

  ### `ShapeConstructor<S>` type

  New concrete constructor type for Shape subclasses. Eliminates ~30 `as any` casts across the codebase and provides better type safety at runtime boundaries (builder `.from()` methods, Shape static methods).

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
