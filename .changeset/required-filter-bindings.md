---
'@_linked/core': patch
---

Refine SPARQL select lowering so top-level null-rejecting filters emit required triples instead of redundant `OPTIONAL` bindings. Queries like `Person.select().where((p) => p.name.equals('Semmy'))` now lower to a required `?a0 <name> ?a0_name` triple, while cases that still need nullable behavior such as `p.name.equals('Jinx').or(p.hobby.equals('Jogging'))` remain optional.

This change does not add new DSL APIs, but it does change the generated SPARQL shape for some outer `where()` clauses to better match hand-written intent. Inline traversal `.where(...)`, `EXISTS` filters, and aggregate `HAVING` paths keep their previous behavior.

See `documentation/sparql-algebra.md` for the updated lowering rules and examples.
