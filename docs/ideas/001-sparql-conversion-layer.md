---
summary: Where and how to build the IR-to-SPARQL conversion layer — package placement, architecture pattern, result mapping, and scope.
packages: [sparql]
---

# SPARQL Conversion Layer

## Context

The new IR (from `003-ir-refactoring`) defines `SelectQuery`, `CreateQuery`, `UpdateQuery`, `DeleteQuery` as backend-agnostic ASTs. The IR has full test parity (147 tests across 9 suites) and the pipeline is stable: DSL → desugar → canonicalize → lower → IR.

The first downstream implementation needs to convert these IR ASTs to SPARQL queries and map SPARQL JSON results back to the typed result objects (`SelectResult`, `CreateResult`, `UpdateResult`, `DeleteResponse`).

### What we're working with

**IR structure** (the input to SPARQL conversion):
- `SelectQuery`: `root` (shape_scan), `patterns[]` (traverse, join, optional, union, exists), `projection[]` ({alias, expression}), `where?`, `orderBy?`, `limit?`, `offset?`, `subjectId?`, `singleResult?`, `resultMap?`
- `CreateQuery`: `shape`, `data` (IRNodeData with fields)
- `UpdateQuery`: `shape`, `id`, `data`
- `DeleteQuery`: `shape`, `ids[]`

**IQuadStore** (the interface stores implement):
- `selectQuery(query: SelectQuery): Promise<SelectResult>` (required)
- `createQuery?(query: CreateQuery): Promise<CreateResult>` (optional)
- `updateQuery?(query: UpdateQuery): Promise<UpdateResult>` (optional)
- `deleteQuery?(query: DeleteQuery): Promise<DeleteResponse>` (optional)

**Legacy reference** (`./OLD`):
- 4 SPARQL factories consumed old ad-hoc query objects (completely different structure)
- `SPARQLStore` base class delegated to factories + handled HTTP + result mapping
- `ResultTemplate` tree described how to map SPARQL bindings back to objects
- Subclasses (VirtuosoStore) only overrode endpoint/auth config
- ~1200 lines for SelectSPARQLFactory alone (the most complex one)

**Current repo**: single package `@_linked/core`, no workspaces. External packages exist: `@_linked/rdf-mem-store`, `@_linked/react` (separate repos).

---

## Decision 1: Package placement — **Route A chosen**

SPARQL generation lives in `src/sparql/` inside `@_linked/core`. Pure conversion functions that depend only on IR types and string operations. Split to `@_linked/sparql` later if/when the layer grows beyond pure conversion (connection management, streaming, etc.).

---

## Decision 2: Architecture pattern — **Route A chosen**

Pure utility functions. No base class. Each store implements `IQuadStore` directly and calls conversion utilities. Base class can be added later when the shared pattern across 2+ stores is clear.

---

## Decision 3: Result mapping — **Route B chosen**

Use the IR's own `resultMap` and `projection` to drive SPARQL JSON → `SelectResult` mapping. No separate `ResultTemplate`. Enrich IR types if gaps found during implementation.

---

## Decision 4: Graph handling — configurable, storage-config driven

Graph wrapping is configurable via options (no GRAPH by default). The broader direction: a **storage config** will map shapes → named graphs → datasets → graph databases. The conversion utilities accept graph config; the store (informed by storage config) decides what to pass. Some engines have specific rules about named vs default graphs and inference — stores retain control, but the storage config is the primary source of truth.

---

## Decision 5: Scope — full coverage of query-fixtures.ts

All queries in `src/test-helpers/query-fixtures.ts` must produce valid SPARQL and pass assertion. Implementation can be phased, but the goal is complete coverage of every factory in that file: all select patterns (simple, nested, where, and/or, some/every, count, sub-select, sortBy, limit, selectAll, as-cast, preload, context), all mutations (create, update with set modifications, delete).

**Testing approach:**
- Golden tests: IR → expected SPARQL strings
- Integration tests: temporary Fuseki store executes generated SPARQL, results mapped back, assertions reuse existing OLD test expectations
- Result format: match OLD behavior; discuss changes if something seems improvable

---

## Decision 6: Layered conversion architecture (new)

### The problem

Different SPARQL engines have different performance characteristics and capabilities. Example: some engines are faster with `FILTER NOT EXISTS` while others prefer `MINUS`. Some support property paths natively, others don't. The AST-to-SPARQL translation should not be a monolithic black box.

### Thinking about layers

The conversion from IR AST → SPARQL string can be decomposed into layers, where each layer produces an intermediate form that the next layer consumes. This lets engines customize at the right level of abstraction.

**Layer 1: IR → SPARQL Algebra (logical plan)**

Convert IR graph patterns and expressions into a logical query plan — an intermediate structure that represents SPARQL semantics without committing to syntax. This is essentially a tree of operations:

```
SparqlPlan =
  | BasicGraphPattern { triples: Triple[] }
  | Filter { expr: SparqlExpr, inner: SparqlPlan }
  | Optional { inner: SparqlPlan }
  | Join { left: SparqlPlan, right: SparqlPlan }
  | Union { branches: SparqlPlan[] }
  | Exists { inner: SparqlPlan, negated: boolean }
  | Projection { variables: Variable[], inner: SparqlPlan }
  | OrderBy { conditions: OrderCondition[], inner: SparqlPlan }
  | Slice { limit?: number, offset?: number, inner: SparqlPlan }
  | Aggregation { groupBy: Variable[], having?: SparqlExpr, aggregates: Aggregate[], inner: SparqlPlan }
```

This layer handles:
- Resolving IR aliases to SPARQL variables (`a0` → `?a0`)
- Converting `shape_scan` → type triple + variable binding
- Converting `traverse` → property triple
- Converting IR expressions → SPARQL expression trees
- Deciding where to place OPTIONAL boundaries

**Layer 2: SPARQL Algebra → SPARQL Algebra (engine-specific rewrites)**

Optional transformation pass. Default is identity (no-op). Engines override to apply rewrites:
- `NOT EXISTS` → `MINUS` (or vice versa)
- Flatten nested JOINs
- Reorder patterns for better selectivity
- Replace property paths with explicit joins
- Add engine-specific hints

This is the customization point. An engine provides rewrite rules or a custom transformer.

**Layer 3: SPARQL Algebra → SPARQL string (serialization)**

Walk the algebra tree and emit SPARQL syntax. This is mostly mechanical:
- Serialize triples, filters, optionals
- Generate PREFIX block from collected URIs
- Apply GRAPH wrapping if configured
- Format for readability

### What this means for the API

```ts
// Full pipeline (what most stores call):
selectToSparql(query: SelectQuery, options?: SparqlOptions): string

// Exposed intermediate steps for engine customization:
selectToPlan(query: SelectQuery): SparqlSelectPlan
planToSparql(plan: SparqlSelectPlan, options?: SparqlOptions): string

// Engine customizes the middle:
class VirtuosoStore implements IQuadStore {
  async selectQuery(query: SelectQuery) {
    let plan = selectToPlan(query);
    plan = this.optimizePlan(plan);  // engine-specific rewrites
    const sparql = planToSparql(plan, this.options);
    // ...
  }
}
```

### Route A: Build all three layers now

Define the algebra type, implement all three layers.

**Pros:** Clean from the start, engines can customize immediately
**Cons:** More upfront work; we don't yet know what rewrite rules engines actually need

### Route B: Build layers 1+3 fused, refactor when needed

Start with a direct IR → SPARQL string conversion (conceptually layers 1+3 merged). Structure the code so that extracting the algebra later is a refactor, not a rewrite. Use clean function boundaries internally.

**Pros:** Ship faster, learn what customization points matter from real usage
**Cons:** Risk of the fused layer becoming hard to split (mitigated by clean internal structure)

### Route C: Build layer 1 + 3, add layer 2 as a hook

Implement the algebra type and serializer. Layer 2 is a simple `(plan) => plan` identity function by default, exposed as an option.

**Pros:** Algebra type exists for engines to inspect/modify, but no premature rewrite rules
**Cons:** Slight overhead of defining the algebra type upfront

### Decision: **Route C chosen**

Define the algebra type from the start (layer 1 + 3). Layer 2 (engine-specific rewrites) is optional and only built when specific stores need it. The algebra type prevents monolithic conversion and gives engines a clean customization surface.

### SPARQL 1.2 algebra as basis for layer 1

The SPARQL 1.2 spec (W3C TR, section 18) defines a formal algebra that maps well to our layer 1. The spec's algebra operators:

| Operator | Signature | Maps from |
|----------|-----------|-----------|
| `BGP` | `BGP(triples[])` | Basic graph pattern (type triples, property triples) |
| `Join` | `Join(P1, P2)` | Conjunction of patterns |
| `LeftJoin` | `LeftJoin(P1, P2, expr)` | OPTIONAL with optional filter |
| `Filter` | `Filter(expr, P)` | WHERE constraints |
| `Union` | `Union(P1, P2)` | Alternative patterns |
| `Minus` | `Minus(P1, P2)` | Pattern subtraction (negation) |
| `Extend` | `Extend(P, var, expr)` | BIND — computed variables |
| `Graph` | `Graph(iri, P)` | Named graph scoping |
| `Table` | `Table(rows)` | Inline data (VALUES) |
| `Aggregate` | `Aggregate(groupExpr, aggExpr, P)` | GROUP BY / HAVING |
| `Project` | `Project(vars, P)` | SELECT variable projection |
| `Distinct` | `Distinct(P)` | Duplicate removal |
| `Reduced` | `Reduced(P)` | Optional duplicate reduction |
| `OrderBy` | `OrderBy(conditions, P)` | Result ordering |
| `Slice` | `Slice(offset, limit, P)` | LIMIT/OFFSET |

Our layer 1 algebra type should align with this standard. The translation from our IR to this algebra is straightforward:
- IR `shape_scan` → `BGP` with type triple
- IR `traverse` → additional triple in `BGP` or `Join`
- IR `optional` → `LeftJoin`
- IR `join` → `Join`
- IR `union` → `Union`
- IR `exists` (negated) → `Filter(NOT EXISTS(...))` which engines can rewrite to `Minus` in layer 2
- IR `binary_expr`, `logical_expr` → algebra expressions inside `Filter`
- IR `aggregate_expr` → `Aggregate`
- IR `projection` → `Project`
- IR `orderBy`, `limit`, `offset` → `OrderBy`, `Slice`

This is not an ASK query — it's a full algebra tree (like an AST for SPARQL). Layer 3 serializes this tree into SPARQL syntax (SELECT, INSERT DATA, etc.). Think of it like: our IR is the *application-level* AST, the SPARQL algebra is the *query-level* AST, and the SPARQL string is the serialized form.

---

## Resolved questions

### 1. Prefix management — use global `Prefix` utility

Core has `Prefix` (`src/utils/Prefix.ts`) with `toPrefixed(fullURI)`, `findMatch()`, and bidirectional prefix↔URI maps. The SPARQL conversion utilities will:
- Use `Prefix.toPrefixed()` to shorten URIs where possible
- Collect all prefixes actually used in the query
- Emit a `PREFIX` block with only those prefixes

### 2. URI generation for creates — caller can override, default to `{DATA_ROOT}/{shape_label}_{ulid}`

The `CreateQuery` IR supports a caller-provided `__id` (see `createWithFixedId` in query-fixtures). When no ID is provided, the conversion generates one using `{DATA_ROOT}/{shape_label}_{ulid}`. The old code used the `ulid` npm package (v3). We'll add this dependency.

`DATA_ROOT` defaults to `process.env.DATA_ROOT` (matching the old behavior). The conversion utility accepts it as an overridable option:
```ts
interface SparqlOptions {
  dataRoot?: string;  // Defaults to process.env.DATA_ROOT
}
```

### 3. SPARQL algebra — align with SPARQL 1.2 spec

See the algebra table above. Our algebra type will follow the SPARQL 1.2 standard operators. This gives us a well-understood formal foundation and makes the algebra familiar to anyone who knows SPARQL internals.

### 4. Engine-specific rewrites — deferred

Layer 2 is the customization point but we build no rewrite rules now. Engines override when needed. Known future candidates: `NOT EXISTS` ↔ `MINUS`, join reordering, property path expansion.

### 5. Full SPARQL coverage path — see 003-dynamic-ir-construction.md

Future DSL/IR expansion includes: FILTER NOT EXISTS / MINUS, proper subqueries, advanced property paths, shared variables across paths, dynamic/programmatic query building. Tracked in [003-dynamic-ir-construction.md](003-dynamic-ir-construction.md).

### 6. Graph handling — deferred to storage config

No GRAPH wrapping for now. Future storage config design tracked in [002-storage-config-and-graph-management.md](002-storage-config-and-graph-management.md). The SPARQL options will accept graph config once that design is ready.

---

## Summary of decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Package placement | In `@_linked/core` (`src/sparql/`), split later if needed |
| 2 | Architecture | Pure utility functions, no base class |
| 3 | Result mapping | IR-driven (use `resultMap` + `projection`) |
| 4 | Graph handling | No GRAPH wrapping; deferred to storage config (see 002) |
| 5 | Scope | Full coverage of `query-fixtures.ts` + Fuseki integration tests |
| 6 | Layered conversion | Route C: IR → SPARQL algebra (layer 1) → SPARQL string (layer 3), layer 2 optional |
| - | Prefix management | Use core `Prefix` utility, emit minimal PREFIX block |
| - | URI generation | `{DATA_ROOT}/{shape_label}_{ulid}`, defaults to `process.env.DATA_ROOT`, overridable via options |
| - | Algebra standard | Align with SPARQL 1.2 spec operators |
