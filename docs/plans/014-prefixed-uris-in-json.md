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
