# Changelog

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
