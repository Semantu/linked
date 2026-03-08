import {describe, expect, test} from '@jest/globals';
import {Person, tmpEntityBase} from '../test-helpers/query-fixtures';
import {captureQuery} from '../test-helpers/query-capture-store';
import {QueryBuilder} from '../queries/QueryBuilder';
import {buildSelectQuery} from '../queries/IRPipeline';
import {walkPropertyPath} from '../queries/PropertyPath';
import {FieldSet} from '../queries/FieldSet';
import {setQueryContext} from '../queries/QueryContext';

setQueryContext('user', {id: 'user-1'}, Person);

const entity = (suffix: string) => ({id: `${tmpEntityBase}${suffix}`});

/**
 * Helper: capture the built IR from the existing DSL path.
 */
const captureDslIR = async (runner: () => Promise<unknown>) => {
  const ir = await captureQuery(runner);
  return ir;
};

/**
 * Helper: sanitize IR for comparison (strip undefined keys).
 */
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

// =============================================================================
// Immutability tests
// =============================================================================

describe('QueryBuilder — immutability', () => {
  test('.where() returns new instance', () => {
    const b1 = QueryBuilder.from(Person).select((p) => p.name);
    const b2 = b1.where((p) => p.name.equals('Semmy'));
    expect(b1).not.toBe(b2);
  });

  test('.limit() returns new instance', () => {
    const b1 = QueryBuilder.from(Person).select((p) => p.name);
    const b2 = b1.limit(10);
    expect(b1).not.toBe(b2);
  });

  test('.select() returns new instance', () => {
    const b1 = QueryBuilder.from(Person);
    const b2 = b1.select((p) => p.name);
    expect(b1).not.toBe(b2);
  });

  test('chaining preserves prior state', () => {
    const b1 = QueryBuilder.from(Person).select((p) => p.name);
    const b2 = b1.limit(5);
    const b3 = b1.limit(10);
    expect(b2).not.toBe(b3);
    // b2 and b3 should produce different IRs since they have different limits
    const ir2 = b2.build();
    const ir3 = b3.build();
    expect(ir2.limit).toBe(5);
    expect(ir3.limit).toBe(10);
  });

  test('.orderBy() returns new instance', () => {
    const b1 = QueryBuilder.from(Person).select((p) => p.name);
    const b2 = b1.orderBy((p) => p.name);
    expect(b1).not.toBe(b2);
  });

  test('.for() returns new instance', () => {
    const b1 = QueryBuilder.from(Person).select((p) => p.name);
    const b2 = b1.for(entity('p1'));
    expect(b1).not.toBe(b2);
  });

  test('.one() returns new instance', () => {
    const b1 = QueryBuilder.from(Person).select((p) => p.name);
    const b2 = b1.one();
    expect(b1).not.toBe(b2);
  });
});

// =============================================================================
// IR equivalence tests — QueryBuilder must produce identical IR to DSL
// =============================================================================

describe('QueryBuilder — IR equivalence with DSL', () => {
  test('selectName', async () => {
    const dslIR = await captureDslIR(() => Person.select((p) => p.name));
    const builderIR = QueryBuilder.from(Person).select((p) => p.name).build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('selectMultiplePaths', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) => [p.name, p.friends, p.bestFriend.name]),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) => [p.name, p.friends, p.bestFriend.name])
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('selectFriendsName', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) => p.friends.name),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) => p.friends.name)
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('selectDeepNested', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) => p.friends.bestFriend.bestFriend.name),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) => p.friends.bestFriend.bestFriend.name)
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('whereFriendsNameEquals', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) => p.friends.where((f) => f.name.equals('Moa'))),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) => p.friends.where((f) => f.name.equals('Moa')))
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('whereAnd', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) =>
        p.friends.where((f) =>
          f.name.equals('Moa').and(f.hobby.equals('Jogging')),
        ),
      ),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) =>
        p.friends.where((f) =>
          f.name.equals('Moa').and(f.hobby.equals('Jogging')),
        ),
      )
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('selectById', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select(entity('p1'), (p) => p.name),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) => p.name)
      .for(entity('p1'))
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('outerWhereLimit', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) => p.name)
        .where((p) => p.name.equals('Semmy').or(p.name.equals('Moa')))
        .limit(1),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) => p.name)
      .where((p) => p.name.equals('Semmy').or(p.name.equals('Moa')))
      .limit(1)
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('sortByAsc', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) => p.name).sortBy((p) => p.name),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) => p.name)
      .orderBy((p) => p.name)
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('countFriends', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) => p.friends.size()),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) => p.friends.size())
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('subSelectPluralCustom', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) =>
        p.friends.select((f) => ({name: f.name, hobby: f.hobby})),
      ),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) =>
        p.friends.select((f) => ({name: f.name, hobby: f.hobby})),
      )
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('selectAllProperties', async () => {
    const dslIR = await captureDslIR(() => Person.selectAll());
    const builderIR = QueryBuilder.from(Person).selectAll().build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });
});

// =============================================================================
// walkPropertyPath tests
// =============================================================================

describe('walkPropertyPath', () => {
  const personShape = (Person as any).shape;

  test('single segment', () => {
    const path = walkPropertyPath(personShape, 'name');
    expect(path.segments.length).toBe(1);
    expect(path.terminal.label).toBe('name');
    expect(path.toString()).toBe('name');
  });

  test('nested segments', () => {
    const path = walkPropertyPath(personShape, 'friends.name');
    expect(path.segments.length).toBe(2);
    expect(path.segments[0].label).toBe('friends');
    expect(path.segments[1].label).toBe('name');
    expect(path.toString()).toBe('friends.name');
  });

  test('deeply nested', () => {
    const path = walkPropertyPath(personShape, 'bestFriend.bestFriend.name');
    expect(path.segments.length).toBe(3);
    expect(path.toString()).toBe('bestFriend.bestFriend.name');
  });

  test('invalid segment throws', () => {
    expect(() => walkPropertyPath(personShape, 'nonexistent')).toThrow(
      /not found/,
    );
  });

  test('traversal through non-object property throws', () => {
    expect(() => walkPropertyPath(personShape, 'name.something')).toThrow(
      /no valueShape/,
    );
  });
});

// =============================================================================
// Shape resolution test
// =============================================================================

describe('QueryBuilder — shape resolution', () => {
  test('from() with shape class', () => {
    const ir = QueryBuilder.from(Person).select((p) => p.name).build();
    expect(ir.kind).toBe('select');
    expect(ir.root.kind).toBe('shape_scan');
  });

  test('from() with string IRI', () => {
    const shapeId = (Person as any).shape.id;
    const ir = QueryBuilder.from(shapeId).select((p: any) => p.name).build();
    expect(ir.kind).toBe('select');
  });
});

// =============================================================================
// PromiseLike test
// =============================================================================

describe('QueryBuilder — PromiseLike', () => {
  test('has .then() method', () => {
    const builder = QueryBuilder.from(Person).select((p) => p.name);
    expect(typeof builder.then).toBe('function');
  });

  test('is thenable (await triggers execution)', async () => {
    const result = await QueryBuilder.from(Person).select((p) => p.name);
    // captureStore returns [] for select queries
    expect(result).toEqual([]);
  });
});

// =============================================================================
// Preload tests (Phase 5)
// =============================================================================

describe('QueryBuilder — preload', () => {
  const componentBuilder = QueryBuilder.from(Person).select((p: any) => ({name: p.name}));
  const componentLike = {query: componentBuilder};

  test('.preload() returns new instance', () => {
    const b1 = QueryBuilder.from(Person).select((p) => [p.name]);
    const b2 = b1.preload('bestFriend', componentLike);
    expect(b1).not.toBe(b2);
  });

  test('.preload() produces same IR as DSL preloadFor', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) => [p.name, p.bestFriend.preloadFor(componentLike)]),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .preload('bestFriend', componentLike)
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('.preload() IR matches DSL preloadFor', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) => [p.name, p.bestFriend.preloadFor(componentLike)]),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .preload('bestFriend', componentLike)
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('.preload() with FieldSet-based component', async () => {
    const personShape = (Person as any).shape;
    const componentFieldSet = FieldSet.for(personShape, ['name']);
    const componentLikeFieldSet = {query: componentFieldSet, fields: componentFieldSet};

    const builderIR = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .preload('bestFriend', componentLikeFieldSet)
      .build();
    expect(builderIR.kind).toBe('select');
    // The preloaded fields should appear in the IR projections
    expect(builderIR.projection.length).toBeGreaterThanOrEqual(2);
  });

  test('DSL preloadFor with QueryBuilder component produces valid IR', async () => {
    const componentBuilder = QueryBuilder.from(Person).select((p: any) => ({name: p.name}));
    const componentLikeBuilder = {query: componentBuilder};

    const ir = await captureQuery(() =>
      Person.select((p) => p.bestFriend.preloadFor(componentLikeBuilder)),
    );
    expect(ir.kind).toBe('select');
    expect(ir.projection.length).toBeGreaterThanOrEqual(1);
  });

  test('DSL preloadFor with FieldSet component produces valid IR', async () => {
    const personShape = (Person as any).shape;
    const componentFieldSet = FieldSet.for(personShape, ['name']);
    const componentLikeFieldSet = {query: componentFieldSet, fields: componentFieldSet};

    const ir = await captureQuery(() =>
      Person.select((p) => p.bestFriend.preloadFor(componentLikeFieldSet)),
    );
    expect(ir.kind).toBe('select');
    expect(ir.projection.length).toBeGreaterThanOrEqual(1);
  });

  test('getQueryPaths() returns valid SelectPath', () => {
    const builder = QueryBuilder.from(Person).select((p) => [p.name]);
    const paths = builder.getQueryPaths();
    expect(Array.isArray(paths)).toBe(true);
    expect((paths as any[]).length).toBeGreaterThan(0);
  });
});

// =============================================================================
// forAll — multi-ID subject filtering
// =============================================================================

describe('QueryBuilder — forAll', () => {
  test('forAll([id1, id2]) produces IR with subjectIds', () => {
    const ir = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .forAll([`${tmpEntityBase}p1`, `${tmpEntityBase}p2`])
      .build();
    expect(ir.subjectIds).toHaveLength(2);
    expect(ir.subjectIds).toContain(`${tmpEntityBase}p1`);
    expect(ir.subjectIds).toContain(`${tmpEntityBase}p2`);
  });

  test('forAll() without IDs produces no subject filter', () => {
    const ir = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .forAll()
      .build();
    expect(ir.subjectId).toBeUndefined();
    expect(ir.subjectIds).toBeUndefined();
  });

  test('for(id) after forAll(ids) clears multi-subject', () => {
    const ir = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .forAll([`${tmpEntityBase}p1`, `${tmpEntityBase}p2`])
      .for(`${tmpEntityBase}p3`)
      .build();
    expect(ir.subjectId).toBe(`${tmpEntityBase}p3`);
    expect(ir.subjectIds).toBeUndefined();
  });

  test('forAll(ids) after for(id) clears single subject', () => {
    const ir = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .for(`${tmpEntityBase}p1`)
      .forAll([`${tmpEntityBase}p2`, `${tmpEntityBase}p3`])
      .build();
    expect(ir.subjectId).toBeUndefined();
    expect(ir.subjectIds).toHaveLength(2);
  });

  test('forAll() returns new instance (immutability)', () => {
    const base = QueryBuilder.from(Person).select((p) => [p.name]);
    const withForAll = base.forAll([`${tmpEntityBase}p1`]);
    expect(base).not.toBe(withForAll);
    // Original has no subjects
    expect(base.build().subjectIds).toBeUndefined();
  });

  test('forAll accepts {id} references', () => {
    const ir = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .forAll([{id: `${tmpEntityBase}p1`}, `${tmpEntityBase}p2`])
      .build();
    expect(ir.subjectIds).toHaveLength(2);
    expect(ir.subjectIds).toContain(`${tmpEntityBase}p1`);
    expect(ir.subjectIds).toContain(`${tmpEntityBase}p2`);
  });
});
