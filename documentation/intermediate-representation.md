# Intermediate Representation (IR)

IR stands for **Intermediate Representation**.

This document defines the canonical Linked query IR structure produced by `@_linked/core` for store/parser implementers.

## Design goals

- Backend-agnostic query contract (SPARQL/SQL/etc compilers can consume the same IR).
- Deterministic structure for golden fixtures.
- Preserve current DSL behavior while normalizing output shape.

## Canonical invariants

1. Every node has a `kind` discriminator.
2. Shape/property references are ID-based (`shapeId`, `propertyShapeId`).
3. Select projection is a flat list of `{alias, expression}`.
4. Quantifiers are normalized (`some` -> `exists_expr`, `every` -> `not_expr(exists_expr(not_expr(...)))`).
5. Mutation kinds remain explicit (`create_mutation`, `update_mutation`, `delete_mutation`).

## Pipeline architecture

The IR is produced by a three-stage pipeline, invoked by `buildSelectQueryIR()`:

```
SelectQuery (legacy) → Desugar → Canonicalize → Lower → IRSelectQuery
```

| Stage | File | Input | Output |
|---|---|---|---|
| **Desugar** | `IRDesugar.ts` | `SelectQuery` (legacy flat object) | `DesugaredSelectQuery` — selection paths, sub-selects, custom objects, where clauses in DSL-close form |
| **Canonicalize** | `IRCanonicalize.ts` | `DesugaredSelectQuery` | `CanonicalDesugaredSelectQuery` — quantifier rewrites (`some` → `exists`, `every` → `not exists(not …)`), boolean flattening, operator normalization |
| **Lower** | `IRLower.ts` | `CanonicalDesugaredSelectQuery` | `IRSelectQuery` — full AST with `IRShapeScanPattern` root, `IRTraversePattern` graph patterns, `IRExpression` trees for projection/where/orderBy |

Projection building (`IRProjection.ts`) and alias scoping (`IRAliasScope.ts`) are invoked by the lowering pass.

Mutation IR is produced separately by `IRMutation.ts` via `buildCanonicalMutationIR()`.

Intermediate types (`DesugaredSelectQuery`, `CanonicalDesugaredSelectQuery`, etc.) are internal to the pipeline and not part of the public API. Only the final types from `IntermediateRepresentation.ts` are intended for external consumption.

## Select query IR

The top-level select query type:

```ts
type IRSelectQuery = {
  kind: 'select_query';
  root: IRShapeScanPattern;     // shape scan entry point
  patterns: IRGraphPattern[];   // traversal patterns (joins, optional, etc.)
  projection: IRProjectionItem[]; // what to return
  where?: IRExpression;         // filter expression
  orderBy?: IROrderByItem[];    // sort specification
  limit?: number;
  offset?: number;
  subjectId?: string;           // target a specific node
  singleResult?: boolean;       // true if .one() or specific subject
  resultMap?: IRResultMap;      // maps projection aliases to result keys
};
```

### Basic selection

DSL: `Person.select((p) => p.name)`

```ts
{
  kind: 'select_query',
  root: {kind: 'shape_scan', shape: {shapeId: 'shape:Person'}, alias: 'a0'},
  patterns: [],
  projection: [
    {
      kind: 'projection_item',
      alias: 'a1',
      expression: {kind: 'property_expr', sourceAlias: 'a0', property: {propertyShapeId: 'prop:name'}}
    }
  ],
  resultMap: {kind: 'result_map', entries: [{key: 'prop:name', alias: 'a1'}]},
  singleResult: false
}
```

### Nested path selection

DSL: `Person.select((p) => p.friends.friends.name)`

```ts
{
  kind: 'select_query',
  root: {kind: 'shape_scan', shape: {shapeId: 'shape:Person'}, alias: 'a0'},
  patterns: [
    {kind: 'traverse', from: 'a0', to: 'a1', property: {propertyShapeId: 'prop:friends'}},
    {kind: 'traverse', from: 'a1', to: 'a2', property: {propertyShapeId: 'prop:friends'}}
  ],
  projection: [
    {
      kind: 'projection_item',
      alias: 'a1',
      expression: {kind: 'property_expr', sourceAlias: 'a2', property: {propertyShapeId: 'prop:name'}}
    }
  ],
  singleResult: false
}
```

### Where (equality filter)

DSL: `Person.select().where((p) => p.name.equals('Semmy'))`

```ts
{
  kind: 'select_query',
  root: {kind: 'shape_scan', shape: {shapeId: 'shape:Person'}, alias: 'a0'},
  patterns: [],
  projection: [],
  where: {
    kind: 'binary_expr',
    operator: '=',
    left: {kind: 'property_expr', sourceAlias: 'a0', property: {propertyShapeId: 'prop:name'}},
    right: {kind: 'literal_expr', value: 'Semmy'}
  },
  singleResult: false
}
```

### Where (exists — normalized `some`)

DSL: `Person.select().where((p) => p.friends.some((f) => f.name.equals('Moa')))`

```ts
{
  kind: 'select_query',
  root: {kind: 'shape_scan', shape: {shapeId: 'shape:Person'}, alias: 'a0'},
  patterns: [],
  projection: [],
  where: {
    kind: 'exists_expr',
    pattern: {kind: 'traverse', from: 'a0', to: 'a1', property: {propertyShapeId: 'prop:friends'}},
    filter: {
      kind: 'binary_expr',
      operator: '=',
      left: {kind: 'property_expr', sourceAlias: 'a1', property: {propertyShapeId: 'prop:name'}},
      right: {kind: 'literal_expr', value: 'Moa'}
    }
  },
  singleResult: false
}
```

### Where (every — normalized to not exists(not ...))

DSL: `Person.select().where((p) => p.friends.every((f) => f.name.equals('Moa')))`

```ts
{
  where: {
    kind: 'not_expr',
    expression: {
      kind: 'exists_expr',
      pattern: {kind: 'traverse', from: 'a0', to: 'a1', property: {propertyShapeId: 'prop:friends'}},
      filter: {
        kind: 'not_expr',
        expression: {
          kind: 'binary_expr',
          operator: '=',
          left: {kind: 'property_expr', sourceAlias: 'a1', property: {propertyShapeId: 'prop:name'}},
          right: {kind: 'literal_expr', value: 'Moa'}
        }
      }
    }
  }
}
```

### Logical expression (and/or)

DSL: `p.friends.some((f) => f.name.equals('Jinx')).and(p.name.equals('Semmy'))`

```ts
{
  where: {
    kind: 'logical_expr',
    operator: 'and',
    expressions: [
      {kind: 'exists_expr', pattern: {/* traverse */}, filter: {/* binary_expr */}},
      {kind: 'binary_expr', operator: '=', left: {/* property_expr */}, right: {/* literal_expr */}}
    ]
  }
}
```

### Aggregation (count/size)

DSL: `Person.select((p) => p.friends.size())`

```ts
{
  projection: [
    {
      kind: 'projection_item',
      alias: 'a1',
      expression: {
        kind: 'aggregate_expr',
        name: 'count',
        args: [{kind: 'property_expr', sourceAlias: 'a0', property: {propertyShapeId: 'prop:friends'}}]
      }
    }
  ]
}
```

### Sub-select with custom result object

DSL: `Person.select((p) => p.friends.select((f) => ({name: f.name, hobby: f.hobby})))`

The sub-select's custom keys appear in the `resultMap`:

```ts
{
  patterns: [
    {kind: 'traverse', from: 'a0', to: 'a1', property: {propertyShapeId: 'prop:friends'}}
  ],
  projection: [
    {kind: 'projection_item', alias: 'a2', expression: {kind: 'property_expr', sourceAlias: 'a1', property: {propertyShapeId: 'prop:name'}}},
    {kind: 'projection_item', alias: 'a3', expression: {kind: 'property_expr', sourceAlias: 'a1', property: {propertyShapeId: 'prop:hobby'}}}
  ],
  resultMap: {
    kind: 'result_map',
    entries: [
      {key: 'name', alias: 'a2'},
      {key: 'hobby', alias: 'a3'}
    ]
  }
}
```

### Type casting (as)

DSL: `Person.select((p) => p.pets.as(Dog).guardDogLevel)`

Type casting does not produce a separate IR node. The cast changes which properties are accessible at the DSL level, so the IR simply contains a traversal to the cast shape's property:

```ts
{
  patterns: [
    {kind: 'traverse', from: 'a0', to: 'a1', property: {propertyShapeId: 'prop:pets'}}
  ],
  projection: [
    {kind: 'projection_item', alias: 'a2', expression: {kind: 'property_expr', sourceAlias: 'a1', property: {propertyShapeId: 'prop:guardDogLevel'}}}
  ]
}
```

### Sorting

DSL: `Person.select((p) => p.name).sortBy((p) => p.name, 'DESC')`

```ts
{
  orderBy: [
    {
      kind: 'order_by_item',
      expression: {kind: 'property_expr', sourceAlias: 'a0', property: {propertyShapeId: 'prop:name'}},
      direction: 'DESC'
    }
  ]
}
```

### Subject targeting and singleResult

DSL: `Person.select({id: 'node:1'}, (p) => p.name)`

```ts
{
  subjectId: 'node:1',
  singleResult: true
  // ...projection, root, etc.
}
```

## Graph pattern types

| Kind | Fields | Description |
|---|---|---|
| `shape_scan` | `shape`, `alias` | Entry point — scan all instances of a shape |
| `traverse` | `from`, `to`, `property` | Follow a property edge between aliases |
| `join` | `patterns[]` | Combine multiple patterns |
| `optional` | `pattern` | Left-outer-join semantics |
| `union` | `branches[]` | OR-union of patterns |
| `exists_pattern` | `pattern` | Existence check pattern |

## Expression types

| Kind | Fields | Description |
|---|---|---|
| `literal_expr` | `value` | String, number, boolean, or null literal |
| `property_expr` | `sourceAlias`, `property` | Property access on an aliased node |
| `alias_expr` | `alias` | Reference to an alias |
| `binary_expr` | `operator`, `left`, `right` | Comparison (`=`, `!=`, `>`, `>=`, `<`, `<=`) |
| `logical_expr` | `operator`, `expressions[]` | Boolean combination (`and`, `or`) |
| `not_expr` | `expression` | Boolean negation |
| `exists_expr` | `pattern`, `filter?` | Existential check with optional filter |
| `aggregate_expr` | `name`, `args[]` | Aggregation (`count`, `sum`, `avg`, `min`, `max`) |
| `function_expr` | `name`, `args[]` | Named function call |

## Mutation IR

### Create

DSL: `Person.create({name: 'Alice'})`

```ts
{
  kind: 'create_mutation',
  shape: {shapeId: 'shape:Person'},
  description: {
    shape: {shapeId: 'shape:Person'},
    fields: [
      {property: {propertyShapeId: 'prop:name'}, value: 'Alice'}
    ]
  }
}
```

Nested creates produce nested `IRNodeDescription` objects in field values. ID references are `{id: string}` objects.

### Update

DSL: `Person.update({id: 'node:1'}, {name: 'Alicia'})`

```ts
{
  kind: 'update_mutation',
  shape: {shapeId: 'shape:Person'},
  id: 'node:1',
  updates: {
    shape: {shapeId: 'shape:Person'},
    fields: [
      {property: {propertyShapeId: 'prop:name'}, value: 'Alicia'}
    ]
  }
}
```

Set modifications use `{add?: [...], remove?: [...]}` instead of a direct value:

```ts
{
  property: {propertyShapeId: 'prop:friends'},
  value: {
    add: [{id: 'node:2'}],
    remove: [{id: 'node:3'}]
  }
}
```

Unsetting a field sets `value: undefined`.

### Delete

DSL: `Person.delete({id: 'node:1'})`

```ts
{
  kind: 'delete_mutation',
  shape: {shapeId: 'shape:Person'},
  ids: [{id: 'node:1'}]
}
```

## Extensibility

Adding new capabilities requires only new variants in the type unions — no structural pipeline changes:

- **New operators**: Add to `IRBinaryOperator` and handle in the canonicalize pass.
- **New expression types**: Add to the `IRExpression` union in `IntermediateRepresentation.ts` and emit from the lowering pass.
- **New graph patterns**: Add to the `IRGraphPattern` union.
- **Optimizations**: Can be implemented as additional passes between canonicalize and lower, or as post-lowering rewrites.
