import {describe, test} from '@jest/globals';
import {Person, Dog, Pet} from '../test-helpers/query-fixtures';
import {QueryBuilder} from '../queries/QueryBuilder';

const expectType = <T>(_value: T) => _value;

// Compile-time checks only; skipped at runtime.
// These mirror query.types.test.ts but use QueryBuilder instead of the DSL.
describe.skip('QueryBuilder result type inference (compile only)', () => {
  test('select a literal property', () => {
    const qb = QueryBuilder.from(Person).select((p) => p.name);
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.name);
    expectType<string | undefined>(first.id);
  });

  test('select an object property (set)', () => {
    const qb = QueryBuilder.from(Person).select((p) => p.friends);
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<string | undefined>(first.id);
    expectType<string | undefined>(first.friends[0].id);
  });

  test('select a date', () => {
    const qb = QueryBuilder.from(Person).select((p) => p.birthDate);
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<Date | null | undefined>(first.birthDate);
    expectType<string | undefined>(first.id);
  });

  test('select a boolean', () => {
    const qb = QueryBuilder.from(Person).select((p) => p.isRealPerson);
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<boolean | null | undefined>(first.isRealPerson);
    expectType<string | undefined>(first.id);
  });

  test('select multiple property paths', () => {
    const qb = QueryBuilder.from(Person).select((p) => [p.name, p.friends, p.bestFriend.name]);
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.name);
    expectType<string | undefined>(first.friends[0].id);
    expectType<string | null | undefined>(first.bestFriend.name);
  });

  test('select nested set property', () => {
    const qb = QueryBuilder.from(Person).select((p) => p.friends.name);
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.friends[0].name);
    expectType<string | undefined>(first.friends[0].id);
  });

  test('select deep nested', () => {
    const qb = QueryBuilder.from(Person).select((p) => p.friends.bestFriend.bestFriend.name);
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.friends[0].bestFriend.bestFriend.name);
  });

  test('select best friend name (single object property)', () => {
    const qb = QueryBuilder.from(Person).select((p) => p.bestFriend.name);
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.bestFriend.name);
  });

  test('count a shapeset', () => {
    const qb = QueryBuilder.from(Person).select((p) => p.friends.size());
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<number>(first.friends);
  });

  test('custom result object - count', () => {
    const qb = QueryBuilder.from(Person).select((p) => ({numFriends: p.friends.size()}));
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<number>(first.numFriends);
  });

  test('custom result object - equals boolean', () => {
    const qb = QueryBuilder.from(Person).select((p) => ({isBestFriend: p.bestFriend.equals({id: 'p3'})}));
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<boolean>(first.isBestFriend);
  });

  test('sub select plural - custom object', () => {
    const qb = QueryBuilder.from(Person).select((p) =>
      p.friends.select((f) => ({name: f.name, hobby: f.hobby})),
    );
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.friends[0].name);
    expectType<string | null | undefined>(first.friends[0].hobby);
  });

  test('select with where preserves result type', () => {
    const qb = QueryBuilder.from(Person)
      .select((p) => p.name)
      .where((p) => p.friends.name.equals('Alice'));
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.name);
    expectType<string | undefined>(first.id);
  });

  test('select with limit preserves result type', () => {
    const qb = QueryBuilder.from(Person)
      .select((p) => [p.name, p.friends])
      .limit(10);
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.name);
    expectType<string | undefined>(first.friends[0].id);
  });

  test('select with offset preserves result type', () => {
    const qb = QueryBuilder.from(Person)
      .select((p) => p.name)
      .offset(5);
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.name);
  });

  test('select with orderBy preserves result type', () => {
    const qb = QueryBuilder.from(Person)
      .select((p) => p.name)
      .orderBy((p) => p.name, 'DESC');
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.name);
  });

  test('select with sortBy preserves result type', () => {
    const qb = QueryBuilder.from(Person)
      .select((p) => p.name)
      .sortBy((p) => p.name);
    type Result = Awaited<typeof qb>;
    const first = (null as unknown as Result)[0];
    expectType<string | null | undefined>(first.name);
  });
});
