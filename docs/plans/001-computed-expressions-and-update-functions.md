---
source: docs/ideas/006-computed-expressions-and-update-functions.md
summary: Expression support for computed query fields and mutation updates via fluent property methods and Expr module.
packages: [core]
---

# Plan: Computed Expressions & Update Functions

## Overview

Add two related capabilities to the DSL:

1. **Computed fields in queries** — fluent expression methods on property proxies (`.plus()`, `.concat()`, etc.) that produce `IRExpression` nodes, usable in `select()` projections and `where()` filters.
2. **Expression-based mutations** — accept `IRExpression` values in update payloads, plus functional callback form `Shape.update(entity, p => ({ ... }))` for deriving values from existing fields.

## Architecture

### Layer diagram

```
DSL (user-facing)
  │  fluent: p.age.plus(1)          module: Expr.plus(p.age, 1)
  ▼
Expression proxy methods + Expr module
  │  both produce IRExpression nodes
  ▼
IR layer (IRExpression, IRProjectionItem, IRFieldValue)
  │  irToAlgebra.ts converts to SparqlExtend / SparqlExpression
  ▼
SPARQL algebra (SparqlExtend, SparqlExpression)  ← already implemented
  │  algebraToString.ts serializes
  ▼
SPARQL string (BIND, FILTER, inline expressions)  ← already implemented
```

The bottom two layers (algebra types + serialization) are already complete. Work focuses on the top three layers.

### Key decisions carried from ideation

- **Fluent methods are the default API.** `Expr` module is for complex/non-property-first cases.
- **Short + long comparison aliases** (`.gt()` / `.greaterThan()`). `Expr` uses short only.
- **Left-to-right chaining** — no hidden precedence across chained calls.
- **Strict null semantics** — unbound operands yield unbound output. Explicit helpers: `.defaultTo(fallback)`, `Expr.firstDefined(a, b, ...)`.
- **`Expr` only** — no `L` alias.
- **Callback updates use read-only proxy** — same tracing as `select()`, no write-trapping.
- **`null`/`undefined` = unset** in callback update payloads (consistent with plain-object API).
- **`power(n)` emits repeated multiplication** — exponent must be positive integer ≤ 20.
- **Regex flags limited to portable subset** (`i`, `m`, `s`).
- **Aggregate/GROUP filtering** deferred to separate ideation (`012-aggregate-group-filtering.md`).

## Detailed design

### 1. Expression IR node production

Fluent methods and `Expr` functions both create `IRExpression` nodes. The existing `IRExpression` union in `IntermediateRepresentation.ts` already covers:

- `IRBinaryExpression` — arithmetic operators need to be added (`+`, `-`, `*`, `/`) alongside existing comparison operators. **Verified**: `irToAlgebra.ts` and `algebraToString.ts` both pass the operator string through generically — no changes needed in those files for arithmetic ops.
- `IRFunctionExpression` — for SPARQL built-in functions (`CONCAT`, `SUBSTR`, `NOW`, `ABS`, etc.)
- `IRLogicalExpression` — `AND`/`OR`
- `IRNotExpression` — `!expr`

#### Changes to `IntermediateRepresentation.ts`

**Extend `IRBinaryOperator`:**

```ts
// Current:
export type IRBinaryOperator = '=' | '!=' | '>' | '>=' | '<' | '<=';

// Proposed:
export type IRBinaryOperator = '=' | '!=' | '>' | '>=' | '<' | '<='
  | '+' | '-' | '*' | '/';
```

**Extend `IRFieldValue` to accept expressions:**

```ts
// Add IRExpression to the IRFieldValue union:
export type IRFieldValue =
  | IRValue | Date | NodeReferenceValue | IRNodeData
  | IRSetModificationValue | IRFieldValue[] | IRExpression | undefined;
```

This allows mutation field values to carry computed expressions alongside literal data.

### 2. Fluent expression methods on proxy types

Add expression-producing methods to the `QueryPrimitive` / `QueryPrimitiveSet` / `QueryShape` types in `SelectQuery.ts`. These methods return expression wrapper objects that:
- Carry an `IRExpression` node
- Expose further chainable methods (for `p.age.plus(1).times(2)`)
- Are recognized by the projection/filter collection logic

#### ExpressionNode wrapper

New file: `src/expressions/ExpressionNode.ts`

```ts
export class ExpressionNode {
  constructor(public readonly ir: IRExpression) {}

  // Arithmetic (returns ExpressionNode)
  plus(n: ExpressionInput): ExpressionNode { ... }
  minus(n: ExpressionInput): ExpressionNode { ... }
  times(n: ExpressionInput): ExpressionNode { ... }
  divide(n: ExpressionInput): ExpressionNode { ... }
  abs(): ExpressionNode { ... }
  round(): ExpressionNode { ... }
  ceil(): ExpressionNode { ... }
  floor(): ExpressionNode { ... }
  power(n: number): ExpressionNode { ... }

  // Comparison (returns ExpressionNode wrapping boolean IR)
  eq(v: ExpressionInput): ExpressionNode { ... }
  equals(v: ExpressionInput): ExpressionNode { ... }  // alias
  neq(v: ExpressionInput): ExpressionNode { ... }
  notEquals(v: ExpressionInput): ExpressionNode { ... }  // alias
  gt(v: ExpressionInput): ExpressionNode { ... }
  greaterThan(v: ExpressionInput): ExpressionNode { ... }  // alias
  gte(v: ExpressionInput): ExpressionNode { ... }
  greaterThanOrEqual(v: ExpressionInput): ExpressionNode { ... }  // alias
  lt(v: ExpressionInput): ExpressionNode { ... }
  lessThan(v: ExpressionInput): ExpressionNode { ... }  // alias
  lte(v: ExpressionInput): ExpressionNode { ... }
  lessThanOrEqual(v: ExpressionInput): ExpressionNode { ... }  // alias

  // String
  concat(...parts: ExpressionInput[]): ExpressionNode { ... }
  contains(s: ExpressionInput): ExpressionNode { ... }
  startsWith(s: ExpressionInput): ExpressionNode { ... }
  endsWith(s: ExpressionInput): ExpressionNode { ... }
  substr(start: number, len?: number): ExpressionNode { ... }
  before(s: ExpressionInput): ExpressionNode { ... }
  after(s: ExpressionInput): ExpressionNode { ... }
  replace(pat: string, rep: string, flags?: string): ExpressionNode { ... }
  ucase(): ExpressionNode { ... }
  lcase(): ExpressionNode { ... }
  strlen(): ExpressionNode { ... }
  encodeForUri(): ExpressionNode { ... }
  matches(pat: string, flags?: string): ExpressionNode { ... }

  // Date/Time
  year(): ExpressionNode { ... }
  month(): ExpressionNode { ... }
  day(): ExpressionNode { ... }
  hours(): ExpressionNode { ... }
  minutes(): ExpressionNode { ... }
  seconds(): ExpressionNode { ... }
  timezone(): ExpressionNode { ... }
  tz(): ExpressionNode { ... }

  // Logical
  and(expr: ExpressionInput): ExpressionNode { ... }
  or(expr: ExpressionInput): ExpressionNode { ... }
  not(): ExpressionNode { ... }

  // Null-handling
  isDefined(): ExpressionNode { ... }
  isNotDefined(): ExpressionNode { ... }
  defaultTo(fallback: ExpressionInput): ExpressionNode { ... }

  // RDF introspection
  lang(): ExpressionNode { ... }
  datatype(): ExpressionNode { ... }

  // Type casting / checking
  str(): ExpressionNode { ... }
  iri(): ExpressionNode { ... }
  isIri(): ExpressionNode { ... }
  isLiteral(): ExpressionNode { ... }
  isBlank(): ExpressionNode { ... }
  isNumeric(): ExpressionNode { ... }

  // Hash
  md5(): ExpressionNode { ... }
  sha256(): ExpressionNode { ... }
  sha512(): ExpressionNode { ... }
}

// Accepted as expression arguments
export type ExpressionInput = ExpressionNode | string | number | boolean | Date;
```

#### Wiring into QueryPrimitive

In `SelectQuery.ts`, the `QueryPrimitive` proxy's `get` trap is extended: when a fluent expression method name is accessed (e.g., `.plus`, `.concat`), return a function that:
1. Converts the current property path to an `IRPropertyExpression`
2. Creates the appropriate `IRExpression` node
3. Wraps it in an `ExpressionNode`

This keeps `QueryPrimitive` itself thin — expression logic lives in `ExpressionNode`.

### 3. `Expr` module

New file: `src/expressions/Expr.ts`

Public API — all functions return `ExpressionNode`:

```ts
export const Expr = {
  // Arithmetic
  plus(a, b): ExpressionNode,
  minus(a, b): ExpressionNode,
  times(a, b): ExpressionNode,
  divide(a, b): ExpressionNode,
  abs(a): ExpressionNode,
  round(a): ExpressionNode,
  ceil(a): ExpressionNode,
  floor(a): ExpressionNode,
  power(a, b): ExpressionNode,

  // Comparison (short names only)
  eq(a, b), neq(a, b), gt(a, b), gte(a, b), lt(a, b), lte(a, b),

  // String
  concat(...parts), contains(a, b), startsWith(a, b), endsWith(a, b),
  substr(a, start, len?), before(a, b), after(a, b),
  replace(a, pat, rep, flags?), ucase(a), lcase(a), strlen(a),
  encodeForUri(a), regex(a, pat, flags?),

  // Date/Time
  now(),
  year(a), month(a), day(a), hours(a), minutes(a), seconds(a),
  timezone(a), tz(a),

  // Logical
  and(a, b), or(a, b), not(a),

  // Null-handling / Conditional
  firstDefined(...args),
  ifThen(cond, thenVal, elseVal),
  bound(a),

  // RDF introspection
  lang(a), datatype(a),
  str(a), iri(s),
  isIri(a), isLiteral(a), isBlank(a), isNumeric(a),

  // Hash
  md5(a), sha256(a), sha512(a),
};
```

All functions normalize `ExpressionInput` arguments to `IRExpression` (wrapping literals as `IRLiteralExpression`), then construct the corresponding IR node.

### 4. Expression-capable mutations

#### Extend `IRFieldValue`

As described in section 1, add `IRExpression` to the `IRFieldValue` union.

#### Functional callback payloads

In `MutationQuery.ts`, the `convertUpdateObject()` method (line 20-38) currently throws for function values. Change to:

1. Detect function payload at `convertUpdateObject()`.
2. Create a read-only proxy via `createProxiedPathBuilder()` (same infra as `select()`).
3. Invoke the callback with the proxy.
4. Iterate the returned object — each value is either:
   - A literal → process as today (→ `IRFieldValue`)
   - An `ExpressionNode` → extract `.ir` (→ `IRExpression`, which is now in `IRFieldValue` union)
5. Continue into normal mutation IR building.

#### `irToAlgebra.ts` changes for mutation expressions

When lowering `IRUpdateMutation` / `IRUpdateWhereMutation` to SPARQL algebra:
- For each field whose value is an `IRExpression`:
  - Do NOT insert a literal triple in the INSERT clause.
  - Instead, add a `SparqlExtend` (BIND) in the WHERE clause to compute the new value.
  - Insert a triple using the BIND variable in the INSERT clause.
  - Keep the DELETE clause pattern for the old value (same as today).

### 5. Expression recognition in `irToAlgebra.ts` for selects

When processing `IRProjectionItem` entries:
- If the expression is a simple `IRPropertyExpression` → existing path (no change).
- If the expression is any other `IRExpression` → emit a `SparqlExtend` node in the WHERE clause and project the bound variable.

This may already partially work since `IRProjectionItem.expression` is typed as `IRExpression`. Verify during implementation and extend as needed.

### 6. `ExpressionInput` normalization

A shared helper converts `ExpressionInput` → `IRExpression`:

```ts
function toIRExpression(input: ExpressionInput): IRExpression {
  if (input instanceof ExpressionNode) return input.ir;
  if (typeof input === 'string') return { type: 'literal', value: input, datatype: 'string' };
  if (typeof input === 'number') return { type: 'literal', value: input, datatype: 'number' };
  if (typeof input === 'boolean') return { type: 'literal', value: input, datatype: 'boolean' };
  if (input instanceof Date) return { type: 'literal', value: input, datatype: 'dateTime' };
  throw new Error(`Invalid expression input: ${input}`);
}
```

## Inter-component contracts

### ExpressionNode ↔ IR layer

`ExpressionNode.ir` is always a valid `IRExpression`. All methods produce new `ExpressionNode` instances (immutable).

### Proxy layer ↔ ExpressionNode

`QueryPrimitive` proxy intercepts expression method names and delegates to `ExpressionNode` constructor with an `IRPropertyExpression` as the base.

### Mutation pipeline ↔ IRExpression

`IRFieldValue` union includes `IRExpression`. Detection: check if value has `type` property matching an `IRExpression` discriminator (e.g., `'binary'`, `'function'`, `'literal-expr'`, etc.), or check `instanceof ExpressionNode` before extracting `.ir`.

### irToAlgebra ↔ SPARQL algebra

Expression field values in mutations produce `SparqlExtend` nodes. The variable naming convention for computed values: `?computed_{fieldName}` or similar, to avoid collision with property variables.

## Files expected to change

| File | Change |
|------|--------|
| `src/queries/IntermediateRepresentation.ts` | Extend `IRBinaryOperator` with arithmetic ops; add `IRExpression` to `IRFieldValue` union |
| `src/expressions/ExpressionNode.ts` | **New** — `ExpressionNode<T>` class with generic type param and all fluent methods |
| `src/expressions/Expr.ts` | **New** — `Expr` module with all static builder functions |
| `src/queries/SelectQuery.ts` | Wire expression methods into `QueryPrimitive` proxy `get` trap |
| `src/queries/MutationQuery.ts` | Handle function callback payloads in `convertUpdateObject()` |
| `src/sparql/irToAlgebra.ts` | Handle `IRExpression` in projection items; handle expression field values in mutations |
| `src/queries/UpdateBuilder.ts` | Accept callback form in `.set()` or constructor |
| `src/queries/QueryFactory.ts` | Extend `PropUpdateValue` to include `IRExpression` / `ExpressionNode` |
| `src/index.ts` | Export `Expr` module and relevant types |
| `src/tests/sparql-select-golden.test.ts` | Golden tests for computed projections and expression filters |
| `src/tests/sparql-mutation-golden.test.ts` | Golden tests for expression-based updates |

## Potential pitfalls

1. **Proxy method name collisions** — Expression method names (e.g., `.concat()`) could collide with existing property names on shapes. Need to establish resolution order: actual shape properties take priority; expression methods are only available on `QueryPrimitive` (leaf values), not on `QueryShape` (object-type properties).

2. **ExpressionNode detection in mutation pipeline** — Need a reliable way to distinguish `IRExpression` from regular `IRFieldValue` objects when processing mutation data. Using `instanceof ExpressionNode` at the boundary, then storing as `IRExpression` in IR.

3. **Variable naming in mutation BIND** — Generated BIND variables for computed mutation values must not collide with property variables. Use a deterministic naming scheme with a prefix.

4. **Chained expression type narrowing** — `p.name.strlen().gt(5)` chains string → numeric → boolean. TypeScript types should reflect this where feasible, but full type narrowing across chains may need to be relaxed to `ExpressionNode` to avoid combinatorial type explosion.

5. **`power()` build-time validation** — Must validate exponent is a positive integer ≤ 20 at expression build time, not at serialization time, to give clear errors.

## Resolved decisions

1. **File location** — `src/expressions/` folder for both `ExpressionNode` and `Expr`. Queries layer imports from expressions.

2. **Single class with generic type parameter** — No subclass hierarchy. One `ExpressionNode<T>` class where `T extends 'numeric' | 'string' | 'boolean' | 'dateTime' | 'any' = 'any'` tracks the output type. Methods return appropriately typed `ExpressionNode<T>` (e.g., `.strlen()` returns `ExpressionNode<'numeric'>`). This keeps all logic in one file (~200-300 lines), avoids cross-class wiring, and provides IDE type narrowing via the generic. If file size grows beyond comfort, method implementations can be extracted into grouped helper files.

## Testing strategy

### Principle

Every expression in the catalog gets at least one end-to-end golden test (DSL → SPARQL). Edge cases and expression combinations get additional tests. Tests are added at each layer where new code is introduced, but not at layers where existing code already handles the new cases.

### Layer-by-layer test plan

#### 1. End-to-end golden tests (DSL → SPARQL) — **required for every expression**

**Files**: `src/tests/sparql-select-golden.test.ts`, `src/tests/sparql-mutation-golden.test.ts`

Each expression from the catalog (arithmetic, comparison, string, date/time, logical, null-handling, RDF introspection, type casting, hash) gets:
- At least one golden test in a SELECT projection (computed field via BIND)
- Comparison/logical expressions additionally tested in WHERE filters
- Expression-based mutations tested in `sparql-mutation-golden.test.ts`
- Chained expressions tested (e.g., `p.name.strlen().gt(5)`)
- `Expr.*` module equivalents tested alongside fluent forms

Edge case tests:
- `power()` with boundary exponent (1, 20) and build-time error for > 20
- `defaultTo()` and `firstDefined()` with various null scenarios
- `concat()` with mixed literal + property arguments
- `replace()` / `matches()` with regex flags (`i`, `m`, `s`)
- Chained arithmetic precedence: `p.a.plus(1).times(2)` produces `((?a + 1) * 2)` (left-to-right)

**Fixture additions**: New query factories in `src/test-helpers/query-fixtures.ts` for expression-based queries and mutations.

#### 2. ExpressionNode unit tests — **new file**

**File**: `src/tests/expression-node.test.ts`

Tests that `ExpressionNode` methods produce the correct `IRExpression` nodes:
- Each method category (arithmetic, comparison, string, etc.) produces the expected IR node type and structure
- `ExpressionInput` normalization: string/number/boolean/Date literals → `IRLiteralExpression`
- Chaining: intermediate nodes are correct at each step
- `power()` validation: throws for non-integer, negative, or > 20 exponents
- Immutability: each method returns a new `ExpressionNode`

#### 3. Expr module unit tests — **new file**

**File**: `src/tests/expr-module.test.ts`

Tests that `Expr.*` functions produce the same IR nodes as fluent equivalents:
- `Expr.plus(a, b)` produces same IR as `a.plus(b)`
- `Expr.now()` produces correct function call IR
- `Expr.ifThen()`, `Expr.firstDefined()` produce correct IR
- `Expr.bound()`, `Expr.str()`, `Expr.iri()`, etc.

#### 4. IR → Algebra tests — **additions to existing file**

**File**: `src/tests/sparql-algebra.test.ts`

- Verify `IRExpression` in projection items produces `SparqlExtend` nodes in the algebra tree
- Verify `IRExpression` field values in mutations produce BIND + computed variable in WHERE clause
- Verify variable naming for computed mutation values doesn't collide

#### 5. Builder equivalence tests — **additions to existing file**

**File**: `src/tests/query-builder.test.ts`

- `QueryBuilder` expression queries produce same IR as DSL expression queries
- Immutability preserved when chaining expressions

#### 6. Algebra/serialization layer — **no new tests needed**

The existing `sparql-serialization.test.ts` already covers `serializeExpression()` for `binary_expr`, `function_call`, `logical_expr`, etc. New arithmetic binary operators (`+`, `-`, `*`, `/`) flow through the same `binary_expr` serialization path. No changes needed at the algebra type level.

### Test file summary

| File | Status | What it tests |
|------|--------|---------------|
| `sparql-select-golden.test.ts` | Extend | Every expression end-to-end in SELECT |
| `sparql-mutation-golden.test.ts` | Extend | Expression-based mutation updates |
| `expression-node.test.ts` | **New** | ExpressionNode → IRExpression correctness |
| `expr-module.test.ts` | **New** | Expr.* → IRExpression correctness |
| `sparql-algebra.test.ts` | Extend | Expression projection/mutation algebra |
| `query-builder.test.ts` | Extend | Builder equivalence for expressions |
| `query-fixtures.ts` | Extend | New expression query/mutation factories |

## Phased tasks

### Phase 1: IR type extensions

Small, surgical changes to existing types. No new files.

**Tasks:**
1. Extend `IRBinaryOperator` in `IntermediateRepresentation.ts` to include `'+' | '-' | '*' | '/'`.
2. Add `IRExpression` to the `IRFieldValue` union in `IntermediateRepresentation.ts`.

**Validation:**
- `npm run test` passes (no regressions from type widening).
- TypeScript compiles with no errors.

**Dependencies:** None — this is the foundation.

**Status:** COMPLETE — all existing tests pass.

---

### Phase 2: ExpressionNode class + Expr module

Create the two new expression files with full method coverage, plus unit tests.

**Tasks:**
1. Create `src/expressions/ExpressionNode.ts`:
   - `ExpressionNode` class with `readonly ir: IRExpression`.
   - `ExpressionInput` type alias.
   - `toIRExpression(input)` normalization helper.
   - All fluent methods (arithmetic, comparison with short+long aliases, string, date/time, logical, null-handling, RDF introspection, type casting/checking, hash).
   - `power(n)` with build-time validation (positive integer ≤ 20).
   - `matches(pat, flags?)` validates flags are subset of `i`, `m`, `s`.

2. Create `src/expressions/Expr.ts`:
   - `Expr` object with all static builder functions.
   - Uses `toIRExpression()` for argument normalization.
   - `Expr.now()`, `Expr.ifThen()`, `Expr.firstDefined()`, `Expr.bound()` — functions that have no natural fluent host.

3. Create `src/tests/expression-node.test.ts`:
   - Each method category produces correct IR node type and structure.
   - Chaining produces correct nested IR (e.g., `node.plus(1).times(2)` → binary wrapping binary).
   - `ExpressionInput` normalization: string/number/boolean/Date → `IRLiteralExpression`.
   - `power()` throws for non-integer, negative, or > 20 exponents.
   - `replace()`/`matches()` throws for unsupported flags.
   - Immutability: each method returns a new instance.

4. Create `src/tests/expr-module.test.ts`:
   - `Expr.plus(a, b)` produces same IR as `new ExpressionNode(a_ir).plus(b)`.
   - `Expr.now()` produces `IRFunctionExpression` with name `'NOW'`, empty args.
   - `Expr.ifThen(cond, then, else)` → `IRFunctionExpression` with name `'IF'`.
   - `Expr.firstDefined(a, b, c)` → `IRFunctionExpression` with name `'COALESCE'`.
   - `Expr.bound(a)` → appropriate IR node (maps to `SparqlBoundExpr` at algebra level).
   - Type-checking functions: `Expr.isIri()`, `Expr.isLiteral()`, etc.
   - Hash functions: `Expr.md5()`, `Expr.sha256()`, `Expr.sha512()`.

**Validation:**
- `expression-node.test.ts` passes.
- `expr-module.test.ts` passes.
- All existing tests still pass.

**Dependencies:** Phase 1 (IRBinaryOperator must include arithmetic ops).

**Status:** COMPLETE — 129 unit tests pass.

---

### Phase 3: SELECT integration (projections + filters) — COMPLETE

Wire ExpressionNode into the query proxy and handle expression results in the projection/filter pipeline.

**Completed work:**
1. `wrapWithExpressionProxy()` in `SelectQuery.ts` — Proxy wraps all `QueryPrimitive` returns from `generatePathValue()`. Intercepts expression method calls (EXPRESSION_METHODS set), creates `tracedPropertyExpression` from the property path segments, and delegates to ExpressionNode methods. `.equals()` excluded to avoid collision with Evaluation.
2. `FieldSet.ts` — `expressionNode?: ExpressionNode` field on `FieldSetEntry`. `convertTraceResult()`, `traceFieldsWithProxy()`, and `extractSubSelectEntries()` detect ExpressionNode results.
3. `IRDesugar.ts` — `DesugaredExpressionSelect` type added to `DesugaredSelection` union. `desugarEntry()` handles `expressionNode` entries before evaluations.
4. `IRCanonicalize.ts` — No changes needed; spread-based pass-through preserves `expression_select` in selections.
5. `IRLower.ts` — `collectProjectionSeeds()` handles `expression_select` kind: resolves property refs via `resolveExpressionRefs()` and emits `{kind: 'expression'}` seeds.
6. Golden tests: 4 IR-level tests in `ir-select-golden.test.ts` (strlen, custom key, nested path, mixed) + 4 SPARQL-level tests in `sparql-select-golden.test.ts`.
7. Query fixtures: `exprStrlen`, `exprCustomKey`, `exprNestedPath`, `exprMultiple` in `query-fixtures.ts`.

**Validation:** 781 tests pass, 0 regressions. TypeScript compiles clean.

---

### Phase 4: Mutation integration (expression-based updates) — COMPLETE

Enable expression values in update payloads and functional callback form.

**Completed work:**
1. `MutationQuery.ts` — `convertUpdateObject()` handles `typeof obj === 'function'`: creates proxy via `createProxiedPathBuilder()`, invokes callback, processes returned object with `convertNodeDescription()`. `convertUpdateValue()` detects ExpressionNode and passes it through.
2. `IRMutation.ts` — `toSingleFieldValue()` detects ExpressionNode via `isExpressionNode()`, calls `resolveExpressionRefs()` with `MUTATION_SUBJECT_ALIAS` to resolve property refs, returns resolved IRExpression.
3. `irToAlgebra.ts` — `processUpdateFields()` returns `extends` array alongside triples. When a field value is an IRExpression: creates old value variable + OPTIONAL, creates VariableRegistry, processes expression property refs, converts to SparqlExpression, adds BIND (extend), inserts using computed variable. Both `updateToAlgebra()` and `updateWhereToAlgebra()` apply extends.
4. Query fixtures: `updateExprCallback` (functional callback with arithmetic), `updateExprNow` (Expr.now() in update object).
5. Golden tests: 2 SPARQL mutation golden tests verifying BIND, old/computed variables, arithmetic operators.

**Note:** TypeScript type signatures for `UpdatePartial` don't yet accept function callbacks or ExpressionNode values — tests use `as any`. Type-level support deferred to Phase 5 or future work.

**Validation:** 783 tests pass, 0 regressions. TypeScript compiles clean.

---

### Phase 5: Public exports + final integration — COMPLETE

Expose the public API and verify cross-cutting concerns.

**Completed work:**
1. `src/index.ts` — exported `ExpressionNode`, `ExpressionInput`, `PropertyRefMap`, and `Expr`.
2. Edge case tests already covered in Phase 2: power(1) identity, power(20) success, power(21) error, chaining left-to-right, concat with multiple args. All passing.
3. Builder equivalence and IR→algebra tests deferred — the golden tests in Phases 3–4 already verify the full pipeline end-to-end.
4. Removed ideation doc `docs/ideas/006-computed-expressions-and-update-functions.md`.

**Validation:** 783 tests pass, 0 regressions. TypeScript compiles clean. Ideation doc removed.

---

### Phase 6: Expression-aware TypeScript types for updates

Add proper TypeScript types so that expression values and functional callbacks are accepted without `as any` casts. Two sub-strategies combined:

**Sub-strategy A (quick win):** Add `ExpressionNode` to the literal-property branch of `ShapePropValueToUpdatePartial`, so plain-object update payloads accept expression values alongside literals.

**Sub-strategy C (full type-safe proxy):** Add expression method interfaces grouped by property type, a mapped `ExpressionUpdateProxy<S>` type, and a function-callback overload on `UpdateBuilder.set()` and `Shape.update()` that types `p` as `ExpressionUpdateProxy<S>` — giving autocomplete for `.plus()`, `.strlen()`, etc. on the correct property types.

#### Design

**Expression method interfaces** (new file `src/expressions/ExpressionMethods.ts`):

```ts
// Shared base — methods available on ALL expression types
interface BaseExpressionMethods {
  eq(v: ExpressionInput): ExpressionNode;
  equals(v: ExpressionInput): ExpressionNode;
  neq(v: ExpressionInput): ExpressionNode;
  notEquals(v: ExpressionInput): ExpressionNode;
  isDefined(): ExpressionNode;
  isNotDefined(): ExpressionNode;
  defaultTo(fallback: ExpressionInput): ExpressionNode;
  str(): ExpressionNode;
}

// Numeric properties get arithmetic + comparison methods
interface NumericExpressionMethods extends BaseExpressionMethods {
  plus(n: ExpressionInput): ExpressionNode;
  minus(n: ExpressionInput): ExpressionNode;
  times(n: ExpressionInput): ExpressionNode;
  divide(n: ExpressionInput): ExpressionNode;
  abs(): ExpressionNode;
  round(): ExpressionNode;
  ceil(): ExpressionNode;
  floor(): ExpressionNode;
  power(n: number): ExpressionNode;
  gt(v: ExpressionInput): ExpressionNode;
  greaterThan(v: ExpressionInput): ExpressionNode;
  gte(v: ExpressionInput): ExpressionNode;
  greaterThanOrEqual(v: ExpressionInput): ExpressionNode;
  lt(v: ExpressionInput): ExpressionNode;
  lessThan(v: ExpressionInput): ExpressionNode;
  lte(v: ExpressionInput): ExpressionNode;
  lessThanOrEqual(v: ExpressionInput): ExpressionNode;
}

// String properties get string manipulation methods
interface StringExpressionMethods extends BaseExpressionMethods {
  concat(...parts: ExpressionInput[]): ExpressionNode;
  contains(s: ExpressionInput): ExpressionNode;
  startsWith(s: ExpressionInput): ExpressionNode;
  endsWith(s: ExpressionInput): ExpressionNode;
  substr(start: number, len?: number): ExpressionNode;
  before(s: ExpressionInput): ExpressionNode;
  after(s: ExpressionInput): ExpressionNode;
  replace(pat: string, rep: string, flags?: string): ExpressionNode;
  ucase(): ExpressionNode;
  lcase(): ExpressionNode;
  strlen(): ExpressionNode;
  encodeForUri(): ExpressionNode;
  matches(pat: string, flags?: string): ExpressionNode;
  gt(v: ExpressionInput): ExpressionNode;
  lt(v: ExpressionInput): ExpressionNode;
  gte(v: ExpressionInput): ExpressionNode;
  lte(v: ExpressionInput): ExpressionNode;
}

// Date properties get date extraction + comparison
interface DateExpressionMethods extends BaseExpressionMethods {
  year(): ExpressionNode;
  month(): ExpressionNode;
  day(): ExpressionNode;
  hours(): ExpressionNode;
  minutes(): ExpressionNode;
  seconds(): ExpressionNode;
  timezone(): ExpressionNode;
  tz(): ExpressionNode;
  gt(v: ExpressionInput): ExpressionNode;
  lt(v: ExpressionInput): ExpressionNode;
  gte(v: ExpressionInput): ExpressionNode;
  lte(v: ExpressionInput): ExpressionNode;
}

// Boolean properties get logical methods
interface BooleanExpressionMethods extends BaseExpressionMethods {
  and(expr: ExpressionInput): ExpressionNode;
  or(expr: ExpressionInput): ExpressionNode;
  not(): ExpressionNode;
}
```

**Mapped proxy type** (same file):

```ts
// Maps a property type to its expression-enhanced version
type ToExpressionProxy<T> =
  T extends number ? number & NumericExpressionMethods :
  T extends string ? string & StringExpressionMethods :
  T extends Date ? Date & DateExpressionMethods :
  T extends boolean ? boolean & BooleanExpressionMethods :
  T extends Shape ? ExpressionUpdateProxy<T> :
  T;

// The full proxy type passed to update callbacks
export type ExpressionUpdateProxy<S> = {
  [P in KeysWithoutFunctions<S> as P extends 'node' | 'nodeShape' | 'namedNode' | 'targetClass' ? never : P]:
    S[P] extends ShapeSet<infer SST> ? never :  // ShapeSet props not available in expression proxy
    ToExpressionProxy<S[P]>;
};
```

**Function callback overload** — changes to `UpdateBuilder.set()`:

```ts
// Current: set<NewU extends UpdatePartial<S>>(data: NewU): UpdateBuilder<S, NewU, R>
// Add overload:
set(fn: (p: ExpressionUpdateProxy<S>) => ExpressionUpdateResult<S>): UpdateBuilder<S, any, R>;
set<NewU extends UpdatePartial<S>>(data: NewU): UpdateBuilder<S, NewU, R>;
```

Where `ExpressionUpdateResult<S>` is a Partial mapped type that accepts either literal values or ExpressionNode for each property.

**Sub-strategy A integration** — 1-line change in `QueryFactory.ts`:

```ts
// Line 120-124, change:
type ShapePropValueToUpdatePartial<ShapeProperty> = ShapeProperty extends Shape
  ? UpdatePartial<ShapeProperty>
  : ShapeProperty extends ShapeSet<infer SSType>
    ? SetUpdateValue<SSType>
    : ShapeProperty;
// To:
type ShapePropValueToUpdatePartial<ShapeProperty> = ShapeProperty extends Shape
  ? UpdatePartial<ShapeProperty>
  : ShapeProperty extends ShapeSet<infer SSType>
    ? SetUpdateValue<SSType>
    : ShapeProperty | ExpressionNode;
```

This makes `.set({age: someExpressionNode})` compile without casts. The downside (ExpressionNode in autocomplete for every literal property) is mitigated by Option C's callback form being the primary expression API.

#### Tasks

1. **Create `src/expressions/ExpressionMethods.ts`** — Define `BaseExpressionMethods`, `NumericExpressionMethods`, `StringExpressionMethods`, `DateExpressionMethods`, `BooleanExpressionMethods` interfaces. Define `ToExpressionProxy<T>`, `ExpressionUpdateProxy<S>`, and `ExpressionUpdateResult<S>` types. Export all.

2. **Update `QueryFactory.ts`** — Add `| ExpressionNode` to the literal-property branch of `ShapePropValueToUpdatePartial` (Sub-strategy A). Import `ExpressionNode` type.

3. **Update `UpdateBuilder.ts`** — Add function-callback overload to `.set()` method. Import `ExpressionUpdateProxy` and `ExpressionUpdateResult` types.

4. **Update `Shape.ts` (or relevant base update method)** — If `Shape.update()` exists as a static convenience, add the same function-callback overload there.

5. **Export new types from `src/index.ts`** — Export `ExpressionUpdateProxy`, `ExpressionMethods` interfaces, `ExpressionUpdateResult`.

6. **Add type-level tests** — Create or extend `src/tests/expression-types.test.ts`:
   - Verify `.set({age: p.age.plus(1)})` compiles without cast (Sub-strategy A).
   - Verify `.set(p => ({age: p.age.plus(1)}))` compiles without cast and `p.age` has `.plus()` in autocomplete (Sub-strategy C).
   - Verify `p.name` in callback has `.strlen()`, `.ucase()` etc but NOT `.plus()`.
   - Verify `p.age` has `.plus()`, `.abs()` etc but NOT `.strlen()`.
   - Verify `p.birthDate` has `.year()`, `.month()` etc but NOT `.plus()`.
   - Verify nested shape properties work: `p.bestFriend.name.ucase()`.
   - Verify return type accepts mixed literal + expression values.
   - Negative cases: verify expressions on ShapeSet properties are excluded.

7. **Update existing test fixtures** — Remove `as any` casts from `updateExprCallback` and `updateExprNow` in `query-fixtures.ts` to verify the types work end-to-end.

#### Validation

- All existing 783 tests still pass.
- TypeScript compiles clean (no errors).
- `as any` casts removed from expression mutation test fixtures.
- Type-level tests verify correct method availability per property type.
- No regressions in autocomplete behavior for non-expression update payloads.

#### Dependencies

Phase 4 (mutation integration must be complete for runtime behavior to exist).

#### Estimated scope

~80-100 lines of new type definitions in `ExpressionMethods.ts`, ~10 lines of changes across `QueryFactory.ts`, `UpdateBuilder.ts`, `index.ts`. Test file ~60 lines.

---

### Phase 7: Multi-segment expression refs in mutations (B2 — traversal collector)

Enable mutation expressions that reference properties on related entities, e.g. `p.bestFriend.name.ucase()`. Currently, multi-segment refs silently resolve incorrectly (all segments collapse to the mutation subject alias). This phase replaces the stub with a real traversal collector and wires the resulting patterns into the SPARQL WHERE clause.

#### Current problem

In `IRMutation.ts:64-78`, when `resolveExpressionRefs` encounters a multi-segment ref like `p.bestFriend.name` (segments: `[bestFriendPropertyId, namePropertyId]`), the `resolveTraversal` callback is a stub that always returns `MUTATION_SUBJECT_ALIAS`. This means:

- `p.bestFriend.name` resolves as `property_expr(MUTATION_SUBJECT_ALIAS, namePropertyId)` — reading `name` on the **subject** instead of on the **bestFriend** entity
- The traversal to `bestFriend` is never generated, so the SPARQL is wrong

#### Design (B2 — threaded collector)

**Traversal collector** — a factory function that creates a `resolveTraversal` callback and accumulates traversal patterns as a side effect:

```ts
// IRMutation.ts
type TraversalPattern = {
  from: string;       // alias of the source entity (e.g. '__mutation_subject__')
  property: string;   // PropertyShape ID for the relationship (e.g. bestFriend's ID)
  to: string;         // generated alias for the target entity (e.g. '__trav_0__')
};

function createTraversalCollector() {
  const patterns: TraversalPattern[] = [];
  let counter = 0;
  // Dedup: if the same (from, property) pair appears twice, return the existing alias
  const seen = new Map<string, string>();

  const resolve = (fromAlias: string, propertyShapeId: string): string => {
    const key = `${fromAlias}|${propertyShapeId}`;
    if (seen.has(key)) return seen.get(key)!;
    const toAlias = `__trav_${counter++}__`;
    seen.set(key, toAlias);
    patterns.push({ from: fromAlias, property: propertyShapeId, to: toAlias });
    return toAlias;
  };

  return { resolve, patterns };
}
```

**Integration into `toSingleFieldValue`** — the collector is threaded as an optional parameter. Return type stays `IRFieldValue` — traversal patterns accumulate in the collector:

```ts
// Before:
const toSingleFieldValue = (value: SinglePropertyUpdateValue): IRFieldValue => {
  // ...
  if (isExpressionNode(value)) {
    return resolveExpressionRefs(
      value.ir, value._refs, MUTATION_SUBJECT_ALIAS,
      (_fromAlias, _propertyShapeId) => MUTATION_SUBJECT_ALIAS, // stub
    );
  }
  // ...
};

// After:
const toSingleFieldValue = (
  value: SinglePropertyUpdateValue,
  collector?: ReturnType<typeof createTraversalCollector>,
): IRFieldValue => {
  // ...
  if (isExpressionNode(value)) {
    if (!collector) {
      // No collector = no multi-segment support; throw for safety
      throw new Error(
        'Multi-segment property refs in mutation expressions require a traversal collector',
      );
    }
    return resolveExpressionRefs(
      value.ir, value._refs, MUTATION_SUBJECT_ALIAS,
      collector.resolve,
    );
  }
  // ...
};
```

The collector is created once per `toNodeData()` call and threaded through `toFieldValue` → `toSingleFieldValue`:

```ts
const toNodeData = (
  description: NodeDescriptionValue,
  collector?: ReturnType<typeof createTraversalCollector>,
): IRNodeData => {
  return {
    shape: description.shape.id,
    fields: description.fields.map(f => toFieldUpdate(f, collector)),
    ...(description.__id ? {id: description.__id} : {}),
  };
};
```

**IR output** — `IRUpdateMutation` and `IRUpdateWhereMutation` gain an optional `traversalPatterns` field:

```ts
// IntermediateRepresentation.ts
export type IRUpdateMutation = {
  kind: 'update';
  shape: string;
  id: string;
  data: IRNodeData;
  traversalPatterns?: IRTraversalPattern[];
};

export type IRUpdateWhereMutation = {
  kind: 'update_where';
  shape: string;
  data: IRNodeData;
  where?: IRExpression;
  wherePatterns?: IRGraphPattern[];
  traversalPatterns?: IRTraversalPattern[];
};

export type IRTraversalPattern = {
  from: string;       // source alias
  property: string;   // property IRI
  to: string;         // target alias
};
```

**`buildCanonicalUpdateMutationIR` and `buildCanonicalUpdateWhereMutationIR`** create the collector, pass it to `toNodeData`, and attach `collector.patterns` to the output (only if non-empty).

**`irToAlgebra.ts` changes** — in `updateToAlgebra()` and `updateWhereToAlgebra()`, after constructing the WHERE base, iterate `query.traversalPatterns` and add OPTIONAL join patterns:

```ts
// For each traversal pattern, add an OPTIONAL triple to the WHERE clause
if (query.traversalPatterns) {
  for (const trav of query.traversalPatterns) {
    // Resolve 'from' alias to actual SPARQL term
    const fromTerm = trav.from === MUTATION_SUBJECT_ALIAS
      ? subjectTerm
      : varTerm(trav.from);
    const traversalTriple = tripleOf(fromTerm, iriTerm(trav.property), varTerm(trav.to));
    whereAlgebra = {
      type: 'left_join',
      left: whereAlgebra,
      right: { type: 'bgp', triples: [traversalTriple] },
    };
  }
}
```

The OPTIONAL wrapping ensures the update still executes when the related entity doesn't exist (the expression evaluates to unbound).

#### Example: `p.bestFriend.name.ucase()`

User code:
```ts
await Person.update(entity, p => ({
  nickname: p.bestFriend.name.ucase(),
}));
```

Ref map: `{__ref_0__: [bestFriendPropertyId, namePropertyId]}`

After collector resolution:
- Traversal: `{from: '__mutation_subject__', property: bestFriendPropertyId, to: '__trav_0__'}`
- Resolved expression: `UCASE(property_expr('__trav_0__', namePropertyId))`

Generated SPARQL:
```sparql
DELETE { <entity> <nickname> ?old_nickname }
INSERT { <entity> <nickname> ?computed_nickname }
WHERE {
  OPTIONAL { <entity> <nickname> ?old_nickname }
  OPTIONAL { <entity> <bestFriend> ?__trav_0__ }
  OPTIONAL { ?__trav_0__ <name> ?__trav_0___name }
  BIND(UCASE(?__trav_0___name) AS ?computed_nickname)
}
```

#### Tasks

1. **Add `IRTraversalPattern` type to `IntermediateRepresentation.ts`** — Define `IRTraversalPattern` with `from`, `property`, `to` fields. Add optional `traversalPatterns?: IRTraversalPattern[]` to both `IRUpdateMutation` and `IRUpdateWhereMutation`.

2. **Implement `createTraversalCollector()` in `IRMutation.ts`** — Factory function returning `{resolve, patterns}`. Includes dedup via `(from, property)` key.

3. **Thread collector through `toNodeData` → `toFieldUpdate` → `toFieldValue` → `toSingleFieldValue`** — Add optional `collector` parameter to each function. Pass the collector through without changing return types. In `toSingleFieldValue`, replace the stub callback with `collector.resolve`.

4. **Update `buildCanonicalUpdateMutationIR` and `buildCanonicalUpdateWhereMutationIR`** — Create collector, pass to `toNodeData`, attach `collector.patterns` to output when non-empty.

5. **Update `irToAlgebra.ts`** — In both `updateToAlgebra()` and `updateWhereToAlgebra()`, after `wrapOldValueOptionals`, iterate `query.traversalPatterns` and add OPTIONAL join triples to the WHERE algebra.

6. **Add golden test: multi-segment mutation expression** — New fixture in `query-fixtures.ts`:
   ```ts
   // Person.update(entity, p => ({ nickname: p.bestFriend.name.ucase() }))
   export const updateExprTraversal = ...
   ```
   Golden test in `sparql-mutation-golden.test.ts` verifying:
   - OPTIONAL triple for `<entity> <bestFriend> ?__trav_0__`
   - OPTIONAL triple for `?__trav_0__ <name> ?__trav_0___name`
   - BIND with `UCASE(?__trav_0___name)` as `?computed_nickname`
   - DELETE/INSERT for `<entity> <nickname>`

7. **Add golden test: multi-segment with shared traversal** — Two expression fields referencing the same intermediate entity (e.g. `p.bestFriend.name` and `p.bestFriend.age`), verifying the dedup produces only one traversal triple for `bestFriend`.

8. **Add error test: collector absent** — Verify that a multi-segment ref without a collector throws a clear error (safety net for internal misuse).

9. **Replace silent stub with error** — In the current stub location (`IRMutation.ts:72-76`), the stub is removed entirely by Task 3. Verify that any code path reaching `resolveExpressionRefs` without a collector throws rather than silently resolving wrong.

#### Validation

- All existing 783+ tests still pass.
- TypeScript compiles clean.
- New golden tests pass for single-traversal and shared-traversal cases.
- Error test confirms multi-segment refs without collector throw.
- Single-segment mutation expressions (existing tests) continue to work unchanged.

#### Dependencies

Phase 4 (mutation expression support must exist). Independent of Phase 6 (types).

#### Estimated scope

~50-60 lines in `IRMutation.ts` (collector + threading), ~15 lines in `IntermediateRepresentation.ts`, ~15 lines in `irToAlgebra.ts`, ~40 lines in test fixtures/golden tests.

---

### Phase 8: Expression-based WHERE filters (Evaluation ↔ ExpressionNode unification)

Enable expressions in WHERE clauses so users can write:
```ts
Person.select(p => ({name: p.name}))
  .where(p => p.name.strlen().gt(5))
```

Currently this fails because `.strlen()` returns `ExpressionNode` (via `wrapWithExpressionProxy`), and `processWhereClause` expects the callback to return `Evaluation`. The `.gt()` on ExpressionNode returns another ExpressionNode, not an Evaluation.

#### Architecture review

**Current WHERE pipeline** (all working, no changes needed in the IR/lowering layers):

```
WhereClause callback → Evaluation → WherePath → DesugaredWhere → CanonicalWhere → IRExpression
```

Key files and entry points:
- `SelectQuery.ts:52-54` — `WhereClause<S>` type: `Evaluation | ((s: ...) => Evaluation)`
- `SelectQuery.ts:845-859` — `processWhereClause()`: invokes callback, calls `result.getWherePath()`
- `SelectQuery.ts:1325-1393` — `Evaluation` class: holds `(value, method, args)`, produces `WherePath`
- `IRDesugar.ts:383-396` — `toWhere()`: converts `WherePath` → `DesugaredWhere`
- `IRCanonicalize.ts:152+` — `canonicalizeWhere()`: flattens AND/OR groups
- `IRLower.ts:461-497` — `lowerWhereToIR()`: converts canonical → `{where: IRExpression, wherePatterns: IRGraphPattern[]}`

**Current Expression pipeline** (for SELECT projections, already working):

```
ExpressionNode.ir → resolveExpressionRefs() → IRExpression
```

**The gap:** These two pipelines produce the same output type (`IRExpression`) but have completely separate entry points. The WHERE pipeline requires `Evaluation` objects; expressions produce `ExpressionNode`. They need to meet.

#### Dependency analysis

**Upstream (what calls processWhereClause / consumes WhereClause):**

| Caller | File | Line | Notes |
|--------|------|------|-------|
| `SelectQueryFactory` (DSL) | `SelectQuery.ts` | 1145, 1189 | `.where()` on QueryShapeSet (some/every) |
| `QueryBuilder.build()` | `QueryBuilder.ts` | 436, 500 | `.where()` and sub-select where |
| `DeleteBuilder.build()` | `DeleteBuilder.ts` | 113 | `.where()` on delete |
| `UpdateBuilder.buildUpdateWhere()` | `UpdateBuilder.ts` | 153 | `.where()` on update |
| `Evaluation.and()/.or()` | `SelectQuery.ts` | 1382, 1389 | Chaining |

All callers follow the same pattern: pass `WhereClause` → get `WherePath` → feed into desugar pipeline. The `WherePath` type is the funnel point.

**Downstream (what consumes the output):**

All paths converge to `IRExpression` — which is already the type that ExpressionNode produces. The IR, canonical, and lowering layers don't need to change.

#### Design: Dual-track at the funnel point

The cleanest approach is to widen `processWhereClause` to accept ExpressionNode results alongside Evaluation, and introduce a new `DesugaredExpressionWhere` that bypasses the desugar/canonicalize pipeline and goes straight to IRExpression during lowering.

**Sub-phase 8a: ExpressionNode → WHERE at the DSL level**

1. Widen `WhereClause<S>` type to accept ExpressionNode-returning callbacks
2. Widen `processWhereClause` to detect ExpressionNode results
3. Return a new `WherePath` variant that wraps ExpressionNode

**Sub-phase 8b: ExpressionNode WHERE through the pipeline**

1. Add `DesugaredExpressionWhere` to the desugar layer
2. Add `CanonicalExpressionWhere` to the canonical layer (passthrough)
3. Handle in `lowerWhere` → resolve refs → emit IRExpression directly

**Sub-phase 8c: AND/OR chaining with mixed Evaluation + ExpressionNode**

1. Enable `.and()` / `.or()` on ExpressionNode results in WHERE context
2. This is the hardest part — need a wrapper that bridges both worlds

---

#### Sub-phase 8a: DSL-level ExpressionNode WHERE acceptance

**Goal:** Make `.where(p => p.name.strlen().gt(5))` not throw at the DSL level.

**Task 8a.1: Widen `WhereClause` type** (`SelectQuery.ts:52-54`)

```ts
// Before:
export type WhereClause<S extends Shape | AccessorReturnValue> =
  | Evaluation
  | ((s: ToQueryBuilderObject<S>) => Evaluation);

// After:
export type WhereClause<S extends Shape | AccessorReturnValue> =
  | Evaluation
  | ExpressionNode
  | ((s: ToQueryBuilderObject<S>) => Evaluation | ExpressionNode);
```

This is safe because all callers pass through `processWhereClause`, which is the single funnel point.

**Task 8a.2: Widen `processWhereClause` return type and add ExpressionNode detection** (`SelectQuery.ts:845-859`)

Introduce a new `WhereExpressionPath` variant:

```ts
// New type alongside existing WherePath types (SelectQuery.ts ~line 200)
export type WhereExpressionPath = {
  expressionNode: ExpressionNode;
};

// Widen WherePath:
export type WherePath = WhereEvaluationPath | WhereAndOr | WhereExpressionPath;
```

Update `processWhereClause`:

```ts
export const processWhereClause = (
  validation: WhereClause<any>,
  shape?,
): WherePath => {
  if (validation instanceof Function) {
    if (!shape) {
      throw new Error('Cannot process where clause without shape');
    }
    const proxy = createProxiedPathBuilder(shape);
    const result = validation(proxy);
    // NEW: detect ExpressionNode result
    if (isExpressionNode(result)) {
      return { expressionNode: result };
    }
    return result.getWherePath();
  } else if (isExpressionNode(validation)) {
    return { expressionNode: validation };
  } else {
    return (validation as Evaluation).getWherePath();
  }
};
```

**Task 8a.3: Add type guard for `WhereExpressionPath`** (`SelectQuery.ts`)

```ts
export function isWhereExpressionPath(path: WherePath): path is WhereExpressionPath {
  return 'expressionNode' in path;
}
```

**Validation 8a:**
- TypeScript compiles clean — no errors from callers of `processWhereClause` (they all pass WherePath to `toWhere`, which we update in 8b)
- `.where(p => p.name.strlen().gt(5))` no longer throws at the DSL level

---

#### Sub-phase 8b: Pipeline passthrough for ExpressionNode WHERE

**Goal:** Wire `WhereExpressionPath` through desugar → canonicalize → lower to produce IRExpression.

**Task 8b.1: Add `DesugaredExpressionWhere` type** (`IRDesugar.ts`)

```ts
// New type (alongside DesugaredWhereComparison and DesugaredWhereBoolean)
export type DesugaredExpressionWhere = {
  kind: 'where_expression';
  expressionNode: ExpressionNode;
};

// Widen DesugaredWhere:
export type DesugaredWhere =
  | DesugaredWhereComparison
  | DesugaredWhereBoolean
  | DesugaredExpressionWhere;
```

**Task 8b.2: Handle `WhereExpressionPath` in `toWhere()`** (`IRDesugar.ts:383-396`)

```ts
export const toWhere = (path: WherePath): DesugaredWhere => {
  // NEW: check for expression path first
  if ('expressionNode' in path) {
    return {
      kind: 'where_expression',
      expressionNode: (path as WhereExpressionPath).expressionNode,
    };
  }
  // ... existing WhereAndOr and WhereEvaluationPath handling
};
```

**Task 8b.3: Add `CanonicalExpressionWhere` type** (`IRCanonicalize.ts`)

```ts
export type CanonicalExpressionWhere = {
  kind: 'where_expression';
  expressionNode: ExpressionNode;
};

// Widen:
export type CanonicalWhereExpression =
  | CanonicalWhereComparison
  | CanonicalWhereLogical
  | CanonicalWhereExists
  | CanonicalWhereNot
  | CanonicalExpressionWhere;
```

**Task 8b.4: Passthrough in `canonicalizeWhere()`** (`IRCanonicalize.ts`)

```ts
// In the canonicalizeWhere switch/if chain, add:
if (where.kind === 'where_expression') {
  return where; // passthrough — already canonical
}
```

**Task 8b.5: Handle in `lowerWhere()`** (`IRLower.ts`)

This is where ExpressionNode refs get resolved and the final IRExpression is produced:

```ts
// In lowerWhere(), add case for 'where_expression':
if (canonical.kind === 'where_expression') {
  const exprWhere = canonical as CanonicalExpressionWhere;
  return resolveExpressionRefs(
    exprWhere.expressionNode.ir,
    exprWhere.expressionNode._refs,
    options.rootAlias,
    options.resolveTraversal,
  );
}
```

Also update `lowerWhereToIR()` (`IRLower.ts:461-497`) — no changes needed since it calls `lowerWhere()` internally.

**Validation 8b:**
- Full pipeline works: `.where(p => p.name.strlen().gt(5))` produces correct IRExpression
- Golden test: `Person.select(p => ({name: p.name})).where(p => p.name.strlen().gt(5))` → SPARQL with `FILTER(STRLEN(?name) > 5)`
- Golden test: `.where(p => p.age.plus(10).lt(100))` → `FILTER((?age + 10) < 100)`
- Existing evaluation-based WHERE tests still pass (regression)

---

#### Sub-phase 8c: AND/OR chaining with ExpressionNode WHERE

**Goal:** Support mixed chaining:
```ts
.where(p => p.name.strlen().gt(5).and(p => p.age.gt(18)))
// or
.where(p => p.name.strlen().gt(5)).and(p => p.age.equals(30))
```

**Problem:** ExpressionNode has `.and()` and `.or()` methods, but they produce `ExpressionNode` (IRLogicalExpression), not `Evaluation` with WhereAndOr chains. There are two sub-cases:

1. **ExpressionNode `.and(ExpressionNode)`** — Already works! `p.name.strlen().gt(5).and(p.age.gt(18))` chains via ExpressionNode's `.and()` method producing a logical_expr. The whole thing is one ExpressionNode returned from the callback.

2. **Evaluation `.and(ExpressionNode-returning callback)`** — Doesn't work. `p.name.equals('Bob').and(p => p.age.plus(1).gt(18))` tries to call `Evaluation.and()` which passes through `processWhereClause`, which now (after 8a) returns `WhereExpressionPath`. But `Evaluation._andOr` stores `WherePath[]` — which we've already widened to include `WhereExpressionPath`. So this should work automatically after 8a+8b.

3. **ExpressionNode result + separate `.and()` chain** — `Person.select(...).where(p => p.name.strlen().gt(5)).where(p => p.age.equals(30))`. This uses two `.where()` calls, not chaining within one callback. QueryBuilder already ANDs multiple where clauses together at build time. This already works at the IR level.

**Task 8c.1: Verify ExpressionNode-to-ExpressionNode AND/OR chaining** — Test that `p.name.strlen().gt(5).and(p.age.plus(1).lt(100))` works as a single ExpressionNode returned from callback. This chains through ExpressionNode's existing `.and()` method — no code changes needed, just tests.

**Task 8c.2: Verify mixed Evaluation-ExpressionNode AND/OR** — Test that:
```ts
.where(p => p.name.equals('Bob').and(p => p.age.plus(1).gt(18)))
```
works. `Evaluation.and()` calls `processWhereClause(subQuery)` — after 8a, this handles ExpressionNode results. The `WhereExpressionPath` flows through `_andOr` array. `toWhere()` handles `WhereAndOr.andOr` entries, each of which calls `toWhere()` recursively — after 8b, this handles `WhereExpressionPath`. No code changes needed beyond 8a+8b; just verification tests.

**Task 8c.3: Handle `WhereExpressionPath` in `DesugaredWhereBoolean`** — Verify that `toWhere()` correctly handles `WhereAndOr` where the `andOr` entries contain `WhereExpressionPath`. The recursive `toWhere()` call in the `andOr.map()` already dispatches to the new `'expressionNode' in path` check from 8b.2. No code changes needed, but the `DesugaredWhereBoolean` type's `andOr` array type references `DesugaredWhere` which now includes `DesugaredExpressionWhere`. Verify the canonical layer handles this:

In `canonicalizeWhere()`, the handler for `where_boolean` recursively calls `canonicalizeWhere()` on each `and`/`or` entry — after 8b.4, this handles `where_expression`. No changes needed.

In `lowerWhere()`, the handler for `where_logical` recursively calls `lowerWhere()` on each expression — after 8b.5, this handles `where_expression`. No changes needed.

**Validation 8c:**
- Golden test: expression-only AND chain `p.name.strlen().gt(5).and(p.age.gt(18))` → SPARQL with `FILTER((STRLEN(?name) > 5) && (?age > 18))`
- Golden test: mixed Evaluation + Expression AND chain → correct combined FILTER
- All existing AND/OR chaining tests still pass

---

#### Sub-phase 8d: Mutation builder WHERE with expressions

**Goal:** Enable expression-based WHERE on UpdateBuilder and DeleteBuilder:
```ts
UpdateBuilder.from(Person).where(p => p.name.strlen().gt(5)).set({active: false})
DeleteBuilder.from(Person).where(p => p.age.plus(10).gt(100))
```

**Task 8d.1: Verify UpdateBuilder.where works** — `UpdateBuilder.buildUpdateWhere()` calls `processWhereClause()` → `toWhere()` → `canonicalizeWhere()` → `lowerWhereToIR()`. After 8a+8b, all these handle ExpressionNode. The `lowerWhereToIR` function (`IRLower.ts:461-497`) calls `lowerWhere()` internally — which now handles `where_expression`. No code changes needed.

**Task 8d.2: Verify DeleteBuilder.where works** — Same pipeline as UpdateBuilder. `DeleteBuilder.buildDeleteWhere()` calls `processWhereClause()` → same chain. No code changes needed.

**Task 8d.3: Add golden tests** — Expression WHERE on mutations:
- `UpdateBuilder.from(Person).where(p => p.name.strlen().gt(5)).set({active: false})` → SPARQL with `FILTER(STRLEN(?name) > 5)` in DELETE/INSERT WHERE
- `DeleteBuilder.from(Person).where(p => p.age.plus(10).gt(100))` → SPARQL with `FILTER((?age + 10) > 100)` in DELETE WHERE

**Validation 8d:**
- Golden tests pass for expression WHERE on update and delete mutations
- Existing mutation WHERE tests still pass

---

#### Full Phase 8 validation criteria

- All existing tests pass (783+)
- TypeScript compiles clean
- New golden tests (6-8 tests):
  1. SELECT with expression WHERE: `strlen().gt()`
  2. SELECT with expression WHERE: `plus().lt()`
  3. SELECT with AND chain of two expressions
  4. SELECT with mixed Evaluation + Expression AND
  5. UPDATE with expression WHERE
  6. DELETE with expression WHERE
  7. Nested expression WHERE: `p.bestFriend.name.strlen().gt(3)`
  8. Expression WHERE combined with expression SELECT projection

#### Files changed

| File | Change | Sub-phase |
|------|--------|-----------|
| `SelectQuery.ts` | Widen `WhereClause`, `WherePath` types; update `processWhereClause`; add `isWhereExpressionPath` guard; import `isExpressionNode` | 8a |
| `IRDesugar.ts` | Add `DesugaredExpressionWhere`; widen `DesugaredWhere`; handle in `toWhere()` | 8b |
| `IRCanonicalize.ts` | Add `CanonicalExpressionWhere`; widen `CanonicalWhereExpression`; passthrough in `canonicalizeWhere()` | 8b |
| `IRLower.ts` | Handle `where_expression` in `lowerWhere()` | 8b |
| `query-fixtures.ts` | New expression WHERE fixtures | 8b-8d |
| `sparql-select-golden.test.ts` | Golden tests for expression WHERE | 8b-8c |
| `sparql-mutation-golden.test.ts` | Golden tests for expression WHERE on mutations | 8d |

#### Dependencies

Phases 3 + 5 (expression proxy and ref resolution must be working). Independent of Phases 6 and 7.

#### Estimated scope

- Sub-phase 8a: ~15 lines (type widening + processWhereClause update)
- Sub-phase 8b: ~30 lines (4 files, small additions to desugar/canonicalize/lower)
- Sub-phase 8c: ~0 code lines, ~30 lines of tests (verification only — chaining works via existing recursion)
- Sub-phase 8d: ~0 code lines, ~20 lines of tests (verification only — mutation builders use same pipeline)

Total: ~45 lines of code changes + ~80 lines of tests

---

### Phase 9: QueryBuilder expression equivalence tests

Verify that `QueryBuilder` (programmatic API) produces identical IR to the DSL when using expressions in SELECT projections and WHERE filters. No code changes expected — `QueryBuilder` uses the same `FieldSet` and `processWhereClause` pipeline.

#### Context

`QueryBuilder` accepts the same `select(fn)` and `where(fn)` callbacks as the DSL. Internally:
- `select(fn)` → `FieldSet.fromCallback(fn, shape)` → same desugar/lower pipeline as DSL (`QueryBuilder.ts:158-170`)
- `where(fn)` → stores callback, calls `processWhereClause(fn, shape)` at build time (`QueryBuilder.ts:436`)

Since Phases 3 and 8 added ExpressionNode handling to `FieldSet` and `processWhereClause` respectively, `QueryBuilder` should handle expressions automatically. This phase confirms that with equivalence tests.

#### Tasks

1. **SELECT expression equivalence test** — Verify DSL and QueryBuilder produce same IR:
   ```ts
   // DSL
   const dslIR = Person.select(p => ({nameLen: p.name.strlen()})).build();
   // QueryBuilder
   const builderIR = QueryBuilder.from(Person).select(p => ({nameLen: p.name.strlen()})).build();
   expect(builderIR).toEqual(dslIR);
   ```

2. **WHERE expression equivalence test** — Verify expression WHERE produces same IR:
   ```ts
   const dslIR = Person.select(p => ({name: p.name})).where(p => p.name.strlen().gt(5)).build();
   const builderIR = QueryBuilder.from(Person).select(p => ({name: p.name})).where(p => p.name.strlen().gt(5)).build();
   expect(builderIR).toEqual(dslIR);
   ```

3. **Mixed expression + evaluation WHERE equivalence** — Verify combined expression and evaluation WHERE:
   ```ts
   const dslIR = Person.select(p => p.name)
     .where(p => p.name.equals('Bob').and(p => p.age.plus(1).gt(18))).build();
   const builderIR = QueryBuilder.from(Person).select(p => p.name)
     .where(p => p.name.equals('Bob').and(p => p.age.plus(1).gt(18))).build();
   expect(builderIR).toEqual(dslIR);
   ```

4. **Expression projection + WHERE combined** — Both expression SELECT and expression WHERE in one query:
   ```ts
   const dslIR = Person.select(p => ({nameLen: p.name.strlen(), name: p.name}))
     .where(p => p.age.gt(18)).build();
   const builderIR = QueryBuilder.from(Person)
     .select(p => ({nameLen: p.name.strlen(), name: p.name}))
     .where(p => p.age.gt(18)).build();
   expect(builderIR).toEqual(dslIR);
   ```

#### Validation

- All 4 equivalence tests pass
- All existing tests still pass
- If any test fails, it indicates a code gap in QueryBuilder that needs fixing (escalate to a code task)

#### Files changed

| File | Change |
|------|--------|
| `src/tests/query-builder.test.ts` | Add 4 expression equivalence tests |

#### Dependencies

Phases 3, 8 (expression SELECT and WHERE must be working).

#### Estimated scope

~40 lines of tests. Zero code changes expected.

---

### Phase summary

| Phase | Description | New files | Changed files | Depends on | Status |
|-------|-------------|-----------|---------------|------------|--------|
| 1 | IR type extensions | — | `IntermediateRepresentation.ts` | — | COMPLETE |
| 2 | ExpressionNode + Expr + unit tests | `ExpressionNode.ts`, `Expr.ts`, 2 test files | — | Phase 1 | COMPLETE |
| 3 | SELECT integration | — | `SelectQuery.ts`, `IRProjection.ts`, `IRLower.ts`, golden tests, fixtures | Phase 2 | COMPLETE |
| 4 | Mutation integration | — | `MutationQuery.ts`, `QueryFactory.ts`, `UpdateBuilder.ts`, `irToAlgebra.ts`, golden tests, fixtures | Phases 1–3 | COMPLETE |
| 5 | Public exports + edge cases | — | `index.ts`, algebra tests, builder tests | Phases 1–4 | COMPLETE |
| 6 | Expression-aware TS types | `ExpressionMethods.ts`, type tests | `QueryFactory.ts`, `UpdateBuilder.ts`, `index.ts`, fixtures | Phase 4 | COMPLETE |
| 7 | Multi-segment mutation refs | — | `IRMutation.ts`, `IntermediateRepresentation.ts`, `irToAlgebra.ts`, golden tests, fixtures | Phase 4 | COMPLETE |
| 8 | Expression-based WHERE | — | `SelectQuery.ts`, `IRDesugar.ts`, `IRCanonicalize.ts`, `IRLower.ts`, golden tests | Phases 3, 5 | COMPLETE |
| 9 | QueryBuilder equivalence | — | `query-builder.test.ts` | Phases 3, 8 | COMPLETE |

## Dependency graph and parallel execution

```
Phases 1–5: COMPLETE
         │
         ├──→ Phase 6 (TS types)      ─┐
         ├──→ Phase 7 (multi-seg refs)  ├──→ Phase 9 (QueryBuilder equivalence)
         └──→ Phase 8 (WHERE filters)  ─┘
```

**Parallel group A** — Phases 6, 7, 8 can all run in parallel after Phases 1–5:
- Phase 6 touches `QueryFactory.ts` (types only), `UpdateBuilder.ts` (overload), `ExpressionMethods.ts` (new), `index.ts` (exports)
- Phase 7 touches `IRMutation.ts` (collector), `IntermediateRepresentation.ts` (new type), `irToAlgebra.ts` (traversal patterns)
- Phase 8 touches `SelectQuery.ts` (WhereClause/processWhereClause), `IRDesugar.ts`, `IRCanonicalize.ts`, `IRLower.ts`
- **No file overlap** between Phase 6, 7, and 8 — fully parallel-safe.

**Phase 9** depends on Phases 3 + 8. It is test-only; no code changes expected. Runs after Phase 8 completes.

**Stub boundaries for parallel execution:**
- Phase 6 needs no stubs — it's type-only changes and can be validated with `npx tsc --noEmit`.
- Phase 7 needs no stubs — it extends the existing mutation pipeline with new internal functions and tests against its own golden fixtures.
- Phase 8 needs no stubs — it adds a new code path through the existing WHERE pipeline and tests against its own golden fixtures.
- Phase 9 needs Phases 3 + 8 to be merged first (no stubs possible — it tests real pipeline equivalence).

## Detailed validation specifications

### Phase 6 validation

**File:** `src/tests/expression-types.test.ts` (new)

Test cases using `@ts-expect-error` and type assertion patterns:

1. **`sub-A: plain object with ExpressionNode value`** — Construct `UpdateBuilder.from(Dog).for('x').set({age: someExpressionNode})`. Assert: compiles without `as any`. Assert: `npx tsc --noEmit` exits 0.

2. **`sub-A: plain object with literal value still works`** — `UpdateBuilder.from(Dog).for('x').set({age: 5})`. Assert: compiles without error.

3. **`sub-C: callback with numeric expression`** — `UpdateBuilder.from(Dog).for('x').set(p => ({age: p.age.plus(1)}))`. Assert: compiles without `as any`. Assert: `p.age` has type `number & NumericExpressionMethods`.

4. **`sub-C: callback with string expression`** — `UpdateBuilder.from(Person).for('x').set(p => ({name: p.name.ucase()}))`. Assert: compiles. Assert: `p.name` has `.strlen()`, `.ucase()`, `.concat()`.

5. **`sub-C: string property lacks numeric methods`** — `// @ts-expect-error` on `p.name.plus(1)`. Assert: TypeScript rejects this.

6. **`sub-C: numeric property lacks string methods`** — `// @ts-expect-error` on `p.age.strlen()`. Assert: TypeScript rejects this.

7. **`sub-C: date property has date methods`** — `p.birthDate.year()` compiles. `// @ts-expect-error` on `p.birthDate.plus(1)`.

8. **`sub-C: nested shape property`** — `p.bestFriend.name.ucase()` compiles.

9. **`sub-C: mixed literal + expression return`** — `set(p => ({name: 'Bob', age: p.age.plus(1)}))` compiles.

10. **`sub-C: ShapeSet property excluded`** — `// @ts-expect-error` on `p.friends.strlen()` or similar.

**Compilation check:** `npx tsc --noEmit` exits 0 with no errors.

**Runtime regression:** `npm test` — all existing 783+ tests pass.

**Fixture update:** Remove `as any` from `updateExprCallback` and `updateExprNow` in `src/test-helpers/query-fixtures.ts`. Assert: `npx tsc --noEmit` still exits 0 after removal.

---

### Phase 7 validation

**File:** `src/tests/sparql-mutation-golden.test.ts` (extend)

**File:** `src/test-helpers/query-fixtures.ts` (extend)

Test cases:

1. **`updateExprTraversal — single traversal`** — Fixture: `Person.update(entity, p => ({nickname: p.bestFriend.name.ucase()}))` (using `as any` for now if Phase 6 isn't done yet).
   - Assert SPARQL contains: `DELETE { <entity> <nickname> ?old_nickname }`
   - Assert SPARQL contains: `INSERT { <entity> <nickname> ?computed_nickname }`
   - Assert SPARQL contains: `OPTIONAL { <entity> <bestFriend> ?__trav_0__ }` (or equivalent variable name)
   - Assert SPARQL contains: `OPTIONAL { ?__trav_0__ <name>` (traversal to name property)
   - Assert SPARQL contains: `BIND(UCASE(` ... `) AS ?computed_nickname)`

2. **`updateExprSharedTraversal — dedup traversal`** — Fixture: two fields referencing same intermediate entity (e.g. `p.bestFriend.name.ucase()` and `p.bestFriend.age.plus(1)`).
   - Assert: only ONE `OPTIONAL { <entity> <bestFriend>` triple in SPARQL (dedup works)
   - Assert: both BIND expressions reference the same traversal variable

3. **`updateExprTraversalError — no collector throws`** — Unit test calling `toSingleFieldValue` directly (or constructing scenario without collector).
   - Assert: throws `Error` with message containing "traversal collector" or similar

**IR-level test** in `src/tests/ir-mutation-golden.test.ts` (if exists, else in sparql-mutation-golden):

4. **`IR: single traversal pattern`** — Build IR for multi-segment fixture.
   - Assert: `result.traversalPatterns` is array of length 1
   - Assert: `result.traversalPatterns[0].from === '__mutation_subject__'`
   - Assert: `result.traversalPatterns[0].property` matches the bestFriend property ID
   - Assert: `result.traversalPatterns[0].to` starts with `__trav_`

**Compilation check:** `npx tsc --noEmit` exits 0.

**Runtime regression:** `npm test` — all existing tests pass + new tests pass.

---

### Phase 8 validation

**File:** `src/tests/sparql-select-golden.test.ts` (extend)

**File:** `src/tests/sparql-mutation-golden.test.ts` (extend)

**File:** `src/test-helpers/query-fixtures.ts` (extend)

Test cases:

1. **`whereExprStrlen — string expression WHERE`** — `Person.select(p => ({name: p.name})).where(p => p.name.strlen().gt(5))`
   - Assert SPARQL contains: `FILTER(STRLEN(?name) > 5)` (or equivalent with literal `"5"^^xsd:integer`)
   - Assert SPARQL contains: `SELECT ?name`
   - Assert: no BIND in WHERE (expression is in FILTER, not projected)

2. **`whereExprArithmetic — numeric expression WHERE`** — `.where(p => p.age.plus(10).lt(100))`
   - Assert SPARQL contains: `FILTER((?age + 10) < 100)`

3. **`whereExprAndChain — two expressions AND'd`** — `.where(p => p.name.strlen().gt(5).and(p.age.gt(18)))`
   - Assert SPARQL contains: `FILTER((STRLEN(?name) > 5) && (?age > 18))`
   - Assert: single FILTER with logical AND, not two separate FILTERs

4. **`whereExprMixed — Evaluation AND ExpressionNode`** — `.where(p => p.name.equals('Bob').and(p => p.age.plus(1).gt(18)))`
   - Assert SPARQL contains both: `?name = "Bob"` and `(?age + 1) > 18` combined with `&&`

5. **`whereExprUpdateBuilder — expression WHERE on update`** — `UpdateBuilder.from(Person).where(p => p.name.strlen().gt(5)).set({active: false})`
   - Assert SPARQL is DELETE/INSERT with `FILTER(STRLEN(?name) > 5)` in WHERE clause

6. **`whereExprDeleteBuilder — expression WHERE on delete`** — `DeleteBuilder.from(Person).where(p => p.age.plus(10).gt(100))`
   - Assert SPARQL is DELETE with `FILTER((?age + 10) > 100)` in WHERE clause

7. **`whereExprNestedPath — traversal in WHERE`** — `.where(p => p.bestFriend.name.strlen().gt(3))`
   - Assert SPARQL contains traversal pattern to bestFriend + FILTER on traversed name

8. **`whereExprWithProjection — expression in both SELECT and WHERE`** — `.select(p => ({nameLen: p.name.strlen()})).where(p => p.age.gt(18))`
   - Assert SPARQL contains both `BIND(STRLEN(?name) AS ?nameLen)` and `FILTER(?age > 18)`

**Compilation check:** `npx tsc --noEmit` exits 0.

**Runtime regression:** `npm test` — all existing tests pass + new tests pass. Specifically verify existing evaluation-based WHERE tests (e.g. `.where(p => p.name.equals('Bob'))`) are unaffected.

---

### Phase 9 validation

**File:** `src/tests/query-builder.test.ts` (extend)

Test cases:

1. **`equivalence: expression SELECT`** — Build IR from both DSL (`Person.select(p => ({nameLen: p.name.strlen()}))`) and QueryBuilder (`QueryBuilder.from(Person).select(p => ({nameLen: p.name.strlen()}))`).
   - Assert: `JSON.stringify(dslIR) === JSON.stringify(builderIR)` (deep equality)

2. **`equivalence: expression WHERE`** — Both APIs with `.where(p => p.name.strlen().gt(5))`.
   - Assert: deep equality of IR

3. **`equivalence: mixed Evaluation + Expression WHERE`** — Both APIs with `.where(p => p.name.equals('Bob').and(p => p.age.plus(1).gt(18)))`.
   - Assert: deep equality of IR

4. **`equivalence: expression SELECT + WHERE combined`** — Both APIs with expression projection and evaluation where.
   - Assert: deep equality of IR

**Runtime check:** `npm test` — all 4 new tests pass.

**Escalation:** If any test fails with different IR, it indicates a code gap in QueryBuilder — file a follow-up task.

## Open questions

None remaining — all design decisions are resolved.

## REVIEW

### Wrapup outcomes

All 9 phases are COMPLETE. Post-implementation cleanup performed:

- **Shared traversal registry**: Extracted `createTraversalResolver<P>()` in `IRLower.ts`, replacing 4 duplicated traversal resolution patterns (3 in IRLower.ts + 1 in IRMutation.ts).
- **`as any` removal**: Removed 3 of 4 production `as any` casts — introduced `AliasGenerator` interface, exhaustive switch check, and proper type narrowing in `isIRExpression`. Remaining cast in `UpdateBuilder.set()` is idiomatic TS for overloaded methods.
- **Traversal separator standardization**: Unified to `:` separator (IRMutation previously used `|`).
- **Where-expression type consolidation**: Removed `CanonicalExpressionWhere`, reusing `DesugaredExpressionWhere` directly in the canonical union.
- **README documentation**: Added computed expressions, expression-based WHERE, `Expr` module, and expression-based updates sections.

### Validation

- 821 tests passing, 0 failures, 3 skipped suites (pre-existing compile-only type tests)
- TypeScript compiles clean (0 errors)
- All phases verified with golden tests covering the full DSL → IR → SPARQL pipeline

### PR readiness: READY

- Code complete, tests passing, documentation updated, changeset prepared.
- Deferred work tracked in `docs/ideas/012-aggregate-group-filtering.md`.
