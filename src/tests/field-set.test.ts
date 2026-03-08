import {describe, expect, test} from '@jest/globals';
import {Person} from '../test-helpers/query-fixtures';
import {FieldSet} from '../queries/FieldSet';
import {PropertyPath, walkPropertyPath} from '../queries/PropertyPath';
import {QueryBuilder} from '../queries/QueryBuilder';
import {captureQuery} from '../test-helpers/query-capture-store';

const personShape = (Person as any).shape;

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

  test('FieldSet.all — depth 0 same as depth 1', () => {
    const fs0 = FieldSet.all(personShape, {depth: 0});
    const fs1 = FieldSet.all(personShape);
    expect(fs0.labels()).toEqual(fs1.labels());
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
    // The inner FieldSet paths are relative to Person, but when used as nested
    // they should combine with the base path
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
  /** Helper: build a FieldSet from JSON with extended fields (subSelect, aggregation, customKey). */
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

    // Sanitize for comparison (strip undefined keys)
    const sanitize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map((item) => sanitize(item));
      if (value && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).reduce(
          (acc, [key, child]) => {
            if (child !== undefined) acc[key] = sanitize(child);
            return acc;
          },
          {} as Record<string, unknown>,
        );
      }
      return value;
    };

    expect(sanitize(builderIR)).toEqual(sanitize(callbackIR));
  });

  test('QueryBuilder.fields() returns FieldSet', () => {
    const fs = FieldSet.for(personShape, ['name', 'hobby']);
    const builder = QueryBuilder.from(Person).select(fs);
    const returned = builder.fields();
    expect(returned).toBeInstanceOf(FieldSet);
    expect(returned.labels()).toEqual(['name', 'hobby']);
  });
});
