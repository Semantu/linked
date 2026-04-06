---
summary: Refine SPARQL select lowering so top-level null-rejecting filters use required bindings instead of redundant OPTIONAL triples.
packages: [core]
---

# Required Filter Bindings

## Scope

This report documents the refinement to `@_linked/core` SPARQL select lowering that promotes top-level filter bindings from `OPTIONAL` to required triples when the filter would reject rows without those bindings.

The change is intentionally narrow:

- it affects top-level `query.where` lowering in `selectToAlgebra()`
- it does not change inline traversal `.where(...)` lowering
- it does not change `EXISTS` block lowering
- it does not change aggregate HAVING behavior

## Motivation

The previous lowering strategy treated every discovered property binding as optional unless it came from a required traversal. That produced SPARQL such as:

```sparql
SELECT DISTINCT ?a0
WHERE {
  ?a0 rdf:type <Person> .
  OPTIONAL { ?a0 <name> ?a0_name . }
  FILTER(?a0_name = "Semmy")
}
```

That query is valid, but it is not how a human would typically write the same intent. Because the `FILTER` already rejects rows where `?a0_name` is unbound, the `OPTIONAL` is redundant.

The goal of this scope was to improve generated SPARQL so it more closely matches hand-written intent without changing result semantics.

## Architecture Overview

The relevant pipeline remains:

1. DSL builders emit `IRSelectQuery`
2. `selectToAlgebra()` in `src/sparql/irToAlgebra.ts` converts IR into SPARQL algebra
3. algebra serialization produces the final SPARQL string
4. result mapping reconstructs projected objects from bindings

The refinement sits inside step 2.

## Final Design

### Core rule

Bindings referenced by a top-level `query.where` are partitioned into:

- required bindings: emitted in the main BGP
- optional bindings: emitted via `OPTIONAL` `LeftJoin`s exactly as before

Bindings are promoted only when the outer filter is null-rejecting with respect to that binding.

### Boolean composition rules

The implementation uses a small recursive analysis over IR expressions:

- `AND`: required bindings are the union of both sides
- `OR`: required bindings are the intersection of both sides
- `NOT`: forwards the required set of its inner expression
- `binary_expr` and `function_expr`: gather required bindings from their arguments
- `exists_expr`: contributes nothing to the outer required set because it lowers inside its own block
- `aggregate_expr`: contributes nothing because aggregate comparisons continue through HAVING behavior

This gives the desired result:

- `p.name.equals("Semmy")` promotes `name`
- `p.name.equals("A").or(p.name.equals("B"))` promotes `name`
- `p.name.equals("A").or(p.hobby.equals("B"))` promotes neither

### Why this design

This was chosen over a simpler “selected and filtered” heuristic because the simplification is about row elimination semantics, not projection overlap. The null-rejection approach is small enough to maintain, scales to function-based filters, and avoids over-constraining `OR` expressions.

## File Responsibilities

### `src/sparql/irToAlgebra.ts`

This file owns the lowering change.

Key additions:

- `bindingKey()` and `contextAliasKey()` for stable lookup keys
- `mergeKeySets()` and `intersectKeySets()` for boolean composition
- `collectRequiredBindingKeys()` to compute which outer filter bindings are mandatory
- partitioning logic in `processExpressionForProperties()` to route each discovered binding to either `requiredPropertyTriples` or `optionalPropertyTriples`

The rest of the select-lowering pipeline stays intact:

- root type triple is always required
- traversals are still required unless they are already modeled as filtered optional traversal blocks
- inline traversal filters still produce nested OPTIONAL blocks
- `EXISTS` and `MINUS` keep their local property-collection behavior

### `src/test-helpers/query-fixtures.ts`

Added one focused fixture:

- `outerWhereDifferentPropsOr`

This exists specifically to guard the case that must not simplify:

```ts
Person.select((p) => [p.name, p.hobby])
  .where((p) => p.name.equals('Jinx').or(p.hobby.equals('Jogging')))
```

### `src/tests/sparql-algebra.test.ts`

Expanded structural assertions for:

- simple top-level equality
- top-level filter plus projection
- same-property `OR`
- different-property `OR`
- context-property filters
- implicit traversal filters
- function-based filters
- aggregate filter inputs remaining optional

These tests verify placement in the algebra tree, not just textual output.

### `src/tests/sparql-select-golden.test.ts`

Updated goldens where simplification is now intended and added a golden for the non-simplifying different-property `OR` case.

### `src/tests/sparql-fuseki.test.ts`

Added integration coverage to prove semantic preservation for the different-property `OR` case. This is the highest-risk case for accidental over-promotion.

### `documentation/sparql-algebra.md`

Updated the docs so the public description no longer claims that every discovered property becomes optional. The documentation now explains that top-level null-rejecting filters promote required triples while projection-only and conditional bindings remain optional.

## Behavior Examples

### Example 1: simple top-level equality

DSL:

```ts
Person.select().where((p) => p.name.equals('Semmy'))
```

Current SPARQL:

```sparql
SELECT DISTINCT ?a0
WHERE {
  ?a0 rdf:type <Person> .
  ?a0 <name> ?a0_name .
  FILTER(?a0_name = "Semmy")
}
```

### Example 2: projected property plus filtered property

DSL:

```ts
Person.select((p) => p.name).where((p) => p.bestFriend.equals(getQueryContext('user')))
```

Current SPARQL shape:

- `bestFriend` is required because the filter depends on it
- `name` stays optional because it is projection-only

### Example 3: same-property OR

DSL:

```ts
Person.select((p) => p.name)
  .where((p) => p.name.equals('Semmy').or(p.name.equals('Moa')))
```

`name` is required because both branches depend on the same binding.

### Example 4: different-property OR

DSL:

```ts
Person.select((p) => [p.name, p.hobby])
  .where((p) => p.name.equals('Jinx').or(p.hobby.equals('Jogging')))
```

Both bindings stay optional because either branch can match without the other property being present.

### Example 5: implicit traversal filter

DSL:

```ts
Person.select().where((p) => p.friends.name.equals('Moa'))
```

The friend traversal remains required, and the filtered `name` binding is now also required because the outer filter cannot pass without it.

## Public API Surface

There are no new public exports, classes, or user-facing DSL methods in this scope.

The behavioral change is in SPARQL generation only:

- simpler SPARQL for outer null-rejecting filters
- unchanged result mapping and DSL surface

## Resolved Edge Cases

- `OR` across different properties does not simplify
- shared-property `OR` does simplify
- function filters such as `strlen(name) > 5` simplify because they are null-rejecting
- context-property comparisons simplify only the filtered binding and leave projection-only bindings optional
- aggregate comparisons such as `friends.size().equals(2)` keep aggregate inputs optional and continue to rely on HAVING semantics
- `EXISTS` internals do not leak required bindings into the outer query

## Validation Coverage

Validation was run at two levels.

### Targeted validation

Command:

```bash
npm test -- --runInBand --runTestsByPath src/tests/sparql-algebra.test.ts src/tests/sparql-select-golden.test.ts src/tests/sparql-fuseki.test.ts
```

Result:

- 3 suites passed
- 204 tests passed

### Full package validation

Command:

```bash
npm test -- --runInBand
```

Result:

- 33 suites passed
- 3 suites skipped
- 1033 tests passed
- 114 skipped tests remained skipped

## Documentation Links

- `documentation/sparql-algebra.md`
- `src/sparql/irToAlgebra.ts`
- `src/tests/sparql-algebra.test.ts`
- `src/tests/sparql-select-golden.test.ts`
- `src/tests/sparql-fuseki.test.ts`

## Tradeoffs And Final Decisions

- Kept the implementation local to select lowering instead of rewriting all property discovery paths.
- Chose semantic null-rejection analysis over a projection-aware heuristic.
- Treated `OR` conservatively via set intersection to preserve correctness.
- Left inline traversal `.where(...)` and `EXISTS` lowering untouched because they already model their own scope and optionality rules.

## Limitations

- The required-binding analysis currently treats function-based outer filter usage as null-rejecting by default. That matches the current function set and SPARQL behavior used here, but future additions with explicit null-tolerant semantics may need an exception list.
- This scope does not attempt to further optimize nested `EXISTS`, traversal-local OPTIONAL blocks, or serializer-level formatting beyond required-vs-optional placement.

## Deferred Work

Nothing was deferred from this specific scope.

If future work expands the expression system with null-tolerant functions, add a focused follow-up ideation doc rather than weakening the current rule implicitly.

## Wrapup Status

Code readability:

- reviewed
- one clarifying comment added to `src/sparql/irToAlgebra.ts`

Dead code:

- none found in scope

Documentation:

- updated and aligned with behavior

PR readiness:

- implementation: ready
- tests: ready
- docs: ready
- changeset: pending user-selected bump level
- final commit: pending changeset resolution

PR reference:

- no PR created during this scope
