import {describe, expect, test} from '@jest/globals';
import {Person, tmpEntityBase} from '../test-helpers/query-fixtures';
import {entity, captureDslIR, sanitize} from '../test-helpers/test-utils';
import {CreateBuilder} from '../queries/CreateBuilder';
import {UpdateBuilder} from '../queries/UpdateBuilder';
import {DeleteBuilder} from '../queries/DeleteBuilder';

// =============================================================================
// Create IR equivalence tests
// =============================================================================

describe('CreateBuilder — IR equivalence', () => {
  test('create — simple', async () => {
    const dslIR = await captureDslIR(() =>
      Person.create({name: 'Test Create', hobby: 'Chess'}),
    );
    const builderIR = CreateBuilder.from(Person)
      .set({name: 'Test Create', hobby: 'Chess'})
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('create — with friends', async () => {
    const dslIR = await captureDslIR(() =>
      Person.create({
        name: 'Test Create',
        friends: [entity('p2'), {name: 'New Friend'}],
      }),
    );
    const builderIR = CreateBuilder.from(Person)
      .set({
        name: 'Test Create',
        friends: [entity('p2'), {name: 'New Friend'}],
      })
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('create — with fixed id', async () => {
    const dslIR = await captureDslIR(() =>
      Person.create({
        __id: `${tmpEntityBase}fixed-id`,
        name: 'Fixed',
        bestFriend: {id: `${tmpEntityBase}fixed-id-2`},
      } as any),
    );
    const builderIR = CreateBuilder.from(Person)
      .set({name: 'Fixed', bestFriend: {id: `${tmpEntityBase}fixed-id-2`}} as any)
      .withId(`${tmpEntityBase}fixed-id`)
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });
});

// =============================================================================
// Update IR equivalence tests
// =============================================================================

describe('UpdateBuilder — IR equivalence', () => {
  test('update — simple', async () => {
    const dslIR = await captureDslIR(() =>
      Person.update({hobby: 'Chess'}).for(entity('p1')),
    );
    const builderIR = UpdateBuilder.from(Person)
      .for(entity('p1'))
      .set({hobby: 'Chess'})
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('update — add/remove multi', async () => {
    const dslIR = await captureDslIR(() =>
      Person.update({
        friends: {add: [entity('p2')], remove: [entity('p3')]},
      }).for(entity('p1')),
    );
    const builderIR = UpdateBuilder.from(Person)
      .for(entity('p1'))
      .set({friends: {add: [entity('p2')], remove: [entity('p3')]}})
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('update — nested with predefined id', async () => {
    const dslIR = await captureDslIR(() =>
      Person.update({
        bestFriend: {id: `${tmpEntityBase}p3-best-friend`, name: 'Bestie'},
      }).for(entity('p1')),
    );
    const builderIR = UpdateBuilder.from(Person)
      .for(entity('p1'))
      .set({
        bestFriend: {id: `${tmpEntityBase}p3-best-friend`, name: 'Bestie'},
      })
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('update — overwrite set', async () => {
    const dslIR = await captureDslIR(() =>
      Person.update({friends: [entity('p2')]}).for(entity('p1')),
    );
    const builderIR = UpdateBuilder.from(Person)
      .for(entity('p1'))
      .set({friends: [entity('p2')]})
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('update — birth date', async () => {
    const dslIR = await captureDslIR(() =>
      Person.update({birthDate: new Date('2020-01-01')}).for(entity('p1')),
    );
    const builderIR = UpdateBuilder.from(Person)
      .for(entity('p1'))
      .set({birthDate: new Date('2020-01-01')})
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });
});

// =============================================================================
// Delete IR equivalence tests
// =============================================================================

describe('DeleteBuilder — IR equivalence', () => {
  test('delete — single via .for()', async () => {
    const dslIR = await captureDslIR(() => Person.delete(entity('to-delete')));
    const builderIR = DeleteBuilder.from(Person).for(entity('to-delete')).build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('delete — multiple via .for()', async () => {
    const dslIR = await captureDslIR(() =>
      Person.delete([entity('to-delete-1'), entity('to-delete-2')]),
    );
    const builderIR = DeleteBuilder.from(Person)
      .for([entity('to-delete-1'), entity('to-delete-2')])
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('delete — single via .from() (backwards compat)', async () => {
    const dslIR = await captureDslIR(() => Person.delete(entity('to-delete')));
    const builderIR = DeleteBuilder.from(Person, entity('to-delete')).build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('delete — multiple via .from() (backwards compat)', async () => {
    const dslIR = await captureDslIR(() =>
      Person.delete([entity('to-delete-1'), entity('to-delete-2')]),
    );
    const builderIR = DeleteBuilder.from(Person, [
      entity('to-delete-1'),
      entity('to-delete-2'),
    ]).build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });
});

// =============================================================================
// Immutability tests
// =============================================================================

describe('Mutation builders — immutability', () => {
  test('CreateBuilder — .set() returns new instance', () => {
    const b1 = CreateBuilder.from(Person);
    const b2 = b1.set({name: 'Alice'});
    expect(b1).not.toBe(b2);
  });

  test('CreateBuilder — .withId() returns new instance', () => {
    const b1 = CreateBuilder.from(Person).set({name: 'Alice'});
    const b2 = b1.withId('some-id');
    expect(b1).not.toBe(b2);
  });

  test('DeleteBuilder — .for() returns new instance', () => {
    const b1 = DeleteBuilder.from(Person);
    const b2 = b1.for(entity('to-delete'));
    expect(b1).not.toBe(b2);
  });

  test('UpdateBuilder — .for() returns new instance', () => {
    const b1 = UpdateBuilder.from(Person);
    const b2 = b1.for(entity('p1'));
    expect(b1).not.toBe(b2);
  });

  test('UpdateBuilder — .set() returns new instance', () => {
    const b1 = UpdateBuilder.from(Person).for(entity('p1'));
    const b2 = b1.set({hobby: 'Chess'});
    expect(b1).not.toBe(b2);
  });
});

// =============================================================================
// Guard tests (LP3 + LP4: consistent validation across builders)
// =============================================================================

describe('Mutation builders — guards', () => {
  test('UpdateBuilder — .build() without .for() throws', () => {
    const builder = UpdateBuilder.from(Person).set({hobby: 'Chess'});
    expect(() => builder.build()).toThrow(/requires .for/);
  });

  test('UpdateBuilder — .build() without .set() throws', () => {
    const builder = UpdateBuilder.from(Person).for(entity('p1'));
    expect(() => builder.build()).toThrow(/requires .set/);
  });

  test('CreateBuilder — .build() without .set() throws', () => {
    const builder = CreateBuilder.from(Person);
    expect(() => builder.build()).toThrow(/requires .set/);
  });

  test('DeleteBuilder — .build() without .for() throws', () => {
    const builder = DeleteBuilder.from(Person);
    expect(() => builder.build()).toThrow(/requires at least one ID/);
  });

  test('DeleteBuilder — .build() with empty .for() throws', () => {
    const builder = DeleteBuilder.from(Person).for([] as any);
    expect(() => builder.build()).toThrow(/requires at least one ID/);
  });
});

// =============================================================================
// PromiseLike tests
// =============================================================================

describe('Mutation builders — PromiseLike', () => {
  test('CreateBuilder has .then()', () => {
    const builder = CreateBuilder.from(Person).set({name: 'Alice'});
    expect(typeof builder.then).toBe('function');
  });

  test('UpdateBuilder has .then()', () => {
    const builder = UpdateBuilder.from(Person).for(entity('p1')).set({hobby: 'Chess'});
    expect(typeof builder.then).toBe('function');
  });

  test('DeleteBuilder has .then()', () => {
    const builder = DeleteBuilder.from(Person).for(entity('to-delete'));
    expect(typeof builder.then).toBe('function');
  });

  test('CreateBuilder await triggers execution', async () => {
    const result = await CreateBuilder.from(Person).set({name: 'Test'});
    expect(result).toBeDefined();
  });

  test('DeleteBuilder await triggers execution', async () => {
    const result = await DeleteBuilder.from(Person).for(entity('to-delete'));
    expect(result).toEqual({deleted: [], count: 0});
  });
});
