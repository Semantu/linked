# Plan: Fix SHACL Constraint Field Types & Input Handling

## Context

SHACL constraint fields on `PropertyShapeConfig` currently all go through `toPlainNodeRef()`,
which wraps every string as `{id: resolvedIRI}`. This is correct for fields whose value is
always an IRI (property path, class, datatype), but **wrong** for fields that can accept
literal values (`hasValue`, `in`).

These fields are **metadata-only** today — stored on `PropertyShape`, exposed via `getResult()`,
not consumed in SPARQL generation or validation. But the stored values must be correct so that
downstream serialization to SHACL RDF (or any consumer reading `getResult()`) gets the right
type — literal vs IRI node.

Additionally, `lessThan` and `lessThanOrEquals` exist in `LiteralPropertyShapeConfig` but are
never wired into `createPropertyShape` — they're silently dropped.

---

## Phase 1: Fix `hasValue` and `in` to support literal values

### Problem
`hasValue: "active"` currently becomes `{id: "active"}` (an IRI node) instead of staying as the
literal string `"active"`. Same for `in: ["ACTIVE", "PENDING"]`.

### Changes

**Types** (`PropertyShapeConfig` + `PropertyShape`):

- `hasValue` config type: `NodeReferenceValue | string | number | boolean`
  - `{id: ...}` → IRI node reference
  - plain `string` → literal string value (NOT run through `toPlainNodeRef`)
  - `number` / `boolean` → literal value
- `in` config type: `(NodeReferenceValue | string | number | boolean)[]`
  - same logic per element
- `PropertyShape.hasValueConstraint` storage type: `NodeReferenceValue | string | number | boolean`
- `PropertyShape.in` storage type: `(NodeReferenceValue | string | number | boolean)[]`

**Processing** in `createPropertyShape`:

- For `hasValue`: if value is `{id: ...}` object → `toPlainNodeRef()`. If primitive → store as-is.
- For `in`: same per element — `{id}` objects go through `toPlainNodeRef`, primitives stored as-is.

**`getResult()`**: no change needed — already passes through whatever is stored.

### Question: How to distinguish IRI strings from literal strings?

Currently `toPlainNodeRef("foaf:name")` resolves the prefix. For `hasValue`/`in`, we need:
- `{id: 'foaf:Person'}` → IRI (resolved via `toPlainNodeRef`)
- `"ACTIVE"` → literal string

**Rule**: For `hasValue` and `in`, plain strings are **literals**. To specify an IRI, use `{id: '...'}`.
This is a breaking change for the one test in `prefix-resolution.test.ts` that does
`hasValue: 'foaf:Person'` expecting it to be treated as an IRI — that should become
`hasValue: {id: 'foaf:Person'}`.

---

## Phase 2: Wire up `lessThan` and `lessThanOrEquals`

### Problem
These fields exist in `LiteralPropertyShapeConfig` (lines 78, 82) but `createPropertyShape`
never reads them. They're silently dropped.

### Changes

- Add fields to `PropertyShape` class:
  - `lessThan?: NodeReferenceValue`
  - `lessThanOrEquals?: NodeReferenceValue`
- In `createPropertyShape`, after the `disjoint` block:
  ```ts
  if ((config as LiteralPropertyShapeConfig).lessThan) {
    propertyShape.lessThan = toPlainNodeRef((config as LiteralPropertyShapeConfig).lessThan);
  }
  if ((config as LiteralPropertyShapeConfig).lessThanOrEquals) {
    propertyShape.lessThanOrEquals = toPlainNodeRef((config as LiteralPropertyShapeConfig).lessThanOrEquals);
  }
  ```
- In `getResult()`, expose them:
  ```ts
  if (this.lessThan) { result.lessThan = this.lessThan; }
  if (this.lessThanOrEquals) { result.lessThanOrEquals = this.lessThanOrEquals; }
  ```

These always reference another property IRI, so `toPlainNodeRef` is correct.

---

## Phase 3: Add tests

### New test cases in prefix-resolution.test.ts or a new shacl-constraints.test.ts:

1. **`hasValue` with literal string**: `hasValue: "active"` → stored as `"active"` (not `{id: "active"}`)
2. **`hasValue` with IRI**: `hasValue: {id: 'foaf:Person'}` → stored as `{id: '<resolved>'}`
3. **`in` with literal strings**: `in: ["ACTIVE", "PENDING"]` → stored as `["ACTIVE", "PENDING"]`
4. **`in` with IRI nodes**: `in: [{id: 'foaf:Person'}, {id: 'foaf:Agent'}]` → resolved IRIs
5. **`in` with mixed**: `in: [{id: 'ex:Foo'}, "bar"]` → `[{id: '<resolved>'}, "bar"]`
6. **`in` with numbers**: `in: [1, 2, 3]` → stored as `[1, 2, 3]`
7. **`lessThan` wired up**: config `lessThan: 'foaf:endDate'` → stored and exposed via `getResult()`
8. **`lessThanOrEquals` wired up**: same
9. **Fix existing test**: `hasValue: 'foaf:Person'` → `hasValue: {id: 'foaf:Person'}`

---

## Phase 4: Clone support

Ensure `PropertyShape.clone()` copies the new/changed fields (`lessThan`, `lessThanOrEquals`,
and the now-potentially-primitive `hasValueConstraint` and `in`). Check if the current clone
logic handles this (it likely does via generic property copy, but verify).

---

## Summary of field semantics after fix

| Config Field | Value is always... | Processing | Storage type |
|---|---|---|---|
| `equals` | property IRI | `toPlainNodeRef` | `NodeReferenceValue` |
| `disjoint` | property IRI | `toPlainNodeRef` | `NodeReferenceValue` |
| `lessThan` | property IRI | `toPlainNodeRef` | `NodeReferenceValue` |
| `lessThanOrEquals` | property IRI | `toPlainNodeRef` | `NodeReferenceValue` |
| `datatype` | datatype IRI | `toPlainNodeRef` | `NodeReferenceValue` |
| `class` | class IRI | `toPlainNodeRef` | `NodeReferenceValue` |
| `hasValue` | IRI or literal | `toPlainNodeRef` only for `{id}` | `NodeReferenceValue \| string \| number \| boolean` |
| `in` | IRIs or literals | `toPlainNodeRef` only for `{id}` | `(NodeReferenceValue \| string \| number \| boolean)[]` |
