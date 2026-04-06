import {describe, expect, test} from '@jest/globals';
import {Person, Employee, tmpEntityBase} from '../test-helpers/query-fixtures';
import {sanitize} from '../test-helpers/test-utils';
import {FieldSet} from '../queries/FieldSet';
import {QueryBuilder} from '../queries/QueryBuilder';
import type {QueryBuilderJSON} from '../queries/QueryBuilder';

const personShape = Person.shape;

// =============================================================================
// FieldSet serialization tests
// =============================================================================

describe('FieldSet — serialization', () => {
  test('toJSON — simple fields', () => {
    const json = FieldSet.for(personShape, ['name', 'hobby']).toJSON();
    expect(json.shape).toBe(personShape.id);
    expect(json.fields).toHaveLength(2);
    expect(json.fields[0].path).toBe('name');
    expect(json.fields[1].path).toBe('hobby');
  });

  test('toJSON — nested path', () => {
    const json = FieldSet.for(personShape, ['friends.name']).toJSON();
    expect(json.fields).toHaveLength(1);
    expect(json.fields[0].path).toBe('friends.name');
  });

  test('fromJSON — round-trip', () => {
    const original = FieldSet.for(personShape, ['name', 'hobby']);
    const json = original.toJSON();
    const restored = FieldSet.fromJSON(json);
    expect(restored.labels()).toEqual(original.labels());
    expect(restored.entries.length).toBe(original.entries.length);
  });

  test('fromJSON — round-trip nested', () => {
    const original = FieldSet.for(personShape, ['friends.name', 'bestFriend.hobby']);
    const json = original.toJSON();
    const restored = FieldSet.fromJSON(json);
    expect(restored.entries.length).toBe(2);
    expect(restored.entries[0].path.toString()).toBe('friends.name');
    expect(restored.entries[1].path.toString()).toBe('bestFriend.hobby');
  });

  test('fromJSON — preserves alias', () => {
    const json = {
      shape: personShape.id,
      fields: [{path: 'name', as: 'personName'}],
    };
    const restored = FieldSet.fromJSON(json);
    expect(restored.entries[0].alias).toBe('personName');
  });
});

// =============================================================================
// QueryBuilder serialization tests
// =============================================================================

describe('QueryBuilder — serialization', () => {
  test('toJSON — select with FieldSet + limit', () => {
    const fs = FieldSet.for(personShape, ['name', 'hobby']);
    const json = QueryBuilder.from(Person)
      .select(fs)
      .limit(20)
      .toJSON();

    expect(json.shape).toBe(personShape.id);
    expect(json.fields).toHaveLength(2);
    expect(json.fields[0].path).toBe('name');
    expect(json.fields[1].path).toBe('hobby');
    expect(json.limit).toBe(20);
  });

  test('toJSON — selectAll', () => {
    const json = QueryBuilder.from(Person).selectAll().toJSON();
    expect(json.shape).toBe(personShape.id);
    expect(json.fields.length).toBeGreaterThan(0);
    // All unique property labels should be present
    const paths = json.fields.map((f) => f.path);
    expect(paths).toContain('name');
    expect(paths).toContain('hobby');
    expect(paths).toContain('friends');
  });

  test('toJSON — with subject', () => {
    const json = QueryBuilder.from(Person)
      .select(['name'])
      .for({id: `${tmpEntityBase}p1`})
      .toJSON();

    expect(json.subject).toBe(`${tmpEntityBase}p1`);
    expect(json.singleResult).toBe(true);
  });

  test('toJSON — with offset', () => {
    const json = QueryBuilder.from(Person)
      .select(['name'])
      .offset(10)
      .limit(5)
      .toJSON();

    expect(json.offset).toBe(10);
    expect(json.limit).toBe(5);
  });

  test('toJSON — orderBy direction', () => {
    const json = QueryBuilder.from(Person)
      .select(['name'])
      .orderBy((p) => p.name, 'DESC')
      .toJSON();

    expect(json.orderDirection).toBe('DESC');
  });

  test('fromJSON — round-trip IR equivalence', () => {
    const fs = FieldSet.for(personShape, ['name', 'hobby']);
    const original = QueryBuilder.from(Person).select(fs).limit(10);
    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    const originalIR = original.build();
    const restoredIR = restored.build();
    expect(sanitize(restoredIR)).toEqual(sanitize(originalIR));
  });

  test('fromJSON — with subject round-trip', () => {
    const fs = FieldSet.for(personShape, ['name']);
    const original = QueryBuilder.from(Person)
      .select(fs)
      .for({id: `${tmpEntityBase}p1`});
    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    const originalIR = original.build();
    const restoredIR = restored.build();
    expect(sanitize(restoredIR)).toEqual(sanitize(originalIR));
  });

  test('fromJSON — minimal (shape only)', () => {
    const json: QueryBuilderJSON = {shape: personShape.id};
    // Should not throw — creates a builder without select
    const builder = QueryBuilder.fromJSON(json);
    expect(builder).toBeDefined();
  });

  test('fromJSON — with offset and limit', () => {
    const json: QueryBuilderJSON = {
      shape: personShape.id,
      fields: [{path: 'name'}],
      limit: 5,
      offset: 10,
    };
    const builder = QueryBuilder.fromJSON(json);
    const ir = builder.build();
    expect(ir.limit).toBe(5);
    expect(ir.offset).toBe(10);
  });

  test('toJSON — with subjects', () => {
    const json = QueryBuilder.from(Person)
      .select(['name'])
      .forAll([`${tmpEntityBase}p1`, `${tmpEntityBase}p2`])
      .toJSON();
    expect(json.subjects).toHaveLength(2);
    expect(json.subjects).toContain(`${tmpEntityBase}p1`);
    expect(json.subjects).toContain(`${tmpEntityBase}p2`);
    expect(json.subject).toBeUndefined();
  });

  test('fromJSON — round-trip forAll', () => {
    const fs = FieldSet.for(personShape, ['name']);
    const original = QueryBuilder.from(Person)
      .select(fs)
      .forAll([`${tmpEntityBase}p1`, `${tmpEntityBase}p2`]);
    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    const originalIR = original.build();
    const restoredIR = restored.build();
    expect(sanitize(restoredIR)).toEqual(sanitize(originalIR));
  });

  // --- Phase 7d: callback-based selection serialization ---

  test('toJSON — callback select', () => {
    const json = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .toJSON();
    expect(json.fields).toHaveLength(1);
    expect(json.fields![0].path).toBe('name');
  });

  test('toJSON — callback select nested', () => {
    const json = QueryBuilder.from(Person)
      .select((p) => [p.friends.name])
      .toJSON();
    expect(json.fields).toHaveLength(1);
    expect(json.fields![0].path).toBe('friends.name');
  });

  test('toJSON — callback select with aggregation', () => {
    const json = QueryBuilder.from(Person)
      .select((p) => [p.friends.size()])
      .toJSON();
    expect(json.fields).toHaveLength(1);
    expect(json.fields![0].aggregation).toBe('count');
  });

  test('fromJSON — round-trip callback select', () => {
    const original = QueryBuilder.from(Person)
      .select((p) => [p.name, p.hobby])
      .limit(10);
    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    // The restored builder won't have the callback, but the FieldSet
    // should produce equivalent IR for the selection part.
    expect(json.fields).toHaveLength(2);
    expect(json.fields![0].path).toBe('name');
    expect(json.fields![1].path).toBe('hobby');
    expect(restored.build().limit).toBe(10);
  });

  test('fromJSON — orderDirection preserved', () => {
    const json = QueryBuilder.from(Person)
      .select(['name'])
      .orderBy((p) => p.name, 'DESC')
      .toJSON();
    expect(json.orderDirection).toBe('DESC');

    const restored = QueryBuilder.fromJSON(json);
    const restoredJson = restored.toJSON();
    expect(restoredJson.orderDirection).toBe('DESC');
  });
});

// =============================================================================
// Where clause serialization tests
// =============================================================================

describe('QueryBuilder — where clause serialization', () => {
  test('toJSON — simple where equals', () => {
    const json = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .where((p) => p.name.equals('Bob'))
      .toJSON();

    expect(json.where).toBeDefined();
    expect(json.where!.kind).toBe('evaluation');
    if (json.where!.kind === 'evaluation') {
      expect(json.where!.method).toBe('=');
      expect(json.where!.path).toHaveLength(1);
      expect((json.where!.path[0] as any).label).toBe('name');
    }
  });

  test('toJSON — where with nodeRef arg', () => {
    const json = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .where((p) => p.bestFriend.equals({id: `${tmpEntityBase}p1`}))
      .toJSON();

    expect(json.where).toBeDefined();
    expect(json.where!.kind).toBe('evaluation');
    if (json.where!.kind === 'evaluation') {
      expect(json.where!.args).toHaveLength(1);
      expect(json.where!.args[0].kind).toBe('nodeRef');
    }
  });

  test('toJSON — where with AND', () => {
    const json = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .where((p) => p.name.equals('Bob').and(p.hobby.equals('Chess')))
      .toJSON();

    expect(json.where).toBeDefined();
    expect(json.where!.kind).toBe('andOr');
  });

  test('round-trip — simple where equals produces same IR', () => {
    const original = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .where((p) => p.name.equals('Bob'));

    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    expect(sanitize(restored.build())).toEqual(sanitize(original.build()));
  });

  test('round-trip — where with nodeRef produces same IR', () => {
    const original = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .where((p) => p.bestFriend.equals({id: `${tmpEntityBase}p1`}));

    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    expect(sanitize(restored.build())).toEqual(sanitize(original.build()));
  });

  test('round-trip — where AND produces same IR', () => {
    const original = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .where((p) => p.name.equals('Bob').and(p.hobby.equals('Chess')));

    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    expect(sanitize(restored.build())).toEqual(sanitize(original.build()));
  });

  test('round-trip — nested where path produces same IR', () => {
    const original = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .where((p) => p.bestFriend.name.equals('Alice'));

    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    expect(sanitize(restored.build())).toEqual(sanitize(original.build()));
  });

  test('round-trip — where + limit + one produces same IR', () => {
    const original = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .where((p) => p.name.equals('Bob'))
      .one();

    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    expect(sanitize(restored.build())).toEqual(sanitize(original.build()));
  });
});

// =============================================================================
// Sort key serialization tests
// =============================================================================

describe('QueryBuilder — sort key serialization', () => {
  test('toJSON — orderBy includes sort key path', () => {
    const json = QueryBuilder.from(Person)
      .select(['name'])
      .orderBy((p) => p.name, 'DESC')
      .toJSON();

    expect(json.sortBy).toBeDefined();
    expect(json.sortBy!.paths).toContain('name');
    expect(json.sortBy!.direction).toBe('DESC');
  });

  test('round-trip — orderBy produces same IR', () => {
    const original = QueryBuilder.from(Person)
      .select(['name', 'hobby'])
      .orderBy((p) => p.name, 'ASC');

    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    expect(sanitize(restored.build())).toEqual(sanitize(original.build()));
  });
});

// =============================================================================
// Minus entry serialization tests
// =============================================================================

describe('QueryBuilder — minus entry serialization', () => {
  test('toJSON — minus with shape type', () => {
    const json = QueryBuilder.from(Person)
      .select(['name'])
      .minus(Employee)
      .toJSON();

    expect(json.minusEntries).toBeDefined();
    expect(json.minusEntries).toHaveLength(1);
    expect(json.minusEntries![0].shapeId).toBeDefined();
  });

  test('toJSON — minus with where callback', () => {
    const json = QueryBuilder.from(Person)
      .select(['name'])
      .minus((p) => p.hobby.equals('Chess'))
      .toJSON();

    expect(json.minusEntries).toBeDefined();
    expect(json.minusEntries).toHaveLength(1);
    expect(json.minusEntries![0].where).toBeDefined();
  });

  test('round-trip — minus with shape type produces same IR', () => {
    const original = QueryBuilder.from(Person)
      .select(['name'])
      .minus(Employee);

    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    expect(sanitize(restored.build())).toEqual(sanitize(original.build()));
  });

  test('round-trip — minus with where produces same IR', () => {
    const original = QueryBuilder.from(Person)
      .select(['name'])
      .minus((p) => p.hobby.equals('Chess'));

    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    expect(sanitize(restored.build())).toEqual(sanitize(original.build()));
  });
});

// =============================================================================
// nullSubject and pendingContextName serialization tests
// =============================================================================

describe('QueryBuilder — nullSubject & pendingContextName serialization', () => {
  test('toJSON — nullSubject preserved', () => {
    const json = QueryBuilder.from(Person)
      .select(['name'])
      .for(null)
      .toJSON();

    expect(json.nullSubject).toBe(true);
  });

  test('fromJSON — nullSubject restored', () => {
    const json: QueryBuilderJSON = {
      shape: personShape.id,
      fields: [{path: 'name'}],
      nullSubject: true,
      singleResult: true,
    };
    const restored = QueryBuilder.fromJSON(json);
    // The restored builder should have _nullSubject set
    expect(restored.toJSON().nullSubject).toBe(true);
  });
});

// =============================================================================
// Combined round-trip: complex queries
// =============================================================================

describe('QueryBuilder — complex round-trip', () => {
  test('round-trip — where + subject + limit + fields', () => {
    const original = QueryBuilder.from(Person)
      .select((p) => [p.name, p.hobby])
      .where((p) => p.name.equals('Bob'))
      .for({id: `${tmpEntityBase}p1`});

    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    expect(sanitize(restored.build())).toEqual(sanitize(original.build()));
  });

  test('round-trip — JSON string serialization', () => {
    const original = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .where((p) => p.name.equals('Bob'))
      .limit(10);

    const jsonString = JSON.stringify(original.toJSON());
    const parsed = JSON.parse(jsonString);
    const restored = QueryBuilder.fromJSON(parsed);

    expect(sanitize(restored.build())).toEqual(sanitize(original.build()));
  });
});

// =============================================================================
// Preload serialization tests
// =============================================================================

describe('QueryBuilder — preload serialization', () => {
  const componentLike = {query: QueryBuilder.from(Person).select((p: any) => ({name: p.name}))};

  test('toJSON — preload merges into fields as subSelect', () => {
    const json = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .preload('bestFriend', componentLike)
      .toJSON();

    // Should have 2 fields: name + bestFriend (with subSelect from preload)
    expect(json.fields!.length).toBe(2);
    const bestFriendField = json.fields!.find((f) => f.path === 'bestFriend');
    expect(bestFriendField).toBeDefined();
    expect(bestFriendField!.subSelect).toBeDefined();
    expect(bestFriendField!.subSelect!.fields.length).toBeGreaterThan(0);
  });

  test('round-trip — preload produces same IR', () => {
    const original = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .preload('bestFriend', componentLike);

    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    expect(sanitize(restored.build())).toEqual(sanitize(original.build()));
  });

  test('round-trip — preload with FieldSet component', () => {
    const componentFs = FieldSet.for(personShape, ['name']);
    const componentWithFs = {query: componentFs, fields: componentFs};

    const original = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .preload('bestFriend', componentWithFs);

    const json = original.toJSON();
    const restored = QueryBuilder.fromJSON(json);

    expect(sanitize(restored.build())).toEqual(sanitize(original.build()));
  });
});
