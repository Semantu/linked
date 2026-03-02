# Report: SPARQL Conversion Layer

## Overview

Added a complete SPARQL conversion pipeline to `@_linked/core` that compiles the canonical IR into executable SPARQL queries and maps results back into fully typed DSL objects. This enables any SPARQL 1.1 endpoint to serve as a Linked store.

The pipeline follows a three-layer architecture:

```
IR (SelectQuery, CreateQuery, UpdateQuery, DeleteQuery)
  → Layer 1: irToAlgebra — IR → SPARQL algebra plan (SparqlPlan)
  → Layer 2: algebraToString — SPARQL algebra plan → SPARQL string
  → Execute against SPARQL endpoint → SPARQL JSON results
  → Layer 3: resultMapping — SPARQL JSON → DSL result types (SelectResult, CreateResult, etc.)
```

The algebra layer is a formal, typed AST aligned with SPARQL 1.1 spec §18. It serves as an inspectable intermediate that stores can optimize before serialization (e.g., rewriting patterns, adding graph clauses, pruning redundant joins).

---

## File structure

```
src/sparql/
  SparqlAlgebra.ts      — Algebra type definitions (terms, nodes, expressions, plans)          ~200 lines
  irToAlgebra.ts        — IR → SPARQL algebra conversion (Layer 1)                             ~1150 lines
  algebraToString.ts    — Algebra → SPARQL string serialization (Layer 2)                      ~385 lines
  resultMapping.ts      — SPARQL JSON results → DSL result types (Layer 3)                     ~625 lines
  SparqlStore.ts        — Abstract base class wiring the full pipeline (IR → string → execute → map)  ~95 lines
  sparqlUtils.ts        — Shared helpers (URI formatting, literal escaping, prefix collection)  ~100 lines
  index.ts              — Public API re-exports                                                 ~50 lines

src/test-helpers/
  FusekiStore.ts        — Example SparqlStore implementation for Apache Jena Fuseki (test only)
  fuseki-test-store.ts  — Test data setup/teardown helpers for Fuseki integration tests

src/tests/
  sparql-algebra.test.ts          — IR → algebra structural unit tests
  sparql-serialization.test.ts    — Algebra → SPARQL string unit tests
  sparql-result-mapping.test.ts   — SPARQL JSON → result mapping unit tests
  sparql-utils.test.ts            — URI formatting, literal escaping, prefix collection tests
  sparql-select-golden.test.ts    — IR → SPARQL string golden tests (all select fixtures)
  sparql-mutation-golden.test.ts  — IR → SPARQL string golden tests (all mutation fixtures)
  sparql-mutation-algebra.test.ts — Mutation IR → algebra structure assertions
  sparql-negative.test.ts         — Error cases and edge cases
  sparql-fuseki.test.ts           — Full pipeline integration tests against Fuseki (80 tests)
```

### Other modified files

| File | Change |
|---|---|
| `src/index.ts` | Added sparql barrel export |
| `src/queries/MutationQuery.ts` | Fixed `isNodeReference()` to check `Object.keys(obj).length === 1`; fixed `convertNodeDescription()` to handle `obj.id` as predefined entity ID; removed ~18 lines of dead commented code |
| `src/queries/IRCanonicalize.ts` | Minor adjustments for canonical IR normalization |
| `src/queries/IRLower.ts` | Fixed `evaluation_select` lowering for boolean expression projections; fixed context property path handling |
| `src/queries/IRProjection.ts` | Fixed projection building for expression-based projections |
| `src/queries/IntermediateRepresentation.ts` | Added `IRContextPropertyExpr` and related types |
| `documentation/sparql-algebra.md` | New — full layer documentation |
| `documentation/intermediate-representation.md` | Updated reference implementations section |
| `README.md` | Added pipeline walkthrough, type inference highlight, SparqlStore section |

---

## Public API

### SparqlStore base class

```ts
import {SparqlStore} from '@_linked/core/sparql';
```

Abstract base class that wires the full pipeline. Concrete stores implement two transport methods:

- `protected abstract executeSparqlSelect(sparql: string): Promise<SparqlJsonResults>` — send a SPARQL SELECT query, return parsed JSON
- `protected abstract executeSparqlUpdate(sparql: string): Promise<void>` — send a SPARQL UPDATE

The base class implements all four `IQuadStore` methods: `selectQuery`, `createQuery`, `updateQuery`, `deleteQuery`.

### IR → Algebra conversion

```ts
import {
  selectToAlgebra,   // IRSelectQuery → SparqlSelectPlan
  createToAlgebra,   // IRCreateMutation → SparqlInsertDataPlan
  updateToAlgebra,   // IRUpdateMutation → SparqlDeleteInsertPlan
  deleteToAlgebra,   // IRDeleteMutation → SparqlDeleteInsertPlan
} from '@_linked/core/sparql';
```

### Convenience wrappers (IR → SPARQL string in one call)

```ts
import {
  selectToSparql,    // IRSelectQuery → string
  createToSparql,    // IRCreateMutation → string
  updateToSparql,    // IRUpdateMutation → string
  deleteToSparql,    // IRDeleteMutation → string
} from '@_linked/core/sparql';
```

### Algebra → string serialization

```ts
import {
  selectPlanToSparql,       // SparqlSelectPlan → string
  insertDataPlanToSparql,   // SparqlInsertDataPlan → string
  deleteInsertPlanToSparql, // SparqlDeleteInsertPlan → string
  deleteWherePlanToSparql,  // SparqlDeleteWherePlan → string
  serializeAlgebraNode,     // SparqlAlgebraNode → string (WHERE body)
  serializeExpression,      // SparqlExpression → string
  serializeTerm,            // SparqlTerm → string
} from '@_linked/core/sparql';
```

### Result mapping

```ts
import {
  mapSparqlSelectResult,   // SparqlJsonResults + IRSelectQuery → SelectResult
  mapSparqlCreateResult,   // generatedUri + IRCreateMutation → CreateResult
  mapSparqlUpdateResult,   // IRUpdateMutation → UpdateResult
} from '@_linked/core/sparql';
```

### Type exports

All algebra types are re-exported: `SparqlTerm`, `SparqlTriple`, `SparqlAlgebraNode`, `SparqlExpression`, `SparqlProjectionItem`, `SparqlSelectPlan`, `SparqlInsertDataPlan`, `SparqlDeleteInsertPlan`, `SparqlDeleteWherePlan`, `SparqlPlan`, `SparqlOptions`, etc.

---

## Key design decisions

### 1. VariableRegistry for SPARQL variable management

A `VariableRegistry` class maps `(alias, property)` pairs to SPARQL variable names. The naming convention is `{alias}_{localName(property)}` (e.g., `a0_name`, `a1_hobby`). Features:

- **Deduplication**: When a `property_expr` matches an existing `traverse` pattern, the existing variable is reused (no duplicate triples).
- **Collision detection**: A `usedVarNames` set detects when two different `(alias, property)` pairs would produce the same sanitized variable name. Counter-based suffixing resolves collisions (`a0_name`, `a0_name_2`).
- **Context properties**: Context property IRIs use the raw IRI as the registry key (not sanitized) to prevent collisions between similar-looking IRIs.

### 2. OPTIONAL wrapping for all property triples

All property triples generated from `property_expr` are wrapped in `LeftJoin` (OPTIONAL). This ensures entities aren't excluded from results when a property value is absent. The type triple from `shape_scan` is NOT optional — it defines the result set. Traverse triples from explicit `traverse` patterns follow the IR's own `optional` markers.

### 3. Inline `.where()` produces filtered OPTIONAL blocks

When a DSL query uses inline `.where()` on a traversal (e.g., `p.hobby.where(h => h.equals('Jogging'))`), the algebra places the traverse triple, filter property triples, and FILTER expression together inside a single OPTIONAL block. This ensures the filter applies only within the optional scope.

### 4. Mutations use DELETE/INSERT/WHERE (not DELETE WHERE)

Updates use the `DELETE { old } INSERT { new } WHERE { match old }` pattern. All WHERE triples are wrapped in OPTIONAL so the update succeeds even when the old value doesn't exist (e.g., setting `bestFriend` when none was previously set). This is safer than DELETE WHERE which requires the WHERE pattern to match.

### 5. NestingDescriptor for result mapping

Result mapping uses a recursive `NestingDescriptor` tree built from `resultMap` and `projection`. It guides grouping of flat SPARQL bindings into nested objects. The algorithm:

1. Builds alias chains by walking `traverseMap` from each field's source alias back to root
2. Groups bindings by root entity (`?a0`), then recursively by each traversal alias
3. Detects literal traversals (e.g., `p.hobby.where(...)`) by pre-scanning bindings — these return coerced values instead of entity reference arrays
4. Handles missing values (OPTIONAL misses) as null

### 6. GROUP BY inference

The IR does not carry explicit GROUP BY. The algebra builder infers it: if any projection item contains an `aggregate_expr`, all non-aggregate projected variables become GROUP BY targets. When an aggregate alias collides with a traversal alias (both `a1`), the aggregate is renamed to `a1_agg`.

### 7. Aggregate WHERE → HAVING

When a WHERE clause contains aggregate expressions (e.g., `friends.size() > 2`), the expression is emitted as HAVING instead of FILTER, since SPARQL requires aggregate conditions in HAVING.

### 8. XSD/RDF constants from ontology modules

All XSD and RDF URI constants are imported from `src/ontologies/xsd.ts` and `src/ontologies/rdf.ts` — no hardcoded URI strings in the SPARQL layer.

### 9. String literal escaping

`escapeSparqlString()` in `sparqlUtils.ts` escapes `\`, `"`, `\n`, `\r`, `\t` per SPARQL 1.1 §19.7. It is called by `formatLiteral()` and also directly in `serializeTerm()` for language-tagged literals (which bypass `formatLiteral()`).

### 10. Prefix-aware serialization

URIs are collected during serialization via a `UriCollector`. After the query body is fully serialized, `buildPrefixBlock()` computes the minimal set of PREFIX declarations from registered `Prefix` ontology mappings and prepends them. URIs whose local name contains `/` are not prefixed (they would produce invalid prefixed names).

---

## IR → Algebra conversion rules

### Select queries (`selectToAlgebra`)

| IR node | → SPARQL Algebra |
|---|---|
| `shape_scan {shape, alias}` | `BGP(?alias rdf:type <shape>)` — required, not optional |
| `traverse {from, to, property}` | Triple `?from <property> ?to` joined into BGP |
| `property_expr {sourceAlias, property}` | Lookup/create variable via registry, add OPTIONAL triple |
| `where` expression | `Filter(expression, inner)` wrapping the pattern algebra |
| `subjectId` | `Filter(?root = <subjectId>)` |
| `exists_expr {pattern, filter}` | `EXISTS { ... }` or `NOT EXISTS { ... }` inside Filter |
| `aggregate_expr` | Aggregate binding; triggers GROUP BY inference |
| `orderBy`, `limit`, `offset` | Direct fields on `SparqlSelectPlan` |
| Inline `.where()` on traversal | Filtered OPTIONAL block (traverse + filter triples + FILTER together) |

### Create mutations (`createToAlgebra`)

Produces `SparqlInsertDataPlan`. Recursively generates triples from `IRNodeData`:
- Type triple: `<entity> rdf:type <Shape>`
- Field triples: `<entity> <property> "value"` or `<entity> <property> <nestedEntity>`
- Entity URIs generated via `generateEntityUri()`: `{dataRoot}/{shapeLabel}_{ulid}`

### Update mutations (`updateToAlgebra`)

Produces `SparqlDeleteInsertPlan`. Per field:

| Update type | DELETE | INSERT | WHERE |
|---|---|---|---|
| Simple value | `<s> <p> ?old` | `<s> <p> "new"` | `OPTIONAL { <s> <p> ?old }` |
| Unset (undefined) | `<s> <p> ?old` | — | `OPTIONAL { <s> <p> ?old }` |
| Array overwrite | `<s> <p> ?old` | `<s> <p> "v1"`, `<s> <p> "v2"` | `OPTIONAL { <s> <p> ?old }` |
| Set add | — | `<s> <p> <new>` | — |
| Set remove | `<s> <p> <old>` | — | `<s> <p> <old>` |
| Nested create | `<s> <p> ?old` | `<s> <p> <nested>` + nested triples | `OPTIONAL { <s> <p> ?old }` |

### Delete mutations (`deleteToAlgebra`)

Produces `SparqlDeleteInsertPlan` with bidirectional cleanup:
- DELETE: subject-wildcard (`<s> ?p ?o`), object-wildcard (`?s ?p2 <s>`), type triple
- WHERE: subject-wildcard + type triple (required), object-wildcard (OPTIONAL)

---

## Result mapping

### Value coercion (`coerceValue`)

| SPARQL binding type | → JavaScript type |
|---|---|
| `xsd:boolean` | `boolean` (handles both `"true"` and `"1"`) |
| `xsd:integer`, `xsd:long`, `xsd:decimal`, `xsd:float`, `xsd:double` | `number` |
| `xsd:dateTime`, `xsd:date` | `Date` |
| URI | `string` (the URI value) |
| Untyped literal | `string` |
| Missing binding | `null` |

### Entity reference detection

`alias_expr` projections that resolve to URIs produce `{id: uri}` entity references. Literal traversals (detected by `detectLiteralTraversals()`) return coerced values directly.

---

## Resolved gaps and edge cases

| # | Issue | Resolution |
|---|---|---|
| 1 | String literal escaping | Added `escapeSparqlString()` in sparqlUtils.ts per SPARQL 1.1 §19.7 |
| 2 | Unused `varCounter` in `updateToAlgebra()` | Removed dead declaration |
| 3 | EXISTS pattern conversion only handled `traverse` | Rewrote `convertExistsPattern()` with full recursive support for `optional`, `union`, `join`, `shape_scan`, nested `exists` |
| 4 | Literal traversal detection | `detectLiteralTraversals()` scans all bindings per group; mixed-type groups treated as literal (safe fallback) |
| 5 | `localName()` key collision | Duplicate key detection in `buildNestingDescriptor()` — throws descriptive error |
| 6 | Context property key collision | Raw IRI as registry key + counter-based variable name deduplication in `VariableRegistry.getOrCreate()` |
| 7 | Boolean expression lost in projection | Fixed `irToAlgebra.ts` to handle `binary_expr` in projections as `(expr AS ?alias)` |
| 8 | Context property tautology filter | Fixed to not emit redundant `FILTER(?ctx = ?ctx)` |
| 9 | `some()` inside compound expressions | Fixed `not_expr` wrapping to preserve `some` semantics inside `.and()`/`.or()` |
| 10 | COUNT in WHERE → HAVING | Expressions containing aggregates are emitted as HAVING, not FILTER |
| 11 | Nested create with predefined ID | Fixed `isNodeReference()` to require `Object.keys(obj).length === 1`; fixed `convertNodeDescription()` to handle `obj.id` |
| 12 | `as any` casts | Changed to `as never` for exhaustive switch defaults; explicit `ResultRow[]` cast for type gap |
| 13 | Hardcoded XSD/RDF URIs | Replaced with imports from ontology modules |
| 14 | Dead commented code in MutationQuery.ts | Removed ~18 lines |

---

## Test coverage

| Test file | Count | What it covers |
|---|---|---|
| `sparql-algebra.test.ts` | ~30 | IR → algebra structure: type triples, traversals, variable reuse, filters, EXISTS with optional/union, aggregation, GROUP BY inference |
| `sparql-serialization.test.ts` | ~50 | Algebra → SPARQL string: all node types, expressions, operator precedence, PREFIX generation |
| `sparql-result-mapping.test.ts` | ~30 | Result mapping: flat/nested rows, value coercion, literal traversals, entity references, nesting descriptor |
| `sparql-utils.test.ts` | ~15 | URI formatting, literal escaping, prefix collection, entity URI generation |
| `sparql-select-golden.test.ts` | ~40 | All select query fixtures → exact SPARQL string comparison |
| `sparql-mutation-golden.test.ts` | ~15 | All mutation fixtures → exact SPARQL string comparison |
| `sparql-mutation-algebra.test.ts` | ~20 | Mutation IR → algebra structure assertions |
| `sparql-negative.test.ts` | ~15 | Error cases, edge cases, invalid inputs |
| `sparql-fuseki.test.ts` | 80 | Full pipeline → Fuseki: all select fixtures, mutations (CRUD), SparqlStore base class integration |

**Total: ~200 unit/golden tests + 80 Fuseki integration tests**

### Remaining test gaps (not blocking)

- Deeply nested results (4+ levels)
- Empty result sets for all query types
- Multiple filtered traversals on the same entity

---

## Unused algebra types (ready for future DSL extensions)

The following types are defined in `SparqlAlgebra.ts` and serialized by `algebraToString.ts` but not yet produced by the IR conversion. They exist for future DSL features:

| Type | Future use | Ideation doc |
|---|---|---|
| `SparqlGraph` | Named graph queries/mutations (`.from()`, `.into()`) | `docs/ideas/005-named-graph-support.md` |
| `SparqlExtend` | BIND expressions for computed fields and expression-based mutations | `docs/ideas/006-computed-expressions-and-update-functions.md` |
| `SparqlMinus` | MINUS set difference (`.minus()`) | `docs/ideas/007-advanced-query-patterns.md` |
| `SparqlDeleteWherePlan` | DELETE WHERE shorthand for bulk deletes (`.deleteAll()`) | `docs/ideas/007-advanced-query-patterns.md` |

---

## Known limitations

1. **Named graphs** — pipeline operates on the default graph only. `SparqlGraph` is ready but not wired.
2. **VALUES / SERVICE** — not supported in the algebra or serialization.
3. **Update functions** — IR does not capture function expressions in mutations (e.g., `L.plus(p.age, 1)`). Update values must be concrete.
4. **Lateral / subquery** — SPARQL subqueries (SELECT inside WHERE) are not produced.
5. **Property key uniqueness** — two properties with the same `localName()` in the same projection throw a descriptive error. By design — result rows use short property names as JS object keys.
6. **Proxy operator limitation** — JavaScript proxies cannot intercept operators (`+`, `*`, `>`), so computed expressions require function-call syntax (e.g., `L.times(p.age, 12)`) — see ideation doc 006.

---

## Deferred work

- `docs/ideas/005-named-graph-support.md` — DSL `.from()` / `.into()` for GRAPH clauses
- `docs/ideas/006-computed-expressions-and-update-functions.md` — BIND expressions, `L` expression builder module, expression-based mutations
- `docs/ideas/007-advanced-query-patterns.md` — MINUS set difference, DELETE WHERE bulk delete

---

## PR

- PR #14: https://github.com/Semantu/linked/pull/14
- Target: `dev`
- Branch: `flyon/nashville-v1`
