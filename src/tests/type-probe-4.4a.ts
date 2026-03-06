/**
 * Type probe for Phase 4.4a — tests whether QueryResponseToResultType resolves
 * correctly when used as a computed generic parameter (simulating QueryBuilder).
 *
 * This file is NOT a test. Run with: npx tsc --noEmit src/tests/type-probe-4.4a.ts
 * If it compiles, the approach works.
 */
import {Person, Dog, Pet} from '../test-helpers/query-fixtures';
import {
  QueryResponseToResultType,
  QueryBuildFn,
  SelectQueryFactory,
  SingleResult,
} from '../queries/SelectQuery';
import {Shape} from '../shapes/Shape';

const expectType = <T>(_value: T) => _value;

// =============================================================================
// PROBE 1: Does QueryResponseToResultType resolve when used as a default
// generic parameter, with S and R inferred at the call site?
// =============================================================================

// Simulates QueryBuilder.select() return type
type SimulatedResult<S extends Shape, R> = QueryResponseToResultType<R, S>[];

// The function simulates what QueryBuilder.select(fn) would do:
declare function simulateSelect<S extends Shape, NewR>(
  shape: abstract new (...args: any[]) => S,
  fn: QueryBuildFn<S, NewR>,
): {result: SimulatedResult<S, NewR>};

// --- Test: literal property ---
const t1 = simulateSelect(Person, (p) => p.name);
type T1 = typeof t1.result;
const _t1: T1 = null as any;
expectType<string | null | undefined>(_t1[0].name);
expectType<string | undefined>(_t1[0].id);

// --- Test: object property (set) ---
const t2 = simulateSelect(Person, (p) => p.friends);
type T2 = typeof t2.result;
const _t2: T2 = null as any;
expectType<string | undefined>(_t2[0].friends[0].id);

// --- Test: multiple paths ---
const t3 = simulateSelect(Person, (p) => [p.name, p.friends, p.bestFriend.name]);
type T3 = typeof t3.result;
const _t3: T3 = null as any;
expectType<string | null | undefined>(_t3[0].name);
expectType<string | undefined>(_t3[0].friends[0].id);
expectType<string | null | undefined>(_t3[0].bestFriend.name);

// --- Test: nested property path ---
const t4 = simulateSelect(Person, (p) => p.friends.name);
type T4 = typeof t4.result;
const _t4: T4 = null as any;
expectType<string | null | undefined>(_t4[0].friends[0].name);

// --- Test: deep nested ---
const t5 = simulateSelect(Person, (p) => p.friends.bestFriend.bestFriend.name);
type T5 = typeof t5.result;
const _t5: T5 = null as any;
expectType<string | null | undefined>(_t5[0].friends[0].bestFriend.bestFriend.name);

// =============================================================================
// PROBE 2: Does SingleResult (for .one()) unwrap correctly?
// =============================================================================

type OneResult<R> = R extends (infer E)[] ? E : R;

// Simulated .one() on result of select
type T1One = OneResult<T1>;
const _t1One: T1One = null as any;
expectType<string | null | undefined>(_t1One.name);

// =============================================================================
// PROBE 3: Does it work inside a class with generic propagation?
// (simulates QueryBuilder<S, R, Result>)
// =============================================================================

declare class FakeBuilder<S extends Shape, R = any, Result = any> {
  select<NewR>(fn: QueryBuildFn<S, NewR>): FakeBuilder<S, NewR, QueryResponseToResultType<NewR, S>[]>;
  where(fn: any): FakeBuilder<S, R, Result>;
  limit(n: number): FakeBuilder<S, R, Result>;
  one(): FakeBuilder<S, R, OneResult<Result>>;
  then<T1 = Result>(onfulfilled?: ((value: Result) => T1) | null): Promise<T1>;
}

declare function fakeFrom<S extends Shape>(shape: abstract new (...args: any[]) => S): FakeBuilder<S>;

// --- Test: full chain simulation ---
const fb1 = fakeFrom(Person).select((p) => p.name);
type FB1Result = Awaited<typeof fb1 extends { then: (onfulfilled?: infer F) => any } ? (F extends ((v: infer V) => any) ? Promise<V> : never) : never>;
// Simpler: just test the Result generic directly
type FB1 = typeof fb1 extends FakeBuilder<any, any, infer Res> ? Res : never;
const _fb1: FB1 = null as any;
expectType<string | null | undefined>(_fb1[0].name);

// --- Test: chain with where + limit (Result preserved) ---
const fb2 = fakeFrom(Person).select((p) => p.name).where((p: any) => true).limit(10);
type FB2 = typeof fb2 extends FakeBuilder<any, any, infer Res> ? Res : never;
const _fb2: FB2 = null as any;
expectType<string | null | undefined>(_fb2[0].name);

// --- Test: .one() unwraps ---
const fb3 = fakeFrom(Person).select((p) => p.name).one();
type FB3 = typeof fb3 extends FakeBuilder<any, any, infer Res> ? Res : never;
const _fb3: FB3 = null as any;
expectType<string | null | undefined>(_fb3.name);

// --- Test: sub-select ---
const fb4 = fakeFrom(Person).select((p) =>
  p.friends.select((f) => ({name: f.name, hobby: f.hobby})),
);
type FB4 = typeof fb4 extends FakeBuilder<any, any, infer Res> ? Res : never;
const _fb4: FB4 = null as any;
expectType<string | null | undefined>(_fb4[0].friends[0].name);
expectType<string | null | undefined>(_fb4[0].friends[0].hobby);

// --- Test: count ---
const fb5 = fakeFrom(Person).select((p) => p.friends.size());
type FB5 = typeof fb5 extends FakeBuilder<any, any, infer Res> ? Res : never;
const _fb5: FB5 = null as any;
expectType<number>(_fb5[0].friends);

// --- Test: custom object ---
const fb6 = fakeFrom(Person).select((p) => ({numFriends: p.friends.size()}));
type FB6 = typeof fb6 extends FakeBuilder<any, any, infer Res> ? Res : never;
const _fb6: FB6 = null as any;
expectType<number>(_fb6[0].numFriends);

// --- Test: boolean (equals without where) ---
const fb7 = fakeFrom(Person).select((p) => ({isBestFriend: p.bestFriend.equals({id: 'p3'})}));
type FB7 = typeof fb7 extends FakeBuilder<any, any, infer Res> ? Res : never;
const _fb7: FB7 = null as any;
expectType<boolean>(_fb7[0].isBestFriend);

// =============================================================================
// PROBE 4: Does Awaited<FakeBuilder> resolve correctly via PromiseLike?
// This is the critical test — users write `const r = await builder`.
// =============================================================================

// PromiseLike-based builder (closer to real implementation)
declare class PromiseBuilder<S extends Shape, R = any, Result = any>
  implements PromiseLike<Result>
{
  select<NewR>(fn: QueryBuildFn<S, NewR>): PromiseBuilder<S, NewR, QueryResponseToResultType<NewR, S>[]>;
  where(fn: any): PromiseBuilder<S, R, Result>;
  limit(n: number): PromiseBuilder<S, R, Result>;
  one(): PromiseBuilder<S, R, Result extends (infer E)[] ? E : Result>;
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

declare function promiseFrom<S extends Shape>(shape: abstract new (...args: any[]) => S): PromiseBuilder<S>;

// Test: Awaited<> resolves through PromiseLike.then()
// More realistic: test the actual usage pattern
const pb1 = promiseFrom(Person).select((p) => p.name);
type PB1Result = Awaited<typeof pb1>;
const _pb1: PB1Result = null as any;
expectType<string | null | undefined>(_pb1[0].name);
expectType<string | undefined>(_pb1[0].id);

// Test: Awaited with .one()
const pb2 = promiseFrom(Person).select((p) => p.name).one();
type PB2Result = Awaited<typeof pb2>;
const _pb2: PB2Result = null as any;
expectType<string | null | undefined>(_pb2.name);
expectType<string | undefined>(_pb2.id);

// Test: Awaited with chaining
const pb3 = promiseFrom(Person).select((p) => [p.name, p.friends]).where(null).limit(5);
type PB3Result = Awaited<typeof pb3>;
const _pb3: PB3Result = null as any;
expectType<string | null | undefined>(_pb3[0].name);
expectType<string | undefined>(_pb3[0].friends[0].id);

// Test: sub-select through PromiseLike
const pb4 = promiseFrom(Person).select((p) =>
  p.friends.select((f) => ({name: f.name, hobby: f.hobby})),
);
type PB4Result = Awaited<typeof pb4>;
const _pb4: PB4Result = null as any;
expectType<string | null | undefined>(_pb4[0].friends[0].name);
expectType<string | null | undefined>(_pb4[0].friends[0].hobby);

// Test: date type
const pb5 = promiseFrom(Person).select((p) => p.birthDate);
type PB5Result = Awaited<typeof pb5>;
const _pb5: PB5Result = null as any;
expectType<Date | null | undefined>(_pb5[0].birthDate);

// Test: boolean
const pb6 = promiseFrom(Person).select((p) => p.isRealPerson);
type PB6Result = Awaited<typeof pb6>;
const _pb6: PB6Result = null as any;
expectType<boolean | null | undefined>(_pb6[0].isRealPerson);

console.log('Type probe compiled successfully — approach is viable.');
