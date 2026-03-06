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
