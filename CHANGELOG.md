# Changelog

## 2.2.3

### Patch Changes

- [#42](https://github.com/Semantu/linked/pull/42) [`1b4d114`](https://github.com/Semantu/linked/commit/1b4d114f22aec4e984b744733dbab603df8b282d) Thanks [@flyon](https://github.com/flyon)! - Add `PendingQueryContext` for lazy query context resolution. `getQueryContext()` now returns a live reference with a lazy `.id` getter instead of `null` when the context hasn't been set yet. `QueryBuilder.for()` accepts `PendingQueryContext` and `null`. New `hasPendingContext()` method. `setQueryContext(name, null)` now properly clears the entry. Test Fuseki port changed to 3939; `globalSetup`/`globalTeardown` added for reliable Fuseki auto-start.

## 2.2.2

### Patch Changes

- [#40](https://github.com/Semantu/linked/pull/40) [`4688fdd`](https://github.com/Semantu/linked/commit/4688fdd3edb949ddca50886d51549aa543a99033) Thanks [@flyon](https://github.com/flyon)! - ### Bug fixes

  - **`MutationQuery.convertNodeDescription()`** no longer mutates the caller's input object. Previously, `delete obj.id` / `delete obj.__id` operated directly on the passed-in object, causing shared references to lose their `id` across sequential creates.
  - **`SparqlStore.createQuery()`** now respects a pre-set `data.id` from `__id` instead of always generating a new URI via `generateEntityUri()`. Entities created with custom identity (e.g. webID) are now stored under the correct URI.

  ### Test infrastructure

  - Jest config simplified: `roots` + single `testMatch` pattern prevents duplicate test runs.
  - Fuseki integration tests now call `ensureFuseki()` to auto-start Docker when Fuseki isn't running.
  - Parallel test safety: `afterAll` clears data instead of deleting the shared dataset.
  - Added regression tests for both fixes (unit + Fuseki integration).

## 2.2.1

### Patch Changes

- [#37](https://github.com/Semantu/linked/pull/37) [`0a3adc1`](https://github.com/Semantu/linked/commit/0a3adc1b9c47d9101da6d5c8b09e44531e2e396f) Thanks [@flyon](https://github.com/flyon)! - Fix SPARQL generation for `.where()` filters with OR conditions and `.every()`/`.some()` quantifiers.
  Tightened assertions across multiple integration tests.

## 2.2.0

### Patch Changes

- [#34](https://github.com/Semantu/linked/pull/34) [`e2ae4a2`](https://github.com/Semantu/linked/commit/e2ae4a28e5be28716e1634ca81d9c379a291cbc6) Thanks [@flyon](https://github.com/flyon)! - ### SHACL property path support

  Property decorators now accept full SPARQL property path syntax:

  ```ts
  @literalProperty({path: 'foaf:knows/foaf:name'})        // sequence
  @literalProperty({path: '<http://ex.org/a>|<http://ex.org/b>'})  // alternative
  @literalProperty({path: '^foaf:knows'})                  // inverse
  @literalProperty({path: 'foaf:knows*'})                  // zeroOrMore
  ```

  New exports from `src/paths/`:

  - `PathExpr`, `PathRef` — AST types for property paths
  - `parsePropertyPath(input): PathExpr` — parser for SPARQL property path strings
  - `normalizePropertyPath(input): PathExpr` — normalizes any input form to canonical AST
  - `pathExprToSparql(expr): string` — renders PathExpr to SPARQL syntax
  - `serializePathToSHACL(expr): SHACLPathResult` — serializes to SHACL RDF triples

  `PropertyShape.path` is now typed as `PathExpr` (was opaque). Complex paths flow through the full IR pipeline and emit correct SPARQL property path syntax in generated queries.

  ### Strict prefix resolution in query API

  `QueryBuilder.for()` and `.forAll()` now throw on unregistered prefixes instead of silently passing through. New export:

  - `resolveUriOrThrow(str): string` — strict prefix resolution (throws on unknown prefix)

  ### SHACL constraint field fixes

  - `hasValue` and `in` config fields now correctly handle literal values (`string`, `number`, `boolean`) — previously all values were wrapped as IRI nodes
  - `lessThan` and `lessThanOrEquals` config fields are now wired into `createPropertyShape` and exposed via `getResult()`
  - New `PropertyShapeResult` interface provides typed access to `getResult()` output

## 2.1.0

### Minor Changes

- [#31](https://github.com/Semantu/linked/pull/31) [`eb88865`](https://github.com/Semantu/linked/commit/eb8886564f2c9663805c4308a834ca615f9a1dab) Thanks [@flyon](https://github.com/flyon)! - Properties in `select()` and `update()` now support expressions — you can compute values dynamically instead of just reading or writing raw fields.

  ### What's new

  - **Computed fields in queries** — chain expression methods on properties to derive new values: string manipulation (`.strlen()`, `.ucase()`, `.concat()`), arithmetic (`.plus()`, `.times()`, `.abs()`), date extraction (`.year()`, `.month()`, `.hours()`), and comparisons (`.gt()`, `.eq()`, `.contains()`).

    ```typescript
    await Person.select((p) => ({
      name: p.name,
      nameLen: p.name.strlen(),
      ageInMonths: p.age.times(12),
    }));
    ```

  - **Expression-based WHERE filters** — filter using computed conditions, not just equality checks. Works on queries, updates, and deletes.

    ```typescript
    await Person.select((p) => p.name).where((p) => p.name.strlen().gt(5));
    await Person.update({ verified: true }).where((p) => p.age.gte(18));
    ```

  - **Computed updates** — when updating data, calculate new values based on existing ones instead of providing static values. Pass a callback to `update()` to reference current field values.

    ```typescript
    await Person.update((p) => ({ age: p.age.plus(1) })).for(entity);
    await Person.update((p) => ({
      label: p.firstName.concat(" ").concat(p.lastName),
    })).for(entity);
    ```

  - **`Expr` module** — for expressions that don't start from a property, like the current timestamp, conditional logic, or coalescing nulls.

    ```typescript
    await Person.update({ lastSeen: Expr.now() }).for(entity);
    await Person.select((p) => ({
      displayName: Expr.firstDefined(p.nickname, p.name),
    }));
    ```

  Update expression callbacks are fully typed — `.plus()` only appears on number properties, `.strlen()` only on strings, etc.

  ### New exports

  `ExpressionNode`, `Expr`, `ExpressionInput`, `PropertyRefMap`, `ExpressionUpdateProxy<S>`, `ExpressionUpdateResult<S>`, and per-type method interfaces (`NumericExpressionMethods`, `StringExpressionMethods`, `DateExpressionMethods`, `BooleanExpressionMethods`, `BaseExpressionMethods`).

  See the [README](./README.md#computed-expressions) for the full method reference and more examples.

## 2.0.1

### Patch Changes

- [#27](https://github.com/Semantu/linked/pull/27) [`d3c1e91`](https://github.com/Semantu/linked/commit/d3c1e918b2a63240ddbf3cb550ec43fa1e019c35) Thanks [@flyon](https://github.com/flyon)! - Add MINUS support on QueryBuilder with multiple call styles:

  - `.minus(Shape)` — exclude by shape type
  - `.minus(p => p.prop.equals(val))` — exclude by condition
  - `.minus(p => p.prop)` — exclude by property existence
  - `.minus(p => [p.prop1, p.nested.prop2])` — exclude by multi-property existence with nested path support

  Add bulk delete operations:

  - `Shape.deleteAll()` / `DeleteBuilder.from(Shape).all()` — delete all instances with schema-aware blank node cleanup
  - `Shape.deleteWhere(fn)` / `DeleteBuilder.from(Shape).where(fn)` — conditional delete

  Add conditional update operations:

  - `.update(data).where(fn)` — update matching instances
  - `.update(data).forAll()` — update all instances

  API cleanup:

  - Deprecate `sortBy()` in favor of `orderBy()`
  - Remove `DeleteBuilder.for()` — use `DeleteBuilder.from(shape, ids)` instead
  - Require `data` parameter in `Shape.update(data)`

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
