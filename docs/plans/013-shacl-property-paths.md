# Full SHACL Property Paths — Architecture Plan

> Converts ideation decisions from `docs/ideas/013-shacl-property-paths.md` into an implementation plan.

## Summary

Add support for all SPARQL property path forms in property decorators, SHACL serialization, and query/SPARQL generation. The implementation adds a `PathExpr` AST, a string parser, a normalization pipeline, SHACL path serialization, and IR/SPARQL property-path emission — all while preserving full backward compatibility.

## Architecture decisions

### 1. New file: `src/paths/PropertyPathExpr.ts`

Houses the canonical AST types and the string parser.

**Types:**

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

**Parser:** Recursive-descent parser for SPARQL property path grammar. Operates on raw prefixed strings (e.g. `ex:friend/ex:name`). No prefix resolution — that happens downstream.

**Grammar (precedence low→high):**
1. `alt` — `A | B`
2. `seq` — `A / B`
3. `unary` — `^A` (inverse), `A*` (zeroOrMore), `A+` (oneOrMore), `A?` (zeroOrOne)
4. `primary` — `prefixedName`, `<iri>`, `!(...)` (negatedPropertySet), `(group)`

**Exports:** `PathExpr`, `PathRef`, `parsePropertyPath(input: string): PathExpr`

### 2. New file: `src/paths/normalizePropertyPath.ts`

Replaces and extends the current `normalizePathInput` in SHACL.ts.

**Function:** `normalizePropertyPath(input: PropertyPathDecoratorInput): PathExpr`

Handles all input forms:
- `string` without operators → treated as simple IRI ref (backward compat)
- `string` with operators (`/`, `|`, `^`, `*`, `+`, `?`, `(`, `!`) → parsed via `parsePropertyPath`
- `{id: string}` → preserved as `PathRef`
- `PathExpr` object (has `seq`, `alt`, `inv`, etc.) → passed through
- `Array` → converted to `{seq: [...]}`  (backward compat for `[ref1, ref2]`)

### 3. Changes to `src/shapes/SHACL.ts`

**Type changes:**
- `PropertyPathInput` widens from `NodeReferenceValue` to `PropertyPathDecoratorInput`
- `PropertyPathInputList` kept for backward compat but now unions with `PathExpr`
- `PropertyShapeConfig.path` type becomes `PropertyPathDecoratorInput`
- `PropertyShape.path` type becomes `PathExpr` (normalized canonical form)

**`PropertyPathDecoratorInput` type:**
```ts
type PropertyPathDecoratorInput =
  | string
  | {id: string}
  | PropertyPathDecoratorInput[]  // sequence shorthand
  | PathExpr;
```

**Function changes:**
- `normalizePathInput` → delegates to `normalizePropertyPath` from the new module
- `createPropertyShape` stores the normalized `PathExpr` on `propertyShape.path`

**Backward compat:** Existing decorators like `@literalProperty({path: name})` where `name = {id: '...'}` continue to work because `{id: string}` is a valid `PathRef` which is a valid `PathExpr`.

### 4. New file: `src/paths/serializePathToSHACL.ts`

Serializes `PathExpr` to SHACL RDF structures.

**Strategy:**
- Simple `PathRef` (single IRI) → direct IRI node (current behavior)
- `{seq: [...]}` → RDF list of path nodes
- `{alt: [...]}` → blank node with `sh:alternativePath` → RDF list
- `{inv: ...}` → blank node with `sh:inversePath`
- `{zeroOrMore: ...}` → blank node with `sh:zeroOrMorePath`
- `{oneOrMore: ...}` → blank node with `sh:oneOrMorePath`
- `{zeroOrOne: ...}` → blank node with `sh:zeroOrOnePath`
- `{negatedPropertySet: ...}` → throws `Error('negatedPropertySet cannot be serialized to SHACL sh:path')`

**Output format:** Returns an array of `{subject, predicate, object}` triples representing the path structure, plus the root node reference.

### 5. Changes to IR layer

**`IntermediateRepresentation.ts` — `IRTraversePattern`:**
```ts
type IRTraversePattern = {
  kind: 'traverse';
  from: IRAlias;
  to: IRAlias;
  property: string;
  pathExpr?: PathExpr;  // NEW: when present, emits property path syntax
  filter?: IRExpression;
};
```

When `pathExpr` is present, SPARQL generation uses it instead of `property` for the predicate position.

**`IRDesugar.ts` — `DesugaredPropertyStep`:**
```ts
type DesugaredPropertyStep = {
  kind: 'property_step';
  propertyShapeId: string;
  pathExpr?: PathExpr;  // NEW: complex path expression from PropertyShape
  where?: DesugaredWhere;
};
```

The desugarer reads `PropertyShape.path` and if it's a complex `PathExpr` (not a simple `PathRef`), attaches it to the step.

**`IRLower.ts`:**
- `getOrCreateTraversal` propagates `pathExpr` from `DesugaredPropertyStep` to `IRTraversePattern`
- When a step has `pathExpr`, the full path expression is used in a single traversal (no multi-hop decomposition)

### 6. Changes to SPARQL generation

**`SparqlAlgebra.ts` — `SparqlTerm`:**
```ts
type SparqlTerm =
  | {kind: 'variable'; name: string}
  | {kind: 'iri'; value: string}
  | {kind: 'literal'; value: string; datatype?: string; language?: string}
  | {kind: 'path'; value: string};  // NEW: property path expression as predicate
```

**`irToAlgebra.ts`:**
- `case 'traverse'`: when `pattern.pathExpr` is present, produce `{kind: 'path', value: pathExprToSparql(pattern.pathExpr)}` as predicate instead of `iriTerm(pattern.property)`

**New function `pathExprToSparql(expr: PathExpr): string`:**
Renders the AST to SPARQL property path syntax:
- `PathRef` → `<iri>` or `prefix:local`
- `{seq: [A, B]}` → `A/B`
- `{alt: [A, B]}` → `A|B`
- `{inv: A}` → `^A`
- `{zeroOrMore: A}` → `A*`
- `{oneOrMore: A}` → `A+`
- `{zeroOrOne: A}` → `A?`
- `{negatedPropertySet: [...]}` → `!(A|B|...)`
- Parentheses added when needed for precedence

**`algebraToString.ts`:**
- When serializing a triple whose predicate is `{kind: 'path'}`, emit the path value directly instead of wrapping in `<>`.

### 7. Test strategy

All tests use Jest. New test files:

1. **`src/tests/property-path-parser.test.ts`** — Unit tests for `parsePropertyPath`:
   - Each operator form individually
   - Nested/grouped combinations
   - Error cases (malformed input)

2. **`src/tests/property-path-normalize.test.ts`** — Unit tests for `normalizePropertyPath`:
   - String inputs (simple and complex)
   - Object inputs (`{id}`, `PathExpr`)
   - Array inputs (sequence shorthand)
   - Backward compat with existing `NodeReferenceValue`

3. **`src/tests/property-path-shacl.test.ts`** — Unit tests for SHACL serialization:
   - Each path form → expected RDF triples
   - `negatedPropertySet` → expected error

4. **`src/tests/property-path-sparql.test.ts`** — Golden tests for end-to-end SPARQL generation:
   - New test fixtures with path decorators
   - Expected SPARQL output for each path form

## Expected file changes

| File | Change type | Description |
|------|-------------|-------------|
| `src/paths/PropertyPathExpr.ts` | **New** | AST types + string parser |
| `src/paths/normalizePropertyPath.ts` | **New** | Normalization pipeline |
| `src/paths/serializePathToSHACL.ts` | **New** | SHACL RDF serialization |
| `src/paths/pathExprToSparql.ts` | **New** | PathExpr → SPARQL string |
| `src/shapes/SHACL.ts` | **Modify** | Widen path types, delegate normalization |
| `src/queries/IntermediateRepresentation.ts` | **Modify** | Add optional `pathExpr` to `IRTraversePattern` |
| `src/queries/IRDesugar.ts` | **Modify** | Attach `pathExpr` to `DesugaredPropertyStep` |
| `src/queries/IRLower.ts` | **Modify** | Propagate `pathExpr` through traversals |
| `src/sparql/SparqlAlgebra.ts` | **Modify** | Add `path` term kind |
| `src/sparql/irToAlgebra.ts` | **Modify** | Emit path predicate for traverse with `pathExpr` |
| `src/sparql/algebraToString.ts` | **Modify** | Serialize `path` term kind |
| `src/tests/property-path-parser.test.ts` | **New** | Parser unit tests |
| `src/tests/property-path-normalize.test.ts` | **New** | Normalizer unit tests |
| `src/tests/property-path-shacl.test.ts` | **New** | SHACL serialization tests |
| `src/tests/property-path-sparql.test.ts` | **New** | End-to-end SPARQL golden tests |

## Pitfalls

1. **Backward compat in `PropertyShape.path`**: The `path` field changes from `PropertyPathInputList` to `PathExpr`. All downstream consumers that read `path` (e.g., desugarer reading `path[0].id` or `path.id`) must handle both the old `{id}` form (which is a valid `PathRef`) and complex `PathExpr` forms. The key risk is in `IRDesugar.ts:segmentsToSteps` which reads `segment.id` — this continues to work because `PropertyShape.id` is set by `registerPropertyShape`, not from path.

2. **Parser edge cases**: Prefixed names can contain characters that overlap with operators (e.g., `ex:name+` — is this `oneOrMore('ex:name')` or an IRI `ex:name+`?). The parser must follow SPARQL spec: `+`, `*`, `?` are postfix operators, so `ex:name+` = `oneOrMore(ex:name)`. Document this.

3. **SHACL negatedPropertySet**: Must throw at serialization boundary, not at parse time. The AST accepts it (per decision 5b) but SHACL doesn't support it.

4. **Traversal deduplication**: `LoweringContext.getOrCreateTraversal` keys on `${fromAlias}:${propertyShapeId}`. For complex paths, the `propertyShapeId` is the PropertyShape ID (not the path expression). This means two different complex paths on the same property shape correctly share traversals.

## Contracts

### Parser contract
- Input: raw string (may contain prefixed names)
- Output: `PathExpr` AST
- Errors: throws on syntax errors with position info
- Does NOT resolve prefixes

### Normalizer contract
- Input: `PropertyPathDecoratorInput` (any form)
- Output: canonical `PathExpr`
- Preserves string refs as-is (no `{id}` wrapping at this stage — refs stay as `PathRef`)

### SHACL serializer contract
- Input: `PathExpr`
- Output: `{root: NodeRef, triples: Triple[]}`
- Throws on `negatedPropertySet`

### SPARQL emitter contract
- Input: `PathExpr`
- Output: SPARQL property path string with correct precedence and parenthesization
- Handles all forms including `negatedPropertySet`

## Phases

### Phase 1: AST types + string parser + normalizer

**Dependency:** None (leaf phase).

**Tasks:**
1. Create `src/paths/PropertyPathExpr.ts` with `PathExpr`, `PathRef` types and `parsePropertyPath` function
2. Create `src/paths/normalizePropertyPath.ts` with `normalizePropertyPath` function
3. Create `src/tests/property-path-parser.test.ts` — parser unit tests
4. Create `src/tests/property-path-normalize.test.ts` — normalizer unit tests

**Validation:**
- `npm test -- --testPathPattern="property-path-(parser|normalize)"` passes
- Parser handles all 8 path forms: predicate, sequence, alternative, inverse, zeroOrMore, oneOrMore, zeroOrOne, negatedPropertySet
- Parser handles nested/grouped expressions: `(ex:a|^ex:b)/ex:c+`
- Parser throws on malformed input with position info
- Normalizer handles: string, `{id}`, `PathExpr` object, array

### Phase 2: SHACL type integration + SHACL serialization

**Dependency:** Phase 1 (uses `PathExpr` types and `normalizePropertyPath`).

**Tasks:**
1. Modify `src/shapes/SHACL.ts`: widen `PropertyPathInput`/`PropertyPathInputList` types, update `PropertyShape.path` to `PathExpr`, delegate `normalizePathInput` to `normalizePropertyPath`
2. Create `src/paths/serializePathToSHACL.ts` — SHACL path serialization
3. Create `src/tests/property-path-shacl.test.ts` — SHACL serialization tests
4. Verify all existing tests still pass (backward compat)

**Validation:**
- `npm test` passes (all existing tests unchanged)
- `npm test -- --testPathPattern="property-path-shacl"` passes
- SHACL serializer handles: predicate, sequence, alternative, inverse, zeroOrMore, oneOrMore, zeroOrOne
- SHACL serializer throws for negatedPropertySet

### Phase 3: Query/IR/SPARQL generation

**Dependency:** Phase 2 (uses `PathExpr` on `PropertyShape.path`).

**Tasks:**
1. Add optional `pathExpr` to `IRTraversePattern` in `IntermediateRepresentation.ts`
2. Add optional `pathExpr` to `DesugaredPropertyStep` in `IRDesugar.ts`; attach from `PropertyShape.path` when complex
3. Propagate `pathExpr` in `IRLower.ts` through `getOrCreateTraversal`
4. Create `src/paths/pathExprToSparql.ts` — PathExpr → SPARQL property path string
5. Add `path` term kind to `SparqlTerm` in `SparqlAlgebra.ts`
6. Update `irToAlgebra.ts`: when `pathExpr` present on traverse, emit `path` term as predicate
7. Update `algebraToString.ts`: serialize `path` term kind directly (no `<>` wrapping)
8. Create `src/tests/property-path-sparql.test.ts` — end-to-end golden tests
9. Verify all existing tests still pass

**Validation:**
- `npm test` passes (all existing + new tests)
- `npm test -- --testPathPattern="property-path-sparql"` passes
- Golden tests cover: each path form individually + nested combination
- Existing SPARQL golden tests produce identical output (no regression)

## Dependency graph

```
Phase 1 (AST + parser + normalizer)
    ↓
Phase 2 (SHACL integration + serialization)
    ↓
Phase 3 (Query/IR/SPARQL)
```

Strictly sequential — each phase depends on the prior.

## Parallelization notes

- Within Phase 1: parser and normalizer can be written in parallel (parser is a dependency of normalizer, but both can be scaffolded together).
- Within Phase 3: tasks 1–3 (IR changes) and task 4 (pathExprToSparql) are independent and can be done in parallel. Tasks 5–7 (algebra changes) depend on task 4. Task 8 (tests) depends on all prior tasks.
