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

### Phase 1: Types, utilities, and exports (foundation)

**Must complete before anything else. All parallel phases depend on this.**

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

### Phase 2a: Layer 1 — IR → Algebra for SELECT queries

**Depends on:** Phase 1 only
**Can run in parallel with:** 2b, 2c, 2d

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

### Phase 2b: Layer 3 — Algebra → SPARQL string serialization

**Depends on:** Phase 1 only
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

### Phase 2c: Result mapping

**Depends on:** Phase 1 only (uses IR types + SparqlJsonResults type)
**Can run in parallel with:** 2a, 2b, 2d

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

### Phase 2d: Layer 1 — IR → Algebra for mutations

**Depends on:** Phase 1 only
**Can run in parallel with:** 2a, 2b, 2c

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

### Phase 3: Golden tests + wiring

**Depends on:** Phases 2a + 2b (need both layers to produce end-to-end SPARQL strings)

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

### Phase 4: Fuseki integration tests

**Depends on:** Phases 2c + 3 (need result mapping + working SPARQL generation)

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

### Phase summary

| Phase | Description | Depends on | Parallel group |
|-------|------------|------------|----------------|
| 1 | Types + utils + exports | — | — |
| 2a | Layer 1: select IR→algebra | 1 | **parallel** |
| 2b | Layer 3: algebra→string | 1 | **parallel** |
| 2c | Result mapping | 1 | **parallel** |
| 2d | Layer 1: mutation IR→algebra | 1 | **parallel** |
| 3 | Golden tests + wiring | 2a, 2b, 2d | — |
| 4 | Fuseki integration | 2c, 3 | — |
