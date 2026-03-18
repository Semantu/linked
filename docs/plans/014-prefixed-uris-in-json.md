# Plan: Prefixed URI Shorthand Support

**Ideation doc:** `docs/ideas/014-prefixed-uris-in-json.md`

## Architecture Decisions

### Resolution strategy
Prefix resolution happens eagerly at decoration/normalization time. Two normalization functions are the central gateways:

1. **`toNodeReference(value: NodeReferenceInput)`** in `src/utils/NodeReference.ts` — used by query API
2. **`toPlainNodeRef(value)`** in `src/shapes/SHACL.ts` — used by decorator config processing

Both will call `Prefix.toFullIfPossible()` on string inputs before wrapping in `{id}`. This resolves `'foaf:knows'` → `{id: 'http://xmlns.com/foaf/0.1/knows'}`. Strings without a `:` (plain IDs) pass through unchanged.

### Internal types unchanged
`NodeReferenceValue = {id: string}` stays internal. Only input-facing types (`NodeReferenceInput`, decorator config fields) accept strings. After normalization, all internal code sees `{id: string}`.

### Fail-fast on unknown prefixes
When a string contains `:` (looks like a prefixed name), we use `Prefix.toFull()` which throws if the prefix is unknown. Strings without `:` are treated as plain IDs and pass through.

### PathExpr AST canonicalization
`normalizePropertyPath` resolves all prefixed string refs in the AST to `{id: fullIRI}` form. The parser (`parsePropertyPath`) continues to produce raw strings — resolution happens in the normalizer afterward.

## Expected File Changes

| File | Change |
|------|--------|
| `src/utils/NodeReference.ts` | Update `toNodeReference` to resolve prefixed strings via `Prefix.toFullIfPossible()` |
| `src/shapes/SHACL.ts` | Update `toPlainNodeRef` to resolve prefixed strings; widen `in` type to `(NodeReferenceValue \| string)[]` |
| `src/utils/Package.ts` | In `applyLinkedShape`, normalize `targetClass` if string |
| `src/shapes/Shape.ts` | Widen `targetClass` type to `NodeReferenceValue \| string` |
| `src/paths/normalizePropertyPath.ts` | Add prefix resolution pass after normalization |
| `src/queries/QueryBuilder.ts` | Update `.for()` and `.forAll()` to resolve prefixed strings |
| `src/tests/prefix-resolution.test.ts` | **New file** — tests for prefix resolution across all entry points |

## Contracts

### `toNodeReference(value: NodeReferenceInput): NodeReferenceValue`
- String with `:` → call `Prefix.toFull(value)`, wrap in `{id}` (throws on unknown prefix)
- String without `:` → wrap in `{id: value}` (plain ID, no resolution)
- `{id: string}` → pass through unchanged
- **Note:** `{id: 'prefix:name'}` values also get resolved — the `id` field is passed through `Prefix.toFullIfPossible()`

### `toPlainNodeRef(value): NodeReferenceValue`
- Same logic as `toNodeReference` — resolve prefixed strings, pass through `{id}` values with resolution on `.id`

### `normalizePropertyPath` prefix resolution
- After normalization, walk the AST and resolve every `PathRef` string via `Prefix.toFullIfPossible()`
- Convert resolved strings to `{id: fullIRI}` form
- Leave unresolvable strings (no `:` match) as-is

### `@linkedShape` targetClass normalization
- In `applyLinkedShape`, if `constructor.targetClass` is a string, resolve via `toNodeReference()` and assign back

### Query API `.for()` / `.forAll()`
- String inputs pass through `toNodeReference()` which now resolves prefixes

## Pitfalls

1. **Circular imports**: `NodeReference.ts` importing `Prefix.ts` — verify no circular dependency chain. `Prefix.ts` does not import from `NodeReference.ts`, so this is safe.
2. **Strings that contain `:` but aren't prefixed names**: e.g., `'urn:uuid:123'`. `Prefix.toFullIfPossible()` returns the original string if no prefix matches, so these pass through safely. But `Prefix.toFull()` would throw. Need to use `toFullIfPossible` for the general case, and only throw when we're confident it's a prefixed name (has exactly one `:` and prefix part matches `[a-zA-Z][\w]*`).
3. **`{id}` values with prefixed strings**: Per D6, `{id: 'foaf:knows'}` should resolve. This means `toNodeReference({id: 'foaf:knows'})` should resolve the `.id` value too.
4. **Order of operations**: Prefix registrations happen at import time. Shape decorators run at import time too. Need to ensure ontology imports happen before shape class imports.

## Revised approach for prefix detection

Rather than throwing on all strings with `:`, use this heuristic:
- A string looks like a prefixed name if it matches `/^[a-zA-Z][\w.-]*:/ ` AND does NOT contain `://`
- For such strings, call `Prefix.toFull()` (throws on unknown prefix — fail-fast per D5)
- For strings containing `://` (full IRIs like `http://...`), pass through as-is
- For strings without `:`, pass through as-is (plain IDs)

This handles `urn:uuid:...`, `http://...`, and plain IDs correctly while catching prefixed names.

---

## Phases

### Phase 1: Core resolution in `toNodeReference` and `toPlainNodeRef`

**Files:** `src/utils/NodeReference.ts`, `src/shapes/SHACL.ts`

**Tasks:**
1. Add a `resolvePrefixedUri(str: string): string` helper to `NodeReference.ts` that:
   - Returns `str` unchanged if it contains `://` or has no `:`
   - Calls `Prefix.toFull(str)` otherwise (throws on unknown prefix)
2. Update `toNodeReference`: for string input, call `resolvePrefixedUri` before wrapping in `{id}`
3. Update `toNodeReference`: for `{id}` input, resolve `.id` via `resolvePrefixedUri`
4. Update `toPlainNodeRef` in SHACL.ts: for string input, call `resolvePrefixedUri` before wrapping; for `{id}` input, resolve `.id`

**Validation:**
- Unit test: `toNodeReference('foaf:Person')` returns `{id: 'http://xmlns.com/foaf/0.1/Person'}` (with foaf prefix registered)
- Unit test: `toNodeReference('http://example.org/foo')` returns `{id: 'http://example.org/foo'}` unchanged
- Unit test: `toNodeReference('plain-id')` returns `{id: 'plain-id'}` unchanged
- Unit test: `toNodeReference('unknown:foo')` throws with clear error
- Unit test: `toNodeReference({id: 'foaf:Person'})` resolves to `{id: 'http://xmlns.com/foaf/0.1/Person'}`
- Build passes: `npm run build`

### Phase 2: `@linkedShape` targetClass normalization

**Files:** `src/shapes/Shape.ts`, `src/utils/Package.ts`

**Tasks:**
1. Widen `Shape.targetClass` type from `NodeReferenceValue` to `NodeReferenceValue | string` (and in `ShapeConstructor` type)
2. In `applyLinkedShape` (Package.ts), normalize `constructor.targetClass` via `toNodeReference()` before assigning to shape

**Validation:**
- Unit test: A shape class with `static targetClass = 'foaf:Person'` gets normalized to `{id: 'http://xmlns.com/foaf/0.1/Person'}` on its NodeShape
- Build passes

### Phase 3: PathExpr AST prefix resolution

**Files:** `src/paths/normalizePropertyPath.ts`

**Tasks:**
1. Add a `resolvePathExprPrefixes(expr: PathExpr): PathExpr` function that recursively walks the AST and resolves prefixed string refs to `{id: fullIRI}`
2. Call it at the end of `normalizePropertyPath` before returning
3. For string PathRefs: if `resolvePrefixedUri` returns a different value, convert to `{id: resolved}`. If same, leave as string.

**Validation:**
- Unit test: `normalizePropertyPath('foaf:knows')` returns `{id: 'http://xmlns.com/foaf/0.1/knows'}`
- Unit test: `normalizePropertyPath('foaf:knows/foaf:name')` returns `{seq: [{id: '...knows'}, {id: '...name'}]}`
- Unit test: Path with `{id: 'foaf:knows'}` resolves the prefixed id
- Build passes

### Phase 4: PropertyShapeConfig type widening for `in`

**Files:** `src/shapes/SHACL.ts`

**Tasks:**
1. Widen `in` field type from `NodeReferenceValue[]` to `(NodeReferenceValue | string)[]` in `PropertyShapeConfig` and `LiteralPropertyShapeConfig`

**Validation:**
- TypeScript accepts `in: ['foaf:Person', 'foaf:Agent']` in decorator configs
- Existing `toPlainNodeRef` calls on `in` entries already handle resolution (from Phase 1)
- Build passes

### Phase 5: Query API prefix support

**Files:** `src/queries/QueryBuilder.ts`

**Tasks:**
1. Update `.for()` to use `toNodeReference()` (already imported) instead of inline `{id}` wrapping
2. Update `.forAll()` to use `toNodeReference()` instead of inline `{id}` wrapping
3. The `{id}` values in `.equals()` etc. already flow through comparison logic — verify they use `toNodeReference` or equivalent

**Validation:**
- Unit test: `QueryBuilder.from(Shape).select(...).for('foaf:Person')` resolves the prefixed name
- Build passes

### Phase 6: Tests

**Files:** `src/tests/prefix-resolution.test.ts` (new)

**Tasks:**
1. Create comprehensive test file covering:
   - `toNodeReference` with prefixed, full IRI, plain ID, unknown prefix, and `{id: prefixed}` inputs
   - `toPlainNodeRef` same cases
   - `normalizePropertyPath` with prefixed string refs
   - Shape with `static targetClass = 'prefix:Class'`
   - Decorator configs with prefixed URIs (`datatype`, `class`, `equals`, `in`, etc.)
   - Query `.for('prefix:id')` resolution
   - Error cases: unknown prefix throws

**Validation:**
- All tests pass: `npm test`
- Build passes: `npm run build`

---

## Review

### Gap analysis findings

1. **No integration test with decorator pipeline**: Unit tests register prefixes manually but don't verify the full `createPropertyShape` pipeline with prefixed strings in `path`, `datatype`, `class`, `equals`, `in`, etc.
2. **D5 strictness**: Adjusted to lenient `toFullIfPossible` — deferred, working correctly.
3. **Documentation**: No user-facing docs or JSDoc examples on public APIs.
4. **`in` field resolution**: Type widened but no dedicated test for mixed `in: ['foaf:Person', {id: 'foaf:Agent'}]` flowing through `createPropertyShape`.

## Iteration 1 — Ideation

### Gap 1 of 4: Integration test with decorator pipeline
- **Chosen:** Add integration tests to `prefix-resolution.test.ts` that call `createPropertyShape` directly with prefixed strings in all URI config fields, verifying the output `PropertyShape` has fully-resolved `{id}` values.
- **Rationale:** Co-locates all prefix resolution tests. No new files. Direct verification of the decorator pipeline.

### Gap 2 of 4: D5 strictness
- **Chosen:** Deferred. Lenient `toFullIfPossible` is correct and backward-compatible.

### Gap 3 of 4: Documentation
- **Chosen:** Add JSDoc examples to key public functions (`toNodeReference`, `resolvePrefixedUri`) and to the decorator config type fields. Most discoverable — shows up in IDE autocomplete.
- **Rationale:** JSDoc lives next to the code, easiest to maintain.

### Gap 4 of 4: `in` field resolution test
- **Chosen:** Add tests to `prefix-resolution.test.ts` verifying mixed `in` values (strings + `{id}` objects) flow through `createPropertyShape` correctly.

## Iteration 1 — Plan

### Architecture decisions
- No new code paths — just tests and JSDoc additions
- `createPropertyShape` is the function under test for the integration tests — it calls `toPlainNodeRef` (→ `toNodeReference`) and `normalizePathInput` (→ `normalizePropertyPath`) internally

### File changes

| File | Change |
|------|--------|
| `src/tests/prefix-resolution.test.ts` | Add `createPropertyShape` integration tests (path, datatype, class, equals, disjoint, hasValue, in fields with prefixed strings) |
| `src/utils/NodeReference.ts` | Add JSDoc examples to `resolvePrefixedUri` and `toNodeReference` |
| `src/shapes/SHACL.ts` | Add JSDoc examples to `PropertyShapeConfig.in` showing mixed string/node usage |

### Contracts
- Integration tests call `createPropertyShape(config, 'propName', null, null)` and inspect the returned `PropertyShape`
- All URI fields on the returned `PropertyShape` should contain `{id: fullIRI}` when given prefixed string input

## Iteration 1 — Phases

### Phase 7: Integration tests for createPropertyShape with prefix resolution

**Files:** `src/tests/prefix-resolution.test.ts`

**Tasks:**
1. Import `createPropertyShape` and `PropertyShape` from SHACL
2. Add a `describe('createPropertyShape with prefix resolution')` block covering:
   - `path: 'foaf:name'` → `propertyShape.path` is `{id: fullIRI}`
   - `datatype: 'xsd:string'` → `propertyShape.datatype` is `{id: fullIRI}`
   - `class: 'foaf:Person'` → `propertyShape.class` is `{id: fullIRI}`
   - `equals: 'foaf:name'` → `propertyShape.equalsConstraint` is `{id: fullIRI}`
   - `disjoint: 'foaf:name'` → `propertyShape.disjoint` is `{id: fullIRI}`
   - `hasValue: 'foaf:Person'` → `propertyShape.hasValueConstraint` is `{id: fullIRI}`
   - `in: ['foaf:Person', {id: 'foaf:Agent'}]` → `propertyShape.in` has both resolved
   - Complex path: `'foaf:knows/foaf:name'` → `propertyShape.path` is `{seq: [...]}`

**Validation:** All new tests pass. No regressions in full suite.

**Dependencies:** None — can run independently.

### Phase 8: JSDoc documentation

**Files:** `src/utils/NodeReference.ts`, `src/shapes/SHACL.ts`

**Tasks:**
1. Add JSDoc `@example` blocks to `resolvePrefixedUri` and `toNodeReference` in NodeReference.ts
2. Add JSDoc example to `PropertyShapeConfig.in` showing mixed string/node usage

**Validation:** Build passes. No functional changes.

**Dependencies:** None — can run in parallel with Phase 7.

---

## Iteration 2 — Scope Change: No Prefix Resolution in Decorators

### Decision

**Option B chosen**: Prefix shorthand is supported **only in the query API**, not in decorators or shape config.

**Rationale:**
- Decorators are static definitions — ontology imports (`foaf.name`, `xsd.string`) provide compile-time safety, IDE autocomplete, and guarantee the prefix is registered.
- Prefix strings in decorators are dangerous: if the ontology isn't imported, the string silently passes through unresolved (with `toFullIfPossible`), producing broken SPARQL downstream.
- In the LINCD/create.now world, each ontology has a canonical prefix, but relying on prefix strings in decorators still creates a hidden dependency on import order.

**Type clarifications:**
- `equals`, `disjoint`, `lessThan`, `lessThanOrEquals` — these are **property references** in SHACL (always IRIs). Should be `NodeReferenceValue` only. A bare string is ambiguous.
- `hasValue` — can be a literal string or an IRI node. Type `NodeReferenceValue | string` is correct, but string = literal, `{id}` = IRI. No prefix resolution.
- `in` — same as `hasValue`: mixed literals and IRI nodes. `(NodeReferenceValue | string)[]` is correct.
- `datatype`, `class` — always IRIs in SHACL. Should be `NodeReferenceValue` only.

### Summary of what stays vs what gets reverted

| Component | Before iteration 2 | After iteration 2 |
|-----------|--------------------|--------------------|
| `resolvePrefixedUri()` | Resolves prefixes | **Stays** — used by query API |
| `toNodeReference()` | Resolves prefixed strings and `{id}` values | **Revert** — simple wrap, no resolution |
| `toPlainNodeRef()` | Delegates to `toNodeReference` (resolves) | **Revert** — simple extraction, no resolution |
| `normalizePropertyPath` | Resolves prefixed refs in AST | **Revert** — no prefix resolution pass |
| `Shape.targetClass` | `NodeReferenceInput` (accepts strings) | **Revert** — `NodeReferenceValue` only |
| `Package.ts applyLinkedShape` | Normalizes string targetClass | **Revert** — direct assignment |
| `PropertyShapeConfig.equals` | `NodeReferenceValue \| string` | **Narrow** to `NodeReferenceValue` |
| `PropertyShapeConfig.disjoint` | `NodeReferenceValue \| string` | **Narrow** to `NodeReferenceValue` |
| `LiteralPropertyShapeConfig.lessThan` | `NodeReferenceValue \| string` | **Narrow** to `NodeReferenceValue` |
| `LiteralPropertyShapeConfig.lessThanOrEquals` | `NodeReferenceValue \| string` | **Narrow** to `NodeReferenceValue` |
| `LiteralPropertyShapeConfig.datatype` | `NodeReferenceValue \| string` | **Narrow** to `NodeReferenceValue` |
| `ObjectPropertyShapeConfig.class` | `NodeReferenceValue \| string` | **Narrow** to `NodeReferenceValue` |
| `PropertyShapeConfig.hasValue` | `NodeReferenceValue \| string` | **Keep** — string = literal |
| `PropertyShapeConfig.in` | `(NodeReferenceValue \| string)[]` | **Keep** — strings = literals |
| `QueryBuilder.for()` | Uses `toNodeReference` (resolves) | **Keep resolution** — use `resolvePrefixedUri` inline |
| `QueryBuilder.forAll()` | Uses `toNodeReference` (resolves) | **Keep resolution** — use `resolvePrefixedUri` inline |

## Iteration 2 — Phases

### Phase 9: Revert `toNodeReference` and `toPlainNodeRef`

**Files:** `src/utils/NodeReference.ts`, `src/shapes/SHACL.ts`

**Tasks:**
1. Revert `toNodeReference` to original simple form: string → `{id: string}`, `{id}` → pass through. No `resolvePrefixedUri` calls.
2. Keep `resolvePrefixedUri` exported (still used by query API).
3. Revert `toPlainNodeRef` in SHACL.ts to original form (simple extraction, not delegating to `toNodeReference`).

**Validation:** Build passes. Existing non-prefix tests still pass.

### Phase 10: Revert `normalizePropertyPath` prefix resolution

**Files:** `src/paths/normalizePropertyPath.ts`

**Tasks:**
1. Remove `resolvePathExprPrefixes` call from `normalizePropertyPath` — revert to original flow.
2. Keep the `resolvePathExprPrefixes`, `resolvePathRef`, `mapIfChanged` functions in the file (they're useful utilities if ever needed). OR remove if cleaner.
3. Remove `resolvePrefixedUri` import if no longer used.

**Validation:** `property-path-normalize.test.ts` passes. Build passes.

### Phase 11: Revert `targetClass` type widening

**Files:** `src/shapes/Shape.ts`, `src/utils/Package.ts`, `src/utils/ShapeClass.ts`

**Tasks:**
1. Revert `Shape.targetClass` back to `NodeReferenceValue` (and `ShapeConstructor.targetClass`).
2. Revert `applyLinkedShape` in Package.ts to direct assignment (remove `toNodeReference` call and import).
3. Revert `ShapeClass.ts` `resolveTargetClassId` to original form.
4. Revert `Shape.registerByType` to original form.
5. Remove `NodeReferenceInput` import from Shape.ts.

**Validation:** Build passes.

### Phase 12: Narrow decorator config types

**Files:** `src/shapes/SHACL.ts`

**Tasks:**
1. `equals`: narrow from `NodeReferenceValue | string` to `NodeReferenceValue`
2. `disjoint`: narrow from `NodeReferenceValue | string` to `NodeReferenceValue`
3. `lessThan`: narrow from `NodeReferenceValue | string` to `NodeReferenceValue`
4. `lessThanOrEquals`: narrow from `NodeReferenceValue | string` to `NodeReferenceValue`
5. `datatype`: narrow from `NodeReferenceValue | string` to `NodeReferenceValue`
6. `class`: narrow from `NodeReferenceValue | string` to `NodeReferenceValue`
7. `hasValue`: keep as `NodeReferenceValue | string` (string = literal value)
8. `in`: keep as `(NodeReferenceValue | string)[]` (strings = literals, `{id}` = IRIs). Update JSDoc to reflect this.
9. Verify `createPropertyShape` handles narrowed types correctly (remove casts if now unnecessary).

**Validation:** Build passes. No existing code uses string form for narrowed fields.

### Phase 13: Keep query API prefix resolution

**Files:** `src/queries/QueryBuilder.ts`

**Tasks:**
1. `.for()`: use `resolvePrefixedUri` on string input before wrapping in `{id}`, instead of `toNodeReference`
2. `.forAll()`: same pattern
3. Import `resolvePrefixedUri` from NodeReference.ts

**Validation:** Build passes.

### Phase 14: Update tests

**Files:** `src/tests/prefix-resolution.test.ts`

**Tasks:**
1. Remove `createPropertyShape` integration tests (prefixes no longer resolve in decorators)
2. Remove `normalizePropertyPath` prefix resolution tests
3. Keep `resolvePrefixedUri` unit tests (utility still exists)
4. Keep `toNodeReference` tests but update: it no longer resolves prefixes, just wraps
5. Add query API tests if not already covered (`.for('foaf:Person')` still resolves)

**Validation:** All tests pass. Full suite green.
