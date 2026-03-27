---
"@_linked/core": patch
---

### Bug fixes

- **`MutationQuery.convertNodeDescription()`** no longer mutates the caller's input object. Previously, `delete obj.id` / `delete obj.__id` operated directly on the passed-in object, causing shared references to lose their `id` across sequential creates.
- **`SparqlStore.createQuery()`** now respects a pre-set `data.id` from `__id` instead of always generating a new URI via `generateEntityUri()`. Entities created with custom identity (e.g. webID) are now stored under the correct URI.

### Test infrastructure

- Jest config simplified: `roots` + single `testMatch` pattern prevents duplicate test runs.
- Fuseki integration tests now call `ensureFuseki()` to auto-start Docker when Fuseki isn't running.
- Parallel test safety: `afterAll` clears data instead of deleting the shared dataset.
- Added regression tests for both fixes (unit + Fuseki integration).
