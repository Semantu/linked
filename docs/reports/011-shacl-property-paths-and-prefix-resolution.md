# Report: SHACL Property Paths & Prefix Resolution

**Plans:** `013-shacl-property-paths`, `014-prefixed-uris-in-json`
**Ideation docs:** `docs/ideas/013-shacl-property-paths.md`, `docs/ideas/014-prefixed-uris-in-json.md`
**Deferred work:** `docs/ideas/015-shacl-rdf-serialization.md`

## Summary

Added full SPARQL property path support in property decorators with end-to-end pipeline from decorator config through SHACL serialization and SPARQL generation. Also added strict prefix resolution in the query API (`.for()`, `.forAll()`), fixed SHACL constraint field type semantics, and wired up missing `lessThan`/`lessThanOrEquals` fields.

## Architecture Overview

### Property Path Pipeline

```
Decorator config string    →  parsePropertyPath()  →  PathExpr AST
                                                          ↓
PropertyPathDecoratorInput →  normalizePropertyPath() →  PathExpr (canonical)
                                                          ↓
                                                    PropertyShape.path
                                                          ↓
                                          ┌───────────────┼───────────────┐
                                          ↓               ↓               ↓
                                   serializePathToSHACL  IRDesugar     pathExprToSparql
                                   (RDF triples)       (DesugaredStep)  (SPARQL string)
                                                          ↓
                                                      IRLower
                                                    (IRTraversePattern)
                                                          ↓
                                                      irToAlgebra
                                                    (SparqlTerm 'path')
                                                          ↓
                                                    algebraToString
                                                    (final SPARQL)
```

### PathExpr AST

Discriminated-object union representing all SPARQL property path forms:

```ts
type PathRef = string | {id: string};
type PathExpr =
  | PathRef
  | {seq: PathExpr[]}
  | {alt: PathExpr[]}
  | {inv: PathExpr}
  | {zeroOrMore: PathExpr}
  | {oneOrMore: PathExpr}
  | {zeroOrOne: PathExpr}
  | {negatedPropertySet: (PathRef | {inv: PathRef})[]};
```

Simple `PathRef` values (single IRI) are backward-compatible with the pre-existing `{id: string}` pattern used throughout the codebase.

## New Files

### `src/paths/PropertyPathExpr.ts`
- **PathExpr/PathRef types** — canonical AST for all SPARQL property path forms
- **`parsePropertyPath(input: string): PathExpr`** — recursive-descent parser supporting sequence (`/`), alternative (`|`), inverse (`^`), repetition (`*`, `+`, `?`), negatedPropertySet (`!`), grouping (`()`), and angle-bracket IRIs (`<...>`)
- **`isPathRef()`, `isComplexPathExpr()`** — type guards
- **`PATH_OPERATOR_CHARS`** — regex for detecting path operators in strings

### `src/paths/normalizePropertyPath.ts`
- **`normalizePropertyPath(input: PropertyPathDecoratorInput): PathExpr`** — normalizes any input form to canonical PathExpr: strings with operators are parsed, arrays become `{seq}`, `{id}` and structured PathExpr pass through
- **`PropertyPathDecoratorInput`** — union type: `string | {id} | PathExpr | array`
- **`getSimplePathId(expr: PathExpr): string | null`** — extracts IRI from simple paths (backward compat helper)

### `src/paths/pathExprToSparql.ts`
- **`pathExprToSparql(expr: PathExpr): string`** — renders PathExpr to SPARQL property path syntax with correct precedence parenthesization
- **`collectPathUris(expr: PathExpr): string[]`** — walks AST collecting full IRIs for PREFIX block generation
- Uses `formatUri()` from sparqlUtils for full-IRI-to-prefixed-form rendering

### `src/paths/serializePathToSHACL.ts`
- **`serializePathToSHACL(expr: PathExpr): SHACLPathResult`** — serializes PathExpr to SHACL RDF triples using blank nodes and RDF lists per SHACL spec
- Supports: sequence (RDF list), alternative (`sh:alternativePath`), inverse (`sh:inversePath`), zeroOrMore/oneOrMore/zeroOrOne (`sh:*Path`)
- Throws on `negatedPropertySet` (no SHACL representation)
- **`resetBlankNodeCounter()`** — for deterministic testing

## Modified Files

### `src/shapes/SHACL.ts`
- **`PropertyShape.path`** type changed from `PropertyPathInputList` to `PathExpr`
- **`PropertyShape.lessThan`**, **`PropertyShape.lessThanOrEquals`** — new fields, wired in `createPropertyShape`
- **`PropertyShape.hasValueConstraint`** — widened to `NodeReferenceValue | string | number | boolean`
- **`PropertyShape.in`** — widened to `(NodeReferenceValue | string | number | boolean)[]`
- **`PropertyShapeResult`** — new typed interface for `getResult()` output, exposes all constraint fields
- **`createPropertyShape`** — processes `hasValue`/`in` with type dispatch (literals pass through, `{id}` objects go through `toNodeReference`); reads `lessThan`/`lessThanOrEquals` from config
- **`getResult()`** — uses `!== undefined` for `hasValue` to handle falsy literals (0, false, "")
- Removed `toPlainNodeRef` wrapper (was just delegating to `toNodeReference`)
- Removed `normalizePathInput` wrapper (was just delegating to `normalizePropertyPath`)
- Merged duplicate `NodeReferenceValue` import

### `src/utils/NodeReference.ts`
- **`resolvePrefixedUri(str: string): string`** — lenient resolver using `Prefix.toFullIfPossible()`. Passes through full IRIs, plain IDs, and unregistered prefixes unchanged.
- **`resolveUriOrThrow(str: string): string`** — strict resolver using `Prefix.toFull()`. Throws on unknown prefixes. Used at query API boundaries.
- **`toNodeReference`** — simple wrap only (no prefix resolution). String → `{id}`, `{id}` → pass through.

### `src/queries/QueryBuilder.ts`
- `.for()` and `.forAll()` use `resolveUriOrThrow` for strict prefix resolution on string inputs

### `src/queries/IntermediateRepresentation.ts`
- `IRTraversePattern` — added optional `pathExpr: PathExpr` field
- `IRPropertyExpression` — added optional `pathExpr` field

### `src/queries/IRDesugar.ts`
- `DesugaredPropertyStep` — added optional `pathExpr: PathExpr` field
- `segmentsToSteps()` — attaches `pathExpr` from `PropertyShape.path` when complex
- `desugarEntry()` main code path — same `pathExpr` attachment
- `toSortBy()` — same pattern, fixes sortBy with complex paths

### `src/queries/IRLower.ts`
- `getOrCreateTraversal()` — propagates `pathExpr` to `IRTraversePattern`
- `resolveTraversal` callback signature widened to accept optional `pathExpr`

### `src/queries/IRProjection.ts`
- `resolveTraversal` signature widened for `pathExpr`
- `lowerSelectionPathExpression` — passes `pathExpr` through property step traversals and leaf `property_expr` nodes

### `src/sparql/SparqlAlgebra.ts`
- `SparqlTerm` — added `{kind: 'path'; value: string; uris: string[]}` variant

### `src/sparql/irToAlgebra.ts`
- Three locations emit `path` terms when `pathExpr` present: traverse patterns, optional property triples, and EXISTS patterns
- Uses `pathExprToSparql()` and `collectPathUris()` from pathExprToSparql.ts

### `src/sparql/algebraToString.ts`
- `serializeTerm` handles `'path'` kind: returns raw value, collects URIs for PREFIX block

### `src/ontologies/shacl.ts`
- Added SHACL path vocabulary constants: `alternativePath`, `inversePath`, `zeroOrMorePath`, `oneOrMorePath`, `zeroOrOnePath`

### `src/utils/ShapeClass.ts`
- `resolveTargetClassId` — explicit falsy check instead of optional chaining (avoids edge case with `targetClass` being non-null but falsy)

### `jest.config.js`
- Added new test files to test paths array

## Key Design Decisions

### 1. Stateless parser, downstream resolution
The parser produces raw strings — no prefix resolution. Resolution happens at SPARQL rendering time via `formatUri()`. This keeps the parser pure and avoids import-order dependencies with the Prefix registry.

### 2. PathExpr embedded in IR traverse nodes
Complex paths are carried as `pathExpr` on `IRTraversePattern` and `IRPropertyExpression`. When present, SPARQL generation emits the path expression as the predicate. When absent, falls back to simple IRI predicate. This is additive — no existing IR consumers break.

### 3. Prefix resolution scoped to query API only
After iteration 2, prefix resolution was removed from decorators/shapes. Rationale: decorators use ontology imports (`foaf.name`) which provide compile-time safety. The query API (`.for()`, `.forAll()`) uses `resolveUriOrThrow` (strict — throws on unknown prefix) since strings there are always URIs.

### 4. Literal vs IRI discrimination in hasValue/in
`hasValue` and `in` accept mixed types: `{id: string}` for IRI nodes, plain `string | number | boolean` for literals. `createPropertyShape` dispatches on `typeof v === 'object'` to decide whether to wrap via `toNodeReference`.

### 5. negatedPropertySet accepted in AST, rejected at SHACL boundary
The parser and AST accept `negatedPropertySet` (valid SPARQL). SHACL serialization throws because SHACL has no representation for it. SPARQL generation handles it correctly.

## Test Coverage

| Test File | Tests | Coverage |
|-----------|-------|---------|
| `property-path-parser.test.ts` | 34 | All 8 path forms, nested/grouped, error cases |
| `property-path-normalize.test.ts` | 16 | String/object/array inputs, operator detection |
| `property-path-shacl.test.ts` | 11 | All SHACL-supported forms + negatedPropertySet error |
| `property-path-sparql.test.ts` | 24 | E2E golden tests: each form, nested, PREFIX collection |
| `property-path-integration.test.ts` | 7 | Full decorator→SPARQL pipeline |
| `property-path-fuseki.test.ts` | 29 | Live Fuseki E2E (skipped without server) |
| `prefix-resolution.test.ts` | 15 | resolvePrefixedUri, toNodeReference, resolveUriOrThrow |
| `shacl-constraints.test.ts` | 21 | hasValue/in literals, lessThan/lessThanOrEquals, equals/disjoint |

**Total new tests:** 157. **Full suite:** 993 passed, 0 failed (3 suites skipped — require Fuseki).

## Resolved Gaps

1. **Prefix resolution in path SPARQL** — `refToSparql()` uses `formatUri()` for full IRIs; `collectPathUris()` feeds URIs to PREFIX block via `SparqlTerm.uris`
2. **sortBy with complex paths** — `toSortBy()` now copies `pathExpr` from segments
3. **desugarEntry main path missing pathExpr** — both `segmentsToSteps` and the main desugar loop now attach pathExpr
4. **IRPropertyExpression leaf missing pathExpr** — added optional field, threaded through projection
5. **hasValue/in literal handling** — type dispatch preserves literal values, only wraps `{id}` objects
6. **lessThan/lessThanOrEquals not wired** — now read from config and exposed via `getResult()`
7. **Strict prefix resolution in query API** — `resolveUriOrThrow` throws on unknown prefixes (was lenient `toFullIfPossible`)

## Known Limitations

- **`QResult` type doesn't expose constraint fields** — `getResult()` returns runtime values but TypeScript type is limited. Pre-existing issue, not introduced here.
- **No SHACL RDF serialization for shape constraints** — constraint fields are stored correctly but not serialized to RDF. Tracked in `docs/ideas/015-shacl-rdf-serialization.md`.
- **Fuseki E2E tests require running server** — 29 tests in `property-path-fuseki.test.ts` are skipped when Fuseki is unavailable.

## Deferred Work

- **SHACL RDF serialization** (`docs/ideas/015-shacl-rdf-serialization.md`) — serialize full shapes (including constraints) to SHACL RDF triples. Three routes explored in ideation.
- **Builder API for property paths** — fluent API like `path.inv('foaf:knows').zeroOrMore()`. Deferred per ideation decision #6.
