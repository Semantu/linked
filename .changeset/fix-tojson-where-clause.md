---
"@_linked/core": patch
---

Fix QueryBuilder.toJSON() to serialize where, orderBy, minus, and preload clauses that were previously silently dropped during JSON round-trips
