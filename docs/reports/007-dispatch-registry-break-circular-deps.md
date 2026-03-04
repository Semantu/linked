# 007 — Dispatch Registry: Break Circular Dependencies

## Problem

Circular import: `Shape.ts → QueryParser.ts → LinkedStorage.ts → Shape.ts`

- Shape imported QueryParser to execute queries
- QueryParser imported LinkedStorage to dispatch built IR to stores
- LinkedStorage imported Shape for the `shapeToStore` map key type and walk-stop sentinel

## Solution

Created a leaf dispatch module (`queryDispatch.ts`) that defines a `QueryDispatch` interface and a mutable slot. Shape calls `getQueryDispatch()` to execute queries. LinkedStorage registers itself as the dispatch provider in `setDefaultStore()`. Neither imports the other.

```
Shape ──────────→ queryDispatch.ts ←──────── LinkedStorage
  (calls dispatch)      (leaf)        (registers as dispatch)
```

## Changes

| File | Change |
|------|--------|
| `src/queries/queryDispatch.ts` | New leaf module — dispatch interface + get/set registry |
| `src/shapes/Shape.ts` | Uses dispatch; inlines mutation factory creation |
| `src/queries/SelectQuery.ts` | `exec()` uses dispatch |
| `src/utils/LinkedStorage.ts` | Removed Shape import; registers as dispatch in `setDefaultStore()` |
| `src/queries/QueryParser.ts` | Deleted — was a pass-through with no logic |
| `src/test-helpers/query-capture-store.ts` | Capture via dispatch; added `captureRawQuery` for pre-pipeline tests |
| `src/index.ts` | Replaced QueryParser export with queryDispatch |
| 7 test files | Adjusted for dispatch-based capture |

## Verification

- `tsc --noEmit` passes
- 18/18 test suites, 477 tests green
- Zero circular imports between Shape, LinkedStorage, and query modules
