# Comparison: Linked vs JS/TS ORM & Query Libraries

This document compares **Linked** — a type-safe, graph-first query DSL for RDF/semantic web data — with the most popular JavaScript/TypeScript ORM, OGM, and query builder libraries.

Linked's design draws inspiration from **SQLAlchemy** (Python), particularly its expression language, declarative schema mapping, and separation of query construction from execution.

---

## Overview of the Landscape

| Library | Category | Data Model | GitHub Stars | npm Downloads/wk |
|---------|----------|------------|-------------|-----------------|
| **Prisma** | ORM | Relational | ~42k | ~3M |
| **TypeORM** | ORM | Relational | ~34k | ~1.5M |
| **Drizzle ORM** | ORM / Query Builder | Relational | ~28k | ~1M |
| **Sequelize** | ORM | Relational | ~29k | ~1.5M |
| **MikroORM** | ORM | Relational + Mongo | ~8k | ~200k |
| **Knex.js** | Query Builder | Relational | ~19k | ~1.5M |
| **Kysely** | Query Builder | Relational | ~12k | ~500k |
| **Objection.js** | ORM (on Knex) | Relational | ~7k | ~150k |
| **Neo4j GraphQL** | OGM | Graph (LPG) | ~5k | ~50k |
| **Neogma** | OGM | Graph (LPG) | ~400 | ~5k |
| **Linked** | Query DSL | Graph (RDF) | — | — |

---

## Detailed Comparisons

### 1. Prisma

**Type:** Schema-first ORM with generated client.

```prisma
// schema.prisma
model User {
  id    Int     @id @default(autoincrement())
  name  String
  posts Post[]
}
```
```typescript
const users = await prisma.user.findMany({
  where: { name: { contains: 'Alice' } },
  include: { posts: true },
});
```

| Aspect | Prisma | Linked |
|--------|--------|--------|
| **Schema definition** | `.prisma` schema file (custom DSL) | TypeScript classes + decorators → SHACL |
| **Type safety** | Generated types from schema file | Inferred from property access in lambdas |
| **Query style** | Object-based filters (`{ where: { ... } }`) | Expression chains (`p.name.equals(...)`) |
| **Relationships** | `include` / `select` nesting | Natural property traversal (`p.friends.name`) |
| **Computed fields** | Limited (raw SQL) | Rich expression system (`p.age.plus(10)`) |
| **Backend** | PostgreSQL, MySQL, SQLite, MongoDB, CockroachDB | SPARQL endpoints, RDF quad stores |
| **Query AST** | Internal (Prisma Engine, Rust) | Exposed, JSON-serializable IR |
| **Codegen required** | Yes (`prisma generate`) | No |

**Key difference:** Prisma's strength is developer experience for relational data with zero-cost type safety via codegen. Linked achieves type safety without codegen through TypeScript's type inference on property-access proxies.

---

### 2. Drizzle ORM

**Type:** TypeScript-first SQL ORM with an expression-based query API. **Most similar to SQLAlchemy's Core expression language.**

```typescript
// Schema
const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  age: integer('age'),
});

// Query (SQL-like API)
const result = await db
  .select({ name: users.name })
  .from(users)
  .where(eq(users.name, 'Alice'));

// Query (relational API)
const result = await db.query.users.findMany({
  with: { posts: true },
  where: (user, { eq }) => eq(user.name, 'Alice'),
});
```

| Aspect | Drizzle | Linked |
|--------|---------|--------|
| **Schema definition** | TypeScript table definitions | TypeScript Shape classes + decorators |
| **Type safety** | Full inference from schema objects | Full inference from property-access proxies |
| **Query style** | SQL-mirroring function calls + relational API | Lambda-based expression chains |
| **Expression language** | `eq()`, `gt()`, `and()` functions | `.equals()`, `.gt()`, `.and()` methods |
| **Relationships** | `with: { ... }` in relational API | Property traversal (`p.friends.name`) |
| **Computed fields** | SQL expressions (`sql\`...\``) | Method chains (`p.age.plus(10).lt(100)`) |
| **Backend** | PostgreSQL, MySQL, SQLite | SPARQL endpoints, RDF quad stores |
| **Query AST** | Internal SQL AST | Exposed, JSON-serializable IR |
| **Migrations** | Built-in (`drizzle-kit`) | SHACL shape sync |

**Key difference:** Drizzle is the closest SQL-world analog to Linked's expression-based approach. Both use TypeScript inference heavily. The core difference is data model: Drizzle targets tables/rows, Linked targets graphs/triples.

---

### 3. TypeORM

**Type:** Decorator-based ORM inspired by Hibernate/Doctrine. Supports both Active Record and Data Mapper patterns.

```typescript
@Entity()
class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @OneToMany(() => Post, post => post.author)
  posts: Post[];
}

const users = await userRepo.find({
  where: { name: 'Alice' },
  relations: ['posts'],
});
```

| Aspect | TypeORM | Linked |
|--------|---------|--------|
| **Schema definition** | Decorators on entity classes | Decorators on Shape classes |
| **Type safety** | Partial (string-based relation names) | Full inference from lambdas |
| **Query style** | Repository API + QueryBuilder | Expression-chain DSL |
| **Relationships** | `@OneToMany`, `@ManyToOne`, explicit joins | `@objectProperty`, natural traversal |
| **Expression language** | QueryBuilder with string column refs | Typed method chains |
| **Backend** | 10+ SQL databases | SPARQL endpoints, RDF quad stores |
| **Patterns** | Active Record + Data Mapper | Shape-based graph queries |

**Key difference:** TypeORM's decorator pattern is superficially similar to Linked's `@linkedShape` / `@literalProperty` / `@objectProperty`, but TypeORM maps to relational tables while Linked maps to RDF shapes. TypeORM's QueryBuilder uses string-based column references, losing type safety.

---

### 4. MikroORM

**Type:** Data Mapper ORM with Unit of Work and Identity Map. **Most architecturally similar to SQLAlchemy.**

```typescript
@Entity()
class User {
  @PrimaryKey()
  id!: number;

  @Property()
  name!: string;

  @OneToMany(() => Post, post => post.author)
  posts = new Collection<Post>(this);
}

const users = await em.find(User, { name: 'Alice' }, {
  populate: ['posts'],
});
```

| Aspect | MikroORM | Linked |
|--------|----------|--------|
| **Schema definition** | Decorators or `EntitySchema` | Decorators on Shape classes |
| **Type safety** | Good (typed filters, EntitySchema) | Full inference from lambdas |
| **Unit of Work** | Yes (like SQLAlchemy Session) | No (stateless queries) |
| **Identity Map** | Yes | No |
| **Query style** | `em.find()` with typed filters + QueryBuilder | Expression-chain DSL |
| **Relationships** | Collections, `populate` | `ShapeSet`, property traversal |
| **Backend** | PostgreSQL, MySQL, SQLite, MongoDB | SPARQL endpoints, RDF quad stores |
| **Change tracking** | Automatic (UoW flushes changes) | Explicit mutations (CreateBuilder, UpdateBuilder) |

**Key difference:** MikroORM is the JS library most like SQLAlchemy, with Unit of Work, Identity Map, and Data Mapper. Linked takes a different path — stateless, expression-first queries without object state tracking. This makes Linked more similar to SQLAlchemy's *Core* (expression language) than its *ORM* (session/UoW).

---

### 5. Sequelize

**Type:** Promise-based ORM, one of the oldest and most established in Node.js.

```typescript
const User = sequelize.define('User', {
  name: { type: DataTypes.STRING },
});

const users = await User.findAll({
  where: { name: { [Op.like]: '%Alice%' } },
  include: [{ model: Post }],
});
```

| Aspect | Sequelize | Linked |
|--------|-----------|--------|
| **Schema definition** | `define()` calls or decorators (v7) | Decorators on Shape classes |
| **Type safety** | Bolt-on (originally JS, TS added later) | First-class TypeScript inference |
| **Query style** | Object-based operators (`Op.like`, `Op.gt`) | Method chains (`.equals()`, `.gt()`) |
| **Relationships** | `hasMany`, `belongsTo`, `include` | `@objectProperty`, property traversal |
| **Backend** | PostgreSQL, MySQL, SQLite, MSSQL | SPARQL endpoints, RDF quad stores |

**Key difference:** Sequelize is mature but shows its age in TypeScript support. Linked was designed TypeScript-first, resulting in much stronger type inference.

---

### 6. Kysely

**Type:** Type-safe SQL query builder. No ORM layer.

```typescript
const result = await db
  .selectFrom('users')
  .select(['name', 'age'])
  .where('name', '=', 'Alice')
  .execute();
```

| Aspect | Kysely | Linked |
|--------|--------|--------|
| **Type safety** | Full (from DB type interface) | Full (from Shape property access) |
| **Query style** | SQL-mirroring method chains | Expression-based lambdas |
| **Schema** | Manual TypeScript interface | Decorator-based Shape classes |
| **Scope** | Query builder only (no schema mgmt) | Full DSL (queries + mutations + schema) |
| **Backend** | PostgreSQL, MySQL, SQLite | SPARQL endpoints, RDF quad stores |
| **Query AST** | Internal, accessible via `.compile()` | Exposed, JSON-serializable IR |

**Key difference:** Kysely is the purest "query builder" in the SQL space. Linked serves a similar role for SPARQL/RDF but adds schema management and mutation builders.

---

### 7. Knex.js / Objection.js

**Knex** is a SQL query builder; **Objection.js** adds an ORM layer on top.

```typescript
// Knex
const users = await knex('users').where('name', 'Alice').select('name');

// Objection
const users = await User.query()
  .where('name', 'Alice')
  .withGraphFetched('posts');
```

| Aspect | Knex / Objection | Linked |
|--------|-----------------|--------|
| **Type safety** | Minimal (Knex) / Moderate (Objection) | Full inference |
| **Query style** | Method chaining with string columns | Typed expression chains |
| **Schema** | JSON Schema (Objection) | SHACL Shapes |
| **Relationships** | `relationMappings` (Objection) | `@objectProperty` decorators |
| **Graph fetching** | `withGraphFetched` (eager) / `withGraphJoined` | Natural property traversal |

---

### 8. Graph Database Libraries

#### Neo4j GraphQL / OGM

```typescript
const typeDefs = `
  type User {
    name: String!
    friends: [User!]! @relationship(type: "KNOWS", direction: OUT)
  }
`;
// Uses GraphQL schema to auto-generate Cypher queries
```

#### Neogma

```typescript
const Users = new ModelFactory({
  label: 'User',
  schema: { name: { type: 'string', required: true } },
  relationships: {
    knows: { model: Users, direction: 'out', type: 'KNOWS' },
  },
});
```

| Aspect | Neo4j OGM / Neogma | Linked |
|--------|-------------------|--------|
| **Data model** | Labeled Property Graph (LPG) | RDF (triples/quads) |
| **Schema** | GraphQL SDL / JSON config | TypeScript decorators → SHACL |
| **Query language** | Cypher (auto-generated) | SPARQL (auto-generated from IR) |
| **Type safety** | GraphQL types / moderate | Full TypeScript inference |
| **Standards** | Neo4j-specific | W3C standards (RDF, SHACL, SPARQL) |
| **Expression system** | Limited (Cypher passthrough) | Rich, composable expressions |
| **Portability** | Neo4j only | Any SPARQL endpoint / quad store |

**Key difference:** Neo4j tools are tied to a single vendor. Linked targets the open W3C semantic web stack, making it backend-portable.

---

## Cross-Cutting Comparison

### Type Safety

| Library | Approach | Codegen? | Inference Quality |
|---------|----------|----------|------------------|
| **Linked** | Proxy-based property tracing in lambdas | No | Excellent — full path inference |
| **Prisma** | Generated client from schema | Yes | Excellent |
| **Drizzle** | Schema objects as type source | No | Excellent |
| **Kysely** | Manual DB type interface | No | Excellent |
| **MikroORM** | Decorators + EntitySchema | No | Good |
| **TypeORM** | Decorators | No | Partial (string refs lose types) |
| **Sequelize** | Bolt-on TS types | No | Fair |

### SQLAlchemy Pattern Comparison

Linked is inspired by SQLAlchemy. Here's how the JS/TS landscape maps to SQLAlchemy's key patterns:

| Pattern | SQLAlchemy | Linked | Closest SQL Alternative |
|---------|------------|--------|------------------------|
| **Expression Language** | `column.op(value)` chains | `p.field.op(value)` chains | **Drizzle** (`eq()`, `gt()` functions) |
| **Declarative Schema** | `class User(Base)` with `Column()` | `class Person extends Shape` with decorators | **TypeORM**, **MikroORM** (decorators) |
| **Unit of Work** | `Session` tracks/flushes changes | No (stateless) | **MikroORM** (`em.flush()`) |
| **Identity Map** | Objects cached per session | No | **MikroORM** |
| **Query as AST** | `query.statement` (compilable) | IR is JSON-serializable AST | **Kysely** (`.compile()`) |
| **Backend Abstraction** | Dialect system | `IQuadStore` interface | **Knex** / **Kysely** (dialect plugins) |
| **Relationship Loading** | `joinedload()`, `selectinload()` | Property traversal + `preloadFor()` | **Prisma** (`include`), **Objection** (`withGraphFetched`) |

### Query Paradigm

| Library | Query Style | Example |
|---------|-------------|---------|
| **Linked** | Lambda + expression chains | `Person.select(p => p.name).where(p => p.age.gt(18))` |
| **Prisma** | Nested object filters | `prisma.user.findMany({ where: { age: { gt: 18 } } })` |
| **Drizzle** | SQL-mirroring functions | `db.select().from(users).where(gt(users.age, 18))` |
| **TypeORM** | QueryBuilder + strings | `repo.createQueryBuilder('u').where('u.age > :age', { age: 18 })` |
| **MikroORM** | Typed filter objects | `em.find(User, { age: { $gt: 18 } })` |
| **Kysely** | SQL-mirroring chains | `db.selectFrom('users').where('age', '>', 18)` |
| **Sequelize** | Operator symbols | `User.findAll({ where: { age: { [Op.gt]: 18 } } })` |

---

## What Makes Linked Unique

1. **Graph-native data model** — Built for RDF/semantic web, not relational tables. Relationships are first-class, not join-based.

2. **W3C standards** — Schema (SHACL), query (SPARQL), data model (RDF) are all open standards. No vendor lock-in.

3. **Backend-agnostic IR** — The intermediate representation is a JSON-serializable AST that can target any backend, not just SPARQL.

4. **Zero-codegen type inference** — Full TypeScript type inference from property-access lambdas without any code generation step.

5. **Expression-first design** — Computed fields, filters, and updates all use the same composable expression system (`p.age.plus(10).lt(100)`).

6. **Query-as-data** — `QueryBuilder`, `FieldSet`, and IR are all serializable, enabling dynamic/runtime query construction (e.g., CMS dashboards building queries from user config).

7. **Unlimited graph traversal** — `p.friends.friends.name` traverses relationships to arbitrary depth, unlike SQL ORMs which require explicit joins or includes.

8. **Declarative mutations** — `CreateBuilder`, `UpdateBuilder`, `DeleteBuilder` with expression-based updates (`Person.update(p => ({ age: p.age.plus(1) }))`).

---

## Summary: Choosing Between Them

| If you need... | Use |
|---------------|-----|
| Relational DB + best DX | **Prisma** |
| Relational DB + SQL control + type safety | **Drizzle** or **Kysely** |
| SQLAlchemy-like patterns (UoW, Identity Map) | **MikroORM** |
| RDF/semantic web + type safety | **Linked** |
| Neo4j graph database | **Neo4j GraphQL** or **Neogma** |
| Legacy Node.js project | **Sequelize** or **Knex** |

Linked occupies a unique niche: it brings the developer experience quality of modern SQL ORMs (Prisma, Drizzle) to the semantic web / linked data world, while drawing architectural inspiration from SQLAlchemy's expression language and backend abstraction patterns.
