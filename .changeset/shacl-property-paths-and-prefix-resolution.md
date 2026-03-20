---
"@_linked/core": patch
---

### SHACL property path support

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
