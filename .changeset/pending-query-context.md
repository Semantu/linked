---
"@_linked/core": patch
---

Add `PendingQueryContext` for lazy query context resolution. `getQueryContext()` now returns a live reference with a lazy `.id` getter instead of `null` when the context hasn't been set yet. `QueryBuilder.for()` accepts `PendingQueryContext` and `null`. New `hasPendingContext()` method. `setQueryContext(name, null)` now properly clears the entry. Test Fuseki port changed to 3939; `globalSetup`/`globalTeardown` added for reliable Fuseki auto-start.
