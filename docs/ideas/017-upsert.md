---
summary: Introduce upsert (create-or-update) semantics to the mutation DSL
packages: [core]
---

# Upsert — Ideation

## Context

Linked currently supports `Person.create({...})` and `Person.update({...}).for({id})` as separate operations. There is no way to express "create if not exists, update if it does" in a single call.

### What exists today

**CreateBuilder** — `CreateBuilder.ts` (lines 1–147):
- `Person.create({ name: 'Alice' })` → builds `IRCreateMutation` → SPARQL INSERT DATA
- IR type (`IntermediateRepresentation.ts:189–193`):
  ```typescript
  type IRCreateMutation = { kind: 'create'; shape: string; data: IRNodeData; };
  ```
- Always generates a new URI via `generateEntityUri()` in SparqlStore (line 84)

**UpdateBuilder** — `UpdateBuilder.ts` (lines 1–205):
- `Person.update({ name: 'Bob' }).for({ id: '...' })` → builds `IRUpdateMutation` → SPARQL DELETE/INSERT WHERE
- IR type (`IntermediateRepresentation.ts:201–207`):
  ```typescript
  type IRUpdateMutation = { kind: 'update'; shape: string; id: string; data: IRNodeData; traversalPatterns?: IRTraversalPattern[]; };
  ```
- Supports expression-based updates: `Person.update(p => ({ age: p.age.plus(1) })).for({id})`
- Supports conditional updates: `.where(p => p.status.equals('pending'))`

**SparqlStore execution** — `SparqlStore.ts` (lines 78–120):
- `createQuery`: generates URI + INSERT DATA (line 88)
- `updateQuery`: DELETE/INSERT WHERE (lines 92–101)
- Each mutation is a single `executeSparqlUpdate(sparql)` call

**No upsert anywhere:**
- No "upsert" keyword in codebase
- No conditional create logic
- No SPARQL INSERT ... WHERE NOT EXISTS pattern

### How other libraries do it

**SQLAlchemy (PostgreSQL):**
```python
stmt = pg_insert(User).values(name='Alice', email='alice@example.com')
stmt = stmt.on_conflict_do_update(
    index_elements=['email'],
    set_={'name': stmt.excluded.name},
)
```

**Drizzle:**
```typescript
await db.insert(users).values({ email: 'x', name: 'Alice' })
  .onConflictDoUpdate({ target: users.email, set: { name: 'updated' } });
```

**Prisma:**
```typescript
await prisma.user.upsert({
  where: { email: 'alice@example.com' },
  update: { name: 'Alice Updated' },
  create: { email: 'alice@example.com', name: 'Alice' },
});
```

### RDF/SPARQL considerations

RDF doesn't have primary keys or unique constraints like SQL. Identity is by URI. This changes the upsert semantics:

- **SQL upsert**: "insert row; if unique constraint violated, update instead"
- **RDF upsert**: "ensure this node exists with these properties" — more naturally expressed as:
  1. DELETE existing triples for the given properties
  2. INSERT new triples
  3. Optionally: INSERT the rdf:type triple if the node doesn't exist yet

SPARQL pattern for upsert:
```sparql
DELETE { <node> <prop> ?old }
INSERT { <node> rdf:type <Type> . <node> <prop> <newValue> }
WHERE { OPTIONAL { <node> <prop> ?old } }
```

This is actually what `updateQuery` already does (DELETE old + INSERT new), except it requires the node to already exist via `.for({id})`.

## Goals

- Single API call to create-or-update a node
- Works naturally with RDF's URI-based identity (no unique constraint concept)
- Integrates with existing CreateBuilder/UpdateBuilder patterns
- Supports both "known ID" and "match by properties" use cases

## Open Questions

- [ ] Should the API be `Person.upsert({...})` (Prisma-style split) or `Person.createOrUpdate({...})` (simpler)?
- [ ] For the "known ID" case, should it just be `Person.update({...}).for({id}).createIfNotExists()`?
- [ ] For the "match by properties" case, should we support matching on property values (like SQL's ON CONFLICT)?
- [ ] Should upsert always require an explicit ID, or should it support auto-generating one if the node doesn't exist?
- [ ] How should expression-based updates work in upsert? (e.g., `age: p.age.plus(1)` — what if node doesn't exist yet?)
- [ ] Should we add a new IR mutation kind (`'upsert'`) or compose from existing create + update IR?

## Decisions

| # | Decision | Chosen | Rationale |
|---|----------|--------|-----------|

## Notes

- The simplest implementation: `Person.update({...}).for({id})` already does DELETE/INSERT WHERE. Making it also insert rdf:type if missing would effectively make it an upsert for the known-ID case
- Prisma's three-way split (`where` / `create` / `update`) may be overengineered for RDF where identity = URI
- A simpler RDF-native API might be: `Person.ensure({ id: '...', name: 'Alice' })` — "make sure this node has these values"
- Expression-based updates in upsert are tricky — `p.age.plus(1)` has no value if node doesn't exist. Could require a `defaultValue` or reject expressions in upsert create path
