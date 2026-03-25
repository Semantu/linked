---
"@_linked/core": patch
---

Fix SPARQL generation for `.where()` filters with OR conditions and `.every()`/`.some()` quantifiers.

### Inline where with OR filters

Previously, filter property triples inside inline `.where()` blocks were required, causing OR filters to fail when some entities lacked certain properties. For example, `.where(f => f.name.equals('Jinx').or(f.hobby.equals('Jogging')))` would exclude entities without a `hobby` triple, even if they matched the `name` condition.

Filter property triples are now wrapped in nested OPTIONALs within the filtered block, so SPARQL's `||` short-circuits correctly over unbound variables.

### EXISTS/NOT EXISTS scope fix

Property triples referenced inside `.every()` and `.some()` quantifier filters were incorrectly placed in the outer query scope instead of inside the EXISTS block. This caused `.every()` to return incorrect results (e.g., not excluding entities whose members fail the predicate).

Filter property triples are now emitted directly inside the EXISTS pattern where they are semantically scoped.

### Test improvements

Tightened assertions across multiple integration tests (`whereOr`, `whereAnd`, `whereEvery`, `whereSequences`, `countEquals`, `selectBirthDate`, and others) to verify exact result counts, correct inclusion/exclusion, and proper type coercion.
