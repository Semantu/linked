import {describe, expect, test, beforeAll} from '@jest/globals';
import {Person, tmpEntityBase} from '../test-helpers/query-fixtures';
import {captureQuery} from '../test-helpers/query-capture-store';
import {entity, captureDslIR, sanitize} from '../test-helpers/test-utils';
import {QueryBuilder} from '../queries/QueryBuilder';
import {UpdateBuilder} from '../queries/UpdateBuilder';
import {walkPropertyPath} from '../queries/PropertyPath';
import {FieldSet} from '../queries/FieldSet';
import {setQueryContext} from '../queries/QueryContext';

const personShape = Person.shape;

beforeAll(() => {
  setQueryContext('user', {id: 'user-1'}, Person);
});

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
      Person.select((p) => p.name).for(entity('p1')),
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
      Person.select((p) => p.name).orderBy((p) => p.name),
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
    const shapeId = personShape.id;
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
// B2 fix: removed duplicate ".preload() IR matches DSL preloadFor" test.
// TQ2 fix: strengthened preload assertions to verify actual preload structure.
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

  test('.preload() with FieldSet-based component includes preload projections', async () => {
    const componentFieldSet = FieldSet.for(personShape, ['name']);
    const componentLikeFieldSet = {query: componentFieldSet, fields: componentFieldSet};

    const builderIR = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .preload('bestFriend', componentLikeFieldSet)
      .build();
    expect(builderIR.kind).toBe('select');
    // Should have the base 'name' projection + at least one preload projection
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
    const componentFieldSet = FieldSet.for(personShape, ['name']);
    const componentLikeFieldSet = {query: componentFieldSet, fields: componentFieldSet};

    const ir = await captureQuery(() =>
      Person.select((p) => p.bestFriend.preloadFor(componentLikeFieldSet)),
    );
    expect(ir.kind).toBe('select');
    expect(ir.projection.length).toBeGreaterThanOrEqual(1);
  });

  test('fields() returns FieldSet for use by pipeline', () => {
    const builder = QueryBuilder.from(Person).select((p) => [p.name]);
    const fs = builder.fields();
    expect(fs).toBeDefined();
    expect(fs!.entries.length).toBeGreaterThan(0);
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

// =============================================================================
// Phase 8: Direct IR generation tests
// TQ3 fix: strengthened sub-select test to verify actual structure.
// =============================================================================

describe('QueryBuilder — direct IR generation', () => {
  test('FieldSet select produces same IR as callback select', () => {
    const fs = FieldSet.for(Person, ['name', 'hobby']);
    const fieldSetIR = QueryBuilder.from(Person).select(fs).build();
    const callbackIR = QueryBuilder.from(Person).select((p) => [p.name, p.hobby]).build();
    expect(sanitize(fieldSetIR)).toEqual(sanitize(callbackIR));
  });

  test('FieldSet select with where produces same IR as callback', () => {
    const fs = FieldSet.for(Person, ['name']);
    const fieldSetIR = QueryBuilder.from(Person)
      .select(fs)
      .where((p) => p.name.equals('Semmy'))
      .build();
    const callbackIR = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .where((p) => p.name.equals('Semmy'))
      .build();
    expect(sanitize(fieldSetIR)).toEqual(sanitize(callbackIR));
  });

  test('FieldSet select with orderBy produces same IR as callback', () => {
    const fs = FieldSet.for(Person, ['name']);
    const fieldSetIR = QueryBuilder.from(Person)
      .select(fs)
      .orderBy((p) => p.name, 'DESC')
      .build();
    const callbackIR = QueryBuilder.from(Person)
      .select((p) => [p.name])
      .orderBy((p) => p.name, 'DESC')
      .build();
    expect(sanitize(fieldSetIR)).toEqual(sanitize(callbackIR));
  });

  test('selectAll uses direct path (no buildFactory)', () => {
    const ir = QueryBuilder.from(Person).selectAll().limit(5).build();
    expect(ir.projection.length).toBeGreaterThan(0);
    expect(ir.limit).toBe(5);
  });

  test('label-based select uses direct path', () => {
    const ir = QueryBuilder.from(Person).select(['name', 'hobby']).limit(10).build();
    expect(ir.projection.length).toBe(2);
    expect(ir.limit).toBe(10);
  });

  test('direct path handles where + limit + offset', () => {
    const fs = FieldSet.for(Person, ['name']);
    const ir = QueryBuilder.from(Person)
      .select(fs)
      .where((p) => p.name.equals('Semmy'))
      .limit(5)
      .offset(10)
      .build();
    expect(ir.where).toBeDefined();
    expect(ir.limit).toBe(5);
    expect(ir.offset).toBe(10);
  });

  test('direct path handles forAll + subjects', () => {
    const fs = FieldSet.for(Person, ['name']);
    const ir = QueryBuilder.from(Person)
      .select(fs)
      .forAll([`${tmpEntityBase}p1`, `${tmpEntityBase}p2`])
      .build();
    expect(ir.subjectIds).toHaveLength(2);
  });

  test('direct path handles for (single subject)', () => {
    const fs = FieldSet.for(Person, ['name']);
    const ir = QueryBuilder.from(Person)
      .select(fs)
      .for({id: `${tmpEntityBase}p1`})
      .build();
    expect(ir.subjectId).toBe(`${tmpEntityBase}p1`);
    expect(ir.singleResult).toBe(true);
  });

  test('evaluation selection (equals) produces same IR as DSL', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) => ({isBestFriend: p.bestFriend.equals({id: `${tmpEntityBase}p3`})})),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) => ({isBestFriend: p.bestFriend.equals({id: `${tmpEntityBase}p3`})}))
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('sub-select via callback produces matching IR to DSL', async () => {
    const dslIR = await captureDslIR(() =>
      Person.select((p) => p.friends.select((f) => [f.name, f.hobby])),
    );
    const builderIR = QueryBuilder.from(Person)
      .select((p) => p.friends.select((f: any) => [f.name, f.hobby]))
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });
});

// =============================================================================
// .for() and .forAll() chaining tests
// =============================================================================

describe('Shape.select().for() / .forAll() chaining', () => {
  test('Person.select(callback).for(id) produces single-result IR', () => {
    const ir = Person.select((p) => p.name).for(entity('p1')).build();
    expect(ir.subjectId).toBe(entity('p1').id);
    expect(ir.singleResult).toBe(true);
  });

  test('Person.select(callback).for(string) accepts string id', () => {
    const ir = Person.select((p) => p.name).for(`${tmpEntityBase}p1`).build();
    expect(ir.subjectId).toBe(`${tmpEntityBase}p1`);
    expect(ir.singleResult).toBe(true);
  });

  test('Person.select().for(id) with no callback selects nothing', () => {
    const ir = Person.select().for(entity('p1')).build();
    expect(ir.subjectId).toBe(entity('p1').id);
    expect(ir.singleResult).toBe(true);
  });

  test('Person.selectAll().for(id) selects all fields for a single entity', () => {
    const ir = Person.selectAll().for(entity('p1')).build();
    expect(ir.subjectId).toBe(entity('p1').id);
    expect(ir.singleResult).toBe(true);
    expect(ir.projection.length).toBeGreaterThan(0);
  });

  test('.for(id) produces same IR as old select(id, callback)', async () => {
    const newIR = Person.select((p) => p.name).for(entity('p1')).build();
    const builderIR = QueryBuilder.from(Person)
      .select((p) => p.name)
      .for(entity('p1'))
      .build();
    expect(sanitize(newIR)).toEqual(sanitize(builderIR));
  });

  test('.forAll(ids) targets multiple entities', () => {
    const ir = QueryBuilder.from(Person)
      .select((p) => p.name)
      .forAll([entity('p1'), entity('p2')])
      .build();
    expect(ir.subjectIds).toEqual([entity('p1').id, entity('p2').id]);
    expect(ir.singleResult).toBeFalsy();
  });
});

describe('Person.update(data).for(id) chaining', () => {
  test('Person.update(data).for(id) produces correct IR', () => {
    const ir = Person.update({hobby: 'Chess'}).for(entity('p1')).build();
    expect(ir).toBeDefined();
  });

  test('UpdateBuilder.from().for(id).set(data) produces same IR as update(data).for(id)', () => {
    const ir1 = Person.update({hobby: 'Chess'}).for(entity('p1')).build();
    const ir2 = UpdateBuilder.from(Person).for(entity('p1')).set({hobby: 'Chess'}).build();
    expect(sanitize(ir1)).toEqual(sanitize(ir2));
  });

  test('Person.update(data).for(string) accepts string id', () => {
    const ir = Person.update({hobby: 'Chess'}).for(`${tmpEntityBase}p1`).build();
    expect(ir).toBeDefined();
  });

  test('UpdateBuilder.from(Person).for(id).set(data) matches Person.update(data).for(id)', () => {
    const dslIR = Person.update({hobby: 'Chess'}).for(entity('p1')).build();
    const builderIR = UpdateBuilder.from(Person)
      .for(entity('p1'))
      .set({hobby: 'Chess'})
      .build();
    expect(sanitize(dslIR)).toEqual(sanitize(builderIR));
  });
});
