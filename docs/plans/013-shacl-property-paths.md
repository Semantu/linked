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
| `src/tests/property-path-integration.test.ts` | **New** | Full decorator-to-SPARQL integration tests |

## Pitfalls

1. **Backward compat in `PropertyShape.path`**: The `path` field changes from `PropertyPathInputList` to `PathExpr`. All downstream consumers that read `path` (e.g., desugarer reading `path[0].id` or `path.id`) must handle both the old `{id}` form (which is a valid `PathRef`) and complex `PathExpr` forms. The key risk is in `IRDesugar.ts:segmentsToSteps` which reads `segment.id` — this continues to work because `PropertyShape.id` is set by `registerPropertyShape`, not from path.

2. **Parser edge cases**: Prefixed names can contain characters that overlap with operators (e.g., `ex:name+` — is this `oneOrMore('ex:name')` or an IRI `ex:name+`?). The parser must follow SPARQL spec: `+`, `*`, `?` are postfix operators, so `ex:name+` = `oneOrMore(ex:name)`. Document this.

3. **SHACL negatedPropertySet**: Must throw at serialization boundary, not at parse time. The AST accepts it (per decision 5b) but SHACL doesn't support it.

4. **Traversal deduplication**: `LoweringContext.getOrCreateTraversal` keys on `${fromAlias}:${propertyShapeId}`. For complex paths, the `propertyShapeId` is the PropertyShape ID (not the path expression). This means two different complex paths on the same property shape correctly share traversals.

5. **Prefix resolution direction in paths**: `refToSparql()` in Phase 4 must call `formatUri()` (full IRI → prefixed form) not `Prefix.toFull()` (prefixed → full). The path pipeline always stores full IRIs in `{id}` refs; the prefix shortening happens at SPARQL rendering time. String refs that are already prefixed (like `'ex:name'` from parser output) pass through unchanged — they rely on the ontology having registered its prefix at module load time.

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

### Phase 1: AST types + string parser + normalizer ✓

**Status:** Complete — 50/50 tests passing.

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

### Phase 2: SHACL type integration + SHACL serialization ✓

**Status:** Complete — 882/882 tests passing (11 new SHACL tests).

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

### Phase 3: Query/IR/SPARQL generation ✓

**Status:** Complete — 906/906 tests passing (24 new SPARQL path tests).

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

### Phase 4: Prefix resolution in property path SPARQL

**Status:** Planned

**Dependency:** Phase 3 (modifies `pathExprToSparql` and `algebraToString`).

**Problem:** The parser stores prefixed names as raw strings (ideation decision #2: "no prefix resolution in parser"). But the "downstream" resolution was never implemented. Two independent bugs:

1. **`refToSparql()` in `pathExprToSparql.ts`** formats URIs independently of the `Prefix` registry. Full IRIs get `<>` wrapping, prefixed names pass through bare. It never calls `Prefix.toPrefixed()` or `formatUri()`.
2. **`algebraToString.ts:53-54`** `case 'path': return term.value` — the path term is a pre-rendered string that bypasses `collectUri()` entirely. URIs inside paths are never registered for the PREFIX block.

**Design:** Two-pronged fix that keeps `pathExprToSparql` pure (returns string) but adds a new companion that collects URIs:

1. **Add `collectPathUris(expr: PathExpr): string[]`** to `pathExprToSparql.ts` — walks the `PathExpr` AST and returns all full IRIs found in `PathRef` nodes (both string refs containing `://` and `{id}` refs). This function does NOT collect prefixed-name refs since those are already in prefix:local form and don't need PREFIX declarations — the Prefix registry already registered them at ontology-load time.

2. **Modify `refToSparql()`** to use `formatUri()` from `sparqlUtils.ts` for full IRIs (those with `://`), so that full IRIs in paths get shortened to prefixed form when a prefix is registered. Prefixed-name string refs continue to pass through as-is.

3. **Extend `SparqlTerm` `'path'` variant** to carry `uris: string[]` alongside the rendered `value`:
   ```ts
   | {kind: 'path'; value: string; uris: string[]}
   ```

4. **Update `irToAlgebra.ts`** to populate `uris` when creating path terms:
   ```ts
   const predicate = pattern.pathExpr
     ? {kind: 'path' as const, value: pathExprToSparql(pattern.pathExpr), uris: collectPathUris(pattern.pathExpr)}
     : iriTerm(pattern.property);
   ```

5. **Update `algebraToString.ts`** `case 'path'` to collect URIs:
   ```ts
   case 'path':
     if (collector && term.uris) {
       for (const uri of term.uris) collectUri(collector, uri);
     }
     return term.value;
   ```

**Tasks:**
1. Add `collectPathUris(expr: PathExpr): string[]` to `src/paths/pathExprToSparql.ts`
2. Modify `refToSparql()` to call `formatUri()` for full IRIs (import from `sparqlUtils.ts`)
3. Extend `SparqlTerm` path variant with `uris: string[]` in `SparqlAlgebra.ts`
4. Update `irToAlgebra.ts` traverse case to populate `uris` via `collectPathUris`
5. Update `algebraToString.ts` `'path'` case to forward `term.uris` to `collectUri()`
6. Add tests: path with full IRIs gets PREFIX declarations; path with prefixed names renders correctly

**Validation:**
- `npm test` passes (all existing + new tests)
- A path like `{seq: [{id: 'http://xmlns.com/foaf/0.1/knows'}, {id: 'http://xmlns.com/foaf/0.1/name'}]}` renders as `foaf:knows/foaf:name` with `PREFIX foaf: <http://xmlns.com/foaf/0.1/>` in the output
- A path using prefixed string refs like `'foaf:knows'` renders as `foaf:knows` (bare, since it's already prefixed)
- Existing SPARQL golden tests produce identical output

### Phase 5: sortBy with complex property paths

**Status:** Planned

**Dependency:** Phase 3 (uses `pathExpr` on `DesugaredPropertyStep`).

**Problem:** `toSortBy()` in `IRDesugar.ts:421-436` creates `DesugaredPropertyStep` objects from `PropertyPath.segments` but only copies `propertyShapeId` — it ignores `seg.path` entirely. The correct `segmentsToSteps()` function at line 179-189 shows the pattern that's missing.

**Example of the bug:**

```ts
// Shape definition
class PersonShape extends Shape {
  @literalProperty({path: 'foaf:knows/foaf:name'})
  friendName: string;
}

// Query with sortBy
query.select(p => p.friendName).sortBy(p => p.friendName, 'ASC');
```

The `.select()` path correctly generates:
```sparql
?a0 foaf:knows/foaf:name ?a1 .     -- ✅ pathExpr present via segmentsToSteps
ORDER BY ASC(?a1)                    -- sortBy variable reference works
```

But if the sort path involves an *intermediate* traversal with a complex path (a multi-segment sort path where an earlier segment has a complex path), that segment's pathExpr is lost:

```ts
// Shape with nested complex path
class OrgShape extends Shape {
  @objectProperty({path: 'org:hasMember/org:role'})  // complex path
  memberRole: MemberRoleShape;
}
class MemberRoleShape extends Shape {
  @literalProperty({path: rdfs.label})
  label: string;
}

// Sort by nested path
query.select(p => p.memberRole.label).sortBy(p => p.memberRole.label, 'ASC');
```

The `sortBy` traversal for `memberRole` generates:
```sparql
-- Expected (with pathExpr):
?a0 org:hasMember/org:role ?sortA0 .
?sortA0 rdfs:label ?sortA1 .
ORDER BY ASC(?sortA1)

-- Actual (without pathExpr — falls back to simple IRI):
?a0 <http://example.org/OrgShape/memberRole> ?sortA0 .   -- ❌ uses propertyShapeId as IRI
?sortA0 rdfs:label ?sortA1 .
ORDER BY ASC(?sortA1)
```

The sort traversal for `memberRole` emits the PropertyShape ID as an IRI predicate instead of the complex path expression, because `toSortBy()` doesn't copy `pathExpr`.

**Fix:** Apply the same pattern as `segmentsToSteps()`:

```ts
// IRDesugar.ts — toSortBy, line 430-433
steps: path.segments.map((seg) => {
  const step: DesugaredPropertyStep = {
    kind: 'property_step' as const,
    propertyShapeId: seg.id,
  };
  if (seg.path && isComplexPathExpr(seg.path)) {
    step.pathExpr = seg.path;
  }
  return step;
}),
```

**Tasks:**
1. Modify `toSortBy()` in `IRDesugar.ts` to copy `pathExpr` from `seg.path` when complex (same pattern as `segmentsToSteps`)
2. Add test: sortBy with a complex-path segment produces the correct property path in ORDER BY traversals

**Validation:**
- `npm test` passes
- New test asserts that a sort path through a complex-path property emits property path syntax in the traversal triple, not the raw PropertyShape ID

### Phase 6: Decorator-to-SPARQL integration tests

**Status:** Planned

**Dependency:** Phase 4 + Phase 5 (prefix resolution and sortBy must work first).

**Problem:** No test exercises the full pipeline from shape decorators through to final SPARQL string. Existing tests cover layers in isolation. The 29 Fuseki E2E tests operate on raw `PathExpr` objects and full-IRI strings, not through the decorator → FieldSet → desugar → lower → algebra → string pipeline.

**Design:** Create integration tests that define shapes with complex path decorators, build queries against them, and assert the final SPARQL output.

**Test cases:**
1. Simple sequence path decorator: `@literalProperty({path: '<http://ex.org/a>/<http://ex.org/b>'})` → SPARQL contains `ex:a/ex:b` with correct PREFIX block
2. Alternative path decorator: `@literalProperty({path: '<http://ex.org/a>|<http://ex.org/b>'})` → SPARQL contains `ex:a|ex:b`
3. Inverse path decorator: `@literalProperty({path: '^<http://ex.org/parent>'})` → SPARQL contains `^ex:parent`
4. Nested combined path: `@literalProperty({path: {seq: [{inv: {id: 'http://ex.org/parent'}}, {id: 'http://ex.org/name'}]}})` → SPARQL contains `^ex:parent/ex:name`
5. sortBy with complex path (from Phase 5 fix)
6. WHERE filter on a complex-path property
7. Backward compat: simple `{id}` path decorator produces same SPARQL as before

**Tasks:**
1. Create `src/tests/property-path-integration.test.ts` with test shapes and query assertions
2. Each test: define shape → build query → call SPARQL generation → assert output string

**Validation:**
- `npm test -- --testPathPattern="property-path-integration"` passes
- Tests cover the full decorator → FieldSet → desugar → lower → algebra → string chain
- Each test asserts both the triple pattern syntax AND the PREFIX block

## Dependency graph

```
Phase 1 (AST + parser + normalizer)  ✓
    ↓
Phase 2 (SHACL integration + serialization)  ✓
    ↓
Phase 3 (Query/IR/SPARQL)  ✓
    ↓
    ├──→ Phase 4 (Prefix resolution in path SPARQL)
    │        ↓
    ├──→ Phase 5 (sortBy with complex paths)
    │        ↓
    └──→ Phase 6 (Decorator-to-SPARQL integration tests)  [depends on 4 + 5]
```

Phases 4 and 5 are independent and can be implemented in parallel. Phase 6 depends on both.

## Review

### Summary

All three phases implemented successfully. 927 tests passing (106 new including 29 Fuseki E2E), zero regressions. One significant gap identified: prefix resolution is not wired into the property path SPARQL rendering pipeline. The parser correctly preserves prefixed names, and the existing `Prefix` registry can resolve them, but `pathExprToSparql` and `algebraToString`'s `'path'` case bypass the prefix system entirely.

### Ideation decision coverage

All 8 decisions are reflected in the implementation:
1. Full SPARQL grammar in parser ✓
2. Stateless parser (no prefix resolution) ✓
3. No type inference changes ✓
4. Guidance-only readability (no enforcement) ✓
5a. Discriminated-object union AST ✓
5b. negatedPropertySet in AST, throws at SHACL boundary ✓
6. Builder API deferred (not shipped) ✓
7. Standard SHACL blank-node + RDF-list encoding ✓
8. PathExpr embedded in IRTraversePattern ✓

### Gaps

1. **Prefix resolution missing from `pathExprToSparql`** *(medium priority)*: The parser preserves prefixed names as raw strings per ideation decision #2 ("stateless parser; prefix resolution downstream"). But the "downstream" part was never implemented. `pathExprToSparql` uses its own `refToSparql()` which checks for `://` and wraps in `<>` if found, or emits bare otherwise. It does NOT call `Prefix.toFull()` or `formatUri()` from `sparqlUtils.ts`. Additionally, `algebraToString.ts` line 53-54 emits `case 'path': return term.value` — bypassing both `formatUri()` and `collectUri()`, so:
   - Prefixed names in paths (e.g., `ex:knows/ex:name`) emit as bare text without PREFIX declarations
   - URIs in paths are not collected for the PREFIX block
   - **Fix**: `pathExprToSparql` (or a new wrapper) should resolve prefixed PathRef strings via `Prefix.toFull()` before rendering, OR `refToSparql` should call `formatUri()` and collect URIs. The `'path'` case in `algebraToString.ts` may also need to participate in URI collection.

2. **No full-pipeline integration test**: Tests cover each layer in isolation (parser, normalizer, SHACL serializer, SPARQL emitter, IR threading). Missing: an end-to-end test that creates a Shape with a complex path decorator and asserts the final generated SPARQL. This would validate the full decorator → FieldSet → desugar → lower → algebra → string pipeline with complex paths. *(Partially addressed: 29 Fuseki E2E tests now cover pathExprToSparql → Fuseki execution, but only via raw PathExpr objects and full-IRI strings, not through the shape decorator → IR pipeline.)*

3. **String decorator input only works with full IRIs**: The 8 new string-input Fuseki tests use `<http://...>` syntax. Prefixed string paths like `'ex:knows/ex:name'` parse correctly but produce SPARQL with bare prefixed names and no PREFIX declarations (see gap #1). Users must currently use `{id}` refs or `<IRI>` syntax in string paths to get working SPARQL.

4. **sortBy with complex paths**: `PropertyShape.sortBy` is now `PathExpr`, but the sort-by lowering pipeline doesn't thread `pathExpr` through traversals. Complex sort paths (e.g., `sortBy: 'ex:a/ex:b'`) won't generate property path SPARQL. Low priority since sort-by paths are typically simple.

5. **IRProjection.ts not originally in plan**: Was modified to match the widened `resolveTraversal` signature. Functionally necessary, but the plan document didn't list it.

## Parallelization notes

- Within Phase 1: parser and normalizer can be written in parallel (parser is a dependency of normalizer, but both can be scaffolded together).
- Within Phase 3: tasks 1–3 (IR changes) and task 4 (pathExprToSparql) are independent and can be done in parallel. Tasks 5–7 (algebra changes) depend on task 4. Task 8 (tests) depends on all prior tasks.
