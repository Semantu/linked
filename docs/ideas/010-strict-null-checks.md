---
summary: Enable TypeScript strictNullChecks to catch null/undefined bugs at compile time, then normalize select results to use null (not undefined) for missing values.
packages: [core]
depends_on: []
---

# strictNullChecks Migration

## Status: idea (not started)

## Why

This is a data-modeling and query-building library where null/undefined bugs can silently produce wrong queries or corrupt data. `strictNullChecks` catches these at compile time. The codebase already uses optional chaining (`?.`) in places, so the team is already thinking about nullability — the compiler just isn't enforcing it yet.

## Current State

`strictNullChecks` is **off** in `tsconfig.json`. Enabling it produces **129 errors across 22 files**.

### Error Breakdown

| Category | Count | Description |
|---|---|---|
| `T \| undefined` not assignable to `T` | ~30 | Values that might be `undefined` used where a definite type is expected |
| `null` not assignable to various types | ~22 | Variables initialized to `null` but typed without `null` in their union |
| Object is possibly `undefined` | 12 | Direct property access on potentially undefined values |
| Named variable possibly `undefined` | 13 | Variables like `propShape`, `stack`, `shape.id` flagged as possibly undefined |
| `null` violates generic constraints | 7 | `null` used as a type argument where the constraint requires `string \| number \| symbol` or `Shape` |
| Variable used before assigned | 5 | Variables like `res`, `queryObject`, `propertyShape` read before guaranteed assignment |
| Cannot invoke possibly undefined | 2 | Calling a function that might be undefined |
| Missing return / type mismatch | 4 | Functions missing return paths, unsafe type assertions |
| Misc | ~4 | Generic `.toString()` on unconstrained type params, undefined as index, etc. |

### Most Affected Files

| File | Errors | Notes |
|---|---|---|
| `src/queries/SelectQuery.ts` | 35 | Heaviest use of nullable patterns — needs some refactoring, not just `!` |
| `src/shapes/SHACL.ts` | 19 | Shape definitions with many optional properties |
| `src/queries/MutationQuery.ts` | 13 | Similar patterns to SelectQuery |
| `src/test-helpers/query-fixtures.ts` | 11 | Test fixtures using `null` for initial values |
| `src/utils/ShapeClass.ts` | 9 | Utility code with optional lookups |
| `src/queries/IRMutation.ts` | 5 | IR layer with nullable refs |
| `src/shapes/Shape.ts` | 5 | Core shape model |
| `src/utils/Prefix.ts` | 5 | Prefix handling with possible undefined |
| Remaining 14 files | 1–3 each | |

The top 5 files account for 67% of all errors.

## Effort Estimate

**Medium — approximately 2–3 focused days.**

Most fixes are mechanical:
- Adding `| null` or `| undefined` to type declarations
- Adding null guards (`if (x != null)`) before property access
- Providing proper default values instead of `null`
- Using non-null assertion (`!`) only where safety is already guaranteed by logic

The riskiest file is `SelectQuery.ts` (35 errors) where nullable patterns are pervasive and may need some rethinking rather than just sprinkling `!`.

## Implementation Approach

### Step 1: Enable `strictNullChecks` and fix compilation (2–3 days)

Fix one directory at a time, running tests after each batch:

1. **`src/queries/`** — Start here (highest error count, highest risk). Fix `SelectQuery.ts` (35), `MutationQuery.ts` (13), `IRMutation.ts` (5), and remaining query files.
2. **`src/shapes/`** — Fix `SHACL.ts` (19), `Shape.ts` (5).
3. **`src/utils/`** — Fix `ShapeClass.ts` (9), `Prefix.ts` (5).
4. **`src/test-helpers/`** — Fix `query-fixtures.ts` (11).
5. **Remaining files** — 1–3 errors each, quick fixes.

### Step 2: Normalize select results to `null` (not `undefined`) for missing values

**After `strictNullChecks` is on**, address the semantic distinction between `null` and `undefined` in query results:

- **`null`** should mean "this property exists in the query result but has no value" (the SPARQL binding was unbound / the triple doesn't exist).
- **`undefined`** should mean "this property was not requested in the query" (the field wasn't selected).

Currently, `QueryResponseToResultType` produces `string | null | undefined` for literal properties. With `strictNullChecks` enforced, this distinction becomes meaningful:

```ts
// Current (with strictNullChecks off, distinction is cosmetic):
type Result = { name: string | null | undefined; id: string | undefined }

// Target (with strictNullChecks on):
type Result = { name: string | null; id: string }
// - name: string | null  → selected but might be missing in data
// - id: string           → always present (it's the node ID)
```

This requires:
- Updating `QueryResponseToResultType` and related conditional types to produce `T | null` instead of `T | null | undefined`
- Updating the result mapping (`resultMapping.ts`) to return `null` instead of `undefined` for unbound bindings
- Updating `QResult<S>` base type — `id` should be `string` (not `string | undefined`) since every result row has an ID
- Verifying the `query.types.test.ts` expectations match the new nullable semantics
- Updating `@_linked/memstore` result mapping to match

**Note:** This is a breaking change for downstream code that checks `=== undefined` to detect missing query fields. It should be bundled with a major version bump or clearly documented.

### Step 3: Stricter internal types

With `strictNullChecks` on, additional improvements become possible:
- `NodeShape.getPropertyShape(label)` return type becomes `PropertyShape | undefined` instead of implicitly nullable
- `ShapeClass` registry lookups return `ShapeClass | undefined`
- Constructor parameters that currently accept `null` can be tightened to `undefined` or made optional
- The `| null` in `BoundComponent` constructor (`super(null, null)`) can be replaced with proper optional parameters

## Open Questions

1. **Phasing with Plan 001:** Should this happen before or after Phase 4.4 (DSL rewire + dead code removal)? After is safer — fewer files to fix since dead code is already removed. But before means the new builder code written in 4.4 would be strictNullChecks-clean from the start.

2. **`@_linked/memstore` alignment:** The memstore package also needs `strictNullChecks` enabled. Should both packages be migrated together?

3. **`null` vs `undefined` migration timing:** Step 2 (normalizing to `null`) is a semantic change that affects all consumers. It could be deferred to a separate major version bump even if Step 1 (enabling the flag) is done sooner.
