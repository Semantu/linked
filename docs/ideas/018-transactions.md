---
summary: Add transaction support for batching multiple mutations atomically
packages: [core]
---

# Transactions — Ideation

## Context

Linked currently executes each mutation as a separate SPARQL UPDATE request. There is no way to batch multiple mutations into an atomic operation.

### What exists today

**IQuadStore interface** — `IQuadStore.ts` (lines 22–32):
```typescript
interface IQuadStore {
  init?(): Promise<any>;
  selectQuery(query: SelectQuery): Promise<SelectResult>;
  updateQuery?(query: UpdateQuery): Promise<UpdateResult>;
  createQuery?(query: CreateQuery): Promise<CreateResult>;
  deleteQuery?(query: DeleteQuery): Promise<DeleteResponse>;
}
```
No transaction methods, no batch support.

**SparqlStore execution** — `SparqlStore.ts` (lines 78–120):
- Each mutation immediately calls `await this.executeSparqlUpdate(sparql)`
- `createQuery` (line 88), `updateQuery` (lines 95/99), `deleteQuery` (lines 106/111/115) all execute independently
- Abstract method `executeSparqlUpdate(sparql: string): Promise<void>` (line 76)

**SPARQL mutation generation** — `IRMutation.ts` + store methods:
- Each mutation produces a separate SPARQL UPDATE string
- No mechanism to combine multiple UPDATE strings

### How other libraries do it

**SQLAlchemy:**
```python
with Session(engine) as session:
    with session.begin():
        session.add(User(name='Alice'))
        session.add(Post(title='Hello', author_id=1))
    # auto-commit; auto-rollback on exception

# Nested savepoints:
with session.begin():
    session.add(user)
    nested = session.begin_nested()  # SAVEPOINT
    try:
        session.add(duplicate)
        nested.commit()
    except:
        nested.rollback()  # only inner rolled back
```

**Drizzle:**
```typescript
await db.transaction(async (tx) => {
  const user = await tx.insert(users).values({ name: 'Alice' }).returning();
  await tx.insert(posts).values({ title: 'Hello', userId: user[0].id });
});
```

**Prisma:**
```typescript
// Sequential (batched)
const [user, post] = await prisma.$transaction([
  prisma.user.create({ data: { name: 'Alice' } }),
  prisma.post.create({ data: { title: 'Hello' } }),
]);

// Interactive
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: { name: 'Alice' } });
  await tx.post.create({ data: { title: 'Hello', authorId: user.id } });
});
```

### SPARQL transaction capabilities

SPARQL UPDATE natively supports batching multiple operations in a single request:
```sparql
INSERT DATA { <a> rdf:type <Person> . <a> <name> "Alice" } ;
INSERT DATA { <b> rdf:type <Post> . <b> <title> "Hello" . <b> <author> <a> } ;
```

Most SPARQL endpoints (Fuseki, GraphDB, Stardog) execute a single UPDATE request atomically. This means batching = transactions for free.

More advanced SPARQL endpoints also support named transactions, but this is not standardized.

## Goals

- Batch multiple mutations into a single SPARQL UPDATE request for atomicity
- Provide an API that feels natural alongside existing builder patterns
- Support both "fire-and-forget batch" and "interactive transaction" styles
- Keep it optional — single mutations should continue to work as before

## Open Questions

- [ ] Should the API be callback-based (`LinkedStorage.transaction(async (tx) => {...})`) or batch-based (`LinkedStorage.transaction([mut1, mut2])`), or both?
- [ ] For the callback style, how does `tx` relate to stores? Is it a temporary store wrapper that collects SPARQL strings?
- [ ] Should transactions be on `LinkedStorage` (global) or on individual stores?
- [ ] How should the result of intermediate mutations be accessed in interactive transactions (e.g., get created ID for use in next mutation)?
- [ ] Should `IQuadStore` get a `transaction()` method, or should batching happen at a higher level?
- [ ] How should transaction failure/rollback work? SPARQL doesn't have a standard rollback mechanism across endpoints.

## Decisions

| # | Decision | Chosen | Rationale |
|---|----------|--------|-----------|

## Notes

- Simplest approach: concatenate SPARQL UPDATE strings with `;` separator and send as one request. This gives atomicity on most SPARQL endpoints for free
- The interactive style (Drizzle/Prisma) requires a way to get intermediate results — tricky if we're just batching SPARQL strings. May need a two-phase approach: build all mutations, then execute as one request
- For the batch style, builders already produce SPARQL strings via `build()` — could collect these and send together
- SQLAlchemy's Unit of Work pattern (session tracks all changes, flushes at commit) is powerful but a big architectural shift. Probably not right for Linked's stateless design
- The `IQuadStore` interface change should be backward-compatible — `transaction?()` as optional method
