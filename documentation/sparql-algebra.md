# SPARQL Algebra Layer

This document defines the SPARQL conversion pipeline in `@_linked/core` — the layer that compiles the canonical IR into executable SPARQL strings and maps results back into DSL types.

## Design goals

- Formal algebra intermediate aligned with SPARQL 1.2 spec §18.
- Clean separation between algebra construction (structural) and string serialization (syntactic).
- Prefix-aware serialization with automatic PREFIX block generation.
- Full round-trip: IR → algebra → SPARQL string → execute → JSON results → DSL types.

## Pipeline architecture

```
IR (SelectQuery, CreateQuery, UpdateQuery, DeleteQuery)
  → Layer 1: irToAlgebra — IR → SPARQL algebra plan (SparqlPlan)
  → Layer 2: algebraToString — SPARQL algebra plan → SPARQL string
  → Execute against SPARQL endpoint → SPARQL JSON results
  → Layer 3: resultMapping — SPARQL JSON → DSL result types (SelectResult, CreateResult, etc.)
```

All code lives in `src/sparql/`. Pure functions, no base classes.

## File structure

```
src/sparql/
  SparqlAlgebra.ts      — Algebra type definitions (terms, nodes, expressions, plans)
  irToAlgebra.ts        — IR → SPARQL algebra conversion (Layer 1)
  algebraToString.ts    — Algebra → SPARQL string serialization (Layer 2)
  resultMapping.ts      — SPARQL JSON results → DSL result types (Layer 3)
  sparqlUtils.ts        — Shared helpers (URI formatting, literal serialization, prefix collection)
  index.ts              — Public API re-exports
```

---

## Algebra types (`SparqlAlgebra.ts`)

### Terms

The atomic elements of SPARQL patterns — variables, IRIs, and literals:

```ts
type SparqlTerm =
  | {kind: 'variable'; name: string}
  | {kind: 'iri'; value: string}
  | {kind: 'literal'; value: string; datatype?: string; language?: string};

type SparqlTriple = {
  subject: SparqlTerm;
  predicate: SparqlTerm;
  object: SparqlTerm;
};
```

### Algebra nodes

Structural building blocks for WHERE clauses, aligned with SPARQL 1.2 algebra:

| Type | Fields | SPARQL equivalent |
|---|---|---|
| `bgp` | `triples[]` | Basic graph pattern (triple patterns) |
| `join` | `left`, `right` | Inner join of two patterns |
| `left_join` | `left`, `right`, `condition?` | OPTIONAL (left outer join) |
| `filter` | `expression`, `inner` | FILTER wrapping a pattern |
| `union` | `left`, `right` | UNION of two patterns |
| `minus` | `left`, `right` | MINUS (set difference) |
| `extend` | `inner`, `variable`, `expression` | BIND (expression AS ?var) |
| `graph` | `iri`, `inner` | GRAPH (named graph) |

```ts
type SparqlAlgebraNode =
  | SparqlBGP
  | SparqlJoin
  | SparqlLeftJoin
  | SparqlFilter
  | SparqlUnion
  | SparqlMinus
  | SparqlExtend
  | SparqlGraph;
```

### Expressions

Filter/projection expression tree:

| Kind | Fields | SPARQL equivalent |
|---|---|---|
| `variable_expr` | `name` | `?name` |
| `iri_expr` | `value` | `<uri>` |
| `literal_expr` | `value`, `datatype?` | `"value"^^<datatype>` |
| `binary_expr` | `op`, `left`, `right` | `left op right` (=, !=, <, >, <=, >=) |
| `logical_expr` | `op`, `exprs[]` | `a && b && c` or `a \|\| b` |
| `not_expr` | `inner` | `!(expr)` |
| `function_expr` | `name`, `args[]` | `name(args)` |
| `aggregate_expr` | `name`, `args[]`, `distinct?` | `COUNT(?x)`, `SUM(DISTINCT ?x)` |
| `exists_expr` | `pattern`, `negated` | `EXISTS {...}` or `NOT EXISTS {...}` |
| `bound_expr` | `variable` | `BOUND(?var)` |

### Projection items

```ts
type SparqlProjectionItem =
  | {kind: 'variable'; name: string}                              // ?name
  | {kind: 'aggregate'; expression: SparqlAggregateExpr; alias: string}  // (COUNT(?x) AS ?alias)
  | {kind: 'expression'; expression: SparqlExpression; alias: string};   // (expr AS ?alias)
```

### Top-level plans

Four plan types cover all SPARQL query forms:

```ts
type SparqlPlan =
  | SparqlSelectPlan       // SELECT ... WHERE {...}
  | SparqlInsertDataPlan   // INSERT DATA {...}
  | SparqlDeleteInsertPlan // DELETE {...} INSERT {...} WHERE {...}
  | SparqlDeleteWherePlan; // DELETE WHERE {...}
```

**SparqlSelectPlan** — the most complex plan:

```ts
type SparqlSelectPlan = {
  type: 'select';
  algebra: SparqlAlgebraNode;          // WHERE body
  projection: SparqlProjectionItem[];  // SELECT variables/expressions
  distinct?: boolean;
  orderBy?: SparqlOrderCondition[];
  limit?: number;
  offset?: number;
  groupBy?: string[];                  // GROUP BY variables
  having?: SparqlExpression;           // HAVING filter
  aggregates?: SparqlAggregateBinding[];
};
```

**SparqlInsertDataPlan** — used for CREATE mutations:

```ts
type SparqlInsertDataPlan = {
  type: 'insert_data';
  triples: SparqlTriple[];
  graph?: string;
};
```

**SparqlDeleteInsertPlan** — used for UPDATE and DELETE mutations:

```ts
type SparqlDeleteInsertPlan = {
  type: 'delete_insert';
  deletePatterns: SparqlTriple[];
  insertPatterns: SparqlTriple[];
  whereAlgebra: SparqlAlgebraNode;
  graph?: string;
};
```

---

## Layer 1: IR → Algebra (`irToAlgebra.ts`)

### Variable naming

The `VariableRegistry` class maps `(alias, property)` pairs to SPARQL variable names, ensuring each property access produces a consistent, deduplicated variable:

```
(a0, prop:name)   → a0_name
(a0, prop:hobby)  → a0_hobby
(a1, prop:name)   → a1_name
```

The naming convention is `{alias}_{localName(property)}`, where `localName()` extracts the last URI segment.

### Select conversion (`selectToAlgebra`)

Converts an `IRSelectQuery` to a `SparqlSelectPlan`. The algorithm:

1. **Root type triple** — `?a0 rdf:type <ShapeURI>` becomes the required BGP.
2. **Traverse patterns** — each `IRTraversePattern` becomes a triple: `?from <property> ?to`. Filtered traversals (inline `.where()`) are collected separately.
3. **Property discovery** — walks all projection, where, and orderBy expressions to find `property_expr` references. Each unique property becomes an OPTIONAL triple: `OPTIONAL { ?alias <property> ?var }`.
4. **Filtered OPTIONAL blocks** — inline `.where()` filters produce OPTIONAL blocks containing the traverse triple, filter property triples, and FILTER expression together.
5. **WHERE clause** — `query.where` becomes either a FILTER (for non-aggregate expressions) or HAVING (for expressions containing aggregates like COUNT > N).
6. **Subject targeting** — `query.subjectId` becomes an additional FILTER: `?a0 = <subjectUri>`.
7. **Projection** — root alias + property variables + aggregate/expression projections.
8. **Traversal aliases** — traversal target variables (`?a1`, `?a2`, etc.) are auto-included in the SELECT for result grouping.
9. **GROUP BY inference** — if any aggregate is present, all non-aggregate projected variables become GROUP BY targets.
10. **ORDER BY / LIMIT / OFFSET** — passed through from the IR.

#### Example: flat select

DSL: `Person.select((p) => p.name)`

```
SparqlSelectPlan {
  type: 'select',
  algebra: left_join(
    bgp([?a0 rdf:type <Person>]),
    bgp([?a0 <name> ?a0_name])
  ),
  projection: [?a0, ?a0_name],
  distinct: true
}
```

Serialized SPARQL:
```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT ?a0 ?a0_name
WHERE {
  ?a0 rdf:type <Person> .
  OPTIONAL {
    ?a0 <name> ?a0_name .
  }
}
```

#### Example: nested select with inline where

DSL: `Person.select((p) => p.hobby.where((h) => h.equals('Jogging')))`

The inline `.where()` on a literal property creates a filtered traverse pattern. The algebra wraps the traverse triple and filter in a single OPTIONAL:

```sparql
SELECT DISTINCT ?a0 ?a1
WHERE {
  ?a0 rdf:type <Person> .
  OPTIONAL {
    ?a0 <hobby> ?a1 .
    FILTER(?a1 = "Jogging")
  }
}
```

#### Example: aggregation

DSL: `Person.select((p) => p.friends.size())`

Aggregates trigger GROUP BY inference — all non-aggregate variables become GROUP BY targets:

```sparql
SELECT ?a0 (COUNT(?a1) AS ?a1_agg)
WHERE {
  ?a0 rdf:type <Person> .
  OPTIONAL {
    ?a0 <friends> ?a1 .
  }
}
GROUP BY ?a0
```

Note: when an aggregate alias collides with a traversal alias (both would be `a1`), the aggregate is renamed to `a1_agg` to avoid duplicate bindings.

### Create conversion (`createToAlgebra`)

Converts an `IRCreateMutation` to a `SparqlInsertDataPlan`. Recursively generates triples from `IRNodeData`:

- Type triple: `<entity> rdf:type <Shape>`
- Field triples: `<entity> <property> "value"` or `<entity> <property> <nestedEntity>`
- Nested creates produce their own type + field triples recursively.

Entity URIs are generated using `generateEntityUri()`: `{dataRoot}/{shapeLabel}_{ulid}`.

### Update conversion (`updateToAlgebra`)

Converts an `IRUpdateMutation` to a `SparqlDeleteInsertPlan`. For each field:

| Update type | DELETE | INSERT | WHERE |
|---|---|---|---|
| Simple value | `<s> <p> ?old_suffix` | `<s> <p> "new"` | `OPTIONAL { <s> <p> ?old_suffix }` |
| Unset (undefined) | `<s> <p> ?old_suffix` | — | `OPTIONAL { <s> <p> ?old_suffix }` |
| Array overwrite | `<s> <p> ?old_suffix` | `<s> <p> "v1"`, `<s> <p> "v2"` | `OPTIONAL { <s> <p> ?old_suffix }` |
| Set add | — | `<s> <p> <new>` | — |
| Set remove | `<s> <p> <old>` | — | `<s> <p> <old>` |
| Nested create | `<s> <p> ?old_suffix` | `<s> <p> <nested>` + nested triples | `OPTIONAL { <s> <p> ?old_suffix }` |

All WHERE triples are wrapped in OPTIONAL so the update succeeds even when the old value doesn't exist (e.g., setting `bestFriend` when none was previously set).

### Delete conversion (`deleteToAlgebra`)

Converts an `IRDeleteMutation` to a `SparqlDeleteInsertPlan`:

- DELETE block: subject-wildcard (`<s> ?p ?o`), object-wildcard (`?s ?p2 <s>`), type triple
- WHERE block: subject-wildcard + type triple (required), object-wildcard (OPTIONAL)

This removes all triples where the entity appears as subject or object, plus the type assertion.

---

## Layer 2: String serialization (`algebraToString.ts`)

### Serialization functions

| Function | Input → Output |
|---|---|
| `serializeTerm(term)` | `SparqlTerm` → `?var`, `<uri>`, `"value"^^<type>` |
| `serializeExpression(expr)` | `SparqlExpression` → SPARQL expression string |
| `serializeAlgebraNode(node)` | `SparqlAlgebraNode` → WHERE body string |
| `selectPlanToSparql(plan)` | `SparqlSelectPlan` → complete SELECT query |
| `insertDataPlanToSparql(plan)` | `SparqlInsertDataPlan` → INSERT DATA query |
| `deleteInsertPlanToSparql(plan)` | `SparqlDeleteInsertPlan` → DELETE/INSERT/WHERE query |
| `deleteWherePlanToSparql(plan)` | `SparqlDeleteWherePlan` → DELETE WHERE query |

### PREFIX block generation

URIs are collected during serialization via a `UriCollector`. After the query body is fully serialized, `buildPrefixBlock()` computes the minimal set of PREFIX declarations needed and prepends them.

Prefix resolution uses the registered `Prefix` ontology mappings. URIs whose local name contains `/` are not prefixed (they would produce invalid prefixed names).

### Operator precedence

SPARQL `&&` binds tighter than `||`. The serializer handles this by parenthesizing OR children inside AND expressions:

```ts
// IR: and(or(a, b), c) → SPARQL: (a || b) && c
case 'logical_expr': {
  const parts = expr.exprs.map(e => {
    const s = serializeExpression(e);
    if (expr.op === 'and' && e.kind === 'logical_expr' && e.op === 'or') {
      return `(${s})`;
    }
    return s;
  });
  return parts.join(` ${op} `);
}
```

### Algebra node rendering

| Node type | Rendering |
|---|---|
| `bgp` | Each triple on its own line, terminated with ` .` |
| `join` | Left and right blocks concatenated with newline |
| `left_join` | `left\nOPTIONAL {\n  right\n}` |
| `filter` | `inner\nFILTER(expression)` |
| `union` | `{\n  left\n}\nUNION\n{\n  right\n}` |
| `minus` | `left\nMINUS {\n  right\n}` |
| `extend` | `inner\nBIND(expression AS ?variable)` |
| `graph` | `GRAPH <iri> {\n  inner\n}` |

---

## Layer 3: Result mapping (`resultMapping.ts`)

### Select result mapping (`mapSparqlSelectResult`)

Maps SPARQL JSON result bindings back to `SelectResult` (array of `ResultRow` or single row).

**Algorithm:**

1. **Build nesting descriptor** — analyzes `query.resultMap` and `query.projection` to build a tree of `NestedGroup` nodes that describes how flat bindings should be grouped into nested objects.

2. **Flat vs nested path** — if no traversals exist, use `mapFlatRows()` (simple per-row mapping). Otherwise, use `mapNestedRows()` (grouping + recursive collection).

3. **Variable name resolution** — maps IR projection expressions to the SPARQL variable names that appear in bindings:
   - `property_expr(a0, prop:name)` → `a0_name`
   - `alias_expr(a1)` → `a1`
   - `aggregate_expr` → projection alias

4. **Value coercion** — converts SPARQL binding values to JS types based on XSD datatype:
   - `xsd:boolean` → `boolean`
   - `xsd:integer`, `xsd:long`, `xsd:decimal`, `xsd:float`, `xsd:double` → `number`
   - `xsd:dateTime`, `xsd:date` → `Date`
   - URI → `string` (the URI value)
   - Untyped literal → `string`

5. **Entity reference detection** — `alias_expr` projections that resolve to URIs produce `{id: uri}` entity references instead of bare strings.

6. **Literal traversal detection** — when a traverse pattern targets a literal property (e.g. `p.hobby.where(...)`), the traversal alias binds to a literal, not a URI. `detectLiteralTraversals()` pre-scans all bindings to identify these cases, and `collectLiteralTraversalValue()` returns the coerced value directly instead of trying to group by entity ID.

#### Nesting descriptor

The `NestingDescriptor` is a recursive tree that mirrors the query's traversal structure:

```ts
type NestingDescriptor = {
  rootVar: string;              // e.g. "a0"
  flatFields: FieldDescriptor[];    // fields directly on root entity
  nestedGroups: NestedGroup[];      // traversed entity groups
};

type NestedGroup = {
  key: string;                  // result field name (e.g. "friends")
  traverseAlias: string;       // SPARQL variable (e.g. "a1")
  flatFields: FieldDescriptor[];
  nestedGroups: NestedGroup[];  // deeper nesting
};
```

**Example:** `Person.select((p) => [p.name, p.friends.select((f) => f.name)])`

```
NestingDescriptor:
  rootVar: "a0"
  flatFields: [{key: "name", sparqlVar: "a0_name"}]
  nestedGroups: [
    {
      key: "friends",
      traverseAlias: "a1",
      flatFields: [{key: "name", sparqlVar: "a1_name"}],
      nestedGroups: []
    }
  ]
```

The algorithm groups bindings by `?a0` (root entity), then within each group by `?a1` (friend entity), producing:

```ts
[
  {id: 'person:1', name: 'Semmy', friends: [{id: 'person:2', name: 'Moa'}]},
  ...
]
```

### Create result mapping (`mapSparqlCreateResult`)

Echoes back the created fields from `IRNodeData` as a `ResultRow` with the generated URI as `id`. Recursively processes nested creates.

### Update result mapping (`mapSparqlUpdateResult`)

Echoes back the updated fields from `IRUpdateMutation.data` as an `UpdateResult`. Only changed fields are included.

---

## Shared utilities (`sparqlUtils.ts`)

| Function | Purpose |
|---|---|
| `formatUri(uri)` | Returns prefixed form (`rdf:type`) if a prefix is registered, otherwise `<full-uri>` |
| `formatLiteral(value, datatype?)` | Returns `"value"` or `"value"^^<datatype>` with special characters escaped |
| `escapeSparqlString(value)` | Escapes `\`, `"`, `\n`, `\r`, `\t` per SPARQL 1.1 §19.7 |
| `collectPrefixes(uris)` | Computes minimal PREFIX declarations for a set of URIs |
| `generateEntityUri(shape, options?)` | Generates `{dataRoot}/{shapeLabel}_{ulid}` for create mutations |

### SparqlOptions

```ts
interface SparqlOptions {
  dataRoot?: string;       // Base URI for generated entities (default: DATA_ROOT env or http://example.org/data)
  prefixes?: Record<string, string>;  // Additional prefix mappings (reserved for future use)
}
```

---

## Public API (`index.ts`)

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
  serializeAlgebraNode,    // SparqlAlgebraNode → string (WHERE body)
  serializeExpression,     // SparqlExpression → string
  serializeTerm,           // SparqlTerm → string
  selectPlanToSparql,      // SparqlSelectPlan → string
  insertDataPlanToSparql,  // SparqlInsertDataPlan → string
  deleteInsertPlanToSparql, // SparqlDeleteInsertPlan → string
  deleteWherePlanToSparql,  // SparqlDeleteWherePlan → string
} from '@_linked/core/sparql';
```

### Result mapping

```ts
import {
  mapSparqlSelectResult,   // SparqlJsonResults + IRSelectQuery → SelectResult
  mapSparqlCreateResult,   // generatedUri + IRCreateMutation → CreateResult
  mapSparqlUpdateResult,   // IRUpdateMutation → UpdateResult
} from '@_linked/core/sparql';

import type {
  SparqlJsonResults,  // SPARQL JSON result format
  SparqlBinding,      // Single result binding
} from '@_linked/core/sparql';
```

### Type exports

All algebra types are re-exported as type-only exports:

```ts
import type {
  SparqlTerm,
  SparqlTriple,
  SparqlAlgebraNode,
  SparqlExpression,
  SparqlProjectionItem,
  SparqlOrderCondition,
  SparqlAggregateBinding,
  SparqlSelectPlan,
  SparqlInsertDataPlan,
  SparqlDeleteInsertPlan,
  SparqlDeleteWherePlan,
  SparqlPlan,
  SparqlOptions,
} from '@_linked/core/sparql';
```

---

## Implementing a SPARQL store

To implement a SPARQL-backed `IQuadStore`:

```ts
import type {IQuadStore} from '@_linked/core/interfaces/IQuadStore';
import type {SelectQuery} from '@_linked/core/queries/SelectQuery';
import type {CreateQuery} from '@_linked/core/queries/CreateQuery';
import type {UpdateQuery} from '@_linked/core/queries/UpdateQuery';
import type {DeleteQuery, DeleteResponse} from '@_linked/core/queries/DeleteQuery';
import type {SelectResult, CreateResult, UpdateResult} from '@_linked/core/queries/IntermediateRepresentation';
import {
  selectToSparql,
  createToSparql,
  updateToSparql,
  deleteToSparql,
  mapSparqlSelectResult,
  mapSparqlCreateResult,
  mapSparqlUpdateResult,
} from '@_linked/core/sparql';
import type {SparqlJsonResults, SparqlOptions} from '@_linked/core/sparql';

export class SparqlStore implements IQuadStore {
  constructor(private endpoint: string, private options?: SparqlOptions) {}

  async selectQuery(query: SelectQuery): Promise<SelectResult> {
    const sparql = selectToSparql(query, this.options);
    const json: SparqlJsonResults = await this.executeSparqlQuery(sparql);
    return mapSparqlSelectResult(json, query);
  }

  async createQuery(query: CreateQuery): Promise<CreateResult> {
    const sparql = createToSparql(query, this.options);
    const generatedUri = /* extract from the SPARQL or pre-generate */;
    await this.executeSparqlUpdate(sparql);
    return mapSparqlCreateResult(generatedUri, query);
  }

  async updateQuery(query: UpdateQuery): Promise<UpdateResult> {
    const sparql = updateToSparql(query, this.options);
    await this.executeSparqlUpdate(sparql);
    return mapSparqlUpdateResult(query);
  }

  async deleteQuery(query: DeleteQuery): Promise<DeleteResponse> {
    const sparql = deleteToSparql(query, this.options);
    await this.executeSparqlUpdate(sparql);
    return {deleted: query.ids, count: query.ids.length};
  }

  private async executeSparqlQuery(sparql: string): Promise<SparqlJsonResults> {
    // POST to endpoint with Content-Type: application/sparql-query
    // Parse JSON response
  }

  private async executeSparqlUpdate(sparql: string): Promise<void> {
    // POST to endpoint with Content-Type: application/sparql-update
  }
}
```

---

## Known limitations

1. **Named graphs** — `SparqlGraph` algebra node type and `graph` fields on plans are defined but not produced by the IR conversion. The current pipeline operates on the default graph.

2. **VALUES / SERVICE** — not supported in the algebra or serialization.

3. **Update functions** — the IR does not capture function expressions in update mutations (e.g., computed values). Update values must be concrete.

4. **Lateral / subquery** — SPARQL subqueries (SELECT inside WHERE) are not produced by the current IR conversion.

5. **Property key uniqueness** — two properties with the same `localName()` (last URI segment) in the same projection will cause a descriptive error. This is by design — the result row uses short property names as JS object keys.
