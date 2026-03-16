# Prefixed URIs in JSON/Object Formats — Ideation

## Context

Currently, users writing shape definitions and queries interact with URIs in two primary ways:

1. **`NodeReferenceValue` objects** — `{id: 'http://xmlns.com/foaf/0.1/knows'}` — verbose but explicit
2. **Ontology module exports** — `import {foaf} from '../ontologies/foaf'; foaf.knows` — ergonomic but requires imports

The `Prefix` registry (`Prefix.ts`) already supports bidirectional conversion:
- `Prefix.toFull('foaf:knows')` → `'http://xmlns.com/foaf/0.1/knows'` (throws if unknown prefix)
- `Prefix.toFullIfPossible('foaf:knows')` → resolves or returns original
- `Prefix.toPrefixed('http://...')` → `'foaf:knows'` (for SPARQL rendering)

The property path system (phases 1–6) already accepts prefixed strings in path expressions: `@literalProperty({path: 'foaf:knows/foaf:name'})`. The parser preserves them as raw strings. But the `{id}` form and `NodeReferenceValue` inputs throughout the codebase don't support prefixed names — they always expect full IRIs.

### Key entry points that accept URIs from users

| Location | Current type | Example |
|----------|-------------|---------|
| `@literalProperty({path})` | `PropertyPathDecoratorInput` | `path: foaf.name` or `path: 'foaf:name/foaf:nick'` |
| `@objectProperty({path, shape, class})` | same + `NodeReferenceValue` | `class: rdf.Class` |
| `static targetClass` | `NodeReferenceValue` | `static targetClass = {id: 'http://...'}` |
| `PropertyShapeConfig.equals/disjoint/hasValue` | `NodeReferenceValue \| string` | `equals: rdf.type` |
| `PropertyShapeConfig.in` | `NodeReferenceValue[]` | `in: [rdf.type, rdf.Property]` |
| `LiteralPropertyShapeConfig.datatype` | `NodeReferenceValue \| string` | `datatype: xsd.integer` |
| `.for(id)` / `.forAll(ids)` | `string \| NodeReferenceValue` | `.for({id: '...'})` |
| `.where(...).equals(val)` | `JSNonNullPrimitive \| NodeReferenceValue` | `.equals({id: '...'})` |

### Relevant code

- `src/utils/Prefix.ts` — prefix registry with `toFull()`, `toPrefixed()`
- `src/utils/NodeReference.ts` — `NodeReferenceValue = {id: string}`, `toNodeReference()`
- `src/shapes/SHACL.ts` — `toPlainNodeRef()`, `createPropertyShape()`
- `src/paths/normalizePropertyPath.ts` — already handles prefixed strings for paths
- `src/paths/PropertyPathExpr.ts` — `PathRef = string | {id: string}`

## Goals

Let users write prefixed names anywhere they currently write full IRIs in decorator configs, shape definitions, and query inputs. For example:

```ts
// Before
static targetClass = {id: 'http://xmlns.com/foaf/0.1/Person'};
@literalProperty({path: {id: 'http://xmlns.com/foaf/0.1/name'}, datatype: {id: 'http://www.w3.org/2001/XMLSchema#string'}})

// After
static targetClass = 'foaf:Person';
@literalProperty({path: 'foaf:name', datatype: 'xsd:string'})
```

## Open Questions

- [ ] 1. Where should prefix resolution happen — at decoration time (eager) or at consumption time (lazy)?
- [ ] 2. Should `NodeReferenceValue` be widened to accept strings, or add a new input type that resolves to `NodeReferenceValue`?
- [ ] 3. How to handle `targetClass` — it's a static class property typed as `NodeReferenceValue`, widening its type has broad implications
- [ ] 4. Should `PathRef` in the PathExpr AST resolve prefixed strings to full IRIs, or continue storing them raw?
- [ ] 5. Error behavior — what happens when a prefixed name references an unregistered prefix?
- [ ] 6. Scope — which input points to include in this change?

## Decisions

| # | Decision | Chosen | Rationale |
|---|----------|--------|-----------|

## Notes

