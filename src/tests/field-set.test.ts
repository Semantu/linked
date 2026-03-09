import {describe, expect, test} from '@jest/globals';
import {Person, Pet} from '../test-helpers/query-fixtures';
import {sanitize} from '../test-helpers/test-utils';
import {FieldSet} from '../queries/FieldSet';
import {PropertyPath, walkPropertyPath} from '../queries/PropertyPath';
import {QueryBuilder} from '../queries/QueryBuilder';

const personShape = Person.shape;

// =============================================================================
// Construction tests
// =============================================================================

describe('FieldSet — construction', () => {
  test('FieldSet.for — string fields', () => {
    const fs = FieldSet.for(personShape, ['name', 'hobby']);
    expect(fs.entries.length).toBe(2);
    expect(fs.entries[0].path.terminal.label).toBe('name');
    expect(fs.entries[1].path.terminal.label).toBe('hobby');
  });

  test('FieldSet.for — callback', () => {
    const fs = FieldSet.for(personShape, (p) => [p.name, p.hobby]);
    expect(fs.entries.length).toBe(2);
    expect(fs.entries[0].path.terminal.label).toBe('name');
    expect(fs.entries[1].path.terminal.label).toBe('hobby');
  });

  test('FieldSet.for — string shape resolution', () => {
    const shapeId = personShape.id;
    const fs = FieldSet.for(shapeId, ['name']);
    expect(fs.entries.length).toBe(1);
    expect(fs.entries[0].path.terminal.label).toBe('name');
  });

  test('FieldSet.for — PropertyPath instances', () => {
    const path = walkPropertyPath(personShape, 'friends.name');
    const fs = FieldSet.for(personShape, [path]);
    expect(fs.entries.length).toBe(1);
    expect(fs.entries[0].path.toString()).toBe('friends.name');
  });

  test('FieldSet.all — depth 1', () => {
    const fs = FieldSet.all(personShape);
    const labels = fs.labels();
    expect(labels).toContain('name');
    expect(labels).toContain('hobby');
    expect(labels).toContain('nickNames');
    expect(labels).toContain('birthDate');
    expect(labels).toContain('isRealPerson');
    expect(labels).toContain('bestFriend');
    expect(labels).toContain('friends');
    expect(labels).toContain('pets');
    expect(labels).toContain('firstPet');
  });

  test('FieldSet.all — depth 0 throws', () => {
    expect(() => FieldSet.all(personShape, {depth: 0})).toThrow(
      'FieldSet.all() requires depth >= 1',
    );
  });

  test('FieldSet.all — depth 2 includes nested shape properties for non-cyclic refs', () => {
    const fs = FieldSet.all(personShape, {depth: 2});
    const labels = fs.labels();
    expect(labels).toContain('name');
    expect(labels).toContain('pets');
    // pets → Pet is a different shape, so at depth 2 it should have a subSelect
    const petsEntry = fs.entries.find((e: any) => e.path.terminal?.label === 'pets');
    expect(petsEntry).toBeDefined();
    expect(petsEntry!.subSelect).toBeDefined();
    expect(petsEntry!.subSelect!.labels()).toContain('bestFriend');
  });

  test('FieldSet.all — depth 2 skips self-referential shapes (cycle detection)', () => {
    // B1 fix: friends → Person is the same shape as the root, so
    // cycle detection correctly prevents infinite recursion.
    const fs = FieldSet.all(personShape, {depth: 2});
    const friendsEntry = fs.entries.find((e: any) => e.path.terminal?.label === 'friends');
    expect(friendsEntry).toBeDefined();
    // friends → Person is cyclic (same as root), so no subSelect
    expect(friendsEntry!.subSelect).toBeUndefined();

    // bestFriend → Person is also cyclic
    const bestFriendEntry = fs.entries.find((e: any) => e.path.terminal?.label === 'bestFriend');
    expect(bestFriendEntry).toBeDefined();
    expect(bestFriendEntry!.subSelect).toBeUndefined();
  });
});

// =============================================================================
// Composition tests
// =============================================================================

describe('FieldSet — composition', () => {
  test('add — appends entries', () => {
    const fs = FieldSet.for(personShape, ['name']);
    const fs2 = fs.add(['hobby']);
    expect(fs2.entries.length).toBe(2);
    expect(fs2.labels()).toContain('name');
    expect(fs2.labels()).toContain('hobby');
  });

  test('remove — removes by label', () => {
    const fs = FieldSet.for(personShape, ['name', 'hobby']);
    const fs2 = fs.remove(['hobby']);
    expect(fs2.entries.length).toBe(1);
    expect(fs2.labels()).toEqual(['name']);
  });

  test('set — replaces all', () => {
    const fs = FieldSet.for(personShape, ['name', 'hobby']);
    const fs2 = fs.set(['friends']);
    expect(fs2.entries.length).toBe(1);
    expect(fs2.labels()).toEqual(['friends']);
  });

  test('pick — keeps only listed', () => {
    const fs = FieldSet.for(personShape, ['name', 'hobby', 'friends']);
    const fs2 = fs.pick(['name', 'friends']);
    expect(fs2.entries.length).toBe(2);
    expect(fs2.labels()).toContain('name');
    expect(fs2.labels()).toContain('friends');
    expect(fs2.labels()).not.toContain('hobby');
  });

  test('merge — union of entries', () => {
    const fs1 = FieldSet.for(personShape, ['name']);
    const fs2 = FieldSet.for(personShape, ['hobby']);
    const merged = FieldSet.merge([fs1, fs2]);
    expect(merged.entries.length).toBe(2);
    expect(merged.labels()).toContain('name');
    expect(merged.labels()).toContain('hobby');
  });

  test('merge — deduplicates', () => {
    const fs1 = FieldSet.for(personShape, ['name']);
    const fs2 = FieldSet.for(personShape, ['name', 'hobby']);
    const merged = FieldSet.merge([fs1, fs2]);
    expect(merged.entries.length).toBe(2); // not 3
    expect(merged.labels()).toEqual(['name', 'hobby']);
  });

  test('merge — throws on cross-shape', () => {
    const petShape = Pet.shape;
    const fs1 = FieldSet.for(personShape, ['name']);
    const fs2 = FieldSet.for(petShape, ['bestFriend']);
    expect(() => FieldSet.merge([fs1, fs2])).toThrow(
      'Cannot merge FieldSets with different shapes',
    );
  });

  test('immutability — original unchanged after add', () => {
    const fs = FieldSet.for(personShape, ['name']);
    const fs2 = fs.add(['hobby']);
    expect(fs.entries.length).toBe(1);
    expect(fs2.entries.length).toBe(2);
  });

  test('paths() returns PropertyPath array', () => {
    const fs = FieldSet.for(personShape, ['name', 'hobby']);
    const paths = fs.paths();
    expect(paths.length).toBe(2);
    expect(paths[0]).toBeInstanceOf(PropertyPath);
    expect(paths[0].toString()).toBe('name');
  });
});

// =============================================================================
// Nesting tests
// =============================================================================

describe('FieldSet — nesting', () => {
  test('nested — object form', () => {
    const fs = FieldSet.for(personShape, [{friends: ['name', 'hobby']}]);
    expect(fs.entries.length).toBe(2);
    expect(fs.entries[0].path.toString()).toBe('friends.name');
    expect(fs.entries[1].path.toString()).toBe('friends.hobby');
  });

  test('nested — FieldSet value', () => {
    const innerFs = FieldSet.for(personShape, ['name', 'hobby']);
    const fs = FieldSet.for(personShape, [{friends: innerFs}]);
    expect(fs.entries.length).toBe(2);
    expect(fs.entries[0].path.toString()).toBe('friends.name');
    expect(fs.entries[1].path.toString()).toBe('friends.hobby');
  });
});

// =============================================================================
// ShapeClass overloads (Phase 7b)
// =============================================================================

describe('FieldSet — ShapeClass overloads', () => {
  test('FieldSet.for(Person, [labels]) produces same as NodeShape', () => {
    const fromClass = FieldSet.for(Person, ['name']);
    const fromShape = FieldSet.for(personShape, ['name']);
    expect(fromClass.labels()).toEqual(fromShape.labels());
  });

  test('FieldSet.for(Person, [labels]) has correct shape', () => {
    const fs = FieldSet.for(Person, ['name']);
    expect(fs.shape).toBe(personShape);
  });

  test('FieldSet.for(Person, callback) works', () => {
    const fs = FieldSet.for(Person, (p) => [p.name, p.hobby]);
    expect(fs.entries.length).toBe(2);
    expect(fs.labels()).toContain('name');
    expect(fs.labels()).toContain('hobby');
  });

  test('FieldSet.all(Person) produces same as FieldSet.all(personShape)', () => {
    const fromClass = FieldSet.all(Person);
    const fromShape = FieldSet.all(personShape);
    expect(fromClass.labels()).toEqual(fromShape.labels());
  });

  test('FieldSet.for(Person, [nested]) works', () => {
    const fs = FieldSet.for(Person, ['friends.name']);
    expect(fs.entries[0].path.toString()).toBe('friends.name');
  });
});

// =============================================================================
// Callback tracing with ProxiedPathBuilder (Phase 7c)
// =============================================================================

describe('FieldSet — callback tracing (ProxiedPathBuilder)', () => {
  test('flat callback still works', () => {
    const fs = FieldSet.for(Person, (p) => [p.name, p.hobby]);
    expect(fs.entries.length).toBe(2);
    expect(fs.labels()).toContain('name');
    expect(fs.labels()).toContain('hobby');
  });

  test('nested path via callback', () => {
    const fs = FieldSet.for(Person, (p) => [p.friends.name]);
    expect(fs.entries.length).toBe(1);
    expect(fs.entries[0].path.toString()).toBe('friends.name');
    expect(fs.entries[0].path.segments.length).toBe(2);
  });

  test('deep nested path via callback', () => {
    const fs = FieldSet.for(Person, (p) => [p.friends.bestFriend.name]);
    expect(fs.entries.length).toBe(1);
    expect(fs.entries[0].path.segments.length).toBe(3);
    expect(fs.entries[0].path.toString()).toBe('friends.bestFriend.name');
  });

  test('where condition captured on entry', () => {
    const fs = FieldSet.for(Person, (p) => [
      p.friends.where((f: any) => f.name.equals('Moa')),
    ]);
    expect(fs.entries.length).toBe(1);
    expect(fs.entries[0].scopedFilter).toBeDefined();
    expect(fs.entries[0].scopedFilter).not.toBeNull();
  });

  test('aggregation captured on entry', () => {
    const fs = FieldSet.for(Person, (p) => [p.friends.size()]);
    expect(fs.entries.length).toBe(1);
    expect(fs.entries[0].aggregation).toBe('count');
  });

  test('multiple mixed selections', () => {
    const fs = FieldSet.for(Person, (p) => [
      p.name,
      p.friends.name,
      p.bestFriend.hobby,
    ]);
    expect(fs.entries.length).toBe(3);
    expect(fs.entries[0].path.toString()).toBe('name');
    expect(fs.entries[1].path.toString()).toBe('friends.name');
    expect(fs.entries[2].path.toString()).toBe('bestFriend.hobby');
  });

  test('single value return (not array) works', () => {
    const fs = FieldSet.for(Person, (p) => p.friends.name);
    expect(fs.entries.length).toBe(1);
    expect(fs.entries[0].path.toString()).toBe('friends.name');
  });
});

// =============================================================================
// Extended entry fields (Phase 7a)
// =============================================================================

describe('FieldSet — extended entries', () => {
  const buildExtended = (fields: Array<{path: string; subSelect?: any; aggregation?: string; customKey?: string}>) =>
    FieldSet.fromJSON({shape: personShape.id, fields});

  test('entry with subSelect preserved through add()', () => {
    const fs = buildExtended([
      {path: 'friends', subSelect: {shape: personShape.id, fields: [{path: 'name'}]}},
    ]);
    const fs2 = fs.add(['hobby']);
    expect(fs2.entries.length).toBe(2);
    expect(fs2.entries[0].subSelect).toBeDefined();
    expect(fs2.entries[0].subSelect!.labels()).toEqual(['name']);
  });

  test('entry with aggregation preserved through pick()', () => {
    const fs = buildExtended([
      {path: 'friends', aggregation: 'count'},
      {path: 'name'},
    ]);
    const fs2 = fs.pick(['friends']);
    expect(fs2.entries.length).toBe(1);
    expect(fs2.entries[0].aggregation).toBe('count');
  });

  test('entry with customKey preserved through merge()', () => {
    const fs1 = buildExtended([{path: 'friends', customKey: 'numFriends'}]);
    const fs2 = FieldSet.for(personShape, ['name']);
    const merged = FieldSet.merge([fs1, fs2]);
    expect(merged.entries.length).toBe(2);
    expect(merged.entries[0].customKey).toBe('numFriends');
  });

  test('entries with same path but different aggregation are distinct in merge()', () => {
    const fs1 = FieldSet.for(personShape, ['friends']);
    const fs2 = buildExtended([{path: 'friends', aggregation: 'count'}]);
    const merged = FieldSet.merge([fs1, fs2]);
    expect(merged.entries.length).toBe(2);
  });
});

// =============================================================================
// Extended serialization (Phase 7a)
// =============================================================================

describe('FieldSet — extended serialization', () => {
  test('toJSON — entry with subSelect', () => {
    const inner = FieldSet.for(personShape, ['name']);
    const fs = FieldSet.fromJSON({
      shape: personShape.id,
      fields: [{path: 'friends', subSelect: inner.toJSON()}],
    });
    const json = fs.toJSON();
    expect(json.fields[0].subSelect).toBeDefined();
    expect(json.fields[0].subSelect!.fields).toHaveLength(1);
    expect(json.fields[0].subSelect!.fields[0].path).toBe('name');
  });

  test('toJSON — entry with aggregation', () => {
    const fs = FieldSet.fromJSON({
      shape: personShape.id,
      fields: [{path: 'friends', aggregation: 'count'}],
    });
    const json = fs.toJSON();
    expect(json.fields[0].aggregation).toBe('count');
  });

  test('toJSON — entry with customKey', () => {
    const fs = FieldSet.fromJSON({
      shape: personShape.id,
      fields: [{path: 'friends', customKey: 'numFriends'}],
    });
    const json = fs.toJSON();
    expect(json.fields[0].customKey).toBe('numFriends');
  });

  test('fromJSON — round-trip subSelect', () => {
    const json = {
      shape: personShape.id,
      fields: [{path: 'friends', subSelect: {shape: personShape.id, fields: [{path: 'name'}]}}],
    };
    const fs = FieldSet.fromJSON(json);
    const roundTripped = FieldSet.fromJSON(fs.toJSON());
    expect(roundTripped.entries[0].subSelect).toBeDefined();
    expect(roundTripped.entries[0].subSelect!.labels()).toEqual(['name']);
  });

  test('fromJSON — round-trip aggregation', () => {
    const json = {
      shape: personShape.id,
      fields: [{path: 'friends', aggregation: 'count'}],
    };
    const fs = FieldSet.fromJSON(json);
    const roundTripped = FieldSet.fromJSON(fs.toJSON());
    expect(roundTripped.entries[0].aggregation).toBe('count');
  });

  test('fromJSON — round-trip customKey', () => {
    const json = {
      shape: personShape.id,
      fields: [{path: 'friends', customKey: 'numFriends'}],
    };
    const fs = FieldSet.fromJSON(json);
    const roundTripped = FieldSet.fromJSON(fs.toJSON());
    expect(roundTripped.entries[0].customKey).toBe('numFriends');
  });
});

// =============================================================================
// QueryBuilder integration tests
// =============================================================================

describe('FieldSet — QueryBuilder integration', () => {
  test('QueryBuilder.select(fieldSet) produces same IR as callback', async () => {
    const fs = FieldSet.for(personShape, ['name', 'hobby']);
    const builderIR = QueryBuilder.from(Person)
      .select(fs)
      .build();
    const callbackIR = QueryBuilder.from(Person)
      .select((p) => [p.name, p.hobby])
      .build();

    expect(sanitize(builderIR)).toEqual(sanitize(callbackIR));
  });

  test('QueryBuilder.fields() returns FieldSet', () => {
    const fs = FieldSet.for(personShape, ['name', 'hobby']);
    const builder = QueryBuilder.from(Person).select(fs);
    const returned = builder.fields();
    expect(returned).toBeInstanceOf(FieldSet);
    expect(returned!.labels()).toEqual(['name', 'hobby']);
  });
});

// =============================================================================
// Phase 9: Sub-select through FieldSet
// =============================================================================

describe('FieldSet — sub-select extraction', () => {
  test('callback with sub-select produces FieldSet entry with subSelect', () => {
    const fs = FieldSet.for(Person, (p) => p.friends.select((f: any) => [f.name]));
    expect(fs.entries.length).toBe(1);
    expect(fs.entries[0].path.toString()).toBe('friends');
    expect(fs.entries[0].subSelect).toBeDefined();
    expect(fs.entries[0].subSelect).toBeInstanceOf(FieldSet);
    expect(fs.entries[0].subSelect!.labels()).toContain('name');
  });

  test('callback with sub-select custom object produces FieldSet entry with subSelect', () => {
    const fs = FieldSet.for(Person, (p) =>
      p.friends.select((f: any) => ({friendName: f.name, friendHobby: f.hobby})),
    );
    expect(fs.entries.length).toBe(1);
    expect(fs.entries[0].subSelect).toBeDefined();
    const subEntries = fs.entries[0].subSelect!.entries;
    expect(subEntries.length).toBe(2);
    expect(subEntries[0].customKey).toBe('friendName');
    expect(subEntries[1].customKey).toBe('friendHobby');
  });

  test('callback with count in custom object produces aggregation entry', () => {
    const fs = FieldSet.for(Person, (p) => ({numFriends: p.friends.size()}));
    expect(fs.entries.length).toBe(1);
    expect(fs.entries[0].aggregation).toBe('count');
    expect(fs.entries[0].customKey).toBe('numFriends');
  });

  test('sub-select FieldSet produces valid IR with projections', () => {
    const directIR = QueryBuilder.from(Person)
      .select((p) => p.friends.select((f: any) => [f.name]))
      .build();
    expect(directIR.kind).toBe('select');
    // Sub-select should produce at least one projection entry
    expect(directIR.projection.length).toBeGreaterThanOrEqual(1);
  });
});
