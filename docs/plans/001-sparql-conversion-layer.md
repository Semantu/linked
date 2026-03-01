---
summary: Architecture plan for converting IR ASTs to SPARQL via a SPARQL 1.2 algebra intermediate, with full query-fixtures coverage and Fuseki integration tests.
source_ideation: docs/ideas/001-sparql-conversion-layer.md
---

# Plan: SPARQL Conversion Layer

## Architecture overview

Three-layer pipeline converting Linked IR to SPARQL strings:

```
IR (SelectQuery, CreateQuery, etc.)
  → Layer 1: SPARQL Algebra (formal query plan aligned with SPARQL 1.2 spec)
  → [Layer 2: Engine rewrites — optional, not built now]
  → Layer 3: SPARQL String Serialization
```

All code lives in `src/sparql/` inside `@_linked/core`. Pure functions, no base classes.

---

## File structure

```
src/sparql/
  SparqlAlgebra.ts          — Algebra type definitions (layer 1 output types)
  irToAlgebra.ts            — IR → SPARQL algebra conversion (layer 1)
  algebraToString.ts        — Algebra → SPARQL string serialization (layer 3)
  sparqlUtils.ts            — Shared helpers (URI formatting, literal serialization, prefix collection)
  resultMapping.ts          — SPARQL JSON results → SelectResult/CreateResult/etc.
  index.ts                  — Public API re-exports

src/tests/
  sparql-select-golden.test.ts   — IR → SPARQL string golden tests for all select fixtures
  sparql-mutation-golden.test.ts — IR → SPARQL string golden tests for mutations
  sparql-algebra.test.ts         — IR → algebra unit tests (layer 1 output)
  sparql-result-mapping.test.ts  — SPARQL JSON → result mapping tests
  sparql-fuseki.test.ts          — Integration tests against temporary Fuseki store

src/index.ts                — Add sparql exports
```

---

## Layer 1: SPARQL Algebra types (`SparqlAlgebra.ts`)

Aligned with SPARQL 1.2 spec section 18. Discriminated union with `type` field.

```ts
// --- Algebra node types ---

export type SparqlTriple = {
  subject: SparqlTerm;
  predicate: SparqlTerm;
  object: SparqlTerm;
};

export type SparqlTerm =
  | { kind: 'variable'; name: string }
  | { kind: 'iri'; value: string }
  | { kind: 'literal'; value: string; datatype?: string; language?: string };

export type SparqlAlgebraNode =
  | SparqlBGP
  | SparqlJoin
  | SparqlLeftJoin
  | SparqlFilter
  | SparqlUnion
  | SparqlMinus
  | SparqlExtend
  | SparqlGraph;

export type SparqlBGP = {
  type: 'bgp';
  triples: SparqlTriple[];
};

export type SparqlJoin = {
  type: 'join';
  left: SparqlAlgebraNode;
  right: SparqlAlgebraNode;
};

export type SparqlLeftJoin = {
  type: 'left_join';
  left: SparqlAlgebraNode;
  right: SparqlAlgebraNode;
  condition?: SparqlExpression;
};

export type SparqlFilter = {
  type: 'filter';
  expression: SparqlExpression;
  inner: SparqlAlgebraNode;
};

export type SparqlUnion = {
  type: 'union';
  left: SparqlAlgebraNode;
  right: SparqlAlgebraNode;
};

export type SparqlMinus = {
  type: 'minus';
  left: SparqlAlgebraNode;
  right: SparqlAlgebraNode;
};

export type SparqlExtend = {
  type: 'extend';
  inner: SparqlAlgebraNode;
  variable: string;
  expression: SparqlExpression;
};

export type SparqlGraph = {
  type: 'graph';
  iri: string;
  inner: SparqlAlgebraNode;
};

// --- Top-level query plans ---

export type SparqlSelectPlan = {
  type: 'select';
  algebra: SparqlAlgebraNode;
  projection: SparqlProjectionItem[];
  distinct?: boolean;
  orderBy?: SparqlOrderCondition[];
  limit?: number;
  offset?: number;
  groupBy?: string[];            // variable names — inferred from aggregates
  having?: SparqlExpression;
  aggregates?: SparqlAggregateBinding[];
};

export type SparqlInsertDataPlan = {
  type: 'insert_data';
  triples: SparqlTriple[];
  graph?: string;
};

export type SparqlDeleteInsertPlan = {
  type: 'delete_insert';
  deletePatterns: SparqlTriple[];
  insertPatterns: SparqlTriple[];
  whereAlgebra: SparqlAlgebraNode;
  graph?: string;
};

export type SparqlDeleteWherePlan = {
  type: 'delete_where';
  patterns: SparqlAlgebraNode;
  graph?: string;
};

// --- Expressions ---

export type SparqlExpression =
  | { kind: 'variable_expr'; name: string }
  | { kind: 'iri_expr'; value: string }
  | { kind: 'literal_expr'; value: string; datatype?: string }
  | { kind: 'binary_expr'; op: string; left: SparqlExpression; right: SparqlExpression }
  | { kind: 'logical_expr'; op: 'and' | 'or'; exprs: SparqlExpression[] }
  | { kind: 'not_expr'; inner: SparqlExpression }
  | { kind: 'function_expr'; name: string; args: SparqlExpression[] }
  | { kind: 'aggregate_expr'; name: string; args: SparqlExpression[]; distinct?: boolean }
  | { kind: 'exists_expr'; pattern: SparqlAlgebraNode; negated: boolean }
  | { kind: 'bound_expr'; variable: string };
```

### Why this type exists

- Prevents the IR→string conversion from becoming a monolithic function
- Gives engines a typed customization point (layer 2 rewrites operate on this type)
- Aligns with a formal standard, making it predictable
- Separates the "what to query" from "how to serialize it"

---

## Layer 1: IR → Algebra conversion (`irToAlgebra.ts`)

### Select queries

```ts
export function selectToAlgebra(query: IRSelectQuery, options?: SparqlOptions): SparqlSelectPlan
```

Translation rules:

| IR node | → Algebra |
|---------|-----------|
| `root: shape_scan {shape, alias}` | `BGP([?alias rdf:type <shape>])` |
| `traverse {from, to, property}` | Additional triple `?from <property> ?to` joined into the BGP |
| `join {patterns}` | Nested `Join(left, right)` |
| `optional {pattern}` | `LeftJoin(current, inner)` |
| `union {branches}` | `Union(left, right)` (fold branches pairwise) |
| `exists {pattern}` | Used inside Filter as `EXISTS { ... }` |
| `property_expr {sourceAlias, property}` | Variable for triple `?sourceAlias <property> ?varN` — adds triple to appropriate pattern, returns `?varN` |
| `literal_expr {value}` | `SparqlExpression` literal |
| `binary_expr {op, left, right}` | Binary expression |
| `logical_expr {op, expressions}` | Logical AND/OR expression |
| `not_expr` | NOT expression |
| `aggregate_expr {name, args}` | Aggregate binding; triggers GROUP BY inference |
| `exists_expr {pattern, filter}` | `EXISTS` / `NOT EXISTS` inside Filter |
| `where` | `Filter(expression, inner)` wrapping the pattern algebra |
| `subjectId` | `Filter(?root = <subjectId>)` or `VALUES ?root { <subjectId> }` |
| `projection` | `SparqlProjectionItem[]` mapping aliases to variables |
| `orderBy` | `SparqlOrderCondition[]` |
| `limit`, `offset` | Direct on plan |

### Key design details

**Property expression variable reuse**: When the algebra builder encounters a `property_expr` in a projection or expression, it must:
1. Check if a triple for `(sourceAlias, property)` already exists from a `traverse` pattern
2. If yes, reuse the existing variable
3. If no, create a new triple `?sourceAlias <property> ?newVar` and add it to the appropriate BGP (wrapped in OPTIONAL — see below)

This is tracked via a **variable registry** that maps `(alias, property)` → variable name. This registry is populated when processing both `traverse` patterns and `property_expr` nodes.

**Algebra tests for variable reuse**: This deduplication logic is critical to correctness. Layer 1 unit tests (`sparql-algebra.test.ts`) will verify:
- A `property_expr` that matches an existing `traverse` reuses its variable (no duplicate triple)
- Multiple `property_expr` on the same `(alias, property)` all share one variable
- A `property_expr` without a matching `traverse` creates a new triple

Example — `selectDuplicatePaths` (`Person.select(p => [p.bestFriend.name, p.bestFriend.hobby, p.bestFriend.isRealPerson])`):
- IR has one `traverse` from `a0` to `a1` via `bestFriend`
- Three `property_expr` on `a1` for `name`, `hobby`, `isRealPerson`
- The `traverse` creates `?a0 <bestFriend> ?a1` once
- Each `property_expr` creates its own triple: `?a1 <name> ?a1_name`, `?a1 <hobby> ?a1_hobby`, `?a1 <isRealPerson> ?a1_isRealPerson`
- All wrapped in OPTIONAL

**OPTIONAL wrapping**: All property triples generated from `property_expr` should be wrapped in OPTIONAL (via `LeftJoin`). This ensures entities aren't excluded when a property is absent. The type triple from `shape_scan` is NOT optional — it defines the result set. Traverse triples from explicit `traverse` patterns follow the IR's own `optional` markers.

**GROUP BY inference**: The IR does not carry explicit GROUP BY. The algebra builder infers it:
- Scan projection items for `aggregate_expr`
- If any found, all non-aggregated projection variables become GROUP BY targets

Example — `Person.select(p => p.friends.size())`:
```
IR:
  root: shape_scan { a0, Person }
  patterns: [ traverse { a0 → a1, hasFriend } ]
  projection: [ { a2, aggregate_expr { count, [alias_expr a1] } } ]

Algebra builder detects:
  - a2 is aggregate (count)
  - a0 (root, always projected for `id`) is non-aggregate
  → groupBy: ['a0']

SPARQL output:
  SELECT ?a0 (COUNT(?a1) AS ?a2) WHERE {
    ?a0 a <Person> .
    ?a0 <hasFriend> ?a1 .
  } GROUP BY ?a0
```

**Variable naming**: Use IR aliases directly as SPARQL variable names (`?a0`, `?a1`). For property-generated variables, append a suffix: `?a0_name`, `?a0_hobby`. This keeps variables predictable and debuggable.

### Mutation queries

Mutations don't need the full algebra tree — they produce simpler plan types:

**Create** → `SparqlInsertDataPlan`:
- Generate URI: use `data.id` if provided, else `{options.dataRoot}/{shapeLabel}_{ulid()}`
- Type triple: `<uri> rdf:type <shape>`
- Field triples: `<uri> <property> value` for each field
- Nested creates: recursively generate triples for nested `IRNodeData`
- Array fields: multiple triples for the same property

**Update** → `SparqlDeleteInsertPlan`:
- Delete patterns: `<id> <property> ?oldVar` for each changed field
- Insert patterns: `<id> <property> newValue` for each new value
- Where: BGP matching the old triples
- Set modifications (`{add, remove}`): add = insert triples only, remove = delete specific triples
- Unset (undefined/null): delete only, no insert
- Nested creates in updates: generate new URI + insert triples

**Delete** → `SparqlDeleteWherePlan`:
- Pattern: `<id> ?p ?o` for subject triples + `?s ?p <id>` for object triples (bidirectional)
- Type guard: include `<id> rdf:type <shape>` in WHERE

---

## Layer 3: Algebra → SPARQL string (`algebraToString.ts`)

```ts
export function selectPlanToSparql(plan: SparqlSelectPlan, options?: SparqlOptions): string
export function insertDataPlanToSparql(plan: SparqlInsertDataPlan, options?: SparqlOptions): string
export function deleteInsertPlanToSparql(plan: SparqlDeleteInsertPlan, options?: SparqlOptions): string
export function deleteWherePlanToSparql(plan: SparqlDeleteWherePlan, options?: SparqlOptions): string
```

Recursive tree-walk serializer. Each algebra node type has a serialization rule:

| Algebra node | SPARQL output |
|-------------|---------------|
| `bgp` | Triple patterns joined by ` .\n` |
| `join` | Left block followed by right block (in same `{}`) |
| `left_join` | `OPTIONAL { right }` after left |
| `filter` | `FILTER(expr)` inside pattern block |
| `union` | `{ left } UNION { right }` |
| `minus` | `MINUS { right }` |
| `extend` | `BIND(expr AS ?var)` |
| `graph` | `GRAPH <iri> { inner }` |

Top-level structure:
```sparql
PREFIX prefix: <uri>
...
SELECT DISTINCT ?var1 ?var2 (COUNT(?var3) AS ?agg1) ...
WHERE {
  [algebra serialized]
}
GROUP BY ?var1 ?var2
HAVING(expr)
ORDER BY ASC(?var) DESC(?var)
LIMIT n OFFSET m
```

**Prefix collection**: During serialization, collect all IRIs used. After serialization, resolve against `Prefix.toPrefixed()` to build the minimal PREFIX block. Use SPARQL-standard `PREFIX` form (not Turtle `@prefix`).

---

## Result mapping (`resultMapping.ts`)

```ts
export type SparqlJsonResults = {
  head: { vars: string[] };
  results: {
    bindings: SparqlBinding[];
  };
};

export type SparqlBinding = Record<string, {
  type: 'uri' | 'literal' | 'bnode' | 'typed-literal';
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}>;

export function mapSparqlSelectResult(
  json: SparqlJsonResults,
  query: IRSelectQuery,
): SelectResult
```

Mapping logic:
1. Walk `query.resultMap` to know which alias maps to which result key
2. Walk `query.projection` to know each alias's expression type (for type coercion)
3. For each binding row in `json.results.bindings`:
   - Extract values by variable name (derived from alias)
   - Coerce typed literals: `xsd:boolean` → boolean (handle both `"true"` and `"1"`), `xsd:integer`/`xsd:double` → number, `xsd:dateTime` → Date
   - URIs → string (the id)
   - Missing bindings → null
4. Group rows by root alias value to reconstruct nested objects (when `resultMap` has multiple entries pointing to the same root)
5. If `query.singleResult` → return single row or null

**ResultMap enrichment**: The current `IRResultMapEntry` is `{key, alias}`. We will enrich it as needed during implementation to carry:
- Nesting depth / parent relationship (for reconstructing nested objects from flat bindings)
- Array vs single markers (for knowing whether to collect into an array or take first)
- Datatype hints (for typed literal coercion)

These additions will be made to the IR types as gaps are discovered. This is expected and acceptable.

---

## Options type (`sparqlUtils.ts`)

```ts
export interface SparqlOptions {
  dataRoot?: string;       // Defaults to process.env.DATA_ROOT
  prefixes?: Record<string, string>;  // Additional prefix mappings beyond global Prefix registry
}
```

Shared utilities:
- `formatUri(uri: string): string` — `Prefix.toPrefixed(uri)` or `<uri>`
- `formatLiteral(value, datatype?): string` — XSD typed literal serialization
- `collectPrefixes(usedUris: string[]): Record<string, string>` — minimal prefix block
- `generateEntityUri(shape: string, options: SparqlOptions): string` — `{dataRoot}/{label}_{ulid}`

---

## Public API (`src/sparql/index.ts`)

```ts
// High-level: IR → SPARQL string (most stores call these)
export { selectToSparql, createToSparql, updateToSparql, deleteToSparql } from './irToAlgebra.js';

// Layered: for engines that want to customize the algebra
export { selectToAlgebra, createToAlgebra, updateToAlgebra, deleteToAlgebra } from './irToAlgebra.js';
export { selectPlanToSparql, insertDataPlanToSparql, deleteInsertPlanToSparql, deleteWherePlanToSparql } from './algebraToString.js';

// Result mapping
export { mapSparqlSelectResult, mapSparqlCreateResult, mapSparqlUpdateResult } from './resultMapping.js';

// Types
export type { SparqlOptions } from './sparqlUtils.js';
export type * from './SparqlAlgebra.js';
```

Convenience wrappers in `irToAlgebra.ts` compose layers 1+3:
```ts
export function selectToSparql(query: IRSelectQuery, options?: SparqlOptions): string {
  const plan = selectToAlgebra(query, options);
  return selectPlanToSparql(plan, options);
}
```

---

## Testing strategy

### Layer 1 algebra tests (`sparql-algebra.test.ts`)

Unit tests verifying IR → algebra conversion produces correct algebra trees. Key test cases:
- Simple shape scan → BGP with type triple
- Traverse → additional triple with correct variable linkage
- Property expression variable reuse (deduplication with traverse)
- Optional wrapping of property triples
- Where clause → Filter node at correct position
- Aggregate detection → GROUP BY inference
- Nested patterns → correct Join/LeftJoin nesting
- SubjectId → Filter or VALUES

### Golden tests (`sparql-select-golden.test.ts`, `sparql-mutation-golden.test.ts`)

For every factory in `query-fixtures.ts`, assert the full SPARQL string output. Example:

```ts
import { queryFactories } from '../test-helpers/query-fixtures';
import { selectToSparql } from '../sparql';

test('selectName produces correct SPARQL', () => {
  const query = queryFactories.selectName();
  const sparql = selectToSparql(query);
  expect(sparql).toBe(`PREFIX ...
SELECT DISTINCT ?a0 ?a0_name
WHERE {
  ?a0 a <linked://tmp/types/Person> .
  OPTIONAL { ?a0 <linked://tmp/props/name> ?a0_name . }
}
ORDER BY ?a0`);
});
```

### Fuseki integration tests (`sparql-fuseki.test.ts`)

Modeled on `OLD/lincd-fuseki/src/tests/`:
1. **Setup**: Create/reset a test Fuseki dataset, load test data (same entities as OLD: p1-Semmy, p2-Moa, p3-Jinx, p4-Quinn, dog1, dog2 with their properties and relationships)
2. **Per-fixture test**: For each query fixture, generate SPARQL, execute against Fuseki, map results, assert same expectations as OLD tests
3. **Teardown**: Clean up test dataset

Test data from OLD `setup.data.ts`:
- p1 (Semmy): name, birthDate, isRealPerson=true, friends=[p2, p3], pets=[dog1], nickNames=[Sem1, Sem]
- p2 (Moa): name, hobby=Jogging, isRealPerson=false, bestFriend=p3, friends=[p3, p4], pets=[dog2]
- p3 (Jinx): name, isRealPerson=true
- p4 (Quinn): name
- dog1: guardDogLevel=2, bestFriend=dog2
- dog2: (no extra properties)

---

## Potential pitfalls

1. **Result mapping nesting**: The `IRResultMapEntry` will need enrichment to reconstruct nested objects from flat SPARQL bindings. Expected — we'll add fields as gaps are found.

2. **Aggregate + GROUP BY inference**: Standard rule: if any projection is aggregate, GROUP BY the rest. Straightforward to implement, but must handle edge cases (e.g. count inside a sub-select label like `countLabel`).

3. **Property expression variable reuse**: The variable registry is the key mechanism. Well-tested via layer 1 algebra tests.

4. **OPTIONAL wrapping**: All property triples from `property_expr` are OPTIONAL. The type triple from `shape_scan` is NOT. Traverse triples follow IR's `optional` markers. Edge case: a `where` clause filters on a property that's also selected — the property triple must appear in the required pattern (not OPTIONAL) for the filter to work.

5. **Literal type coercion in results**: Different stores return booleans as `"true"` or `"1"`. Handle both in the result mapper. Dates need ISO parsing. Not a design risk, just implementation detail.

6. **ULID dependency**: Add `ulid` package for URI generation in creates.

---

## Resolved decisions

| Decision | Resolution |
|----------|-----------|
| ResultMap enrichment | Will add needed fields (`isArray`, `datatype`, nesting) during implementation |
| Prefix output style | SPARQL-standard `PREFIX` form |
| Variable naming | IR aliases as SPARQL variables (`?a0`), property suffixes (`?a0_name`) |

---

## Scope boundary

**In scope** (this plan):
- All conversion code in `src/sparql/`
- Algebra types, IR→algebra, algebra→string, result mapping
- Layer 1 algebra unit tests
- Golden tests for every query-fixture factory
- Fuseki integration tests

**Out of scope** (tracked in separate ideation docs):
- Storage config / graph management (see `docs/ideas/002`)
- Dynamic IR construction / DSL expansion (see `docs/ideas/003`)
- Engine-specific layer 2 rewrites
- Base class / SPARQLStore abstraction

---

## Task breakdown

### Dependency graph

```
Phase 1: Types + Utils (foundation)
    ↓
Phase 2a: Layer 1 — IR → Algebra (select)     ← can run in parallel
Phase 2b: Layer 3 — Algebra → String           ← can run in parallel
Phase 2c: Result Mapping                        ← can run in parallel
Phase 2d: Layer 1 — IR → Algebra (mutations)   ← can run in parallel
    ↓
Phase 3: Golden tests + integration wiring
    ↓
Phase 4: Fuseki integration tests
```

---

### Phase 1: Types, utilities, and exports (foundation) ✅

**Must complete before anything else. All parallel phases depend on this.**

**Status: COMPLETE** — All 15 tests pass, `npm run compile` clean, no regressions (162/162 existing tests pass).

**Tasks:**
1. Create `src/sparql/` directory
2. Implement `src/sparql/SparqlAlgebra.ts` — all type definitions as specified in the plan (algebra nodes, plans, expressions, terms, triples, projection items, order conditions, aggregate bindings)
3. Implement `src/sparql/sparqlUtils.ts`:
   - `SparqlOptions` interface (with `dataRoot` defaulting to `process.env.DATA_ROOT`)
   - `formatUri(uri)` — uses `Prefix.toPrefixed()`, falls back to `<uri>`
   - `formatLiteral(value, datatype?)` — XSD typed literal serialization (strings, numbers, booleans, dates)
   - `collectPrefixes(usedUris)` — scans URIs, builds minimal prefix→uri map via `Prefix`
   - `generateEntityUri(shape, options)` — `{dataRoot}/{label}_{ulid()}`
4. Create `src/sparql/index.ts` — stub exports (re-export types + utils; placeholder exports for functions not yet implemented)
5. Add sparql barrel export to `src/index.ts`
6. Add `ulid` dependency to `package.json`

**Tests** (`src/tests/sparql-utils.test.ts`):

`formatUri`:
- Given a URI with a registered prefix (e.g. `http://www.w3.org/1999/02/22-rdf-syntax-ns#type` with `rdf` prefix registered) → assert returns `rdf:type`
- Given a URI with no matching prefix → assert returns `<full-uri>`
- Given a URI where the suffix contains `/` (not prefixable) → assert returns `<full-uri>`

`formatLiteral`:
- Given `("hello", undefined)` → assert returns `"hello"`
- Given `(42, xsd.integer)` → assert returns `"42"^^<xsd:integer>` (or prefixed form)
- Given `(3.14, xsd.double)` → assert returns `"3.14"^^<xsd:double>`
- Given `(true, xsd.boolean)` → assert returns `"true"^^<xsd:boolean>`
- Given `(new Date('2020-01-01'), xsd.dateTime)` → assert returns `"2020-01-01T00:00:00.000Z"^^<xsd:dateTime>`

`collectPrefixes`:
- Given a list of URIs, some with registered prefixes, some without → assert returns only the prefix→uri entries that were actually used
- Given an empty list → assert returns empty object

`generateEntityUri`:
- Given `('http://example.org/Person', {dataRoot: 'http://data.example.org'})` → assert starts with `http://data.example.org/person_` and ends with a valid ULID (26 chars, alphanumeric)
- Given no `dataRoot` option but `process.env.DATA_ROOT` is set → assert uses env var

**Validation:** All utils tests pass + `npm run compile` passes.

**Commit:** `feat(sparql): add algebra types, shared utilities, and package exports`

---

### Phase 2a: Layer 1 — IR → Algebra for SELECT queries ✅

**Depends on:** Phase 1 only
**Can run in parallel with:** 2b, 2c, 2d

**Status: COMPLETE** — 27 tests pass in `sparql-algebra.test.ts`. Full compilation clean, no regressions (291/291 tests pass).

**Tasks:**
1. Implement `src/sparql/irToAlgebra.ts` — `selectToAlgebra(query, options)`:
   - Variable registry: `Map<string, Map<string, string>>` mapping `(alias, property) → variableName`
   - Root shape scan → BGP with type triple
   - Traverse patterns → property triples (populate variable registry)
   - Property expressions → lookup registry or create new OPTIONAL triple
   - Where clauses → Filter wrapping
   - Logical/binary/not expressions → SparqlExpression tree
   - Exists expressions → exists_expr with nested algebra
   - Aggregate expressions → aggregate bindings + GROUP BY inference
   - SubjectId → Filter or VALUES
   - OrderBy, limit, offset → direct on plan
   - Projection → SparqlProjectionItem[] with aggregates handled
2. Write `src/tests/sparql-algebra.test.ts` covering:
   - `selectName` → BGP with type triple + OPTIONAL property triple
   - `selectFriendsName` → traverse triple + nested property
   - `selectDuplicatePaths` → variable reuse (one traverse, three properties)
   - `whereHobbyEquals` → Filter with binary_expr
   - `whereAnd`, `whereOr`, `whereAndOrAnd` → nested logical expressions
   - `whereSomeExplicit`, `whereEvery` → exists / not-exists patterns
   - `countFriends` → aggregate + GROUP BY inference
   - `selectById` → subjectId handling
   - `selectAll`, `selectAllProperties` → full property projection
   - `outerWhere` → Filter at correct scope
   - `sortByAsc`, `sortByDesc` → orderBy
   - `outerWhereLimit` → limit + where combo

**Tests** (`src/tests/sparql-algebra.test.ts`):

`selectName` — `Person.select(p => p.name)`:
- Assert plan type is `'select'`
- Assert algebra contains a BGP with exactly one required triple: `?a0 rdf:type <linked://tmp/types/Person>`
- Assert algebra contains a LeftJoin wrapping the property triple `?a0 <linked://tmp/props/name> ?a0_name`
- Assert projection includes `a0` and `a0_name`
- Assert no groupBy, no orderBy, no limit

`selectFriendsName` — `Person.select(p => p.friends.name)`:
- Assert algebra contains type triple for `a0` (Person)
- Assert algebra contains traverse triple `?a0 <linked://tmp/props/hasFriend> ?a1`
- Assert algebra contains OPTIONAL property triple `?a1 <linked://tmp/props/name> ?a1_name`
- Assert projection includes `a0`, `a1`, `a1_name`

`selectDuplicatePaths` — `Person.select(p => [p.bestFriend.name, p.bestFriend.hobby, p.bestFriend.isRealPerson])`:
- Assert exactly ONE traverse triple `?a0 <linked://tmp/props/bestFriend> ?a1` (no duplicates)
- Assert three OPTIONAL property triples: `?a1 <…/name> ?a1_name`, `?a1 <…/hobby> ?a1_hobby`, `?a1 <…/isRealPerson> ?a1_isRealPerson`
- Assert variable registry produced distinct variable names for each property

`whereHobbyEquals` — `Person.select(p => p.hobby.where(h => h.equals('Jogging')))`:
- Assert algebra contains a Filter node
- Assert filter expression is `binary_expr` with op `'='`, left is variable for hobby, right is literal `"Jogging"`

`whereAnd` — `Person.select(p => p.friends.where(f => f.name.equals('Moa').and(f.hobby.equals('Jogging'))))`:
- Assert filter expression is `logical_expr` with op `'and'`
- Assert two sub-expressions: name = 'Moa' AND hobby = 'Jogging'

`whereOr` — `Person.select(p => p.friends.where(f => f.name.equals('Jinx').or(f.hobby.equals('Jogging'))))`:
- Assert filter expression is `logical_expr` with op `'or'`
- Assert two sub-expressions: name = 'Jinx' OR hobby = 'Jogging'

`whereAndOrAnd` — nested AND/OR:
- Assert correct nesting: `(name = 'Jinx' OR hobby = 'Jogging') AND name = 'Moa'`
- Assert outer logical_expr is `'and'`, inner left is `'or'`

`whereSomeExplicit` — `Person.select().where(p => p.friends.some(f => f.name.equals('Moa')))`:
- Assert algebra contains an `exists_expr` node with `negated: false`
- Assert the inner pattern contains the traverse to friends + filter on name

`whereEvery` — `Person.select().where(p => p.friends.every(f => f.name.equals('Moa').or(f.name.equals('Jinx'))))`:
- Assert algebra contains an `exists_expr` with `negated: true`
- Assert the inner filter is the NEGATION of the condition (NOT EXISTS of negated condition)

`countFriends` — `Person.select(p => p.friends.size())`:
- Assert plan has `aggregates` containing one entry: `count` over the friends alias
- Assert `groupBy` contains `['a0']` (root alias is non-aggregate)
- Assert projection includes the aggregate alias

`selectById` — `Person.select(entity('p1'), p => p.name)`:
- Assert plan has subjectId handling: either a Filter with `?a0 = <linked://tmp/entities/p1>` or a VALUES clause
- Assert singleResult may be set on the query

`selectAll` — `Person.select()`:
- Assert projection includes `a0` (the root/id variable)
- Assert no property triples (select all returns only id references by default)

`outerWhere` — `Person.select(p => p.friends).where(p => p.name.equals('Semmy'))`:
- Assert Filter wraps the ENTIRE pattern (not inside the traverse)
- Assert filter expression references `a0`'s name property, not `a1`'s

`sortByAsc` — `Person.select(p => p.name).sortBy(p => p.name)`:
- Assert plan.orderBy has one entry with direction `'ASC'`
- Assert the order expression references the name variable

`outerWhereLimit` — `.where(...).limit(1)`:
- Assert plan.limit is `1`
- Assert Filter is present for the where clause

**Stub boundaries:** This phase produces `SparqlSelectPlan` objects. Phase 2b agent can test `algebraToString` using hand-crafted `SparqlSelectPlan` objects — no dependency on this phase's implementation.

**Validation:**
- All algebra tests pass
- `npm run compile` passes

**Commit:** `feat(sparql): implement IR-to-algebra conversion for select queries`

---

### Phase 2b: Layer 3 — Algebra → SPARQL string serialization ✅

**Depends on:** Phase 1 only

**Status: COMPLETE** — 61 tests pass in `sparql-serialization.test.ts`. Full compilation clean, no regressions.
**Can run in parallel with:** 2a, 2c, 2d

**Tasks:**
1. Implement `src/sparql/algebraToString.ts`:
   - `serializeAlgebraNode(node)` — recursive tree-walk dispatcher
   - BGP → triple patterns with ` .\n` separator
   - Join → left + right in same block
   - LeftJoin → left + `OPTIONAL { right }`
   - Filter → `FILTER(expr)` inside pattern
   - Union → `{ left } UNION { right }`
   - Minus → left + `MINUS { right }`
   - Extend → `BIND(expr AS ?var)`
   - Graph → `GRAPH <iri> { inner }`
   - `serializeExpression(expr)` — recursive expression serializer
   - `selectPlanToSparql(plan, options)` — assembles PREFIX block, SELECT line (with aggregates), WHERE block, GROUP BY, HAVING, ORDER BY, LIMIT/OFFSET
   - `insertDataPlanToSparql(plan, options)` — `INSERT DATA { triples }`
   - `deleteInsertPlanToSparql(plan, options)` — `DELETE { patterns } INSERT { patterns } WHERE { algebra }`
   - `deleteWherePlanToSparql(plan, options)` — `DELETE WHERE { algebra }`
   - Prefix collection: two-pass (serialize body, collect URIs, resolve prefixes, re-serialize with prefixed URIs + PREFIX header)
2. Write serialization-specific tests using **hand-crafted algebra objects** (not from irToAlgebra):
   - BGP with 2 triples → correct formatting
   - LeftJoin → OPTIONAL block
   - Filter with binary expression → `FILTER(?x = "value")`
   - Union → `{ } UNION { }`
   - Extend → `BIND(... AS ?var)`
   - Full SparqlSelectPlan → complete query string with PREFIX, SELECT, WHERE, ORDER BY, LIMIT
   - InsertDataPlan → INSERT DATA block
   - DeleteInsertPlan → DELETE/INSERT/WHERE block
   - DeleteWherePlan → DELETE WHERE block
   - Prefix resolution: IRIs shortened where possible

**Tests** (`src/tests/sparql-serialization.test.ts`):

All tests use hand-crafted algebra objects — no dependency on `irToAlgebra.ts`.

`serializeAlgebraNode — BGP`:
- Given BGP with two triples `?s rdf:type <Person>` and `?s <name> ?name` → assert output is `?s rdf:type <Person> .\n?s <name> ?name .`
- Assert triples are separated by ` .\n`

`serializeAlgebraNode — LeftJoin`:
- Given LeftJoin(bgp, bgp2) → assert output contains `OPTIONAL { ... }` wrapping the right-hand BGP triples
- Assert the left-hand triples appear before the OPTIONAL block

`serializeAlgebraNode — Filter`:
- Given Filter with binary_expr `?x = "value"` → assert output contains `FILTER(?x = "value")`
- Given Filter with logical AND → assert output contains `FILTER(?x = "a" && ?y = "b")`

`serializeAlgebraNode — Union`:
- Given Union(bgp1, bgp2) → assert output matches `{ ... } UNION { ... }` with each BGP in its own block

`serializeAlgebraNode — Minus`:
- Given Minus(bgp1, bgp2) → assert output contains `MINUS { ... }` block

`serializeAlgebraNode — Extend`:
- Given Extend with variable `?bound` and expression → assert output contains `BIND(... AS ?bound)`

`serializeAlgebraNode — Graph`:
- Given Graph with IRI and inner BGP → assert output contains `GRAPH <iri> { ... }`

`serializeExpression — exists`:
- Given exists_expr with negated=false → assert `EXISTS { ... }`
- Given exists_expr with negated=true → assert `NOT EXISTS { ... }`

`selectPlanToSparql — full plan`:
- Given a SparqlSelectPlan with: projection [?a0, ?a0_name], BGP + LeftJoin, orderBy ASC(?a0_name), limit 10 → assert output matches:
  ```
  PREFIX rdf: <...>
  SELECT DISTINCT ?a0 ?a0_name
  WHERE {
    ?a0 rdf:type <Person> .
    OPTIONAL { ?a0 <name> ?a0_name . }
  }
  ORDER BY ASC(?a0_name)
  LIMIT 10
  ```
- Assert PREFIX block contains only actually used prefixes
- Assert DISTINCT is present

`selectPlanToSparql — with aggregates and GROUP BY`:
- Given plan with projection including `(COUNT(?a1) AS ?a2)` and groupBy `['a0']` → assert output contains `SELECT ?a0 (COUNT(?a1) AS ?a2)`, `GROUP BY ?a0`

`insertDataPlanToSparql`:
- Given InsertDataPlan with 3 triples → assert output matches:
  ```
  PREFIX ...
  INSERT DATA {
    <uri> rdf:type <Person> .
    <uri> <name> "Test" .
    <uri> <hobby> "Chess" .
  }
  ```

`deleteInsertPlanToSparql`:
- Given DeleteInsertPlan with delete patterns, insert patterns, and WHERE algebra → assert output matches:
  ```
  DELETE { <id> <hobby> ?old_hobby . }
  INSERT { <id> <hobby> "Chess" . }
  WHERE { <id> <hobby> ?old_hobby . }
  ```

`deleteWherePlanToSparql`:
- Given DeleteWherePlan with subject+object patterns → assert output matches:
  ```
  DELETE WHERE {
    <id> ?p ?o .
    ?s ?p2 <id> .
    <id> rdf:type <Person> .
  }
  ```

`prefix resolution`:
- Given a plan with URIs that have registered prefixes → assert PREFIX declarations appear and URIs are shortened in the body
- Given a plan with URIs that have NO registered prefix → assert `<full-uri>` form and no PREFIX for that URI

**Stub boundaries:** Uses hand-crafted algebra objects for testing. No dependency on `irToAlgebra.ts`.

**Validation:**
- All serialization tests pass
- `npm run compile` passes

**Commit:** `feat(sparql): implement algebra-to-SPARQL string serializer`

---

### Phase 2c: Result mapping ✅

**Depends on:** Phase 1 only (uses IR types + SparqlJsonResults type)
**Can run in parallel with:** 2a, 2b, 2d

**Status: COMPLETE** — 25 tests pass in `sparql-result-mapping.test.ts`. Full compilation clean, no regressions.

**Tasks:**
1. Implement `src/sparql/resultMapping.ts`:
   - `SparqlJsonResults` and `SparqlBinding` types
   - `mapSparqlSelectResult(json, query)` — main select result mapper:
     - Parse bindings by variable name (alias-based)
     - Type coercion: `xsd:boolean` (both `"true"` and `"1"`), `xsd:integer`/`xsd:double` → number, `xsd:dateTime` → Date, untyped literals → string
     - URIs → string id
     - Missing bindings → null
     - Row grouping by root alias for nested object reconstruction
     - `singleResult` → single row or null
   - `mapSparqlCreateResult(generatedUri, query)` — echo back created fields as ResultRow
   - `mapSparqlUpdateResult(query)` — echo back updated fields as UpdateResult
2. **Investigate and enrich `IRResultMapEntry`** if needed:
   - Test with nested queries (e.g. `selectFriendsName`, `subSelectPluralCustom`, `doubleNestedSubSelect`)
   - Determine if `isArray`, `datatype`, `nestedEntries` fields are needed
   - If so, update `IntermediateRepresentation.ts` and the IR pipeline to populate them
3. Write `src/tests/sparql-result-mapping.test.ts`:
   - Simple flat result (selectName) → ResultRow[]
   - Nested result (selectFriendsName) → grouped with nested arrays
   - Boolean coercion (both `"true"` and `"1"`)
   - Date coercion
   - Number coercion
   - Missing values → null
   - singleResult → single row
   - singleResult with no match → null
   - URI fields → id string

**Tests** (`src/tests/sparql-result-mapping.test.ts`):

All tests use hand-crafted `SparqlJsonResults` objects paired with IR queries from `queryFactories`.

`flat literal result — selectName`:
- Given SPARQL JSON with 4 bindings: `{a0: uri "p1", a0_name: literal "Semmy"}, {a0: uri "p2", a0_name: literal "Moa"}, ...`
- Assert returns `ResultRow[]` with length 4
- Assert each row has `id` (the URI value) and `name` (string value)
- Assert `rows[0].id` equals `"linked://tmp/entities/p1"` and `rows[0].name` equals `"Semmy"`

`nested object result — selectFriendsName`:
- Given SPARQL JSON with flat bindings: `{a0: "p1", a1: "p2", a1_name: "Moa"}, {a0: "p1", a1: "p3", a1_name: "Jinx"}, {a0: "p2", a1: "p3", a1_name: "Jinx"}, ...`
- Assert grouping by root alias `a0`: persons are grouped, friends are nested arrays
- Assert `rows[0].friends` is an array of `ResultRow[]` with `id` and `name` fields

`boolean coercion — "true" string`:
- Given binding `{a0_isRealPerson: {type: "typed-literal", value: "true", datatype: xsd.boolean}}` → assert result field is boolean `true`

`boolean coercion — "1" string`:
- Given binding `{a0_isRealPerson: {type: "typed-literal", value: "1", datatype: xsd.boolean}}` → assert result field is boolean `true`

`boolean coercion — "false" string`:
- Given binding with value `"false"` → assert result field is boolean `false`

`integer coercion`:
- Given binding `{a0_guardDogLevel: {type: "typed-literal", value: "2", datatype: xsd.integer}}` → assert result field is number `2`

`double coercion`:
- Given binding `{value: "3.14", datatype: xsd.double}` → assert result field is number `3.14`

`dateTime coercion`:
- Given binding `{a0_birthDate: {type: "typed-literal", value: "2020-01-01T00:00:00.000Z", datatype: xsd.dateTime}}` → assert result field is a `Date` object, `getFullYear()` returns `2020`

`missing binding → null`:
- Given binding where `a0_hobby` key is absent → assert result field for `hobby` is `null`

`URI field → id string`:
- Given binding `{a0_bestFriend: {type: "uri", value: "linked://tmp/entities/p3"}}` → assert nested result has `id: "linked://tmp/entities/p3"`

`singleResult — one match`:
- Given IR query with `singleResult: true` and SPARQL JSON with 1 binding → assert returns a single `ResultRow` (not wrapped in array)

`singleResult — no match`:
- Given IR query with `singleResult: true` and SPARQL JSON with 0 bindings → assert returns `null`

`untyped literal → string`:
- Given binding `{a0_name: {type: "literal", value: "Semmy"}}` (no datatype) → assert result field is string `"Semmy"`

**Stub boundaries:** Uses hand-crafted `SparqlJsonResults` objects + IR queries from `queryFactories`. No dependency on SPARQL generation.

**Validation:**
- All result mapping tests pass
- `npm run compile` passes
- If IR types were enriched, existing IR tests still pass

**Commit:** `feat(sparql): implement SPARQL result-to-object mapper`

---

### Phase 2d: Layer 1 — IR → Algebra for mutations ✅

**Depends on:** Phase 1 only
**Can run in parallel with:** 2a, 2b, 2c

**Status: COMPLETE** — 16 tests pass in `sparql-mutation-algebra.test.ts`. Full compilation clean, no regressions.

**Tasks:**
1. Add mutation conversion functions to `src/sparql/irToAlgebra.ts`:
   - `createToAlgebra(query, options)` → `SparqlInsertDataPlan`:
     - URI generation (use `data.id` or `generateEntityUri`)
     - Type triple
     - Field triples (primitives, references, dates, booleans)
     - Nested `IRNodeData` → recursive triple generation
     - Array fields → multiple triples
   - `updateToAlgebra(query, options)` → `SparqlDeleteInsertPlan`:
     - Delete patterns for each changed field
     - Insert patterns for new values
     - WHERE BGP matching existing triples
     - Set modifications: `{add}` → insert only, `{remove}` → delete specific
     - Unset (undefined/null) → delete only
     - Nested creates in updates
   - `deleteToAlgebra(query, options)` → `SparqlDeleteWherePlan`:
     - Bidirectional: subject triples + object triples
     - Type guard triple
     - Multiple IDs → FILTER(?s IN (...))
   - Convenience wrappers: `createToSparql`, `updateToSparql`, `deleteToSparql`
2. Write mutation algebra tests:
   - `createSimple` → correct triples with generated URI
   - `createWithFixedId` → uses provided ID
   - `createWithFriends` → nested + array references
   - `updateSimple` → delete old + insert new
   - `updateOverwriteSet` → set overwrite pattern
   - `updateAddRemoveMulti` → add/remove set modification
   - `updateUnsetSingleUndefined` → delete only
   - `updateOverwriteNested` → nested create within update
   - `deleteSingle` → bidirectional delete
   - `deleteMultiple` → multi-ID filter

**Tests** (`src/tests/sparql-mutation-algebra.test.ts`):

`createSimple` — `Person.create({name: 'Test Create', hobby: 'Chess'})`:
- Assert plan type is `'insert_data'`
- Assert triples include a type triple: `<generated-uri> rdf:type <linked://tmp/types/Person>`
- Assert triples include: `<generated-uri> <linked://tmp/props/name> "Test Create"`
- Assert triples include: `<generated-uri> <linked://tmp/props/hobby> "Chess"`
- Assert generated URI starts with `{dataRoot}/person_` and ends with a 26-char ULID

`createWithFixedId` — `Person.create({__id: '...fixed-id', name: 'Fixed', bestFriend: entity('fixed-id-2')})`:
- Assert plan type is `'insert_data'`
- Assert the subject URI in all triples is exactly `linked://tmp/entities/fixed-id` (not generated)
- Assert triples include: `<fixed-id> <linked://tmp/props/bestFriend> <linked://tmp/entities/fixed-id-2>` (object reference, not literal)

`createWithFriends` — `Person.create({name: 'Test Create', friends: [entity('p2'), {name: 'New Friend'}]})`:
- Assert plan type is `'insert_data'`
- Assert triples include the root type + name triple
- Assert triples include: `<root-uri> <linked://tmp/props/hasFriend> <linked://tmp/entities/p2>` (reference to existing entity)
- Assert triples include a SECOND hasFriend triple pointing to a newly generated URI
- Assert triples include nested: `<new-friend-uri> rdf:type <linked://tmp/types/Person>` + `<new-friend-uri> <…/name> "New Friend"`
- Assert total triple count covers root + nested entity

`updateSimple` — `Person.update(entity('p1'), {hobby: 'Chess'})`:
- Assert plan type is `'delete_insert'`
- Assert deletePatterns include: `<linked://tmp/entities/p1> <linked://tmp/props/hobby> ?old_hobby`
- Assert insertPatterns include: `<linked://tmp/entities/p1> <linked://tmp/props/hobby> "Chess"`
- Assert whereAlgebra is a BGP matching the old triple

`updateOverwriteSet` — `Person.update(entity('p1'), {friends: [entity('p2')]})`:
- Assert deletePatterns include: `<p1> <linked://tmp/props/hasFriend> ?old_hasFriend` (wildcard old value)
- Assert insertPatterns include: `<p1> <linked://tmp/props/hasFriend> <linked://tmp/entities/p2>`

`updateAddRemoveMulti` — `Person.update(entity('p1'), {friends: {add: [entity('p2')], remove: [entity('p3')]}})`:
- Assert deletePatterns include: `<p1> <linked://tmp/props/hasFriend> <linked://tmp/entities/p3>` (specific remove)
- Assert insertPatterns include: `<p1> <linked://tmp/props/hasFriend> <linked://tmp/entities/p2>` (specific add)
- Assert NO wildcard delete pattern (only specific removes)

`updateUnsetSingleUndefined` — `Person.update(entity('p1'), {hobby: undefined})`:
- Assert plan type is `'delete_insert'`
- Assert deletePatterns include: `<p1> <linked://tmp/props/hobby> ?old_hobby`
- Assert insertPatterns is empty (delete only, no replacement)

`updateOverwriteNested` — `Person.update(entity('p1'), {bestFriend: {name: 'Bestie'}})`:
- Assert deletePatterns include: `<p1> <linked://tmp/props/bestFriend> ?old_bestFriend`
- Assert insertPatterns include: `<p1> <linked://tmp/props/bestFriend> <new-generated-uri>`
- Assert insertPatterns include nested create triples: `<new-uri> rdf:type <Person>`, `<new-uri> <name> "Bestie"`

`updateBirthDate` — `Person.update(entity('p1'), {birthDate: new Date('2020-01-01')})`:
- Assert insertPatterns include a typed literal: `<p1> <linked://tmp/props/birthDate> "2020-01-01T00:00:00.000Z"^^<xsd:dateTime>`

`deleteSingle` — `Person.delete(entity('to-delete'))`:
- Assert plan type is `'delete_where'`
- Assert patterns include subject wildcard: `<linked://tmp/entities/to-delete> ?p ?o`
- Assert patterns include object wildcard: `?s ?p2 <linked://tmp/entities/to-delete>`
- Assert patterns include type guard: `<linked://tmp/entities/to-delete> rdf:type <linked://tmp/types/Person>`

`deleteMultiple` — `Person.delete([entity('to-delete-1'), entity('to-delete-2')])`:
- Assert plan handles multiple IDs (either multiple delete plans or FILTER IN)
- Assert both entity URIs appear in the delete patterns

**Stub boundaries:** Produces `SparqlInsertDataPlan`, `SparqlDeleteInsertPlan`, `SparqlDeleteWherePlan`. Phase 2b's serializer handles these types independently.

**Validation:**
- All mutation algebra tests pass
- `npm run compile` passes

**Commit:** `feat(sparql): implement IR-to-algebra conversion for mutations`

---

### Phase 3: Golden tests + wiring ✅

**Depends on:** Phases 2a + 2b (need both layers to produce end-to-end SPARQL strings)

**Status: COMPLETE** — 55 select golden tests + 19 mutation golden tests pass. Convenience wrappers wired. `npm run compile` clean, no regressions (365/365 tests pass).

**Tasks:**
1. Wire convenience wrappers in `irToAlgebra.ts`: `selectToSparql`, `createToSparql`, `updateToSparql`, `deleteToSparql`
2. Update `src/sparql/index.ts` — replace stubs with real exports
3. Write `src/tests/sparql-select-golden.test.ts`:
   - One test per select fixture in `queryFactories` (~40 fixtures)
   - Each test: call factory → `selectToSparql()` → assert full SPARQL string
4. Write `src/tests/sparql-mutation-golden.test.ts`:
   - One test per mutation fixture (~15 fixtures)
   - Each test: call factory → `createToSparql`/`updateToSparql`/`deleteToSparql` → assert SPARQL string
5. Fix any issues found when layers combine (type mismatches, missing edge cases)

**Tests** (`src/tests/sparql-select-golden.test.ts` + `src/tests/sparql-mutation-golden.test.ts`):

These are full end-to-end string-equality tests. Each test calls the IR factory, converts to SPARQL, and asserts the exact output string. The expected strings are written inline as template literals.

**Select golden tests** — one test per select fixture (each asserts full SPARQL string):

`selectName` → assert output contains: `SELECT DISTINCT`, `?a0 rdf:type`, `OPTIONAL { ?a0 <…/name> ?a0_name }`, no GROUP BY
`selectFriends` → assert output contains: traverse triple `?a0 <…/hasFriend> ?a1`, projects `?a0 ?a1`
`selectBirthDate` → assert output contains: OPTIONAL property triple with `<…/birthDate>`
`selectIsRealPerson` → assert output contains: OPTIONAL property triple with `<…/isRealPerson>`
`selectById` → assert output contains: subject filter for `<linked://tmp/entities/p1>`
`selectNonExisting` → assert output contains: subject filter for `<https://does.not/exist>`
`selectFriendsName` → assert output contains: traverse `?a0 <…/hasFriend> ?a1`, OPTIONAL `?a1 <…/name> ?a1_name`
`selectNestedFriendsName` → assert output contains: two traverse levels (`a0→a1→a2`), OPTIONAL on deepest property
`selectMultiplePaths` → assert output contains: OPTIONAL for name, traverse for friends, traverse for bestFriend + OPTIONAL name
`selectBestFriendName` → assert output contains: traverse to bestFriend + OPTIONAL name
`selectDeepNested` → assert output contains: three traverse levels (`friends→bestFriend→bestFriend`) + OPTIONAL name at deepest level
`whereFriendsNameEquals` → assert output contains: FILTER with `?a1_name = "Moa"`
`whereBestFriendEquals` → assert output contains: FILTER with `?a0_bestFriend = <linked://tmp/entities/p3>`
`whereHobbyEquals` → assert output contains: FILTER with `= "Jogging"`
`whereAnd` → assert output contains: FILTER with `&&` joining two conditions
`whereOr` → assert output contains: FILTER with `||` joining two conditions
`whereAndOrAnd` → assert output contains: correctly nested `(... || ...) && ...`
`whereAndOrAndNested` → assert output contains: correctly nested `... || (... && ...)`
`whereSomeImplicit` → assert output contains: EXISTS or subquery pattern for implicit `some`
`whereSomeExplicit` → assert output contains: `FILTER EXISTS { ... }`
`whereEvery` → assert output contains: `FILTER NOT EXISTS { ... }` with negated inner condition
`whereSequences` → assert output contains: `FILTER(EXISTS { ... } && ...)`
`outerWhere` → assert output contains: FILTER at outer scope on root alias `a0`
`countFriends` → assert output contains: `(COUNT(?a1) AS ?a2)`, `GROUP BY ?a0`
`countNestedFriends` → assert output contains: nested count with correct GROUP BY
`countLabel` → assert output contains: sub-select or aggregate with label alias
`selectAll` → assert output contains: SELECT with root variable, type triple
`selectAllProperties` → assert output contains: OPTIONAL blocks for ALL Person properties (name, hobby, nickName, birthDate, isRealPerson, bestFriend, hasFriend, hasPet, firstPet, pluralTestProp)
`selectWhereNameSemmy` → assert output contains: FILTER with `= "Semmy"` on root alias
`selectDuplicatePaths` → assert output contains: ONE traverse to bestFriend, THREE OPTIONAL property triples
`outerWhereLimit` → assert output contains: `FILTER(...)`, `LIMIT 1`
`sortByAsc` → assert output contains: `ORDER BY ASC(?a0_name)`
`sortByDesc` → assert output contains: `ORDER BY DESC(?a0_name)`
`customResultEqualsBoolean` → assert output contains: boolean expression comparing bestFriend
`customResultNumFriends` → assert output contains: COUNT aggregate for friends
`countEquals` → assert output contains: HAVING or FILTER on count = 2
`subSelectSingleProp` → assert output contains: sub-select pattern for bestFriend.name
`subSelectPluralCustom` → assert output contains: sub-select with name + hobby for friends
`subSelectAllProperties` → assert output contains: sub-select projecting all friend properties
`doubleNestedSubSelect` → assert output contains: two levels of sub-select nesting
`selectShapeSetAs` → assert output contains: type cast to Dog, property `<…/guardDogLevel>`
`selectShapeAs` → assert output contains: single pet cast to Dog
`selectAllEmployeeProperties` → assert output contains: Employee type triple + all Employee properties
`selectOne` → assert output contains: subject filter + same structure as selectById
`nestedQueries2` → assert output contains: multiple nested sub-selects
`nestedObjectProperty` → assert output contains: traverse to bestFriend through friends
`preloadBestFriend` → assert output contains: bestFriend traverse with name projection (from component query)

**Mutation golden tests** — one test per mutation fixture:

`createSimple` → assert output is `INSERT DATA { ... }` with type triple + name + hobby
`createWithFriends` → assert output is `INSERT DATA { ... }` with root + two hasFriend triples (one reference, one nested create)
`createWithFixedId` → assert output is `INSERT DATA { ... }` with fixed URI (no ULID)
`updateSimple` → assert output is `DELETE { ... } INSERT { ... } WHERE { ... }` with hobby field
`updateOverwriteSet` → assert output with wildcard delete + specific insert for friends
`updateUnsetSingleUndefined` → assert output has DELETE but no INSERT block for hobby
`updateUnsetSingleNull` → same as undefined
`updateOverwriteNested` → assert output with nested create triples in INSERT
`updatePassIdReferences` → assert output with ID reference in INSERT (not nested create)
`updateAddRemoveMulti` → assert output with specific add/remove triples
`updateRemoveMulti` → assert output with remove-only triples
`updateNestedWithPredefinedId` → assert output with predefined nested ID
`updateBirthDate` → assert output with dateTime typed literal
`updateUnsetMultiUndefined` → assert output with wildcard delete for multi-value field
`deleteSingle` → assert output is `DELETE WHERE { ... }` with bidirectional patterns
`deleteMultiple` → assert output handles multiple IDs

**Validation:**
- All golden tests pass (every query-fixtures factory produces expected SPARQL)
- `npm run compile` passes
- `npm test` — all existing + new tests pass

**Commit:** `feat(sparql): add golden SPARQL tests for all query fixtures`

---

### Phase 4: Fuseki integration tests ✅

**Depends on:** Phases 2c + 3 (need result mapping + working SPARQL generation)

**Status: COMPLETE** — 19 Fuseki integration tests written (16 select + 3 mutation). Tests skip gracefully when Fuseki is unavailable. `npm run compile` clean, no regressions (384/384 tests pass).

**Tasks:**
1. Create test Fuseki helper (`src/test-helpers/fuseki-test-store.ts`):
   - `createTestDataset()` — create/reset test dataset via Fuseki admin API
   - `loadTestData()` — insert test entities as N-Triples/Turtle
   - `executeSparql(sparql, type)` — raw SPARQL execution against Fuseki
   - `cleanupTestDataset()` — delete test dataset
   - Uses `FUSEKI_BASE_URL` env var (default `http://localhost:3030`)
2. Create test data loader — port `OLD/lincd-fuseki/src/tests/setup.data.ts` entities to N-Triples format (static file or programmatic generation using query-fixtures shapes)
3. Write `src/tests/sparql-fuseki.test.ts`:
   - `beforeAll`: create dataset + load test data
   - `afterAll`: cleanup dataset
   - Tests mirror OLD `fuseki-sparql-queries.test.tsx` assertions:
     - Select literal property (all persons have name)
     - Select object property (friends as nested arrays)
     - Select date property (birthDate coercion)
     - Select boolean property (isRealPerson coercion, null handling)
     - Select by specific subject ID
     - Select with non-existing subject → null
     - Where equals filter
     - Where AND/OR
     - Where some/every quantifiers
     - Count aggregation
     - Sub-selects
     - Create + verify created data
     - Update + verify updated data
     - Delete + verify deleted data
4. Configure test runner to skip Fuseki tests when no Fuseki is available (env var or connection check)

**Tests** (`src/tests/sparql-fuseki.test.ts`):

All tests execute real SPARQL against a Fuseki instance. Tests are skipped when `FUSEKI_BASE_URL` is not reachable.

Test data loaded in `beforeAll` (matching OLD test setup):
- p1 (Semmy): name="Semmy", birthDate=1990-01-01, isRealPerson=true, friends=[p2,p3], pets=[dog1], nickNames=["Sem1","Sem"]
- p2 (Moa): name="Moa", hobby="Jogging", isRealPerson=false, bestFriend=p3, friends=[p3,p4], pets=[dog2]
- p3 (Jinx): name="Jinx", isRealPerson=true
- p4 (Quinn): name="Quinn"
- dog1: guardDogLevel=2, bestFriend=dog2
- dog2: (no extra props)

**Select integration tests:**

`selectName — all persons have name`:
- Execute `selectName` fixture → assert result is array of length 4
- Assert each row has `id` (string) and `name` (string)
- Assert names include "Semmy", "Moa", "Jinx", "Quinn" (order may vary)

`selectFriends — returns friend references`:
- Execute `selectFriends` for all persons → assert p1 has 2 friends, p2 has 2 friends, p3 has 0 friends, p4 has 0 friends

`selectBirthDate — date coercion`:
- Execute `selectBirthDate` → assert p1's birthDate is a Date object with year 1990
- Assert p2/p3/p4 birthDate is null (not set)

`selectIsRealPerson — boolean coercion + null`:
- Execute `selectIsRealPerson` → assert p1.isRealPerson is `true` (boolean, not string)
- Assert p2.isRealPerson is `false` (boolean)
- Assert p3.isRealPerson is `true`
- Assert p4.isRealPerson is `null` (not set)

`selectById — single person by URI`:
- Execute `selectById` (entity p1) → assert returns single row with name "Semmy"

`selectNonExisting — returns null`:
- Execute `selectNonExisting` (non-existent URI) → assert returns `null`

`selectFriendsName — nested traversal`:
- Execute `selectFriendsName` → assert p1's friends have names ["Moa", "Jinx"] (as nested objects)
- Assert p2's friends have names ["Jinx", "Quinn"]

`whereHobbyEquals — filter`:
- Execute `whereHobbyEquals` (hobby = 'Jogging') → assert result contains only entries with hobby "Jogging"

`whereAnd — compound filter`:
- Execute `whereAnd` (name = 'Moa' AND hobby = 'Jogging') → assert returns matching friends only

`whereOr — compound filter`:
- Execute `whereOr` (name = 'Jinx' OR hobby = 'Jogging') → assert returns friends matching either condition

`whereSomeExplicit — exists quantifier`:
- Execute `whereSomeExplicit` (some friend named 'Moa') → assert returns persons who have at least one friend named Moa

`whereEvery — universal quantifier`:
- Execute `whereEvery` (every friend named 'Moa' or 'Jinx') → assert returns persons where ALL friends match

`countFriends — aggregation`:
- Execute `countFriends` → assert p1 has count 2, p2 has count 2, p3 has count 0, p4 has count 0

`outerWhereLimit — filter + limit`:
- Execute `outerWhereLimit` → assert result has at most 1 row

`sortByAsc — ordering`:
- Execute `sortByAsc` → assert names are in ascending alphabetical order

`sortByDesc — ordering`:
- Execute `sortByDesc` → assert names are in descending alphabetical order

`selectDuplicatePaths — multi-property traversal`:
- Execute `selectDuplicatePaths` → assert each row has bestFriend's name, hobby, and isRealPerson

`selectShapeSetAs — type cast`:
- Execute `selectShapeSetAs` → assert dogs with guardDogLevel values appear correctly

**Mutation integration tests:**

`createSimple — insert and verify`:
- Execute `createSimple` → assert returns CreateResult with `id` (generated URI) and field values
- Execute a select query for the created URI → assert data was actually persisted
- Clean up: delete the created entity

`updateSimple — update and verify`:
- Create a test entity first
- Execute `updateSimple`-style update → assert returns UpdateResult with changed fields
- Select the entity → assert hobby changed to new value
- Clean up

`deleteSingle — delete and verify`:
- Create a test entity first
- Execute `deleteSingle`-style delete → assert success
- Select the entity → assert returns null or empty (entity gone)

**Validation:**
- All Fuseki integration tests pass (when Fuseki is running)
- Tests skip gracefully when Fuseki is unavailable
- `npm test` — all tests pass (Fuseki tests skipped if no endpoint)

**Commit:** `feat(sparql): add Fuseki integration tests`

---

### Phase 5: Fuseki Docker setup + live integration verification ✅

**Status:** Complete — `src/tests/docker-compose.test.yml` created, `test:fuseki` npm script added, all 19 integration tests pass against live Fuseki. Fixed 6 test assertion issues: singleResult handling, test data gaps, and documented two known limitations (nested result grouping requires traversal aliases in SELECT projection; FILTER uses string literals for URI entity references).

**Depends on:** Phase 4
**Can run in parallel with:** Phase 6

**Tasks:**
1. Create `src/tests/docker-compose.test.yml` — minimal Fuseki service for tests:
   - Use `secoresearch/fuseki:5.5.0` image (consistent with existing project infrastructure)
   - Expose port 3030 (default, no remap)
   - Set `ADMIN_PASSWORD=admin` env var
   - No assembler config — tests create datasets via HTTP API (`createTestDataset()` already does this)
   - Add healthcheck: `wget -qO- http://localhost:3030/ >/dev/null 2>&1 || exit 1` with `interval: 5s`, `timeout: 3s`, `retries: 10`
   - No persistent volumes (ephemeral test data)
2. Add npm script `test:fuseki` to `package.json`:
   - Shell command: `docker compose -f src/tests/docker-compose.test.yml up -d --wait && npx jest --config jest.config.js --testPathPattern='sparql-fuseki' --verbose; EXIT=$?; docker compose -f src/tests/docker-compose.test.yml down; exit $EXIT`
   - Note: uses `EXIT=$?` pattern to ensure cleanup runs even on test failure, but preserves the exit code
3. Run `npm run test:fuseki` and verify all 19 integration tests pass against live Fuseki.
4. Fix any issues found when running against real Fuseki (query syntax, result format, endpoint behavior).
   - Likely issues: URI encoding in N-Triples, `linked://` scheme handling, SPARQL syntax edge cases

**Validation:**
- `docker compose -f src/tests/docker-compose.test.yml up -d --wait` starts Fuseki and healthcheck passes within 30s.
- `npx jest --config jest.config.js --testPathPattern='sparql-fuseki' --verbose` — all 19 integration tests pass (not skipped) against live Fuseki.
- `docker compose -f src/tests/docker-compose.test.yml down` cleans up without errors.
- `npx jest --config jest.config.js` — all existing tests still pass (no regressions).
- `npx tsc -p tsconfig-cjs.json --noEmit` — clean compilation.

**Commit:** `test(sparql): add Docker Compose for Fuseki integration tests`

---

### Phase 6: Negative and error-path tests ✅

**Status:** Complete — 12 negative/error-path tests written, `convertExistsPattern()` silent failure fixed, outdated "stubs" comments updated, all 396 tests pass.

**Depends on:** Phase 3
**Can run in parallel with:** Phase 5

**Tasks:**
1. Fix silent failures in `src/sparql/irToAlgebra.ts`:
   - Line 598: Change `default: return {type: 'bgp', triples: []};` in `convertExistsPattern()` to `throw new Error('Unsupported pattern kind in EXISTS: ${(pattern as any).kind}')`.
   - Verify the existing throw at line 547 (`Unknown IR expression kind`) has a clear message (it does).
2. Update outdated comments:
   - `src/sparql/index.ts:21` — change `// High-level IR → SPARQL string (stubs until Phase 3)` to `// High-level IR → SPARQL string (convenience wrappers)`
   - `src/sparql/irToAlgebra.ts:901` — change `// Convenience wrappers (stubs — wired in Phase 3 when algebraToString exists)` to `// Convenience wrappers: IR → algebra → SPARQL string in one call`
3. Write `src/tests/sparql-negative.test.ts` with the test cases below.
4. Add `'**/sparql-negative.test.ts'` to `jest.config.js` testMatch.

**Tests** (`src/tests/sparql-negative.test.ts`):

Keep the set focused — ~12-15 tests covering key error paths, not exhaustive.

`describe('irToAlgebra — error paths')`:

`unknown expression kind — throws with message`:
- Hand-craft an `IRSelectQuery` with a `where` containing `{kind: 'bogus_expr'} as any`
- Assert `selectToAlgebra(ir)` throws with message matching `/Unknown IR expression kind: bogus_expr/`

`unknown pattern kind in EXISTS — throws with message`:
- Hand-craft an `IRSelectQuery` with a `where` of kind `exists_expr` containing a pattern `{kind: 'bogus_pattern'} as any`
- Assert `selectToAlgebra(ir)` throws with message matching `/Unsupported pattern kind in EXISTS: bogus_pattern/`

`empty projection — produces valid SPARQL`:
- Hand-craft an `IRSelectQuery` with empty `projection: []`
- Assert `selectToAlgebra(ir)` does NOT throw (empty projection is valid — projects nothing)
- Assert the returned plan has `projection: []`

`create with empty data — produces INSERT DATA with just type triple`:
- Hand-craft `IRCreateMutation` with `data: {properties: []}` (no fields set)
- Assert `createToAlgebra(ir)` returns a plan with at least the type triple
- Assert the plan's triples include `rdf:type`

`delete with empty ids — produces valid plan`:
- Hand-craft `IRDeleteMutation` with `ids: []`
- Assert `deleteToAlgebra(ir)` does not throw

`describe('resultMapping — type coercion edge cases')`:

`NaN numeric string — returns NaN`:
- Input binding: `{value: 'not-a-number', type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#integer'}`
- Assert coerced value is `NaN` (not a thrown error)

`empty string boolean — returns false`:
- Input binding: `{value: '', type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#boolean'}`
- Assert coerced value is `false` (empty string is falsy)

`malformed dateTime — returns string`:
- Input binding: `{value: 'not-a-date', type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#dateTime'}`
- Assert result is returned (not thrown) — the value may be a string or invalid Date

`missing datatype — returns raw string`:
- Input binding: `{value: '42', type: 'literal'}` (no datatype)
- Assert result is the raw string `'42'` (no numeric coercion)

`describe('algebraToString — edge cases')`:

`empty BGP — serializes to empty block`:
- Input: `{type: 'bgp', triples: []}` as algebra node
- Assert `serializeAlgebraNode(node)` returns empty string or whitespace-only

`deeply nested join (5 levels) — does not stack overflow`:
- Construct a chain of 5 nested Joins, each wrapping a single-triple BGP
- Assert `serializeAlgebraNode(node)` returns a string containing all 5 triples
- Assert no error thrown

`select plan with all optional fields — serializes correctly`:
- Hand-craft a `SparqlSelectPlan` with `distinct`, `orderBy`, `limit`, `offset`, `groupBy`, `aggregates` all populated
- Assert `selectPlanToSparql(plan)` contains `SELECT DISTINCT`, `ORDER BY`, `LIMIT`, `OFFSET`, `GROUP BY`

**Validation:**
- All negative tests pass.
- `convertExistsPattern()` throws on unknown pattern kind (verified by test asserting specific message).
- Outdated comments are updated (not "stubs").
- `npx tsc -p tsconfig-cjs.json --noEmit` exits 0.
- `npx jest --config jest.config.js` — all tests pass, no regressions.

**Commit:** `test(sparql): add negative and error-path tests, fix silent failures`

---

**Parallel execution note:** Phases 5 and 6 can run in parallel because they touch different files:
- Phase 5 creates `src/tests/docker-compose.test.yml` and modifies `package.json` — does NOT modify source code unless Fuseki reveals bugs
- Phase 6 modifies `irToAlgebra.ts` (fix silent failure), `index.ts` (comments), creates `sparql-negative.test.ts`, modifies `jest.config.js`

If Phase 5 discovers bugs that require source code fixes in `irToAlgebra.ts`, it should be sequenced after Phase 6 instead. Otherwise parallel is safe.

**Integration after parallel phases:** After both complete, verify:
1. `npx tsc -p tsconfig-cjs.json --noEmit` — compilation clean
2. `npx jest --config jest.config.js` — all unit tests pass together
3. `npm run test:fuseki` — all integration tests still pass with the Phase 6 source changes

---

### Phase 7: Fix URI-vs-literal in FILTER comparisons ✅

**Status:** Complete — Added `IRReferenceExpression` to IR type system, changed `lowerWhereArg()` to emit `reference_expr` for entity references, handled `reference_expr` → `iri_expr` in irToAlgebra. Updated 3 golden tests (selectOne, whereBestFriendEquals, whereWithContext). All 396 tests pass.

**Depends on:** Phase 6
**Can run in parallel with:** — (Phase 8 depends on this)

**Problem:** Where clauses that compare an object property variable to an entity reference emit `FILTER(?var = "uri-string")` (string literal) instead of `FILTER(?var = <uri-string>)` (IRI). In SPARQL, URI ≠ string literal, so these filters always match zero rows.

**Root cause:** `lowerWhereArg()` in `IRLower.ts:101-106` converts `NodeReferenceValue` and `ShapeReferenceValue` objects to `{kind: 'literal_expr', value: id}`, losing the semantic distinction that the value is a URI reference. The SPARQL algebra already has `iri_expr` — the IR just needs a corresponding `reference_expr` kind.

**Files changed:**
- `src/queries/IntermediateRepresentation.ts` — add `IRReferenceExpression` type
- `src/queries/IRLower.ts` — emit `reference_expr` for `NodeReferenceValue` / `ShapeReferenceValue`
- `src/sparql/irToAlgebra.ts` — handle `reference_expr` in `convertExpression()` and `processExpressionForProperties()`
- `src/tests/sparql-select-golden.test.ts` — update ~5 golden tests whose FILTER now uses `<uri>` instead of `"uri"`
- `src/tests/sparql-algebra.test.ts` — update any algebra tests that assert on literal_expr for entity refs
- `src/tests/sparql-negative.test.ts` — add test for `reference_expr` handling

**Tasks:**

1. Add `IRReferenceExpression` to IR type system:
   ```ts
   // In IntermediateRepresentation.ts
   export type IRReferenceExpression = {
     kind: 'reference_expr';
     value: string; // URI
   };
   ```
   Add `IRReferenceExpression` to the `IRExpression` union type.

2. Fix `lowerWhereArg()` in `IRLower.ts`:
   ```ts
   // Lines 101-106: change literal_expr → reference_expr
   if (isShapeRef(arg)) {
     return {kind: 'reference_expr', value: arg.id};
   }
   if (isNodeRef(arg)) {
     return {kind: 'reference_expr', value: (arg as NodeReferenceValue).id};
   }
   ```

3. Handle `reference_expr` in `irToAlgebra.ts`:
   - In `convertExpression()` (after the `literal_expr` case): add case for `reference_expr` that emits `{kind: 'iri_expr', value: expr.value}`.
   - In `processExpressionForProperties()`: add case for `reference_expr` (no-op, same as `literal_expr` — no property references to discover).

4. Update golden tests in `sparql-select-golden.test.ts`:
   - `whereBestFriendEquals` — FILTER now uses `<linked://tmp/entities/p3>` instead of `"linked://tmp/entities/p3"`
   - `whereWithContext` — same fix for query context entity reference
   - `customResultEqualsBoolean` — if it uses entity comparison in FILTER
   - `countEquals` — uses `.size().equals(2)` which is numeric, not affected
   - Any other golden tests with entity references in FILTER/WHERE comparisons

   For each: regenerate by running the pipeline and capture the new expected string, or manually update the `<uri>` vs `"uri"` in the expected output.

5. Update algebra tests in `sparql-algebra.test.ts` if any assert on `literal_expr` for entity references.

6. Add a negative test for unknown `reference_expr` edge cases (e.g., empty URI).

**Validation:**
- `npx tsc -p tsconfig-cjs.json --noEmit` exits 0 — clean compilation
- `npx jest --config jest.config.js` — all tests pass, including updated golden tests
- Verify `whereBestFriendEquals` golden test now produces `FILTER(?a0_bestFriend = <linked://tmp/entities/p3>)` (IRI, not string literal)
- `npm run test:fuseki` — `whereBestFriendEquals` Fuseki test now returns matching results (p2, whose bestFriend is p3)

**Commit:** `fix(sparql): use IRI references in FILTER comparisons for entity equality`

---

### Phase 8: Fix nested result grouping (traversal aliases in SELECT projection) ✅

**Status:** Complete — Added `collectTraversalAliases()` helper and traversal alias injection in `selectToAlgebra()`. Handles aggregate alias collisions. Updated 19 golden tests (SELECT line changes). All 396 tests pass.

**Depends on:** Phase 7
**Can run in parallel with:** —

**Problem:** Queries that traverse object properties and select sub-properties (e.g. `Person.select(p => p.friends.name)`) return empty nested arrays. The generated SPARQL `SELECT DISTINCT ?a0 ?a1_name` omits `?a1` (the traversal alias), so `mapNestedRows()` can't group results by traversed entity.

**Root cause:** `selectToAlgebra()` in `irToAlgebra.ts:244-276` builds the projection only from explicit `query.projection` items. Traversal aliases (from `traverse` patterns) are used as JOIN variables in the WHERE clause but never added to the SELECT projection. The result mapping in `resultMapping.ts:385` does `binding[nestedGroup.traverseAlias]` which returns `undefined` when the alias isn't projected.

**Files changed:**
- `src/sparql/irToAlgebra.ts` — add traversal aliases to projection in `selectToAlgebra()`
- `src/tests/sparql-select-golden.test.ts` — update ~20+ golden tests whose SELECT now includes traversal variables
- `src/tests/sparql-algebra.test.ts` — update algebra tests that check projection arrays
- `src/tests/sparql-fuseki.test.ts` — update `selectFriendsName` test to assert proper nested grouping

**Tasks:**

1. Modify `selectToAlgebra()` in `irToAlgebra.ts` to include traversal aliases in the projection:

   After building the initial projection from `query.projection` items (around line 275), scan `query.patterns` for `traverse` patterns and add each `pattern.to` alias as a projected variable if it's not already present.

   ```ts
   // After the projection loop, before GROUP BY inference:
   // Include traversal aliases needed for result grouping
   const projectedVars = new Set(
     projection.filter((p): p is {kind: 'variable'; name: string} => p.kind === 'variable').map(p => p.name)
   );
   for (const pattern of query.patterns) {
     if (pattern.kind === 'traverse' && !projectedVars.has(pattern.to)) {
       projection.push({kind: 'variable', name: pattern.to});
       projectedVars.add(pattern.to);
     }
   }
   ```

   Also handle nested patterns (traverse inside join/optional).

2. Write a helper to recursively collect all traversal aliases from patterns:
   ```ts
   function collectTraversalAliases(patterns: IRGraphPattern[]): string[] {
     const aliases: string[] = [];
     for (const p of patterns) {
       if (p.kind === 'traverse') aliases.push(p.to);
       if (p.kind === 'join') aliases.push(...collectTraversalAliases(p.patterns));
       if (p.kind === 'optional') aliases.push(...collectTraversalAliases([p.pattern]));
     }
     return aliases;
   }
   ```

3. Update golden tests in `sparql-select-golden.test.ts`:

   Every golden test for a fixture that involves traversals will now have the traversal variable in the SELECT clause. Affected fixtures (at minimum):
   - `selectFriends` — adds `?a1`
   - `selectFriendsName` — adds `?a1`
   - `selectNestedFriendsName` — adds `?a1 ?a2`
   - `selectMultiplePaths` — adds `?a1 ?a2`
   - `selectBestFriendName` — adds `?a1`
   - `selectDeepNested` — adds `?a1 ?a2 ?a3`
   - `selectDuplicatePaths` — adds `?a1`
   - `whereFriendsNameEquals` — adds `?a1`
   - `whereAnd` — adds `?a1`
   - `whereOr` — adds `?a1`
   - `whereAndOrAnd` — adds `?a1`
   - `whereAndOrAndNested` — adds `?a1`
   - `outerWhere` — adds `?a1`
   - `subSelectSingleProp` — adds `?a1`
   - `subSelectPluralCustom` — adds `?a1`
   - `subSelectAllProperties` — adds `?a1`
   - `subSelectAllPropertiesSingle` — adds `?a1`
   - `doubleNestedSubSelect` — adds `?a1 ?a2`
   - `subSelectAllPrimitives` — adds `?a1`
   - `subSelectArray` — adds `?a1`
   - `nestedObjectProperty` — adds `?a1`
   - `nestedObjectPropertySingle` — adds `?a1`
   - `nestedQueries2` — adds `?a1 ?a2`
   - `countNestedFriends` — may need `?a1` in GROUP BY
   - `countLabel` — adds `?a1`
   - `selectShapeSetAs` — adds `?a1`
   - `selectShapeAs` — adds `?a1`
   - `preloadBestFriend` — adds `?a1`

   For each: regenerate by running the pipeline and capturing new output, then update the `toBe()` expected string. The change is mechanical: insert the traversal variable(s) into the `SELECT DISTINCT` clause.

4. Update algebra tests in `sparql-algebra.test.ts` that verify the `projection` array of `SparqlSelectPlan` objects. The projection will now include additional `{kind: 'variable', name: 'a1'}` entries.

5. Update `selectFriendsName` test in `sparql-fuseki.test.ts`:
   - Remove the "known nesting limitation" comment
   - Assert proper nested grouping: `p1.friends` should contain `[{id: ...p2, name: 'Moa'}, {id: ...p3, name: 'Jinx'}]`
   - Match the OLD test pattern: `expect(first.friends[0].name).toBe('Moa')`

6. Handle GROUP BY interaction: when aggregates are present AND traversal aliases are added, ensure traversal aliases are included in the GROUP BY clause (they must be, since they're non-aggregate projected variables). Verify with `countNestedFriends` fixture.

**Validation:**
- `npx tsc -p tsconfig-cjs.json --noEmit` exits 0 — clean compilation
- `npx jest --config jest.config.js` — all tests pass, including all updated golden tests
- `selectFriendsName` golden test now includes `?a1` in SELECT: `SELECT DISTINCT ?a0 ?a1 ?a1_name WHERE { ... }`
- `npm run test:fuseki` — `selectFriendsName` test now returns properly nested results with friend names
- Manually verify 2-3 other nesting fixtures produce correct SPARQL by inspecting golden test output

**Commit:** `fix(sparql): include traversal aliases in SELECT projection for nested result grouping`

---

### Phase 9: Full Fuseki coverage — all 75 fixtures end-to-end ✅

**Status:** Complete

**Depends on:** Phase 8 (both limitations must be fixed first)
**Can run in parallel with:** —

**Problem:** Only 19 of 74 fixtures are tested end-to-end against Fuseki. The OLD test suite ran all query fixtures against a live SPARQL store with full result-type validation. We need parity.

**Approach:** Expand `sparql-fuseki.test.ts` to cover all 74 fixtures (55 select + 19 mutation). Follow the OLD test assertion patterns: validate array/object types, specific field values, nested structure, type coercion (Date, boolean, number), null/undefined for missing values, and correct entity URI references.

**Files changed:**
- `src/tests/sparql-fuseki.test.ts` — add ~55 new test cases
- `src/test-helpers/fuseki-test-store.ts` — add any needed helpers (e.g., for verifying mutation results)

**Test data additions needed:**
The existing TEST_DATA covers p1-p4, dog1-dog2 with most properties. Additional data may be needed for:
- `p1.hobby = "Reading"` — already present
- `p2.hobby = "Jogging"` — already present
- `p1.bestFriend` — NOT present (p2.bestFriend = p3 is present). Add `<p1> bestFriend <p2>` if needed for bestFriend traversal tests
- Employee class data — add `emp1` entity for `selectAllEmployeeProperties`

**Tasks:**

1. Add any missing test data to `TEST_DATA` in `sparql-fuseki.test.ts`:
   - Add Employee entities if `selectAllEmployeeProperties` fixture needs them
   - Add `p1.bestFriend` if bestFriend traversal tests need it for p1
   - Verify all existing entity relationships match what the OLD tests expected

2. Add SELECT fixture tests — **Basic property selection** group:
   - `selectByIdReference` — same as selectById, assert single object with `name: 'Semmy'`
   - `selectUndefinedOnly` — select `[p.hobby, p.bestFriend]` for p3 (no hobby, no bestFriend) → assert both null
   - `selectOne` — `.one()` modifier, assert single object (not array), not null

3. Add SELECT fixture tests — **Nested path selection** group:
   - `selectFriendsName` — (already exists, update after Phase 8): assert `p1.friends` has `[{name:'Moa'}, {name:'Jinx'}]`
   - `selectNestedFriendsName` — `p.friends.friends.name`: assert p1→friends→[p2→friends→[p3,p4 names], p3→friends→[]]
   - `selectMultiplePaths` — `[p.name, p.friends, p.bestFriend.name]`: assert name, friends array, bestFriend nested name
   - `selectBestFriendName` — `p.bestFriend.name`: assert p2.bestFriend has `{name:'Jinx'}`
   - `selectDeepNested` — `p.friends.bestFriend.bestFriend.name`: deep 3-level traversal
   - `selectDuplicatePaths` — `[p.bestFriend.name, p.bestFriend.hobby, p.bestFriend.isRealPerson]`: multiple props of same traversal
   - `nestedObjectProperty` — `p.friends.bestFriend`: assert nested entity references
   - `nestedObjectPropertySingle` — same query, same assertions

4. Add SELECT fixture tests — **Where/filter** group:
   - `whereFriendsNameEquals` — `p.friends.where(f => f.name.equals('Moa'))`: assert p1 has 1 matching friend (Moa)
   - `whereBestFriendEquals` — (already exists, update): now assert returns [p2] (bestFriend=p3)
   - `whereAnd` — `f.name.equals('Moa').and(f.hobby.equals('Jogging'))`: assert p1 has 1 matching friend
   - `whereOr` — `f.name.equals('Jinx').or(f.hobby.equals('Jogging'))`: assert p1 has 2 matching friends
   - `whereAndOrAnd` — complex boolean: assert correct friend filtering
   - `whereAndOrAndNested` — nested boolean: assert correct friend filtering
   - `whereSomeImplicit` — `p.friends.name.equals('Moa')`: assert [p1] returned
   - `whereSomeExplicit` — `p.friends.some(f => f.name.equals('Moa'))`: assert [p1] returned
   - `whereEvery` — `p.friends.every(f => f.name.equals('Moa').or(f.name.equals('Jinx')))`: assert [p1]
   - `whereSequences` — `p.friends.some(f => f.name.equals('Jinx')).and(p.name.equals('Semmy'))`: assert [p1]
   - `outerWhere` — `Person.select(p => p.friends).where(p => p.name.equals('Semmy'))`: assert [p1 with friends]
   - `whereWithContext` — `.where(p => p.bestFriend.equals(getQueryContext('user')))`: assert [p2] (p2.bestFriend=p3=user context)
   - `whereWithContextPath` — `.where(p => p.friends.some(f => f.name.equals(userName)))`: assert p1, p2 (friends named Jinx)

5. Add SELECT fixture tests — **Aggregation & subselect** group:
   - `countNestedFriends` — `p.friends.friends.size()`: assert nested count
   - `countLabel` — `p.friends.select(f => ({numFriends: f.friends.size()}))`: assert custom label
   - `subSelectSingleProp` — `p.bestFriend.select(f => ({name: f.name}))`: assert nested select result
   - `subSelectPluralCustom` — `p.friends.select(f => ({name: f.name, hobby: f.hobby}))`: assert multiple nested fields
   - `subSelectAllProperties` — `p.friends.selectAll()`: assert all friend properties present
   - `subSelectAllPropertiesSingle` — `p.bestFriend.selectAll()`: assert single nested entity with all props
   - `doubleNestedSubSelect` — `p.friends.select(p2 => p2.bestFriend.select(p3 => ({name: p3.name})))`: assert 2 levels deep
   - `subSelectAllPrimitives` — `p.bestFriend.select(f => [f.name, f.birthDate, f.isRealPerson])`: assert type coercion in nested select
   - `subSelectArray` — `p.friends.select(f => [f.name, f.hobby])`: assert array of nested with multiple fields
   - `customResultEqualsBoolean` — `({isBestFriend: p.bestFriend.equals(entity('p3'))})`: assert boolean result
   - `customResultNumFriends` — `({numFriends: p.friends.size()})`: assert numeric result with custom key
   - `countEquals` — `.where(p => p.friends.size().equals(2))`: assert filter by count (p1 and p2 have 2 friends)

6. Add SELECT fixture tests — **Type coercion & special** group:
   - `selectShapeSetAs` — `p.pets.as(Dog).guardDogLevel`: assert number type for guardDogLevel
   - `selectShapeAs` — `p.firstPet.as(Dog).guardDogLevel`: assert single pet with number
   - `selectAllEmployeeProperties` — `Employee.selectAll()`: add Employee test data, assert Employee properties
   - `selectNonExistingMultiple` — `[p.bestFriend, p.friends]`: verify null handling for missing values
   - `nestedQueries2` — complex nested: `[p.friends.select(p2 => [p2.firstPet, p2.bestFriend.select(p3 => ({name: p3.name}))])]`

7. Add MUTATION fixture tests (expand beyond the 3 existing):
   - `createWithFriends` — insert and verify nested creates + references
   - `createWithFixedId` — insert with deterministic ID, verify exact URI
   - `updateOverwriteSet` — overwrite friends array, verify
   - `updateUnsetSingleUndefined` — unset hobby, verify removed
   - `updateUnsetSingleNull` — unset hobby with null, verify removed
   - `updateOverwriteNested` — overwrite bestFriend with nested create, verify
   - `updatePassIdReferences` — update bestFriend to existing entity ref, verify
   - `updateAddRemoveMulti` — add/remove friends, verify
   - `updateRemoveMulti` — remove friend, verify
   - `updateAddRemoveSame` — add and remove in same op, verify
   - `updateUnsetMultiUndefined` — unset friends set, verify
   - `updateNestedWithPredefinedId` — nested create with fixed ID, verify
   - `updateBirthDate` — update date field, verify date coercion
   - `deleteSingleRef` — same as deleteSingle but via ref
   - `deleteMultiple` — delete two entities, verify both removed
   - `deleteMultipleFull` — same

   Each mutation test must:
   - Execute the generated SPARQL against Fuseki
   - Verify the mutation took effect (SELECT query to check)
   - Clean up / restore test data (so tests are independent)

8. Add result-type assertion helpers:
   ```ts
   function assertResultRow(row: ResultRow, expected: Record<string, any>): void {
     for (const [key, val] of Object.entries(expected)) {
       if (val === null) {
         expect(row[key]).toBeNull();
       } else if (val instanceof Date) {
         expect(row[key]).toBeInstanceOf(Date);
         expect((row[key] as Date).getTime()).toBe(val.getTime());
       } else if (typeof val === 'boolean') {
         expect(row[key]).toBe(val);
       } else if (typeof val === 'number') {
         expect(row[key]).toBe(val);
       } else if (typeof val === 'string') {
         expect(row[key]).toBe(val);
       }
     }
   }
   ```

**Validation:**
- `npx tsc -p tsconfig-cjs.json --noEmit` exits 0
- `npm run test:fuseki` — all ~74 integration tests pass against live Fuseki
- `npx jest --config jest.config.js` — all existing tests still pass
- Every fixture from `queryFactories` has a corresponding Fuseki test
- Result type assertions match the OLD test patterns:
  - Arrays checked with `Array.isArray()`
  - Single results checked with `!Array.isArray()`
  - Dates checked with `instanceof Date` + value comparison
  - Booleans checked with strict `=== true` / `=== false`
  - Numbers checked with `=== number`
  - Null/undefined checked for missing optional fields
  - Nested objects checked for `.id` and sub-properties
  - Entity URIs checked with `.toContain()` for fragment matching

**Commit:** `test(sparql): expand Fuseki integration to all 75 query fixtures with full result-type validation`

**Completion notes:**
- Expanded from 19 → 75 test cases (56 SELECT + 19 mutation)
- Added Employee test data (e1, e2) for selectAllEmployeeProperties
- Updated selectFriendsName and whereBestFriendEquals tests — removed "known limitation" comments (fixed in Phases 7/8)
- 3 fixtures produce known-invalid SPARQL (whereEvery, whereSequences, countEquals) → tested generation only, Fuseki execution skipped
- 5 inline-where fixtures produce valid SPARQL with missing filters → tested pipeline execution
- All 452 tests pass, TypeScript compiles clean

---

**Dependency graph for Phases 7-9:**
```
Phase 7 (URI-vs-literal fix)
  ↓
Phase 8 (nested grouping fix) — depends on 7 because golden tests touched in both; sequential avoids merge conflicts
  ↓
Phase 9 (full Fuseki coverage) — depends on 8 because both limitations must be fixed before meaningful E2E validation
```

Phases 7 and 8 are sequential (not parallel) because they both modify the same golden test files. Running them in parallel would create merge conflicts. Phase 9 must wait for both fixes.

---

### Phase 10: Recursive nesting in result mapping

**Status:** Complete

**Depends on:** Phase 9
**Can run in parallel with:** —

**Problem:** `resultMapping.ts` only supports one level of nesting. `buildNestingDescriptor()` creates flat `nestedGroups` keyed by the immediate traverse from root. For multi-level traversals like `selectNestedFriendsName` (friends.friends.name) or `doubleNestedSubSelect` (friends→bestFriend→name), intermediate nesting levels are flattened — a2 entities end up grouped directly under the root instead of nested under their parent a1 entity.

**Root cause:** The `NestingDescriptor` type is flat:
```ts
type NestingDescriptor = {
  rootVar: string;
  flatFields: Array<{key, sparqlVar, expression}>;
  nestedGroups: Array<{key, traverseAlias, fields: Array<{key, sparqlVar, expression}>}>;
};
```
There is no recursive `nestedGroups[].nestedGroups` structure. The walk-up logic in `buildNestingDescriptor()` (lines 209-214) finds the immediate child of root but doesn't track the full traversal chain.

**Affected fixtures:**
- `selectNestedFriendsName` — friends.friends.name (a0→a1→a2)
- `doubleNestedSubSelect` — friends.select(f => f.bestFriend.select(…)) (a0→a1→a2)
- `selectDeepNested` — friends.bestFriend.bestFriend.name (a0→a1→a2→a3)
- `nestedQueries2` — friends.select(f => [f.firstPet, f.bestFriend.select(…)]) (a0→a1, a1→a2)

**Approach:**

Make `NestingDescriptor` recursive. Each `nestedGroup` can itself contain `nestedGroups`:
```ts
type NestedGroup = {
  key: string;
  traverseAlias: string;
  fields: Array<{key, sparqlVar, expression}>;
  nestedGroups: NestedGroup[];  // recursive
};
```

In `buildNestingDescriptor()`, instead of walking up to root and grouping everything flat, build a tree of nested groups matching the traversal chain. In `mapNestedRows()`, recursively descend the tree, grouping bindings at each level.

**Files changed:**
- `src/sparql/resultMapping.ts` — recursive NestingDescriptor, recursive mapNestedRows

**Open questions:**
- **Q10a:** Should we handle mixed nesting (some fields flat on an intermediate entity, some nested further)? Example: `friends.select(f => [f.name, f.bestFriend.name])` has both a flat field (name on a1) and a deeper nested field (name on a2). The current model would need each intermediate group to have both `fields` and `nestedGroups`.
  - **Recommendation:** Yes, this is required. The proposed recursive `NestedGroup` type already supports it naturally — each group has both `fields` (flat on that entity) and `nestedGroups` (deeper nesting). The fixture `nestedQueries2` explicitly uses this pattern: `friends.select(f => [f.firstPet, f.bestFriend.select(...)])` has both a flat object property and a deeper nested sub-select on the same intermediate entity.
- **Q10b:** How should multi-level nesting interact with single-value traversals (maxCount=1) vs multi-value (friends)? For single-value traversals like `bestFriend.bestFriend.name`, should the result be `{bestFriend: {bestFriend: {name: "..."}}}` or flattened?
  - **Recommendation:** Preserve nesting structure regardless of cardinality. Single-value traversals should produce a single nested object (`{bestFriend: {bestFriend: {name: "..."}}}`) while multi-value produce arrays. The cardinality information (maxCount) is already available in the IR through `PropertyShape`. The result mapping layer should use this to decide between wrapping in an array vs returning a single object, but the nesting depth should always match the traversal depth. This is consistent with how the OLD tests assert nested results.
- **Q10c:** Performance concern: for deeply nested queries (3+ levels), the recursive grouping could create many intermediate objects. Is this acceptable, or should we cap nesting depth?
  - **Recommendation:** No depth cap needed. Practical queries rarely exceed 3-4 levels of nesting, and the recursive grouping overhead is negligible compared to the SPARQL query execution cost. The row count from Fuseki is the real bottleneck, not the JS grouping. If performance becomes an issue later, it can be addressed with lazy construction, but pre-optimizing here adds complexity without benefit.

**Implementation details:**

*1. Make `NestingDescriptor` recursive — `src/sparql/resultMapping.ts`*

Replace the flat type (lines 141-160) with:
```ts
type FieldDescriptor = {
  key: string;
  sparqlVar: string;
  expression: IRExpression;
};

type NestedGroup = {
  key: string;            // result key (e.g. "friends", "bestFriend")
  traverseAlias: string;  // SPARQL variable to group by (e.g. "a1")
  fields: FieldDescriptor[];
  nestedGroups: NestedGroup[];
};

type NestingDescriptor = {
  rootVar: string;
  flatFields: FieldDescriptor[];
  nestedGroups: NestedGroup[];
};
```

*2. Rewrite `buildNestingDescriptor()` — `src/sparql/resultMapping.ts` lines 166-239*

Current logic (lines 209-214) walks UP the traversal chain to find the immediate child of root, then groups everything flat at that level. This needs to build a tree instead:

```ts
// For each field, build the full alias chain from root to the source alias.
// Example: friends.bestFriend.name → chain is [a1, a2], field is on a2.
//
// Algorithm:
//   1. For each resultMap entry, determine its sourceAlias from the expression.
//   2. Build the alias chain: walk traverseMap from sourceAlias back to root,
//      collecting [a2, a1] (reversed) → then reverse to get [a1, a2].
//   3. Walk the chain through the NestedGroup tree, creating groups as needed.
//   4. Attach the field to the group corresponding to its sourceAlias.
function buildAliasChain(
  sourceAlias: string,
  rootAlias: string,
  traverseMap: Map<string, {from: string; property: string}>,
): Array<{alias: string; property: string}> {
  const chain: Array<{alias: string; property: string}> = [];
  let current = sourceAlias;
  while (current !== rootAlias) {
    const info = traverseMap.get(current);
    if (!info) break;
    chain.unshift({alias: current, property: info.property});
    current = info.from;
  }
  return chain;
}
```

Then walk the chain through the tree to insert each field at the correct depth:
```ts
function insertIntoTree(
  root: {flatFields: FieldDescriptor[]; nestedGroups: NestedGroup[]},
  chain: Array<{alias: string; property: string}>,
  field: FieldDescriptor,
): void {
  if (chain.length === 0) {
    root.flatFields.push(field);
    return;
  }
  // Find or create group for chain[0]
  let group = root.nestedGroups.find(g => g.traverseAlias === chain[0].alias);
  if (!group) {
    group = {
      key: localName(chain[0].property),
      traverseAlias: chain[0].alias,
      fields: [],
      nestedGroups: [],
    };
    root.nestedGroups.push(group);
  }
  // Recurse with remaining chain
  insertIntoTree(group, chain.slice(1), field);
}
```

*3. Rewrite `mapNestedRows()` — `src/sparql/resultMapping.ts` lines 339-415*

Make it recursive. Extract a helper that processes a single nesting level:

```ts
function groupBindings(
  bindings: SparqlBinding[],
  groupAlias: string,
  fields: FieldDescriptor[],
  nestedGroups: NestedGroup[],
): ResultRow[] {
  // Group bindings by the groupAlias variable
  const groups = new Map<string, {first: SparqlBinding; all: SparqlBinding[]}>();
  for (const binding of bindings) {
    const val = binding[groupAlias];
    if (!val) continue;
    const id = val.value;
    let group = groups.get(id);
    if (!group) {
      group = {first: binding, all: []};
      groups.set(id, group);
    }
    group.all.push(binding);
  }

  const rows: ResultRow[] = [];
  for (const [id, group] of groups) {
    const row: ResultRow = {id};
    // Flat fields from first binding
    for (const field of fields) {
      const val = group.first[field.sparqlVar];
      row[field.key] = val ? (val.type === 'uri' ? {id: val.value} : coerceValue(val)) : null;
    }
    // Recursively process nested groups
    for (const nested of nestedGroups) {
      row[nested.key] = groupBindings(
        group.all,
        nested.traverseAlias,
        nested.fields,
        nested.nestedGroups,
      );
    }
    rows.push(row);
  }
  return rows;
}
```

*4. Things to consider:*
- The `isUriExpression()` check (line 133-135) should be preserved in the recursive helper for correct type coercion.
- The current `mapFlatRows()` function should remain unchanged — it handles the no-nesting case efficiently.
- The `mapSparqlSelectResult()` entry point (lines 255-289) dispatches to `mapFlatRows` or `mapNestedRows` — this stays the same.
- Test with `selectNestedFriendsName` (3 levels: a0→a1→a2) and `nestedQueries2` (mixed: a1 has both flat field and sub-group) to verify correctness.

---

### Phase 11: Tighten Fuseki test assertions to OLD test depth

**Status:** Complete

**Depends on:** Phase 10 (nesting must work before asserting nested structure), Phase 12, 13, 14 (recommended — fixes produce correct results before tightening assertions)
**Can run in parallel with:** —

**Problem:** The OLD tests in `OLD/src/tests/query-tests.tsx` had precise assertions:
- Exact array lengths (`expect(names.length).toBe(4)`)
- Specific field values per entity (`expect(first.friends[0].name).toBe('Moa')`)
- Deep nested structure checks (`expect(first.friends[0].friends.some(f => f.id == p3.uri)).toBe(true)`)
- Type coercion precision (`expect(typeof firstResult.birthDate === 'object').toBe(true)`)
- Full null/undefined handling per entity

The current Fuseki tests use defensive patterns: `length >= 1`, `toBeDefined()`, structural checks. This gives lower confidence that the full pipeline produces correct results for all fixtures.

**Approach:** Systematically go through each Fuseki test and replace defensive assertions with precise ones matching OLD test patterns. For each test:
1. Determine exact expected results from test data
2. Assert exact array lengths
3. Assert specific field values per entity
4. For nested results (after Phase 10), assert nested structure depth and content
5. Verify type coercion (Date objects, boolean primitives, number types)

**Files changed:**
- `src/tests/sparql-fuseki.test.ts` — tighten all assertions

**Open questions:**
- **Q11a:** Should we tighten ALL 75 tests, or only the ones where we're confident the SPARQL is semantically correct? The 5 inline-where fixtures (Gap B) and 3 invalid-SPARQL fixtures (Gap C) produce known-incorrect results — tightening assertions on those would just assert the wrong behavior.
  - **Recommendation:** Only tighten the tests where SPARQL is semantically correct (~60 fixtures). The 5 inline-where fixtures should be tightened after Phase 12 fixes them, and the 3 invalid-SPARQL fixtures after Phase 13. This avoids encoding wrong behavior as expected. Phase 11 should come after 12 and 13 in the dependency graph, or at minimum mark those 8 tests with `// TODO: tighten after Phase 12/13` comments.
- **Q11b:** Should the tightened tests depend on Fuseki being available (as now), or should we also add non-Fuseki assertion tests that use hand-crafted SPARQL JSON to test result mapping in isolation? The latter would run in CI without Docker.
  - **Recommendation:** Add non-Fuseki result-mapping tests using hand-crafted SPARQL JSON bindings. These would test `mapNestedRows()` and `mapFlatRows()` in isolation without Docker, providing CI coverage for the result-mapping layer. Keep the Fuseki tests as end-to-end verification. The hand-crafted tests are especially valuable for Phase 10 (recursive nesting) since they can test arbitrary nesting depths with predictable input. These could live in a separate file like `src/tests/sparql-result-mapping.test.ts`.
- **Q11c:** For nested structure assertions, should we use exact object matching (`toEqual`) or continue with field-by-field assertions? Exact matching is more thorough but more brittle to future changes.
  - **Recommendation:** Use `toEqual` for leaf values and structural shape, but field-by-field for the overall result. Specifically: assert exact array lengths, assert specific field values with `toBe`/`toEqual`, and assert nested object shapes structurally. Avoid `toEqual` on the entire result object because it breaks when new fields are added to the result shape. The OLD tests use this approach — they check `length`, then access specific elements by index and assert individual fields.

**Implementation details:**

*1. Add result-mapping unit tests — new file `src/tests/sparql-result-mapping.test.ts`*

Test `mapSparqlSelectResult()`, `mapFlatRows()`, and the recursive `mapNestedRows()` with hand-crafted SPARQL JSON bindings. This file runs in CI without Docker. Example:
```ts
import {mapSparqlSelectResult, SparqlJsonResults} from '../sparql/resultMapping';
import {IRSelectQuery} from '../queries/IntermediateRepresentation';

describe('result mapping', () => {
  it('maps flat rows with type coercion', () => {
    const json: SparqlJsonResults = {
      head: {vars: ['a0', 'a0_name', 'a0_birthDate']},
      results: {bindings: [
        {a0: {type: 'uri', value: 'urn:p1'}, a0_name: {type: 'literal', value: 'Semmy'}, a0_birthDate: {type: 'literal', value: '2020-01-01T00:00:00Z', datatype: 'http://www.w3.org/2001/XMLSchema#dateTime'}},
      ]},
    };
    // Build matching IRSelectQuery...
    const result = mapSparqlSelectResult(json, query);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Semmy');
    expect(result[0].birthDate).toBeInstanceOf(Date);
  });

  it('groups 2-level nesting (friends.name)', () => { /* ... */ });
  it('groups 3-level nesting (friends.bestFriend.name)', () => { /* ... */ });
  it('handles mixed nesting (flat + nested on same group)', () => { /* ... */ });
});
```

*2. Tighten Fuseki test assertions — `src/tests/sparql-fuseki.test.ts`*

For each test, derive exact expected values from the test data constants at the top of the file. The test data has:
- p1 (Semmy): hobby=Jogging, friends=[p2,p3], bestFriend=p3, birthDate=1990-01-01, isRealPerson=false, pets=[]
- p2 (Moa): hobby=Jogging, friends=[p1,p3], bestFriend=p1, birthDate=1995-06-15, isRealPerson=true, pets=[pet1]
- p3 (Jinx): hobby=Chess, friends=[p1], bestFriend=p2, isRealPerson=true
- pet1: bestFriend=pet1 (self)
- dog1: guardDogLevel=5, bestFriend=pet1
- e1 (Alice): department=Engineering, bestFriend=e2
- e2 (Bob): department=Sales

Example tightening pattern (before/after):
```ts
// BEFORE:
expect(result.length).toBeGreaterThanOrEqual(1);
expect(result[0]).toHaveProperty('name');

// AFTER:
expect(result).toHaveLength(4); // p1, p2, p3, and one more
const semmy = result.find(r => r.name === 'Semmy');
expect(semmy).toBeDefined();
expect(semmy.name).toBe('Semmy');
```

*3. Things to consider:*
- Order of results from Fuseki is not guaranteed unless ORDER BY is used. Use `find()` rather than index-based access for unordered queries.
- For ordered queries (`sortByAsc`, `sortByDesc`), index-based access is appropriate.
- For nested arrays (friends), sort by a predictable key (id or name) before asserting order.
- Mark the 8 known-broken fixtures with `// TODO: tighten after Phase 12/13` rather than asserting wrong behavior.
- The non-Fuseki result-mapping tests can be developed before or in parallel with Phases 10-14, since they use hand-crafted input.

---

### Phase 12: Inline where filter lowering (IR pipeline)

**Status:** Complete

**Depends on:** Phase 9
**Can run in parallel with:** Phase 10, Phase 13, Phase 14

**Problem:** 5 fixtures produce valid SPARQL but with inline `.where()` predicates silently dropped:
- `whereFriendsNameEquals` — `p.friends.where(f => f.name.equals('Moa'))` → no FILTER
- `whereAnd` — `p.friends.where(f => f.name.equals('Moa').and(f.hobby.equals('Jogging')))` → no FILTER
- `whereOr` — `p.friends.where(f => f.name.equals('Jinx').or(f.hobby.equals('Jogging')))` → no FILTER
- `whereAndOrAnd` — compound boolean → no FILTER
- `whereAndOrAndNested` — nested compound boolean → no FILTER

**Root cause analysis:**

The IR pipeline preserves the where predicate during desugaring:
```
DSL: p.friends.where(f => f.name.equals('Moa'))
  → IRDesugar: DesugaredPropertyStep { kind: 'property_step', propertyShapeId, where: DesugaredWhere }
```

But the predicate is **never processed** after that point:
1. `IRCanonicalize.ts` only canonicalizes `query.where` (the top-level outer where), not `DesugaredPropertyStep.where` embedded in selections
2. `IRLower.ts` only processes `canonical.where` and `evaluation_select.where` — it does not inspect property step where predicates
3. Result: the where predicate is silently discarded when the selection path is lowered to an IR expression

**Approach — two options:**

**Option A: Propagate inline where to IR filter expressions**
In `IRLower.ts`, when lowering a selection path that contains property steps with `.where`, convert the where predicate to an IR filter expression attached to the traversal. This means:
- Walking the selection path steps
- When a step has `.where`, canonicalize it and lower it to an IR expression
- Attach the expression as a FILTER on the traversal pattern (like the existing `exists_expr` pattern)

This would change the IR output for these fixtures, requiring golden test updates.

**Option B: Lower inline where to EXISTS subpattern**
Convert inline `.where()` to an EXISTS check at the SPARQL level:
```sparql
-- Instead of just: ?a0 <P/friends> ?a0_friends .
-- Produce: ?a0 <P/friends> ?a0_friends . FILTER EXISTS { ?a0_friends <P/name> ?name . FILTER(?name = "Moa") }
```

This keeps the traversal as-is but adds a FILTER EXISTS to restrict which values match.

**Files changed:**
- `src/queries/IRLower.ts` or `src/queries/IRCanonicalize.ts` — propagate inline where
- `src/sparql/irToAlgebra.ts` — may need changes if IR output changes
- `src/tests/sparql-select-golden.test.ts` — update 5+ golden tests
- `src/tests/sparql-fuseki.test.ts` — update 5 tests with real assertions

**Open questions:**
- **Q12a:** Option A or Option B? Option A is cleaner (filter at IR level) but requires deeper changes to the lowering pipeline. Option B is more localized (SPARQL-layer workaround) but produces more complex SPARQL.
  - **Recommendation:** Option A (IR-level). The `DesugaredPropertyStep.where` is already preserved during desugaring (populated via `toWhere()` in `IRDesugar.ts` line 182). The fix should be in `IRLower.ts`: when lowering a selection path that contains a property step with `.where`, canonicalize the where predicate and lower it to an IR filter expression attached to the traversal. This keeps the filter logic in the IR layer where all other filter processing happens, rather than leaking semantic interpretation into the SPARQL algebra layer. The SPARQL output will be a FILTER inside the pattern block for that traversal, which is clean standard SPARQL.
- **Q12b:** Should the inline where restrict the set of returned values (only return friends matching the filter) or the set of root entities (return persons who have at least one friend matching)? The OLD tests would clarify the expected semantics.
  - **Recommendation:** Restrict the returned values. The OLD tests confirm this unambiguously:
    - `"can use where() to filter a string"` (OLD line 524): `p.friends.where(f => f.name.equals('Moa'))` → asserts `first.friends.length === 1` and `first.friends[0].id === p2.uri` — only the matching friend is returned
    - `"where and"` (OLD line 564): asserts `first.friends.length === 1` — only friends matching both conditions
    - `"where or"` (OLD line 580): asserts `first.friends.length === 2` — friends matching either condition
    - `"where on literal"` (OLD line 552): `p.hobby.where(h => h.equals(p2.hobby))` → asserts `p1Result.hobby` is undefined when it doesn't match

    In SPARQL terms, this means the where predicate should be a FILTER on the traversal variable within the OPTIONAL block, not an outer EXISTS pattern. The OPTIONAL ensures the variable binding is absent when the filter doesn't match, which maps to undefined/null in the result.
- **Q12c:** Does this overlap with the `some()` / `every()` quantifier handling? The DSL `p.friends.where(f => ...)` may be semantically equivalent to `p.friends.some(f => ...)`. If so, should the desugar pass normalize `.where()` to `.some()` first?
  - **Recommendation:** They are semantically different and should remain separate. `.where()` filters which values are returned for a property (value-level filtering), while `.some()` is a boolean existence check used in outer WHERE clauses (entity-level filtering). Example: `p.friends.where(f => f.name.equals('Moa'))` returns only friends named Moa. `p.friends.some(f => f.name.equals('Moa'))` returns true/false for whether any friend is named Moa. They produce different SPARQL patterns: `.where()` → FILTER inside the traversal OPTIONAL; `.some()` → EXISTS subquery in WHERE. No normalization should occur.

**Implementation details:**

*1. Where the fix goes — `src/queries/IRProjection.ts` `lowerSelectionPathExpression()` (lines 36-77)*

This is the function that converts `DesugaredSelectionPath` → `IRExpression`. Currently it iterates through steps, creating traversals for intermediate property steps and returning a `property_expr` for the last step. It completely ignores `step.where`. The fix adds inline where processing here.

Current code (simplified):
```ts
for (let i = 0; i < path.steps.length; i++) {
  const step = path.steps[i];
  if (step.kind === 'property_step') {
    if (isLast) {
      return {kind: 'property_expr', sourceAlias: currentAlias, property: step.propertyShapeId};
    }
    currentAlias = options.resolveTraversal(currentAlias, step.propertyShapeId);
    // ← step.where is never checked here
  }
}
```

*2. Approach: attach inline filter to IR traversal patterns*

When a property step has `.where`, we need to:
1. Canonicalize the where predicate: `canonicalizeWhere(step.where)`
2. Lower it to an IR expression using the traversed alias as root
3. Attach the resulting filter to the traversal pattern

The challenge is that `lowerSelectionPathExpression()` only returns an `IRExpression` — it doesn't have a way to attach side-effect patterns. The patterns are accumulated in `LoweringContext` in `IRLower.ts` via `getOrCreateTraversal()`.

**Option A (recommended): Collect inline filters in LoweringContext**

Add a `inlineFilters` map to `LoweringContext`:
```ts
class LoweringContext {
  // ... existing fields ...
  private inlineFilters = new Map<string, IRExpression[]>(); // traverseAlias → filters

  addInlineFilter(traverseAlias: string, filter: IRExpression): void {
    const existing = this.inlineFilters.get(traverseAlias) || [];
    existing.push(filter);
    this.inlineFilters.set(traverseAlias, existing);
  }

  getInlineFilters(): Map<string, IRExpression[]> {
    return this.inlineFilters;
  }
}
```

Then in `lowerSelectionPathExpression()` (or a wrapper called from `collectProjectionSeeds`), when a step has `.where`:
```ts
if (step.kind === 'property_step' && step.where) {
  const traverseAlias = options.resolveTraversal(currentAlias, step.propertyShapeId);
  const canonical = canonicalizeWhere(step.where);
  const filterExpr = lowerWhere(canonical, ctx, {
    rootAlias: traverseAlias,
    resolveTraversal: options.resolveTraversal,
  });
  ctx.addInlineFilter(traverseAlias, filterExpr);
  currentAlias = traverseAlias;
}
```

*3. Consuming inline filters in `irToAlgebra.ts`*

In `selectToAlgebra()`, after building the algebra tree (step 4), check for inline filters. For each traverse triple that has inline filters, wrap the OPTIONAL with a FILTER inside it:

```ts
// Current: OPTIONAL { ?a0 <P/friends> ?a1 . }
// With filter: OPTIONAL { ?a0 <P/friends> ?a1 . ?a1 <P/name> ?a1_name . FILTER(?a1_name = "Moa") }
```

This requires either:
- Adding an `inlineFilters` field to `IRSelectQuery` (passed from lowering)
- Or attaching filters to the `IRTraversePattern` itself

The cleaner approach is to add `filter?: IRExpression` to `IRTraversePattern`:
```ts
// In IntermediateRepresentation.ts:
export type IRTraversePattern = {
  kind: 'traverse';
  from: string;
  to: string;
  property: string;
  filter?: IRExpression;  // ← NEW: inline where filter
};
```

Then in `irToAlgebra.ts` `processPattern()`, when a traverse has a filter, include it inside the OPTIONAL block by using `wrapOptional()` with a `SparqlFilter` node.

*4. Expected SPARQL output for `whereFriendsNameEquals`:*
```sparql
SELECT DISTINCT ?a0 ?a1
WHERE {
  ?a0 rdf:type <P> .
  OPTIONAL {
    ?a0 <P/friends> ?a1 .
    ?a1 <P/name> ?a1_name .
    FILTER(?a1_name = "Moa")
  }
}
```

The FILTER inside OPTIONAL means: the OPTIONAL succeeds only when the friend's name is "Moa". Friends not matching are excluded (their bindings are null).

*5. Files changed (refined):*
- `src/queries/IntermediateRepresentation.ts` — add `filter?: IRExpression` to `IRTraversePattern`
- `src/queries/IRProjection.ts` or `src/queries/IRLower.ts` — process `step.where` during lowering
- `src/sparql/irToAlgebra.ts` — emit FILTER inside OPTIONAL for filtered traversals
- `src/tests/sparql-select-golden.test.ts` — update 5 golden tests
- `src/tests/sparql-fuseki.test.ts` — update 5 tests with precise assertions

*6. Things to consider:*
- The inline where's predicate may reference properties on the traversed entity that need their own OPTIONAL triples inside the block. For `f.name.equals('Moa')`, the property triple `?a1 <P/name> ?a1_name` must be inside the OPTIONAL, not outside.
- For compound filters (`.where(f => f.name.equals('Moa').and(f.hobby.equals('Jogging')))`), multiple property triples may be needed inside the OPTIONAL.
- The `processExpressionForProperties()` function in `irToAlgebra.ts` discovers property triples — but they currently go to the outer `optionalPropertyTriples` list. Filtered traversals need their property triples co-located inside the OPTIONAL block.
- This is the most architecturally significant change of all phases 10-14 because it modifies the IR shape and the SPARQL algebra construction pattern. Plan carefully around the interaction with existing OPTIONAL wrapping logic.

---

### Phase 13: Fix invalid SPARQL generation (3 fixtures)

**Status:** Complete

**Depends on:** Phase 9
**Can run in parallel with:** Phase 10, Phase 12, Phase 14

**Problem:** 3 fixtures produce syntactically invalid SPARQL that Fuseki rejects:

**13a. `whereEvery` — incorrect NOT syntax**

Generated: `FILTER(!?a1_name = "Moa" || ?a1_name = "Jinx")`
Expected: `FILTER(NOT EXISTS { ... FILTER(NOT(?a1_name = "Moa" || ?a1_name = "Jinx")) })`

Root cause: The `every()` quantifier is canonicalized to `where_not(where_exists(path, where_not(predicate)))`. This is semantically correct (∀x.P(x) ≡ ¬∃x.¬P(x)). But in the lowering, the inner `where_not` produces `not_expr`, which the algebra layer serializes as `!expr`. The `!` prefix in SPARQL has higher precedence than `=`, so `!?a1_name = "Moa"` parses as `(!?a1_name) = "Moa"` instead of `!(?a1_name = "Moa")`.

Fix: In `algebraToString.ts`, when serializing `not_expr`, always wrap the inner expression in parentheses: `!(expr)` instead of `!expr`.

**13b. `whereSequences` — `some` as SPARQL operator**

Generated: `FILTER(?a0_friends some "" && ?a0_name = "Semmy")`

Root cause: The `some` quantifier is being lowered as a binary operator instead of being converted to an EXISTS expression. In `IRCanonicalize.ts`, the `WhereMethods.SOME` enum check (lines 145-151) should convert `some` to an `exists` pattern. But the string `'some'` is reaching `lowerWhere()` as a `where_binary` with `operator: 'some'`, meaning the canonicalization's quantifier detection is being bypassed for this code path.

This likely happens because the chained `.some(...).and(...)` in `whereSequences` produces a compound where structure where the `some` part is nested inside the `and` in a way the canonicalization doesn't recurse into.

Fix: Investigate why `some` escapes canonicalization in the chained-sequence pattern. The canonicalization's `toExists()` handling may need to be applied recursively inside compound boolean expressions.

**13c. `countEquals` — COUNT in FILTER instead of HAVING**

Generated: `FILTER(count(?a0_friends) = "2"^^xsd:integer)`
Expected: `SELECT ?a0 ... GROUP BY ?a0 HAVING(count(?a0_friends) = 2)`

Root cause: `.where(p => p.friends.size().equals(2))` lowers the `size().equals(2)` to a binary expression with an `aggregate_expr` on the left. This binary expression ends up in the WHERE clause of the IR. The SPARQL algebra layer converts it to a FILTER, but aggregates in FILTER are invalid SPARQL — they belong in HAVING.

Fix: In `irToAlgebra.ts` `selectToAlgebra()`, after converting the where clause, detect if the resulting filter expression contains aggregate sub-expressions. If so, extract the aggregate-containing parts to `HAVING` and leave the non-aggregate parts in `FILTER`. This requires:
1. A helper `containsAggregate(expr)` to detect aggregate sub-expressions
2. Logic to split a logical expression into aggregate and non-aggregate parts
3. Adding the aggregate part to `groupBy` / `having` on the plan
4. The `SparqlSelectPlan` type may need a `having` field (check if it exists)

**Files changed:**
- `src/sparql/algebraToString.ts` — fix NOT parenthesization (13a)
- `src/queries/IRCanonicalize.ts` — fix `some` in chained sequences (13b)
- `src/sparql/irToAlgebra.ts` — detect aggregates in WHERE → move to HAVING (13c)
- `src/sparql/SparqlAlgebra.ts` — possibly add `having` to SparqlSelectPlan
- `src/tests/sparql-select-golden.test.ts` — update 3 golden tests
- `src/tests/sparql-fuseki.test.ts` — update 3 tests to run against Fuseki

**Open questions:**
- **Q13a:** For the NOT parenthesization fix (13a): is `!(expr)` always correct, or are there cases where the `!` should distribute differently? e.g., `NOT(a AND b)` vs `NOT(a) OR NOT(b)`.
  - **Recommendation:** `!(expr)` is always correct. In SPARQL, `!` is the unary negation operator with higher precedence than binary operators, so wrapping in parentheses is the standard fix. The current code in `algebraToString.ts` (line 111) serializes as `` `!${serializeExpression(expr.inner)}` `` without parens — changing to `` `!(${serializeExpression(expr.inner)})` `` is a one-line fix. De Morgan distribution (`NOT(a AND b)` → `NOT(a) OR NOT(b)`) is a semantic optimization, not a correctness requirement — the SPARQL engine handles it internally. No distribution needed.
- **Q13b:** For `whereSequences` (13b): should the fix be in the canonicalization layer (prevent `some` from reaching lowering as a binary operator) or in the lowering layer (catch `some` as operator and convert to EXISTS there)?
  - **Recommendation:** Fix in canonicalization. The `canonicalizeWhere()` function in `IRCanonicalize.ts` already handles `WhereMethods.SOME` (lines 147-152) and has recursive handling via `toExists()` (line 74). The bug is likely that in the chained pattern `.some(...).and(...)`, the `some` is nested inside a compound boolean in a way the recursion doesn't reach. The fix should ensure `canonicalizeWhere()` recurses into all operands of `where_binary` / `where_boolean` nodes and converts any `some` found inside them. This keeps the single-responsibility principle: canonicalization normalizes quantifiers, lowering translates canonical forms.
- **Q13c:** For `countEquals` (13c): does `SparqlSelectPlan` already have a `having` field, or does it need to be added? If added, does `algebraToString.ts` already serialize it?
  - **Recommendation:** `SparqlSelectPlan` already has a `having?: SparqlExpression` field (defined in `SparqlAlgebra.ts` line 175). Need to verify whether `algebraToString.ts` serializes it — if not, adding `HAVING(expr)` serialization is straightforward. The main work is in `irToAlgebra.ts`: detect that the WHERE filter expression contains an `aggregate_expr`, extract it, and assign it to the plan's `having` field instead of the `algebra` FILTER. A `containsAggregate(expr: SparqlExpression): boolean` helper would walk the expression tree to detect this.
- **Q13d:** Should all 3 sub-fixes be in one phase or split into separate commits? They touch different layers (serialization, canonicalization, algebra conversion).
  - **Recommendation:** Keep as one phase, one commit. While they touch different layers, they are small, self-contained fixes with no interaction between them. Splitting into 3 separate phases adds coordination overhead without benefit. Each sub-fix is 5-20 lines of code. The tests for all 3 are in the same file, and the golden test updates can be verified together. However, implement and test them in order (13a → 13b → 13c) since 13a is the simplest and 13c is the most involved.

**Implementation details:**

**13a. NOT parenthesization fix — `src/sparql/algebraToString.ts` line 111-112**

One-line fix. Current:
```ts
case 'not_expr':
  return `!${serializeExpression(expr.inner, collector)}`;
```
Change to:
```ts
case 'not_expr':
  return `!(${serializeExpression(expr.inner, collector)})`;
```

This produces `!(expr)` for all NOT expressions. The extra parentheses are harmless for simple expressions (e.g., `!(true)`) and necessary for compound ones (e.g., `!(?x = "Moa" || ?x = "Jinx")`).

Expected golden SPARQL change for `whereEvery`:
```sparql
-- BEFORE: FILTER(!?a1_name = "Moa" || ?a1_name = "Jinx")
-- AFTER:  FILTER(!(EXISTS { ... FILTER(!(?a1_name = "Moa" || ?a1_name = "Jinx")) }))
```
Wait — actually the full whereEvery output wraps in NOT EXISTS already. The parenthesization affects the inner `!` only:
```sparql
FILTER(!EXISTS {
  ?a0 <P/friends> ?a1 .
  FILTER(!(?a1_name = "Moa" || ?a1_name = "Jinx"))
})
```

**13b. `some` in chained sequences — `src/queries/IRCanonicalize.ts` line 158**

The exact bug: in `canonicalizeWhere()` when processing a `where_boolean` (lines 157-168):
```ts
const grouped = where as DesugaredWhereBoolean;
let current: CanonicalWhereExpression = toComparison(grouped.first);  // ← BUG HERE
```

`grouped.first` is the `DesugaredWhereComparison` for the SOME quantifier. But `toComparison()` (lines 45-54) just wraps it as a `CanonicalWhereComparison` without checking for SOME/EVERY. The SOME/EVERY check at lines 146-153 only fires for top-level `where_comparison`, not for the `first` element of a `where_boolean`.

Fix: Replace `toComparison(grouped.first)` with a function that checks for quantifiers:
```ts
// Change line 158 from:
let current: CanonicalWhereExpression = toComparison(grouped.first);
// To:
let current: CanonicalWhereExpression = canonicalizeComparison(grouped.first);

// Add helper:
const canonicalizeComparison = (
  comparison: DesugaredWhereComparison,
): CanonicalWhereExpression => {
  if (
    comparison.operator === WhereMethods.SOME ||
    comparison.operator === WhereMethods.EVERY ||
    (comparison.operator as unknown as string) === 'some' ||
    (comparison.operator as unknown as string) === 'every'
  ) {
    return toExists(comparison);
  }
  return toComparison(comparison);
};
```

This reuses the existing SOME/EVERY detection logic and applies it to the `first` element of boolean compounds. The `toExists()` function already handles the conversion correctly.

Expected golden SPARQL change for `whereSequences`:
```sparql
-- BEFORE: FILTER(?a0_friends some "" && ?a0_name = "Semmy")
-- AFTER:  FILTER(EXISTS { ?a0 <P/friends> ?a1 . ?a1 <P/name> ?a1_name . FILTER(?a1_name = "Jinx") } && ?a0_name = "Semmy")
```

**13c. COUNT in FILTER → HAVING — `src/sparql/irToAlgebra.ts`**

The fix requires changes in `selectToAlgebra()` at step 5 (lines 246-253) and step 8 (lines 322-328).

*Step 1: Add `containsAggregate()` helper:*
```ts
function containsAggregate(expr: SparqlExpression): boolean {
  switch (expr.kind) {
    case 'aggregate_expr': return true;
    case 'binary_expr': return containsAggregate(expr.left) || containsAggregate(expr.right);
    case 'logical_expr': return expr.exprs.some(containsAggregate);
    case 'not_expr': return containsAggregate(expr.inner);
    case 'function_expr': return expr.args.some(containsAggregate);
    default: return false;
  }
}
```

*Step 2: In step 5 (where clause → filter), check for aggregates:*
```ts
if (query.where) {
  const filterExpr = convertExpression(query.where, registry, optionalPropertyTriples);
  if (containsAggregate(filterExpr)) {
    // Move to HAVING instead of FILTER
    havingExpr = filterExpr;  // Store for later
  } else {
    algebra = {type: 'filter', expression: filterExpr, inner: algebra};
  }
}
```

*Step 3: In step 8 (GROUP BY), if havingExpr is set, add it and ensure GROUP BY is present:*
```ts
if (havingExpr) {
  hasAggregates = true;
  // GROUP BY all non-aggregate projected variables
  groupBy = projection
    .filter((p): p is {kind: 'variable'; name: string} => p.kind === 'variable')
    .map((p) => p.name);
}

// In the return statement:
return {
  // ... existing fields ...
  groupBy,
  having: havingExpr,  // ← NEW
};
```

`SparqlSelectPlan` already has `having?: SparqlExpression` (line 174 of `SparqlAlgebra.ts`), and `algebraToString.ts` already serializes it (lines 262-265):
```ts
if (plan.having) {
  const havingExpr = serializeExpression(plan.having, collector);
  clauses.push(`HAVING(${havingExpr})`);
}
```

So no changes needed in the algebra types or serializer — only in `irToAlgebra.ts`.

Expected golden SPARQL change for `countEquals`:
```sparql
-- BEFORE:
SELECT DISTINCT ?a0
WHERE { ... FILTER(count(?a0_friends) = "2"^^xsd:integer) }

-- AFTER:
SELECT ?a0
WHERE { ... }
GROUP BY ?a0
HAVING(count(?a0_friends) = "2"^^xsd:integer)
```

Note: DISTINCT is removed when GROUP BY is present (already handled by `distinct: !hasAggregates ? true : undefined`).

*Things to consider:*
- For 13c, if a WHERE clause has both aggregate and non-aggregate parts combined with AND/OR, we'd need to split them. For `countEquals` the entire expression is aggregate-containing, so no splitting is needed. Splitting logic should be implemented but can be simple: if a `logical_expr` has mixed parts, extract aggregate parts to HAVING and leave the rest in FILTER. If needed, this can be a follow-up.
- For 13b, verify the fix also handles the OLD test's `where_sequences` pattern (which uses `.some().and()`) — the test data should produce correct results.
- All three fixes are independent and can be tested individually.

---

### Phase 14: Fix remaining edge cases (evaluation_select, context path)

**Status:** Complete

**Depends on:** Phase 9
**Can run in parallel with:** Phase 10, Phase 12, Phase 13

**Problem:** 2 fixtures produce semantically incorrect SPARQL:

**14a. `customResultEqualsBoolean` — boolean expression lost in projection**

`Person.select(p => ({isBestFriend: p.bestFriend.equals(entity('p3'))}))` generates:
```sparql
SELECT DISTINCT ?a0 ?a1
WHERE { ?a0 rdf:type <P> . OPTIONAL { ?a0 <P/bestFriend> ?a0_bestFriend . } }
```

The boolean comparison `bestFriend.equals(entity('p3'))` is lost. The projection should be:
```sparql
SELECT DISTINCT ?a0 (?a0_bestFriend = <linked://tmp/entities/p3> AS ?isBestFriend)
```

Root cause: In `IRLower.ts`, `evaluation_select` with a where predicate is lowered to an `IRExpression` and becomes a projection seed. But in `irToAlgebra.ts`, the projection processing via `resolveExpressionVariable()` (line 294) only handles `alias_expr` and `property_expr` — a `binary_expr` returns `null`, causing the fallback to project just the alias name. The binary expression is never serialized into a `(expr AS ?alias)` projected expression.

Fix: In `irToAlgebra.ts` projection building (step 7, lines 278-302), when a projection item's expression is NOT a simple variable/alias/aggregate, serialize it as `(expression AS ?alias)` in the SELECT clause. This requires adding a `bind` or `expression_alias` variant to `SparqlProjectionItem`.

**14b. `whereWithContextPath` — tautological FILTER**

`Person.select(p => p.name).where(p => { const userName = getQueryContext<Person>('user').name; return p.friends.some(f => f.name.equals(userName)); })` generates:
```sparql
FILTER(?a1_name = ?a1_name)
```

The context path `getQueryContext('user').name` resolves to the same variable `?a1_name` instead of resolving to the context user entity's name value.

Root cause: `getQueryContext('user')` returns a shape proxy. When `.name` is accessed, it builds a path expression through the proxy. But since the proxy isn't bound to a specific entity in the query, the path resolves to the same variable that the inner `f.name` resolves to.

Fix: The context path should resolve to a concrete value (the actual name of the context user) or to a different variable bound via a separate traversal from the context entity.

**Files changed:**
- `src/sparql/irToAlgebra.ts` — project expressions as `(expr AS ?alias)` (14a)
- `src/sparql/SparqlAlgebra.ts` — add expression projection item type (14a)
- `src/sparql/algebraToString.ts` — serialize expression projections (14a)
- `src/queries/IRLower.ts` or context resolution — fix context path binding (14b)
- `src/tests/sparql-select-golden.test.ts` — update 2 golden tests
- `src/tests/sparql-fuseki.test.ts` — update 2 tests

**Open questions:**
- **Q14a:** For the expression projection (14a): should we support arbitrary expressions in SELECT (e.g. `(expr AS ?alias)`), or only comparison expressions? SPARQL allows any expression in a BIND/projected expression, but we only need comparison for now.
  - **Recommendation:** Support arbitrary expressions in `(expr AS ?alias)`. The implementation cost is nearly identical either way — `resolveExpressionVariable()` in `irToAlgebra.ts` (line 652) currently returns `null` for non-variable expressions. The fix is to handle the `null` case by converting the full IR expression to a `SparqlExpression` and emitting it as `(serialized_expr AS ?alias)`. Restricting to comparison-only adds a type check with no benefit. The `SparqlProjectionItem` type would need an `expression?: SparqlExpression` variant alongside the existing `variable: string` variant.
- **Q14b:** For context path (14b): what is the intended semantics of `getQueryContext('user').name`? Should it resolve to a literal value (eagerly evaluate the context user's name from the store) or to a SPARQL variable bound to the context entity's name via a separate pattern? The eager approach is simpler but requires a store read at query-build time. The SPARQL approach is purer but more complex.
  - **Recommendation:** Use the SPARQL variable approach — bind the context entity to a variable via a separate triple pattern. The current pipeline already handles `getQueryContext('user')` correctly (lowers to `reference_expr` → `iri_expr`). The problem is only with `.name` path access on the context. The fix: when a context reference is followed by a property path in the where clause, emit a separate triple pattern `<context_entity_iri> <P/name> ?ctx_name .` and use `?ctx_name` in the FILTER instead of resolving to the same variable as `f.name`. This keeps query construction pure (no store reads at build time) and is consistent with how SPARQL works. The eager approach would break the "queries are data" principle where queries can be serialized and sent to remote endpoints.
- **Q14c:** Is `customResultEqualsBoolean` a high-priority use case? The DSL pattern `{isBestFriend: p.bestFriend.equals(entity)}` is unusual — most users would use `.where()` for filtering instead of projecting a boolean. If low priority, we could defer this.
  - **Recommendation:** Medium priority. It's a valid DSL pattern that demonstrates computed projections — a building block for more complex derived fields in the future. The fix is small (10-20 lines in `irToAlgebra.ts` projection building + a `SparqlProjectionItem` variant). Recommend including it in Phase 14 since the effort is low and it rounds out the expression support.
- **Q14d:** Is `whereWithContextPath` a high-priority use case? The pattern of accessing properties of a context entity in a where clause is niche. If low priority, we could defer this.
  - **Recommendation:** Low priority, but still worth implementing in Phase 14. The `getQueryContext` feature is explicitly part of the DSL API and has 2 fixtures testing it (`whereWithContext` works correctly, `whereWithContextPath` does not). Having half the context feature broken would be confusing for users. The fix requires understanding how the desugarer resolves context property paths, which is a contained change in `IRDesugar.ts` or `IRLower.ts`. If time is tight, this could be deferred to a separate phase, but it pairs naturally with 14a since both are about expression handling in projections/filters.

**Implementation details:**

**14a. Expression projection — `(expr AS ?alias)` in SELECT**

*Step 1: Add `expression` variant to `SparqlProjectionItem` — `src/sparql/SparqlAlgebra.ts` line 149-151*

Current:
```ts
export type SparqlProjectionItem =
  | {kind: 'variable'; name: string}
  | {kind: 'aggregate'; expression: SparqlAggregateExpr; alias: string};
```
Add:
```ts
export type SparqlProjectionItem =
  | {kind: 'variable'; name: string}
  | {kind: 'aggregate'; expression: SparqlAggregateExpr; alias: string}
  | {kind: 'expression'; expression: SparqlExpression; alias: string};
```

*Step 2: Handle in `selectPlanToSparql()` — `src/sparql/algebraToString.ts` lines 237-245*

Current projection serialization handles `variable` and `aggregate`. Add `expression`:
```ts
const projectionParts = plan.projection.map((item) => {
  if (item.kind === 'variable') {
    return `?${item.name}`;
  } else if (item.kind === 'aggregate') {
    const aggExpr = serializeExpression(item.expression, collector);
    return `(${aggExpr} AS ?${item.alias})`;
  } else {
    // expression projection: (expr AS ?alias)
    const expr = serializeExpression(item.expression, collector);
    return `(${expr} AS ?${item.alias})`;
  }
});
```

*Step 3: Generate `expression` projection in `irToAlgebra.ts` — lines 292-301*

Current code for non-aggregate expressions:
```ts
} else {
  const varName = resolveExpressionVariable(item.expression, registry);
  if (varName && varName !== rootAlias) {
    projection.push({kind: 'variable', name: varName});
  } else if (!varName) {
    projection.push({kind: 'variable', name: item.alias});  // ← FALLBACK: loses expression
  }
}
```

Fix the `!varName` branch to emit expression projection:
```ts
} else if (!varName) {
  // Non-variable expression (binary_expr, function_expr, etc.)
  // → project as (expr AS ?alias)
  const sparqlExpr = convertExpression(item.expression, registry, optionalPropertyTriples);
  projection.push({kind: 'expression', expression: sparqlExpr, alias: item.alias});
}
```

*Step 4: Also handle in GROUP BY inference (step 8, lines 321-328)*

Currently GROUP BY collects `kind === 'variable'` items. The `expression` kind should not be a GROUP BY target. The existing filter already handles this correctly since it only checks for `p.kind === 'variable'`.

Expected golden SPARQL for `customResultEqualsBoolean`:
```sparql
SELECT DISTINCT ?a0 (?a0_bestFriend = <linked://tmp/entities/p3> AS ?isBestFriend)
WHERE {
  ?a0 rdf:type <P> .
  OPTIONAL { ?a0 <P/bestFriend> ?a0_bestFriend . }
}
```

**14b. Context path tautology — `src/queries/IRLower.ts`**

The bug is in `lowerWhereArg()` (lines 85-109). When the argument is an `arg_path` with a `subject` (context entity reference), the path is lowered using the same `options` as the main query:

```ts
if ('kind' in arg && arg.kind === 'arg_path') {
  const argPath = arg as {kind: 'arg_path'; path: DesugaredSelectionPath};
  return lowerPath(argPath.path, options);  // ← Uses SAME options.rootAlias
}
```

The `argPath.path` contains a property step for `.name`, and since `options.rootAlias` resolves within the `some()` context (which is the exists subquery's `existsRootAlias`), `lowerPath()` produces `{kind: 'property_expr', sourceAlias: existsRootAlias, property: 'P/name'}` — the same variable as `f.name`.

*Fix: When an `arg_path` has a `subject`, use the subject's IRI as a fixed starting point instead of the query's root alias.*

The `arg_path` type in `IRDesugar.ts` already carries the subject:
```ts
{
  kind: 'arg_path';
  subject?: ShapeReferenceValue;  // ← The context entity reference
  path: DesugaredSelectionPath;
}
```

In `lowerWhereArg()`, when `argPath.subject` is present:
```ts
if ('kind' in arg && arg.kind === 'arg_path') {
  const argPath = arg as {kind: 'arg_path'; subject?: ShapeReferenceValue; path: DesugaredSelectionPath};
  if (argPath.subject) {
    // Context entity path — create a separate traversal from the context IRI
    // The subject is a context entity reference with an IRI
    const contextIri = argPath.subject.id;
    // Generate a unique alias for the context entity
    const contextAlias = ctx.generateAlias();
    // Register a pattern that binds the context entity's property
    // This will produce a triple: <context_iri> <P/name> ?ctx_name .
    const contextOptions: PathLoweringOptions = {
      rootAlias: contextAlias,
      resolveTraversal: (from, prop) => ctx.getOrCreateTraversal(from, prop),
    };
    // Add a "fixed" pattern: bind contextAlias to the IRI
    // This is a BIND(<iri> AS ?contextAlias) or a VALUES clause
    // Simplest: emit the property triple with the IRI as subject directly
    // i.e., <context_iri> <P/name> ?ctx_name .
    return lowerContextPath(argPath.path, contextIri, ctx);
  }
  return lowerPath(argPath.path, options);
}
```

The `lowerContextPath()` helper would need to create a new IR pattern:
```ts
function lowerContextPath(
  path: DesugaredSelectionPath,
  contextIri: string,
  ctx: LoweringContext,
): IRExpression {
  // For a path like [property_step("name")]:
  // Emit an IR expression that will produce:
  //   <contextIri> <P/name> ?ctx_name .
  // And return property_expr referencing ?ctx_name
  const lastStep = path.steps[path.steps.length - 1];
  if (lastStep.kind === 'property_step') {
    // Create a unique variable for the context property
    const ctxVar = `ctx_${propertySuffix(lastStep.propertyShapeId)}`;
    // Add a context pattern to the lowering context
    ctx.addContextPattern({
      kind: 'context_bind',
      iri: contextIri,
      property: lastStep.propertyShapeId,
      variable: ctxVar,
    });
    return {kind: 'alias_expr', alias: ctxVar};
  }
  // Fallback
  return {kind: 'literal_expr', value: null};
}
```

This requires a new IR pattern type (`context_bind`) or reuse of the existing `shape_scan`/`traverse` patterns with the IRI as a fixed subject. The cleanest approach may be to emit an extra triple directly in the algebra layer.

**Alternative simpler approach for 14b:** Instead of a new IR pattern, emit a `reference_expr` for the context IRI and let the property path resolve relative to it. This would produce:
```sparql
FILTER EXISTS {
  ?a0 <P/friends> ?a1 .
  <context_user_iri> <P/name> ?ctx_name .
  FILTER(?a1_name = ?ctx_name)
}
```

The `<context_user_iri> <P/name> ?ctx_name .` triple binds the context entity's name. This triple needs to appear inside the EXISTS block, which means the lowering of `where_exists` must include it.

*Things to consider:*
- 14a is straightforward (3 files, ~15 lines each). Implement first.
- 14b is more complex due to the cross-cutting nature of context paths. The context entity needs to be bound via a triple pattern, and this pattern needs to appear in the right scope (inside EXISTS for some/every, in outer WHERE for direct where).
- For 14b, the `arg_path.subject` field is already present and carries the context entity's IRI. The subject IRI (`arg.subject.id`) is the key to generating the correct SPARQL pattern.
- If 14b proves too complex, it can be deferred to a follow-up phase without blocking Phase 11 (only 1 of 75 fixtures affected).

---

**Dependency graph for Phases 10-14:**
```
Phase 9 (complete)
  ├─→ Phase 10 (recursive nesting) ──────────────┐
  ├─→ Phase 12 (inline where lowering) ──────────┤
  ├─→ Phase 13 (invalid SPARQL fixes)            ├─→ Phase 11 (tighten assertions)
  └─→ Phase 14 (edge cases: eval projection,     │       ↓
                 context path)  ──────────────────┘   [full parity]
```

Phases 10, 12, 13, 14 can all run in parallel (different files, different layers). Phase 11 (assertion tightening) should come last — after Phases 10, 12, 13, and 14 fix the underlying issues, so assertions encode correct behavior rather than known-incorrect results.

### Phase summary

| Phase | Description | Depends on | Parallel group |
|-------|------------|------------|----------------|
| 1 | Types + utils + exports ✅ | — | — |
| 2a | Layer 1: select IR→algebra ✅ | 1 | **parallel** |
| 2b | Layer 3: algebra→string ✅ | 1 | **parallel** |
| 2c | Result mapping ✅ | 1 | **parallel** |
| 2d | Layer 1: mutation IR→algebra ✅ | 1 | **parallel** |
| 3 | Golden tests + wiring ✅ | 2a, 2b, 2d | — |
| 4 | Fuseki integration ✅ | 2c, 3 | — |
| 5 | Fuseki Docker + live verification ✅ | 4 | **parallel** |
| 6 | Negative + error-path tests ✅ | 3 | **parallel** |
| 7 | Fix URI-vs-literal in FILTER ✅ | 6 | — |
| 8 | Fix nested result grouping ✅ | 7 | — |
| 9 | Full Fuseki coverage (all 75 fixtures) ✅ | 8 | — |
| 10 | Recursive nesting in result mapping | 9 | **parallel** (10,12,13,14) |
| 11 | Tighten Fuseki assertions to OLD depth | 10,12,13,14 | — |
| 12 | Inline where filter lowering (IR pipeline) | 9 | **parallel** (10,12,13,14) |
| 13 | Fix invalid SPARQL (3 fixtures) | 9 | **parallel** (10,12,13,14) |
| 14 | Fix edge cases (eval projection, context path) | 9 | **parallel** (10,12,13,14) |

---

## Task breakdown

### Dependency graph

```
Phase 9 (complete)
  ├─→ Phase 10 (resultMapping.ts only)  ──────────────┐
  ├─→ Phase 12 (IR pipeline + irToAlgebra)  ──────────┤
  ├─→ Phase 13 (algebraToString + IRCanonicalize +     ├─→ Phase 11 (Fuseki test assertions)
  │              irToAlgebra)                           │
  └─→ Phase 14 (SparqlAlgebra + algebraToString +      │
                 irToAlgebra + IRLower)  ──────────────┘
```

**Parallel group A** (10, 12, 13, 14): All four phases can run concurrently. File conflicts are minimal:
- Phase 10 owns `resultMapping.ts` exclusively.
- Phase 12 owns `IRProjection.ts`, `IntermediateRepresentation.ts` (adding `filter` to `IRTraversePattern`), and touches `irToAlgebra.ts` (OPTIONAL wrapping).
- Phase 13 owns `algebraToString.ts` (NOT parens), `IRCanonicalize.ts` (some fix), and touches `irToAlgebra.ts` (HAVING extraction).
- Phase 14 owns `SparqlAlgebra.ts` (projection type), touches `algebraToString.ts` (expression projection serialization), `irToAlgebra.ts` (projection building), and `IRLower.ts` (context path).

**Shared file risk**: `irToAlgebra.ts` is touched by Phases 12, 13, and 14 in different sections:
- Phase 12: step 4 (OPTIONAL wrapping for filtered traversals) — around lines 238-243
- Phase 13: step 5 (WHERE → HAVING extraction) — around lines 246-253 + step 8 (GROUP BY) — around lines 322-328
- Phase 14: step 7 (projection building) — around lines 292-301

These are non-overlapping sections, but the integration phase (11) must verify they compose correctly.

**Stubs for parallel execution:**
- Phase 12 agents can stub `irToAlgebra.ts` changes by manually constructing `SparqlSelectPlan` objects with FILTER-inside-OPTIONAL for golden test verification.
- Phase 13 agents can stub HAVING by manually constructing plans with `having` field set.
- Phase 14 agents can stub expression projection by constructing plans with the new projection item kind.

---

### Phase 10: Tasks

**T10.1** Replace flat `NestingDescriptor` type with recursive `NestedGroup` type in `src/sparql/resultMapping.ts` (lines 141-160).

**T10.2** Rewrite `buildNestingDescriptor()` (lines 166-239) to build a tree:
- Add `buildAliasChain()` helper to walk traverseMap from sourceAlias back to root.
- Add `insertIntoTree()` helper to walk the chain and create intermediate groups.
- Replace the flat `nestedGroupMap` logic with tree construction.

**T10.3** Rewrite `mapNestedRows()` (lines 339-415) to recursively descend the nesting tree:
- Extract `groupBindings()` recursive helper.
- Preserve `isUriExpression()` check for URI vs literal coercion.
- Preserve deduplication by entity id at each nesting level.

**T10.4** Update golden tests in `src/tests/sparql-select-golden.test.ts` if any SPARQL output changes (unlikely — this phase only changes result mapping, not SPARQL generation).

**T10.5** Verify all 4 affected Fuseki tests pass with correct nested structure:
- `selectNestedFriendsName`
- `doubleNestedSubSelect`
- `selectDeepNested`
- `nestedQueries2`

#### Phase 10: Validation

**Compilation:** `npx tsc --noEmit` exits 0.

**Existing tests pass:** `npx vitest run src/tests/sparql-select-golden.test.ts` — all existing golden tests pass unchanged (SPARQL generation is not affected).

**Fuseki integration (4 fixtures):** `npx vitest run src/tests/sparql-fuseki.test.ts` — all 75 existing tests still pass. Additionally verify structurally:

- **`selectNestedFriendsName`** (`friends.friends.name`, a0→a1→a2):
  Test data: p1→friends→[p2,p3]. p2→friends→[p3,p4]. p3→friends→[]. p4→friends→[].
  Assert: result contains p1 with `friends` array. Each friend entry (p2) should itself have a `friends` array containing `name` strings. p1.friends should include an entry for p2 whose nested friends include entries with names "Jinx" and "Quinn".

- **`doubleNestedSubSelect`** (`friends.select(f => f.bestFriend.select(p3 => ({name: p3.name})))`, a0→a1→a2):
  Test data: p1→friends→[p2,p3]. p2→bestFriend→p3. p3→bestFriend→none.
  Assert: result contains p1 with `friends` array. The p2 entry should have a nested `bestFriend` object with `{name: "Jinx"}`. The p3 entry should have `bestFriend: null` (no bestFriend).

- **`selectDeepNested`** (`friends.bestFriend.bestFriend.name`, a0→a1→a2→a3):
  Test data: p1→friends→[p2,p3]. p2→bestFriend→p3. p3→bestFriend→none. Chain breaks at p3.
  Assert: result may be empty array (no entity satisfies the full 3-hop chain where the final bestFriend exists). Assert `Array.isArray(result)`.

- **`nestedQueries2`** (`friends.select(f => [f.firstPet, f.bestFriend.select(p3 => ({name: p3.name}))])`, mixed nesting):
  Test data: p1→friends→[p2,p3]. p2→firstPet→dog2, p2→bestFriend→p3. p3→firstPet→none, p3→bestFriend→none.
  Assert: result contains p1 with `friends` array. p2 entry has both `firstPet` (entity ref to dog2) and `bestFriend` (nested object with `{name: "Jinx"}`).

**Regression:** All other Fuseki tests (non-nested) continue to pass unchanged — flat result mapping path (`mapFlatRows`) is untouched.

---

### Phase 12: Tasks

**T12.1** Add `filter?: IRExpression` field to `IRTraversePattern` in `src/queries/IntermediateRepresentation.ts`.

**T12.2** In `src/queries/IRProjection.ts` `lowerSelectionPathExpression()` (lines 36-77), process `step.where` on property steps:
- When a non-last property step has `.where`, canonicalize the where and lower it to an IR expression.
- Attach the filter to the traversal pattern via `LoweringContext`.
- This requires either passing `LoweringContext` to `lowerSelectionPathExpression` or collecting filters in a side channel.

**T12.3** In `src/sparql/irToAlgebra.ts` `processPattern()` (lines 356-406), when a traverse pattern has `.filter`:
- Discover property triples needed by the filter expression (call `processExpressionForProperties` scoped to the traversal).
- Emit these triples INSIDE the OPTIONAL block, not in the outer `optionalPropertyTriples`.
- Wrap the traverse triple + filter property triples + FILTER into a single `left_join` (OPTIONAL block).

**T12.4** Update 5 golden tests in `src/tests/sparql-select-golden.test.ts`:
- `whereFriendsNameEquals` — add `FILTER(?a1_name = "Moa")` inside the OPTIONAL
- `whereAnd` — add `FILTER(?a1_name = "Moa" && ?a1_hobby = "Jogging")` inside the OPTIONAL
- `whereOr` — add `FILTER(?a1_name = "Jinx" || ?a1_hobby = "Jogging")` inside the OPTIONAL
- `whereAndOrAnd` — compound boolean FILTER inside the OPTIONAL
- `whereAndOrAndNested` — nested compound boolean FILTER inside the OPTIONAL

**T12.5** Update 5 Fuseki tests with result assertions.

#### Phase 12: Validation

**Compilation:** `npx tsc --noEmit` exits 0.

**Golden tests (5 updated):** `npx vitest run src/tests/sparql-select-golden.test.ts` — all pass with new expected SPARQL containing FILTER inside OPTIONAL.

**Fuseki integration (5 fixtures):**

- **`whereFriendsNameEquals`** (`p.friends.where(f => f.name.equals('Moa'))`):
  Test data: p1→friends→[p2(Moa), p3(Jinx)]. p2→friends→[p3(Jinx), p4(Quinn)].
  Assert: result contains p1 with `friends` array of length 1, containing only Moa (p2). p2's friends array has length 1, containing only Jinx (p3, because neither p3 nor p4 is named "Moa" — actually wait, the filter applies per-entity. p2's friends filtered by name="Moa" → none match → p2.friends is empty array).
  Correction: Each root entity gets their friends filtered. p1.friends=[p2] (Moa matches). p2.friends=[] (neither p3 nor p4 is named Moa).

- **`whereAnd`** (`p.friends.where(f => f.name.equals('Moa').and(f.hobby.equals('Jogging')))`):
  Test data: p2 has name=Moa, hobby=Jogging. p3 has name=Jinx, no hobby.
  Assert: p1.friends=[p2] (Moa+Jogging matches). p2.friends=[] (p3 is Jinx, p4 is Quinn — neither matches).

- **`whereOr`** (`p.friends.where(f => f.name.equals('Jinx').or(f.hobby.equals('Jogging')))`):
  Test data: p2 is Moa+Jogging (hobby matches). p3 is Jinx (name matches).
  Assert: p1.friends=[p2,p3] (both match via OR). p2.friends=[p3] (Jinx matches name, p4 matches neither).

- **`whereAndOrAnd`** and **`whereAndOrAndNested`**: Assert correct compound boolean filtering with specific friend counts per root entity.

**Regression:** All other Fuseki and golden tests pass unchanged.

---

### Phase 13: Tasks

**T13.1** Fix NOT parenthesization in `src/sparql/algebraToString.ts` line 111-112:
- Change `` `!${serializeExpression(expr.inner, collector)}` `` to `` `!(${serializeExpression(expr.inner, collector)})` ``

**T13.2** Fix `some` in chained boolean compounds in `src/queries/IRCanonicalize.ts` line 158:
- Add `canonicalizeComparison()` helper that checks for SOME/EVERY before calling `toComparison()`.
- Replace `toComparison(grouped.first)` with `canonicalizeComparison(grouped.first)` at line 158.

**T13.3** Fix COUNT in FILTER → HAVING in `src/sparql/irToAlgebra.ts`:
- Add `containsAggregate(expr: SparqlExpression): boolean` recursive helper.
- In step 5 (lines 246-253), check `containsAggregate(filterExpr)`. If true, assign to `havingExpr` variable instead of wrapping in FILTER.
- In step 8, if `havingExpr` is set, force `hasAggregates = true` and assign `groupBy` + `having` on the plan.

**T13.4** Update 3 golden tests in `src/tests/sparql-select-golden.test.ts`:
- `whereEvery` — inner `!` gets parenthesized: `FILTER(!(...))`
- `whereSequences` — `some` becomes `EXISTS { ... FILTER(...) } && ...`
- `countEquals` — `FILTER(count(...))` becomes `GROUP BY ?a0 HAVING(count(...))`

**T13.5** Update 3 Fuseki tests to run against Fuseki (currently generation-only).

#### Phase 13: Validation

**Compilation:** `npx tsc --noEmit` exits 0.

**Golden tests (3 updated):** `npx vitest run src/tests/sparql-select-golden.test.ts` — all pass.

**Fuseki integration (3 fixtures — previously generation-only, now live):**

- **`whereEvery`** (`p.friends.every(f => f.name.equals('Moa').or(f.name.equals('Jinx')))`):
  Semantics: ∀ friends, name is "Moa" or "Jinx". Test data: p1→friends→[p2(Moa), p3(Jinx)] — all match. p2→friends→[p3(Jinx), p4(Quinn)] — p4 is Quinn, fails.
  Assert: result is array. p1 should be present (all friends match). p2 should NOT be present (Quinn doesn't match). p3 and p4 have no friends, so vacuously true — they should be present.

- **`whereSequences`** (`p.friends.some(f => f.name.equals('Jinx')).and(p.name.equals('Semmy'))`):
  Semantics: has a friend named Jinx AND own name is Semmy. Test data: p1 is Semmy with friend Jinx(p3).
  Assert: result is array of length 1, containing only p1 (Semmy, who has friend Jinx).

- **`countEquals`** (`p.friends.size().equals(2)`):
  Semantics: entities with exactly 2 friends. Test data: p1 has 2 friends [p2,p3]. p2 has 2 friends [p3,p4].
  Assert: result is array of length 2, containing p1 and p2.

**Regression:** All other tests pass unchanged. Specifically verify `whereSomeExplicit` and `whereSomeImplicit` still work (they use `some` in a non-chained context — should not be affected by the 13b fix).

---

### Phase 14: Tasks

**T14.1** Add `'expression'` variant to `SparqlProjectionItem` in `src/sparql/SparqlAlgebra.ts` (line 149-151):
```ts
| {kind: 'expression'; expression: SparqlExpression; alias: string}
```

**T14.2** Handle `'expression'` projection in `src/sparql/algebraToString.ts` `selectPlanToSparql()` (lines 237-245):
- Serialize as `(expr AS ?alias)`.

**T14.3** Fix projection building in `src/sparql/irToAlgebra.ts` (lines 292-301):
- When `resolveExpressionVariable()` returns null and expression is not aggregate, create `{kind: 'expression', expression: sparqlExpr, alias: item.alias}` projection item.

**T14.4** Fix context path resolution in `src/queries/IRLower.ts` `lowerWhereArg()` (lines 85-109):
- When `arg_path` has `subject` (context entity), resolve the property path from the context entity IRI instead of from the query root alias.
- Emit a triple pattern `<context_iri> <P/name> ?ctx_varname .` that binds the context entity's property.
- Return a reference to `?ctx_varname` instead of the same variable as the inner query.

**T14.5** Update 2 golden tests in `src/tests/sparql-select-golden.test.ts`:
- `customResultEqualsBoolean` — projection becomes `(?a0_bestFriend = <...p3> AS ?isBestFriend)`
- `whereWithContextPath` — FILTER becomes `?a1_name = ?ctx_name` with separate triple for context

**T14.6** Update 2 Fuseki tests with result assertions.

#### Phase 14: Validation

**Compilation:** `npx tsc --noEmit` exits 0.

**Golden tests (2 updated):** `npx vitest run src/tests/sparql-select-golden.test.ts` — all pass.

**Fuseki integration (2 fixtures):**

- **`customResultEqualsBoolean`** (`Person.select(p => ({isBestFriend: p.bestFriend.equals(entity('p3'))}))`):
  Test data: p2→bestFriend→p3. No other person has bestFriend=p3.
  Assert: result is array of 4 persons. p2's `isBestFriend` field is `true`. All others have `isBestFriend` as `false` (or `null` if bestFriend is absent — p3, p4 have no bestFriend).

- **`whereWithContextPath`** (`p.friends.some(f => f.name.equals(getQueryContext('user').name))`):
  Test data: context user is set to entity with specific name. Query finds persons who have a friend with that name.
  Assert: depends on how context is set in test — verify FILTER uses a distinct variable for the context name, not a tautology. The SPARQL should be syntactically valid and produce correct filtering.

**Regression:** All other tests pass. Specifically verify `whereWithContext` (non-path) still works — it uses `getQueryContext('user')` directly as an entity reference, which should be unaffected.

---

### Phase 11: Tasks

**T11.1** Create `src/tests/sparql-result-mapping.test.ts` with hand-crafted SPARQL JSON binding tests:
- Test `mapSparqlSelectResult()` with flat bindings (no nesting).
- Test `mapSparqlSelectResult()` with 1-level nesting.
- Test `mapSparqlSelectResult()` with 2-level nesting (after Phase 10).
- Test `mapSparqlSelectResult()` with mixed nesting (flat + nested on same group).
- Test type coercion: xsd:dateTime → Date, xsd:boolean → boolean, xsd:integer → number.
- Test null handling: missing bindings → null fields.
- Test URI coercion: uri type → entity reference `{id: ...}`.
- Test deduplication: duplicate root ids produce single result row.

**T11.2** Tighten all correct Fuseki SELECT test assertions (~60 fixtures) in `src/tests/sparql-fuseki.test.ts`:
- Replace `toBeGreaterThanOrEqual` with exact `toHaveLength`.
- Replace `toBeDefined()` with specific value assertions.
- Use `findRowById()` for unordered results, index access for ordered (`sortByAsc`, `sortByDesc`).
- Sort nested arrays by id or name before asserting order.
- Add `// TODO: tighten after Phase 12/13` comments on the 8 fixtures that remain known-incorrect if those phases are not yet merged.

**T11.3** Tighten the 5 inline-where fixtures (fixed by Phase 12) with precise assertions per the Phase 12 validation spec.

**T11.4** Tighten the 3 invalid-SPARQL fixtures (fixed by Phase 13) with precise assertions per the Phase 13 validation spec.

**T11.5** Tighten the 2 edge-case fixtures (fixed by Phase 14) with precise assertions per the Phase 14 validation spec.

#### Phase 11: Validation

**Compilation:** `npx tsc --noEmit` exits 0.

**Unit tests (new file):** `npx vitest run src/tests/sparql-result-mapping.test.ts` — all pass. Minimum test count: 8 test cases covering flat, nested, mixed, type coercion, null, URI, dedup.

**Fuseki integration:** `npx vitest run src/tests/sparql-fuseki.test.ts` — all 75 tests pass with tightened assertions. No `toBeGreaterThanOrEqual` or bare `toBeDefined()` assertions remain except on the fixtures marked TODO (if any phases are not yet merged).

**Full suite:** `npx vitest run` — all tests in the repository pass.

---

### Integration verification (after all parallel phases merge)

After Phases 10, 12, 13, 14 are all merged into the same branch:

1. `npx tsc --noEmit` — full compilation passes.
2. `npx vitest run src/tests/sparql-select-golden.test.ts` — all golden tests pass (10 updated golden strings from phases 12+13+14).
3. `npx vitest run src/tests/sparql-fuseki.test.ts` — all 75 Fuseki tests pass.
4. `npx vitest run` — full suite passes.
5. Verify no duplicate variable names in SELECT projections (scan golden test outputs).
6. Verify `irToAlgebra.ts` has no conflicting edits from Phases 12, 13, 14 (review merged diff).

---

## Phase 15: Operator parenthesization — Status: Complete

**Problem**: `whereAndOrAnd` and `whereAndOrAndNested` produce identical SPARQL despite different DSL grouping. `A.or(B).and(C)` should produce `(A || B) && C` but produces `A || B && C` (wrong precedence).

**Root cause**: `serializeExpression()` in `algebraToString.ts` serializes `logical_expr` children without parentheses. When an OR child appears inside an AND parent, the OR's lower precedence is lost.

**Files to change**:
- `src/sparql/algebraToString.ts` — add parenthesization logic to `logical_expr` case
- `src/tests/sparql-select-golden.test.ts` — update `whereAndOrAnd` golden to have `(... || ...) && ...`
- `src/tests/sparql-fuseki.test.ts` — tighten `whereAndOrAnd` and `whereAndOrAndNested` assertions

**Fix** (in `serializeExpression`, `logical_expr` case):
When parent operator is AND and a child expression is `logical_expr` with operator OR, wrap the child serialization in `()`. This is the only case that needs parenthesization since AND already binds tighter than OR.

### Phase 15: Tasks

**T15.1** In `algebraToString.ts`, update the `logical_expr` case in `serializeExpression` to wrap OR children of AND expressions in parentheses.

**T15.2** Update golden test `whereAndOrAnd` in `sparql-select-golden.test.ts` to expect `FILTER((?a1_name = "Jinx" || ?a1_hobby = "Jogging") && ?a1_name = "Moa")`.

**T15.3** Tighten Fuseki test assertions for `whereAndOrAnd` and `whereAndOrAndNested`:
- `whereAndOrAnd`: `(name=Jinx || hobby=Jogging) && name=Moa` → only Moa who also has hobby Jogging matches (friend must have name Moa AND either be named Jinx or have hobby Jogging). With test data: p3(Jinx) doesn't have name Moa, p2(Moa) has hobby Jogging → p2 matches. So p1 should have 1 friend (p2/Moa), p2 should have 0 matching friends.
- `whereAndOrAndNested`: `name=Jinx || (hobby=Jogging && name=Moa)` → friend named Jinx OR (hobby Jogging AND name Moa). p3=Jinx matches first clause, p2=Moa+Jogging matches second. p1 friends=[p2,p3] → 2 match. p2 friends=[p3,p4] → p3=Jinx matches → 1 match.

#### Phase 15: Validation

- `npx tsc --noEmit` exits 0
- `npx jest --config jest.config.js src/tests/sparql-select-golden.test.ts` — all pass (updated whereAndOrAnd golden)
- `npx jest --config jest.config.js src/tests/sparql-fuseki.test.ts` — all 75 pass
- `npx jest --config jest.config.js` — all 455+ pass

---

## Phase 16: Literal property inline where result mapping — Status: Complete

**Problem**: `whereHobbyEquals` applies `.where()` to a literal property (hobby is a string). The inline where lowering in `IRProjection.ts` forces a traversal and returns `alias_expr`. The result mapping treats all `alias_expr` bindings as entity references, wrapping literal values as `{id: "Jogging"}` instead of returning `"Jogging"` directly.

**Root cause**: `isUriExpression()` in `resultMapping.ts` returns `true` for all `alias_expr`, and the mapping code wraps the binding as `{id: val.value}` without checking the actual SPARQL binding type. Additionally, the nested path (`mapNestedRows` → `collectNestedGroup`) creates `{id: literal}` entity refs for literal traversals.

**Files changed**:
- `src/sparql/resultMapping.ts` — three-part fix:
  1. In `mapFlatRows` and `populateFields`: added `val.type === 'uri'` check before wrapping alias_expr bindings as `{id: ...}`
  2. Added `detectLiteralTraversals()` to pre-scan ALL bindings and identify which nested groups resolve to literals vs URIs
  3. Added `collectLiteralTraversalValue()` to coerce literal bindings instead of wrapping as entities
  4. Updated `mapNestedRows` and `collectNestedGroup` recursion to use literal detection
- `src/tests/sparql-result-mapping.test.ts` — added test for alias_expr with literal binding
- `src/tests/sparql-fuseki.test.ts` — tightened `whereHobbyEquals` assertion to verify hobby is string "Jogging"

**Deviation from plan**: The original plan only addressed `mapFlatRows`/`populateFields`. In practice, the inline `.where()` on a literal property creates a traverse pattern, which routes through the nested code path (`mapNestedRows` → `collectNestedGroup`), not the flat path. The fix required a deeper change: pre-scanning all bindings to detect literal traversals at the nesting level, then returning coerced values (or null for OPTIONAL misses) instead of entity reference arrays.

### Phase 16: Tasks

**T16.1** ✅ In `resultMapping.ts`, update both `mapFlatRows` and `populateFields` to check `val.type === 'uri'` before wrapping alias_expr bindings as `{id: ...}`.

**T16.2** ✅ Add `detectLiteralTraversals()` and `collectLiteralTraversalValue()` helpers, update `mapNestedRows` and `collectNestedGroup` to handle literal property traversals.

**T16.3** ✅ Add unit test in `sparql-result-mapping.test.ts`: alias_expr with literal binding should return the literal value, not `{id: ...}`.

**T16.4** ✅ Tighten Fuseki test `whereHobbyEquals`: verify the hobby field is the string `"Jogging"` for matching persons, not `{id: "Jogging"}`.

#### Phase 16: Validation — All passing

- `npx tsc --noEmit` exits 0
- `npx jest --config jest.config.js src/tests/sparql-result-mapping.test.ts` — 29 pass
- `npx jest --config jest.config.js src/tests/sparql-fuseki.test.ts` — 75/75 pass
- `npx jest --config jest.config.js` — 456 pass, 0 fail

---

## Phase 17: Nested create with predefined ID — Status: Complete

**Problem**: `updateNestedWithPredefinedId` (`Person.update(entity('p1'), {bestFriend: {id: '...p3-best-friend', name: 'Bestie'}})`) only creates the link (`p1 bestFriend p3-best-friend`) but does NOT insert the nested entity's data (`p3-best-friend rdf:type Person`, `p3-best-friend name "Bestie"`).

**Root cause**: `isNodeReference()` in `MutationQuery.ts` returns `true` for any object with an `id` property, even when it has additional data properties. The commented-out check `&& Object.keys(obj).length === 1` was the intended guard. When `isNodeReference()` returns true, `convertNodeReference()` strips all properties except `id`, producing a `NodeReferenceValue` instead of a `NodeDescriptionValue` with a predefined ID.

**Files to change**:
- `src/queries/MutationQuery.ts` — fix `isNodeReference()` and `convertNodeDescription()`
- `src/tests/ir-mutation-parity.test.ts` — strengthen assertion to require `fields` and `shape`
- `src/tests/sparql-mutation-algebra.test.ts` — update to expect nested create triples
- `src/tests/sparql-mutation-golden.test.ts` — update expected SPARQL to include INSERT triples
- `src/tests/sparql-fuseki.test.ts` — update to verify nested entity data is inserted

### Phase 17: Tasks

**T17.1** In `MutationQuery.ts`, fix `isNodeReference()` (line 248-253): add `Object.keys(obj).length === 1` to only treat objects with `id` as the sole property as references.

**T17.2** In `MutationQuery.ts`, fix `convertNodeDescription()` (line 103-133): add handling for `obj.id` alongside existing `obj.__id`, extracting it as the predefined entity ID and removing it before field iteration.

**T17.3** Update `ir-mutation-parity.test.ts`: change `updateNestedWithPredefinedId` assertion from optional `if (bestFriend.fields)` to strict assertion that `bestFriend.shape` exists and `bestFriend.fields` contains name = "Bestie".

**T17.4** Update `sparql-mutation-algebra.test.ts`: change test to assert nested create triples (rdf:type, name) in `insertPatterns`, not just the link.

**T17.5** Update `sparql-mutation-golden.test.ts`: change expected SPARQL to include `rdf:type` and `name` triples in the INSERT block.

**T17.6** Update `sparql-fuseki.test.ts`: change `nameResult.results.bindings.length` from `toBe(0)` to `toBe(1)`, verify name = "Bestie", remove the "known limitation" comment.

#### Phase 17: Validation

- `npx tsc --noEmit` exits 0
- `npx jest --config jest.config.js src/tests/ir-mutation-parity.test.ts` — all pass
- `npx jest --config jest.config.js src/tests/sparql-mutation-algebra.test.ts` — all pass
- `npx jest --config jest.config.js src/tests/sparql-mutation-golden.test.ts` — all pass
- `npx jest --config jest.config.js src/tests/sparql-fuseki.test.ts` — all 75 pass
- `npx jest --config jest.config.js` — all pass

---

## Final Review

### Summary

All 17 phases are complete. 456 unit/golden tests pass, 75/75 Fuseki integration tests pass, TypeScript compiles clean. The SPARQL conversion layer covers the full DSL surface: selects (flat, nested, filtered, aggregated, ordered, paged), creates (flat, nested, with references), updates (simple, set overwrite, set add/remove, nested create, nested create with predefined ID, unset), and deletes (single, multi-entity).

### Architecture

The three-layer pipeline (IR → SPARQL Algebra → SPARQL String) is cleanly separated:

| File | Responsibility | Lines |
|---|---|---|
| `SparqlAlgebra.ts` | Type definitions (algebra nodes, expressions, plans) | ~200 |
| `irToAlgebra.ts` | IR → SPARQL algebra conversion | ~1140 |
| `algebraToString.ts` | Algebra → SPARQL string serialization | ~380 |
| `resultMapping.ts` | SPARQL JSON → Linked DSL result types | ~615 |
| `sparqlUtils.ts` | Shared helpers (URI formatting, prefix collection, entity URI generation) | ~85 |
| `index.ts` | Public API re-exports | ~45 |

Key design decisions:
- `VariableRegistry` maps `(alias, property)` → SPARQL variable names, ensuring deduplication across traverse and property_expr references.
- Property triples are always wrapped in OPTIONAL (LeftJoin) for safe access, preventing missing values from eliminating result rows.
- Inline `.where()` filters produce filtered OPTIONAL blocks where the traverse triple and filter property triples are co-located.
- Mutations use DELETE/INSERT/WHERE pattern (not DELETE WHERE) for safe updates when old values may not exist.
- Result mapping uses a `NestingDescriptor` tree built from `resultMap` and `projection`, which guides recursive grouping of flat SPARQL bindings into nested objects.

### Remaining gaps

#### Must fix (before production use)

1. **String literal escaping** — `formatLiteral()` in `sparqlUtils.ts` does not escape special characters (`"`, `\`, newlines, tabs). Literals containing these characters will produce invalid SPARQL. Fix: escape `\` → `\\`, `"` → `\"`, newline → `\n`, tab → `\t`, carriage return → `\r` inside `formatLiteral()`.

2. **Unused `varCounter`** — `updateToAlgebra()` in `irToAlgebra.ts:915` declares `let varCounter = 0` but never uses it. The code uses `propertySuffix()` for variable naming instead. Fix: remove the declaration.

#### Should fix

3. **EXISTS pattern conversion is partial** — `convertExistsPattern()` only handles `traverse`, `join`, and `shape_scan` patterns. If an EXISTS body contains `optional`, `union`, or nested `exists` patterns, they are silently dropped or throw. The current DSL doesn't produce these combinations, but the function should either support them or throw a clear "unsupported" error.

4. **Literal traversal detection heuristic** — `detectLiteralTraversals()` returns after the first non-null binding per group. If different root entities have different types for the same traversal alias (unlikely but possible with UNION patterns), the detection would be incorrect for some entities. Document this assumption or add consistency validation.

5. **`localName()` key collision** — Both `resultMapping.ts` and `irToAlgebra.ts` use `localName()` to extract the last URI segment. Two properties with the same local name but different namespaces would collide in result row keys. The current DSL doesn't produce such collisions because property URIs share a single namespace, but this is fragile.

6. **Context property key collision** — `irToAlgebra.ts` uses `__ctx__${sanitizeVarName(iri)}` as registry keys. Two different IRIs that sanitize to the same string would collide. Low probability but possible.

#### Nice to have

7. **Commented code in MutationQuery.ts** — ~18 lines of commented-out set modification logic (lines 230-247) and a commented simpler condition check (line 41). Should be removed for cleanliness.

8. **`as any` casts in error throws** — `irToAlgebra.ts:703, 754` use `(expr as any).kind` in error messages. Can be replaced with a type-safe exhaustiveness check.

9. **Algebra types not fully utilized** — `SparqlDeleteWherePlan`, `SparqlExtend`, `SparqlGraph`, `SparqlMinus` types are defined but not produced by the current IR conversion. They exist for future use (named graphs, BIND expressions, MINUS patterns). Document their status.

10. **XSD constant duplication** — XSD constants are defined locally in both `irToAlgebra.ts` and `resultMapping.ts`. Could be centralized in `sparqlUtils.ts`.

### Test coverage

| Test file | Tests | Coverage |
|---|---|---|
| `sparql-select-golden.test.ts` | All select fixtures → exact SPARQL string | Golden |
| `sparql-mutation-golden.test.ts` | All mutation fixtures → exact SPARQL string | Golden |
| `sparql-mutation-algebra.test.ts` | Mutation IR → algebra structure assertions | Structural |
| `sparql-result-mapping.test.ts` | SPARQL JSON → result mapping unit tests | Unit |
| `sparql-negative.test.ts` | Error cases and edge cases | Negative |
| `ir-mutation-parity.test.ts` | IR capture layer correctness | Unit |
| `sparql-fuseki.test.ts` | Full pipeline → Fuseki SPARQL endpoint | Integration (75 fixtures) |

**Test gaps** (not blocking but worth adding):
- String literals with special characters (blocked by gap #1)
- Deeply nested results (4+ levels)
- Empty result sets for all query types
- Multiple filtered traversals on the same entity

### Next steps

1. Fix string literal escaping (#1) and remove unused varCounter (#2) — these are quick fixes.
2. Write SPARQL algebra layer documentation (in progress).
3. Consider adding the test cases listed above.
4. Wire the SPARQL layer into a real `IQuadStore` implementation for `@_linked/sparql-store`.
