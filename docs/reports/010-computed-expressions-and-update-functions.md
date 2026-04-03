---
source: docs/plans/001-computed-expressions-and-update-functions.md
summary: Expression support for computed query fields and mutation updates via fluent property methods and Expr module.
packages: [core]
---

# Report: Computed Expressions & Update Functions

## Overview

Added two capabilities to the DSL:

1. **Computed fields in queries** — fluent expression methods on property proxies (`.plus()`, `.concat()`, etc.) that produce `IRExpression` nodes, usable in `select()` projections and `where()` filters.
2. **Expression-based mutations** — accept `IRExpression` values in update payloads, plus functional callback form `Shape.update(entity, p => ({ ... }))` for deriving values from existing fields.

## Architecture

### Pipeline

```
DSL (user-facing)
  │  fluent: p.age.plus(1)          module: Expr.plus(p.age, 1)
  ▼
Expression proxy methods + Expr module
  │  both produce IRExpression nodes via ExpressionNode wrapper
  ▼
IR layer (IRExpression, IRProjectionItem, IRFieldValue)
  │  irToAlgebra.ts converts to SparqlExtend / SparqlExpression
  ▼
SPARQL algebra (SparqlExtend, SparqlExpression)
  │  algebraToString.ts serializes
  ▼
SPARQL string (BIND, FILTER, inline expressions)
```

The bottom two layers (algebra types + serialization) were pre-existing. This work built the top three layers and wired them into the existing query/mutation pipelines.

### Expression proxy mechanism

`QueryPrimitive` in `SelectQuery.ts` uses `wrapWithExpressionProxy()` — a Proxy that intercepts expression method names (from the `EXPRESSION_METHODS` set). When called, it:
1. Converts the current property path segments to placeholder `IRPropertyExpression` nodes via `tracedPropertyExpression()`
2. Stores the real PropertyShape ID segments in a `PropertyRefMap` (`_refs`)
3. Delegates to `ExpressionNode` methods which build the IR tree
4. Placeholder aliases are resolved to real aliases during lowering via `resolveExpressionRefs()`

This keeps `QueryPrimitive` thin — all expression IR logic lives in `ExpressionNode`.

### WHERE expression pipeline

Expression-based WHERE filters follow a dual-track design:

```
WhereClause callback → ExpressionNode detected → WhereExpressionPath
  → DesugaredExpressionWhere (kind: 'where_expression')
  → passthrough in canonicalize
  → lowerWhere() resolves refs → IRExpression (FILTER)
```

**Note:** The `Evaluation` class referenced here was later retired in the 022-negation implementation. All WHERE conditions now use `ExpressionNode` or `ExistsCondition`. See `docs/reports/013-negation-and-evaluation-retirement.md`.

### Mutation expression pipeline

Expression values in update payloads flow through:

```
Shape.update(p => ({age: p.age.plus(1)})) → MutationQuery.convertUpdateObject()
  → proxy invocation → ExpressionNode values detected
  → IRMutation.toSingleFieldValue() → resolveExpressionRefs() → IRExpression in IRFieldValue
  → irToAlgebra: BIND(expr AS ?computed_field) in WHERE, ?computed_field in INSERT
```

Multi-segment refs (e.g. `p.bestFriend.name.ucase()`) use a `TraversalCollector` that generates OPTIONAL join patterns for intermediate entities.

### Shared traversal resolver

`createTraversalResolver<P>()` in `IRLower.ts` is a generic factory that encapsulates the pattern of memoized `(fromAlias, propertyShapeId) → alias` resolution with pattern accumulation. Used by:
- Select query lowering (exists, MINUS, standalone WHERE)
- Mutation traversal collection (`createTraversalCollector()` in `IRMutation.ts`)

## Key design decisions

| Decision | Rationale |
|----------|-----------|
| **Fluent methods as default API** | Natural chaining from property proxies (`p.age.plus(1)`) matches the existing DSL style |
| **`Expr` module for non-property-first** | `Expr.now()`, `Expr.ifThen()`, `Expr.firstDefined()` have no natural fluent host |
| **Left-to-right chaining, no precedence** | `p.a.plus(1).times(2)` = `(a + 1) * 2`. Simple mental model, matches method call order |
| **`power(n)` via repeated multiplication** | SPARQL has no native power function. Exponent must be positive integer ≤ 20 (validated at build time) |
| **Regex flags limited to `i`, `m`, `s`** | Portable subset across SPARQL implementations |
| **Callback updates use read-only proxy** | Same tracing as `select()`, no write-trapping needed |
| **OPTIONAL wrapping for mutation traversals** | Update still executes when related entity doesn't exist (expression evaluates to unbound) |
| **`DesugaredExpressionWhere` reused in canonical layer** | Consolidated — no need for separate `CanonicalExpressionWhere` since the type passes through unchanged |
| **ExpressionMethods interfaces separate from ExpressionNode** | Interfaces describe type-safe projections for `ExpressionUpdateProxy<S>`. ExpressionNode is the runtime IR builder. Different concerns. |

## Files

### New files

| File | Responsibility |
|------|---------------|
| `src/expressions/ExpressionNode.ts` | `ExpressionNode` class — fluent IR builder with all expression methods. `tracedPropertyExpression()`, `PropertyRefMap`, `resolveExpressionRefs()`, `isExpressionNode()` |
| `src/expressions/Expr.ts` | `Expr` module — static builder functions for non-property-first expressions |
| `src/expressions/ExpressionMethods.ts` | TypeScript interfaces per property type (`NumericExpressionMethods`, `StringExpressionMethods`, etc.) and mapped proxy types (`ExpressionUpdateProxy<S>`, `ExpressionUpdateResult<S>`) |
| `src/tests/expression-node.test.ts` | ExpressionNode unit tests (IR node structure, chaining, validation) |
| `src/tests/expr-module.test.ts` | Expr module unit tests (equivalence with fluent forms) |
| `src/tests/expression-types.test.ts` | Type-level tests for update expression proxy typing |

### Changed files

| File | Changes |
|------|---------|
| `src/queries/IntermediateRepresentation.ts` | Extended `IRBinaryOperator` with arithmetic ops. Added `IRExpression` to `IRFieldValue`. Added `IRTraversalPattern` type. Added `traversalPatterns` to `IRUpdateMutation` and `IRUpdateWhereMutation`. |
| `src/queries/SelectQuery.ts` | `wrapWithExpressionProxy()` on QueryPrimitive. Widened `WhereClause<S>` to accept `ExpressionNode`. Added `WhereExpressionPath`. Updated `processWhereClause` to detect ExpressionNode. |
| `src/queries/MutationQuery.ts` | `convertUpdateObject()` handles function callbacks via proxy. `convertUpdateValue()` detects ExpressionNode. |
| `src/queries/IRMutation.ts` | `TraversalCollector` type and `createTraversalCollector()` (delegates to shared `createTraversalResolver`). Threaded collector through `toNodeData` → `toFieldUpdate` → `toFieldValue` → `toSingleFieldValue`. |
| `src/queries/IRDesugar.ts` | `DesugaredExpressionWhere` type. `DesugaredExpressionSelect` type. Handler in `toWhere()` for `WhereExpressionPath`. |
| `src/queries/IRCanonicalize.ts` | Added `DesugaredExpressionWhere` to `CanonicalWhereExpression` union. Passthrough in `canonicalizeWhere()`. |
| `src/queries/IRLower.ts` | `createTraversalResolver<P>()` shared factory. `AliasGenerator` interface. `where_expression` case in `lowerWhere()`. Replaced 3 inlined traversal resolvers with shared factory. Removed `as any` casts. |
| `src/queries/UpdateBuilder.ts` | Function-callback overload on `.set()` with `ExpressionUpdateProxy<S>` typing. |
| `src/queries/QueryFactory.ts` | Added `\| ExpressionNode` to `ShapePropValueToUpdatePartial`. |
| `src/shapes/Shape.ts` | Function-callback overload on `Shape.update()`. |
| `src/queries/FieldSet.ts` | `expressionNode` field on `FieldSetEntry`. Detection in `convertTraceResult()`. |
| `src/queries/IRProjection.ts` | `expression_select` handling in projection seed collection. |
| `src/sparql/irToAlgebra.ts` | `isIRExpression()` type guard. Expression field values in mutations produce BIND + computed variable. Traversal OPTIONAL patterns emitted from `traversalPatterns`. |
| `src/index.ts` | Exported `ExpressionNode`, `ExpressionInput`, `PropertyRefMap`, `Expr`, and all `ExpressionMethods` types. |

## Public API surface

### Exports from `@_linked/core`

```typescript
// Classes
export {ExpressionNode} from './expressions/ExpressionNode.js';

// Module
export {Expr} from './expressions/Expr.js';

// Types
export type {ExpressionInput, PropertyRefMap} from './expressions/ExpressionNode.js';
export type {
  ExpressionUpdateProxy,
  ExpressionUpdateResult,
  BaseExpressionMethods,
  NumericExpressionMethods,
  StringExpressionMethods,
  DateExpressionMethods,
  BooleanExpressionMethods,
} from './expressions/ExpressionMethods.js';
```

### Usage examples

```typescript
// Computed SELECT projection
const result = await Person.select(p => ({
  name: p.name,
  nameLen: p.name.strlen(),
  ageInMonths: p.age.times(12),
}));

// Expression-based WHERE
const adults = await Person.select(p => p.name)
  .where(p => p.age.gt(18));

// Expression-based mutation with callback
await Person.update(p => ({age: p.age.plus(1)})).for(entity);

// Expr module
await Person.update({lastSeen: Expr.now()}).for(entity);
```

## Test coverage

| Test file | Count | What it covers |
|-----------|-------|---------------|
| `expression-node.test.ts` | ~65 | ExpressionNode IR structure, chaining, validation (power, regex flags) |
| `expr-module.test.ts` | ~64 | Expr.* equivalence with fluent, Expr.now/ifThen/firstDefined/bound |
| `expression-types.test.ts` | 14 | Type-level: update proxy typing, method availability per property type |
| `sparql-select-golden.test.ts` | +10 | Expression projections (strlen, custom key, nested, mixed) + expression WHERE (strlen, arithmetic, AND chain, mixed, nested, with projection) |
| `sparql-mutation-golden.test.ts` | +6 | Expression mutations (callback, Expr.now) + traversal (single, shared) + WHERE (update, delete) |
| `query-builder.test.ts` | +4 | QueryBuilder equivalence for expression SELECT, WHERE, mixed, combined |
| `ir-select-golden.test.ts` | +4 | IR-level expression projection tests |

**Total: 821 tests passing**, 0 failures, 3 skipped suites (pre-existing compile-only type tests).

## Post-implementation cleanup

- **Shared traversal registry**: Extracted `createTraversalResolver<P>()`, eliminating 4 duplicated implementations.
- **`as any` removal**: 3 of 4 production casts removed. Remaining one in `UpdateBuilder.set()` is idiomatic for TS overloaded methods.
- **Separator standardization**: All traversal deduplication keys use `:` (was mixed `:` and `|`).
- **Where-expression type consolidation**: `CanonicalExpressionWhere` removed; reuses `DesugaredExpressionWhere` directly.

## Known limitations

- Expression proxy methods are runtime-only on `QueryPrimitive`. Static types for WHERE callbacks return `ExpressionNode | ExistsCondition` (previously `Evaluation | ExpressionNode` before the 022-negation retirement), but the specific expression methods (`.strlen()`, `.plus()`) are not statically typed on `QueryPrimitive`. They work at runtime via Proxy.
- Update expression proxy (`ExpressionUpdateProxy<S>`) IS fully typed — `.plus()` only appears on `number` properties, `.strlen()` only on `string`, etc.
- `power(n)` is limited to positive integer exponents ≤ 20 (emits repeated multiplication).
- Regex flags limited to `i`, `m`, `s`.

## Deferred work

- **Aggregate/GROUP filtering**: Tracked in `docs/ideas/012-aggregate-group-filtering.md`. Expressions like `Expr.sum()`, `Expr.avg()` with HAVING/GROUP BY are out of scope for this work.

## Documentation

- README updated with computed expressions, expression-based WHERE, `Expr` module, and expression-based updates sections.
- [Intermediate Representation docs](../documentation/intermediate-representation.md) — existing, covers base IR types.
- [SPARQL Algebra docs](../documentation/sparql-algebra.md) — existing, covers algebra layer.
