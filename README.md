# @_linked/core
Core Linked package for the query DSL, SHACL shape decorators/metadata, and package registration.

Linked core gives you a type-safe, schema-parameterized query language and SHACL-driven Shape classes for linked data. It compiles queries into a plain JS query object that can be executed by a store.

## Linked core offers

- **Schema-Parameterized Query DSL**: TypeScript-embedded queries driven by your Shape definitions.
- **Shape Classes (SHACL)**: TypeScript classes that generate SHACL shape metadata.
- **Object-Oriented Data Operations**: Query, create, update, and delete data using the same Shape-based API.
- **Storage Routing**: `LinkedStorage` routes query objects to your configured store(s) that implement `IQuadStore`.
- **Automatic Data Validation**: SHACL shapes can be synced to your store for schema-level validation, and enforced at runtime by stores that support it.

## Installation

```bash
npm install @_linked/core
```

```typescript
import {Shape, LinkedStorage} from '@_linked/core';
import {linkedPackage} from '@_linked/core/utils/Package';
```

## Related packages

- `@_linked/rdf-mem-store`: in-memory RDF store that implements `IQuadStore`.
- `@_linked/react`: React bindings for Linked queries and shapes.

## Linked Package Setup

Linked packages expose shapes, utilities, and ontologies through a small `package.ts` file. This makes module exports discoverable across Linked modules and enables linked decorators.

**Minimal `package.ts`**
```typescript
import {linkedPackage} from '@_linked/core/utils/Package';

export const {
  linkedShape,
  linkedUtil,
  linkedOntology,
  registerPackageExport,
  registerPackageModule,
  packageExports,
  getPackageShape,
} = linkedPackage('my-package-name');
```

**Decorators and helpers**
- `@linkedShape`: registers a Shape class and generates SHACL shape metadata
- `@linkedUtil`: exposes utilities to other Linked modules
- `linkedOntology(...)`: registers an ontology and (optionally) its data loader
- `registerPackageExport(...)`: manually export something into the Linked package tree
- `registerPackageModule(...)`: lower-level module registration
- `getPackageShape(...)`: resolve a Shape class by name to avoid circular imports

## Shapes

Linked uses Shape classes to generate SHACL metadata. Paths, target classes, and node kinds are expressed as `NodeReferenceValue` objects: `{id: string}`.

```typescript
import {Shape} from '@_linked/core';
import {ShapeSet} from '@_linked/core/collections/ShapeSet';
import {literalProperty, objectProperty} from '@_linked/core/shapes/SHACL';
import {createNameSpace} from '@_linked/core/utils/NameSpace';
import {linkedShape} from './package';

const schema = createNameSpace('https://schema.org/');
const PersonClass = schema('Person');
const name = schema('name');
const knows = schema('knows');

@linkedShape
export class Person extends Shape {
  static targetClass = PersonClass;

  @literalProperty({path: name, required: true, maxCount: 1})
  declare name: string;

  @objectProperty({path: knows, shape: Person})
  declare knows: ShapeSet<Person>;
}
```

## Queries: Create, Select, Update, Delete

Queries are expressed with the same Shape classes and compile to a query object that a store executes.
Use this section as a quick start. Detailed query variations are documented in `Query examples` below.

A few quick examples:

**1) Select one field for all matching nodes**
```typescript
const names = await Person.select((p) => p.name);
/* names: {id: string; name: string}[] */
```

**2) Select all decorated fields of nested related nodes**
```typescript
const allFriends = await Person.select((p) => p.knows.selectAll());
/* allFriends: {
  id?: string; 
  knows: {
    id?: string; 
    ...all decorated Person fields...
  }[]
	}[] */
```

**3) Apply a simple mutation**
```typescript
const myNode = {id: 'https://my.app/node1'};
const updated = await Person.update(myNode, {
  name: 'Alicia',
});
/* updated: {id: string} & UpdatePartial<Person> */
```

## Storage configuration

`LinkedStorage` is the routing helper (not an interface). It forwards query objects to a store that implements `IQuadStore`.

```typescript
import {LinkedStorage} from '@_linked/core';
import {InMemoryStore} from '@_linked/rdf-mem-store';

LinkedStorage.setDefaultStore(new InMemoryStore());
```

You can also route specific shapes to specific stores:

```typescript
LinkedStorage.setStoreForShapes(new InMemoryStore(), Person);
```

## Automatic data validation

SHACL shapes are ideal for data validation. Linked generates SHACL shapes from your TypeScript Shape classes, which you can sync to your store for schema-level validation. When your store enforces those shapes at runtime, you get both schema validation and runtime enforcement for extra safety.

## Schema-Parameterized Query DSL

The query DSL is schema-parameterized: you define your own SHACL shapes, and Linked exposes a type-safe, object-oriented query API for those shapes.

### Query feature overview (core)

- Basic selection (literals, objects, dates, booleans)
- Target a specific subject by `{id}` or instance
- Multiple paths and mixed results
- Nested paths (deep selection)
- Sub-queries on object/set properties
- Filtering with `where(...)` and `equals(...)`
- `and(...)` / `or(...)` combinations
- Set filtering with `some(...)` / `every(...)` (and implicit `some`)
- Outer `where(...)` chaining
- Counting with `.size()`
- Custom result formats (object mapping)
- Type casting with `.as(Shape)`
- Sorting, limiting, and `.one()`
- Query context variables
- Preloading (`preloadFor`) for component-like queries
- Create / Update / Delete mutations

### Query examples

Result types are inferred from your Shape definitions and the selected paths. Examples below show abbreviated result shapes.

#### Basic selection
```typescript
/* names: {id: string; name: string}[] */
const names = await Person.select((p) => p.name);

/* friends: {
  id: string; 
  knows: { id: string }[]
}[] */
const friends = await Person.select((p) => p.knows);

const dates = await Person.select((p) => [p.birthDate, p.name]);
const flags = await Person.select((p) => p.isRealPerson);
```

#### Target a specific subject
```typescript
const myNode = {id: 'https://my.app/node1'};
/* Result: {id: string; name: string} | null */
const one = await Person.select(myNode, (p) => p.name);
const missing = await Person.select({id: 'https://my.app/missing'}, (p) => p.name); // null
```

#### Multiple paths + nested paths
```typescript
/* Result: Array<{id: string; name: string; knows: Array<{id: string}>; bestFriend: {id: string; name: string}}> */
const mixed = await Person.select((p) => [p.name, p.knows, p.bestFriend.name]);
const deep = await Person.select((p) => p.knows.bestFriend.name);
```

#### Sub-queries
```typescript
const detailed = await Person.select((p) =>
  p.knows.select((f) => f.name),
);

const allPeople = await Person.selectAll();

const detailedAll = await Person.select((p) =>
  p.knows.selectAll(),
);
```

#### Where + equals
```typescript
const filtered = await Person.select().where((p) => p.name.equals('Semmy'));
const byRef = await Person.select().where((p) =>
  p.bestFriend.equals({id: 'https://my.app/node3'}),
);
```

#### And / Or
```typescript
const andQuery = await Person.select((p) =>
  p.knows.where((f) =>
    f.name.equals('Moa').and(f.hobby.equals('Jogging')),
  ),
);
const orQuery = await Person.select((p) =>
  p.knows.where((f) =>
    f.name.equals('Jinx').or(f.hobby.equals('Jogging')),
  ),
);
```

#### Set filtering (some/every)
```typescript
const implicitSome = await Person.select().where((p) =>
  p.knows.name.equals('Moa'),
);
const explicitSome = await Person.select().where((p) =>
  p.knows.some((f) => f.name.equals('Moa')),
);
const every = await Person.select().where((p) =>
  p.knows.every((f) => f.name.equals('Moa').or(f.name.equals('Jinx'))),
);
```

#### Outer where chaining
```typescript
const outer = await Person.select((p) => p.knows).where((p) =>
  p.name.equals('Semmy'),
);
```

#### Counting (size)
```typescript
/* Result: Array<{id: string; knows: number}> */
const count = await Person.select((p) => p.knows.size());
```

#### Custom result formats
```typescript
/* Result: Array<{id: string; nameIsMoa: boolean; numFriends: number}> */
const custom = await Person.select((p) => ({
  nameIsMoa: p.name.equals('Moa'),
  numFriends: p.knows.size(),
}));
```

#### Query As (type casting to a sub shape)
If person.pets returns an array of Pets. And Dog extends Pet.
And you want to select properties of those pets that are dogs:
```typescript
const guards = await Person.select((p) => p.pets.as(Dog).guardDogLevel);
```

#### Sorting, limiting, one
```typescript
const sorted = await Person.select((p) => p.name).sortBy((p) => p.name, 'ASC');
const limited = await Person.select((p) => p.name).limit(1);
const single = await Person.select((p) => p.name).one();
```

#### Query context
Query context lets you inject request-scoped values (like the current user) into filters without threading them through every call.

```typescript
setQueryContext('user', {id: 'https://my.app/user1'}, Person);
const ctx = await Person.select((p) => p.name).where((p) =>
  p.bestFriend.equals(getQueryContext('user')),
);
```

#### Preload
Preloading appends another query to the current query so the combined data is loaded in one round-trip. This is helpful when rendering a nested tree of components and loading all data at once.

```typescript
const preloaded = await Person.select((p) => [
  p.hobby,
  p.bestFriend.preloadFor(ChildComponent),
]);
```

#### Create

```typescript
/* Result: {id: string} & UpdatePartial<Person> */
const created = await Person.create({name: 'Alice'});
```
Where UpdatePartial<Shape> reflects the created properties.

#### Update

Update will patch any property that you send as payload and leave the rest untouched.
```typescript
/* Result: {id: string} & UpdatePartial<Person> */
const updated = await Person.update({id: 'https://my.app/node1'}, {name: 'Alicia'});
```
Returns:
```json
{
  id:"https://my.app/node1",
  name:"Alicia"
}
```

**Updating multi-value properties**
When updating a property that holds multiple values (one that returns an array in the results), you can either overwrite all the values with a new explicit array of values, or delete from/add to the current values.

To overwrite all values:
```typescript
// Overwrite the full set of "knows" values.
const overwriteFriends = await Person.update({id: 'https://my.app/person1'}, {
  knows: [{id: 'https://my.app/person2'}],
});
```
The result will contain an object with `updatedTo`, to indicate that previous values were overwritten to this new set of values:
```json
{
  id: "https://my.app/person1",
  knows: {
    updatedTo: [{id:"https://my.app/person2"}],
  }
}
``` 

To make incremental changes to the current set of values you can provide an object with `add` and/or `remove` keys:
```typescript
// Add one value and remove one value without replacing the whole set.
const addRemoveFriends = await Person.update({id: 'https://my.app/person1'}, {
  knows: {
    add: [{id: 'https://my.app/person2'}],
    remove: [{id: 'https://my.app/person3'}],
  },
});
```
This returns an object with the added and removed items
```json
{
  id: "https://my.app/person1",
  knows: {
    added?: [{id:"https://my.app/person2"},
    removed?: [{id:"https://my.app/person3"}],
  }
}
```


#### Delete
To delete a node entirely:

```typescript
/* Result: {deleted: Array<{id: string}>, count: number} */
const deleted = await Person.delete({id: 'https://my.app/node1'});
```
Returns
```json
{
  deleted:[
    {id:"https://my.app/node1"}
  ],
  count:1
}
```

To delete multiple nodes pass an array:

```typescript
/* Result: {deleted: Array<{id: string}>, count: number} */
const deleted = await Person.delete([{id: 'https://my.app/node1'},{id: 'https://my.app/node2'}]);
```


## Extending shapes

Shape classes can extend other shape classes. Subclasses inherit property shapes from their superclasses and may override them.
This example assumes `Person` from the `Shapes` section above.

```typescript
import {literalProperty} from '@_linked/core/shapes/SHACL';
import {createNameSpace} from '@_linked/core/utils/NameSpace';
import {linkedShape} from './package';

const schema = createNameSpace('https://schema.org/');
const EmployeeClass = schema('Employee');
const name = schema('name');
const employeeId = schema('employeeId');

@linkedShape
export class Employee extends Person {
  static targetClass = EmployeeClass;

  // Override inherited "name" with stricter constraints (still maxCount: 1)
  @literalProperty({path: name, required: true, minLength: 2, maxCount: 1})
  declare name: string;

  @literalProperty({path: employeeId, required: true, maxCount: 1})
  declare employeeId: string;
}
```

Override behavior:

- `NodeShape.getUniquePropertyShapes()` returns one property shape per label, with subclass overrides taking precedence.
- Overrides must be tighten-only for `minCount`, `maxCount`, and `nodeKind` (widening is rejected at registration time).
- If an override omits `minCount`, `maxCount`, or `nodeKind`, inherited values are kept.
- Current scope: compatibility checks for `datatype`, `class`, and `pattern` are not enforced yet.

## TODO

- Allow `preloadFor` to accept another query (not just a component).
- Make and expose functions for auto syncing shapes to the graph.

## Changelog

- Added `Shape.selectAll()` to select all decorated property shapes of a shape in one call.
- Updated `selectAll()` to deduplicate inherited overridden property labels so subclass overrides are selected once.
- Added `NodeShape.getUniquePropertyShapes()` to expose deduplicated inherited property shapes directly on the shape metadata API.
- Simplified `NodeShape.getUniquePropertyShapes()` to always resolve across the inheritance chain.
- Added registration-time override guards so subclass overrides cannot widen `minCount`/`maxCount`/`nodeKind` constraints.

See [CHANGELOG.md](./CHANGELOG.md).
