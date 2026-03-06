import {describe, expect, test} from '@jest/globals';
import {Person, tmpEntityBase} from '../test-helpers/query-fixtures';
import {captureQuery} from '../test-helpers/query-capture-store';
import {CreateBuilder} from '../queries/CreateBuilder';
import {UpdateBuilder} from '../queries/UpdateBuilder';
import {DeleteBuilder} from '../queries/DeleteBuilder';

const entity = (suffix: string) => ({id: `${tmpEntityBase}${suffix}`});

/**
 * Helper: capture IR from the existing DSL path.
 */
const captureDslIR = async (runner: () => Promise<unknown>) => {
  return captureQuery(runner);
};

/**
 * Helper: sanitize IR for comparison.
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
      Person.update(entity('p1'), {hobby: 'Chess'}),
    );
    const builderIR = UpdateBuilder.from(Person)
      .for(entity('p1'))
      .set({hobby: 'Chess'})
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('update — add/remove multi', async () => {
    const dslIR = await captureDslIR(() =>
      Person.update(entity('p1'), {
        friends: {add: [entity('p2')], remove: [entity('p3')]},
      }),
    );
    const builderIR = UpdateBuilder.from(Person)
      .for(entity('p1'))
      .set({friends: {add: [entity('p2')], remove: [entity('p3')]}})
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('update — nested with predefined id', async () => {
    const dslIR = await captureDslIR(() =>
      Person.update(entity('p1'), {
        bestFriend: {id: `${tmpEntityBase}p3-best-friend`, name: 'Bestie'},
      }),
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
      Person.update(entity('p1'), {friends: [entity('p2')]}),
    );
    const builderIR = UpdateBuilder.from(Person)
      .for(entity('p1'))
      .set({friends: [entity('p2')]})
      .build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('update — birth date', async () => {
    const dslIR = await captureDslIR(() =>
      Person.update(entity('p1'), {birthDate: new Date('2020-01-01')}),
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
  test('delete — single', async () => {
    const dslIR = await captureDslIR(() => Person.delete(entity('to-delete')));
    const builderIR = DeleteBuilder.from(Person, entity('to-delete')).build();
    expect(sanitize(builderIR)).toEqual(sanitize(dslIR));
  });

  test('delete — multiple', async () => {
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
// Guard tests
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
    const builder = DeleteBuilder.from(Person, entity('to-delete'));
    expect(typeof builder.then).toBe('function');
  });

  test('CreateBuilder await triggers execution', async () => {
    const result = await CreateBuilder.from(Person).set({name: 'Test'});
    expect(result).toBeDefined();
  });

  test('DeleteBuilder await triggers execution', async () => {
    const result = await DeleteBuilder.from(Person, entity('to-delete'));
    expect(result).toEqual({deleted: [], count: 0});
  });
});
