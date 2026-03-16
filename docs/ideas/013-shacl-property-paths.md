# Full SHACL Property Paths in Decorators — Ideation

## Context

Our property-shape decorator config currently treats `path` as either a single node reference or an array of node references:
- Single IRI-like path value (`ex:name`)
- Sequence-only list (`[ex:friend, ex:name]`)

That means we are effectively limited to **predicate paths and simple sequence paths**. Other SHACL/SPARQL path forms are not modeled in the decorator API yet.

Current code state (`src/shapes/SHACL.ts`):
- `PropertyPathInput` is currently `NodeReferenceValue`, and `PropertyPathInputList` is only scalar-or-array of that scalar.
- `normalizePathInput` currently normalizes strings/objects to plain node refs and arrays of node refs.
- No SHACL path serialization code exists yet.

## Goals

Extend property decorators and SHACL serialization support so users can express **all SPARQL property path forms supported by SHACL** in a concise and readable way, then verify end-to-end behavior via query tests that assert generated SPARQL.

Spec-aligned path forms to support:

1. Predicate path: `ex:knows`
2. Sequence path: `ex:knows/ex:name`
3. Alternative path: `ex:knows|ex:colleague`
4. Inverse path: `^ex:parent`
5. Zero-or-more: `ex:broader*`
6. One-or-more: `ex:broader+`
7. Zero-or-one: `ex:middleName?`
8. Grouped combinations, e.g. `(ex:knows|ex:colleague)/ex:name`

## Open Questions

- [x] **String parser strictness:** Full SPARQL property path grammar from the start.
- [ ] **Prefix handling:** Should parser require expanded IRIs/URLs, or resolve `ex:name` through package prefixes?
- [ ] **Type inference:** How much static typing can we preserve for complex/non-linear paths in accessor return types?
- [ ] **Readability limits:** At what complexity should we recommend object/builder syntax over inline string syntax?
- [ ] **AST type design:** Confirm the canonical internal AST shape (`PathExpr` union) is the right representation.
- [ ] **Builder API scope:** Should we ship helper builders (`path.seq`, `path.alt`, etc.) in Phase 1 or defer to Phase 4?
- [ ] **SHACL serialization approach:** Confirm blank-node + RDF-list encoding for complex paths.
- [ ] **Query/IR threading:** How should path expressions flow through the query IR and into SPARQL generation?

## Decisions

| # | Decision | Chosen | Rationale |
|---|----------|--------|-----------|
| 1 | String parser strictness | Full SPARQL property path grammar | Start with maximum expressiveness; avoid needing a second parser pass later. Accept that negated property sets won't map to SHACL `sh:path` and handle that at the serialization boundary. |

## Notes

### Proposed API direction

#### 1) Canonical internal AST (single source of truth)

Define a typed internal representation used by decorators, SHACL materialization, and query/SPARQL conversion:

```ts
type PathRef = string | { id: string };
type PathExpr =
  | PathRef
  | { seq: PathExpr[] }
  | { alt: PathExpr[] }
  | { inv: PathExpr }
  | { zeroOrMore: PathExpr }
  | { oneOrMore: PathExpr }
  | { zeroOrOne: PathExpr };
```

This shape maps directly to SHACL path node encodings and SPARQL property path operators.

#### 2) Ergonomic decorator input (string + object hybrid)

Allow users to pass either:
- A compact string expression for common usage:
  - `'ex:friend/ex:name'`
  - `'^ex:parent'`
  - `'(ex:friend|ex:colleague)/ex:name'`
- Structured objects for explicit/typed composition:
  - `{ seq: ['ex:friend', 'ex:name'] }`
  - `{ alt: ['ex:friend', 'ex:colleague'] }`
  - `{ inv: 'ex:parent' }`

And continue to support existing forms (`string`, `{id}`, and plain arrays as sequence shorthand).

#### 3) Backward-compatible normalization pipeline

Introduce `normalizePropertyPathExpr(input)`:
1. Parse string path syntax into AST
2. Convert shorthand arrays into `{ seq: [...] }`
3. Normalize all refs to `{id}` internally
4. Validate operator arity and nesting
5. Return canonical AST

This keeps old decorator calls working while enabling new syntax.

#### 4) Explicit helper builder (optional but elegant)

For teams that prefer no mini-parser, provide helper functions:

```ts
path.seq('ex:friend', 'ex:name')
path.alt('ex:friend', 'ex:colleague')
path.inv('ex:parent')
path.zeroOrMore('ex:broader')
```

Builders can emit the same AST, so parser + builder share downstream code.

### Decorator surface proposal

Update property decorator config types from current scalar/list path input to:

```ts
type PropertyPathDecoratorInput =
  | string
  | { id: string }
  | PropertyPathDecoratorInput[] // sequence shorthand
  | PathExpr;
```

Decorator examples:

```ts
@objectProperty({
  path: 'ex:friend/ex:name',
  shape: Person,
})
declare friendName: string;

@objectProperty({
  path: { alt: ['ex:friend', 'ex:colleague'] },
  shape: Person,
})
declare socialEdge: Person;

@objectProperty({
  path: { seq: [{ inv: 'ex:parent' }, 'ex:name'] },
  shape: Person,
})
declare parentName: string;
```

### SHACL materialization strategy

- Keep simple predicate path as direct IRI node where possible.
- Materialize complex paths using SHACL path-node structures (blank nodes and RDF lists) corresponding to:
  - `sh:alternativePath`
  - `sh:inversePath`
  - `sh:zeroOrMorePath`
  - `sh:oneOrMorePath`
  - `sh:zeroOrOnePath`
  - RDF list sequence for path order

### Query to SPARQL generation implications

1. Ensure query primitives can carry path expressions (not only linked property-shape segment chains).
2. Extend IR representation for traversals to include path expression AST.
3. In SPARQL conversion, emit property-path syntax inside triple patterns:
   - `?s (ex:friend/ex:name) ?o`
   - `?s (^ex:parent/ex:name) ?o`
   - `?s (ex:friend|ex:colleague) ?o`

### Test plan (idea-level)

Add query factories + golden SPARQL assertions for each form:

1. Predicate: `ex:p`
2. Sequence: `ex:p1/ex:p2`
3. Alternative: `ex:p1|ex:p2`
4. Inverse: `^ex:p`
5. Zero-or-more: `ex:p*`
6. One-or-more: `ex:p+`
7. Zero-or-one: `ex:p?`
8. Nested grouped: `(ex:p1|^ex:p2)/ex:p3+`

For each, validate:
- Decorator metadata normalization result (AST)
- SHACL graph serialization of `sh:path`
- Lowered IR contains expected path expression
- Final SPARQL string contains correct property-path operator and grouping

### Suggested phased rollout

**Phase 1 — metadata model + normalization**
- Add AST types and normalizer
- Keep existing behavior unchanged for simple paths
- Add unit tests for normalization + invalid syntax

**Phase 2 — SHACL serialization**
- Serialize all AST variants to SHACL path nodes
- Add SHACL output tests for every operator

**Phase 3 — query/IR/SPARQL**
- Thread path AST through query internals
- Generate property path SPARQL for all forms
- Add golden tests per operator and combination

**Phase 4 — ergonomics + docs**
- Add helper builders (`path.seq`, `path.alt`, etc.)
- Document string syntax and migration examples
- Add guidance on when to use strings vs object builders
