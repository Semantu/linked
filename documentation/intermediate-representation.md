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
4. Quantifiers are normalized (`some -> exists`, `every -> not exists(not ...)`).
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

## Select query shape

```ts
{
  kind: 'select_query',
  root: {
    kind: 'shape_scan',
    shape: {shapeId: 'shape:Person'},
    alias: 'p'
  },
  projection: [
    {
      kind: 'projection_item',
      alias: 'name',
      expression: {
        kind: 'property_expr',
        sourceAlias: 'p',
        property: {propertyShapeId: 'prop:name'}
      }
    }
  ],
  where: {
    kind: 'binary_expr',
    operator: '=',
    left: {
      kind: 'property_expr',
      sourceAlias: 'p',
      property: {propertyShapeId: 'prop:name'}
    },
    right: {kind: 'literal_expr', value: 'Semmy'}
  },
  orderBy: [
    {
      kind: 'order_by_item',
      expression: {
        kind: 'property_expr',
        sourceAlias: 'p',
        property: {propertyShapeId: 'prop:name'}
      },
      direction: 'ASC'
    }
  ],
  limit: 10,
  offset: 0
}
```

## Graph pattern node examples

### Traverse

```ts
{
  kind: 'traverse',
  from: 'p',
  to: 'f',
  property: {propertyShapeId: 'prop:friends'}
}
```

### Join + Optional

```ts
{
  kind: 'join',
  patterns: [
    {kind: 'shape_scan', shape: {shapeId: 'shape:Person'}, alias: 'p'},
    {
      kind: 'optional',
      pattern: {
        kind: 'traverse',
        from: 'p',
        to: 'f',
        property: {propertyShapeId: 'prop:friends'}
      }
    }
  ]
}
```

## Expression node examples

### Logical expression

```ts
{
  kind: 'logical_expr',
  operator: 'and',
  expressions: [
    {
      kind: 'binary_expr',
      operator: '=',
      left: {kind: 'property_expr', sourceAlias: 'p', property: {propertyShapeId: 'prop:name'}},
      right: {kind: 'literal_expr', value: 'Semmy'}
    },
    {
      kind: 'binary_expr',
      operator: '!=',
      left: {kind: 'property_expr', sourceAlias: 'p', property: {propertyShapeId: 'prop:hobby'}},
      right: {kind: 'literal_expr', value: null}
    }
  ]
}
```

### Exists expression (normalized `some`)

```ts
{
  kind: 'exists_expr',
  pattern: {
    kind: 'traverse',
    from: 'p',
    to: 'f',
    property: {propertyShapeId: 'prop:friends'}
  }
}
```

## Mutation IR shapes

### Create

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

### Update

```ts
{
  kind: 'update_mutation',
  shape: {shapeId: 'shape:Person'},
  id: 'id:person-1',
  updates: {
    shape: {shapeId: 'shape:Person'},
    fields: [
      {property: {propertyShapeId: 'prop:name'}, value: 'Alicia'}
    ]
  }
}
```

### Delete

```ts
{
  kind: 'delete_mutation',
  shape: {shapeId: 'shape:Person'},
  ids: [{id: 'id:person-1'}]
}
```
