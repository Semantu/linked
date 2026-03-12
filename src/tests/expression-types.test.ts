/**
 * Type-level tests for Phase 6: Expression-aware TypeScript types for updates.
 *
 * These tests verify that the type system correctly accepts expression values
 * and function callbacks in update operations, and rejects invalid usage.
 */
import {describe, test, expect} from '@jest/globals';
import {Dog, Person} from '../test-helpers/query-fixtures';
import {ExpressionNode} from '../expressions/ExpressionNode';
import {Expr} from '../expressions/Expr';
import {UpdateBuilder} from '../queries/UpdateBuilder';
import type {ExpressionUpdateProxy, ExpressionUpdateResult} from '../expressions/ExpressionMethods';
import type {UpdatePartial} from '../queries/QueryFactory';

// Helper: a concrete ExpressionNode for use in tests
const someExprNode = Expr.now();

describe('Expression-aware update types', () => {
  // -------------------------------------------------------------------------
  // Sub-A: .set({prop: ExpressionNode}) compiles
  // -------------------------------------------------------------------------

  test('set() accepts ExpressionNode for literal properties', () => {
    // This should compile — ExpressionNode is now part of the literal union
    const builder = UpdateBuilder.from(Dog).set({guardDogLevel: someExprNode});
    expect(builder).toBeDefined();
  });

  test('set() accepts ExpressionNode for string properties', () => {
    const builder = UpdateBuilder.from(Person).set({name: someExprNode});
    expect(builder).toBeDefined();
  });

  test('set() accepts ExpressionNode for date properties', () => {
    const builder = UpdateBuilder.from(Person).set({birthDate: Expr.now()});
    expect(builder).toBeDefined();
  });

  test('set() still accepts plain literal values', () => {
    const builder = UpdateBuilder.from(Person).set({name: 'Alice'});
    expect(builder).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Sub-C: .set(p => ({...})) function callback compiles
  // -------------------------------------------------------------------------

  test('set() accepts function callback with expression methods', () => {
    const builder = UpdateBuilder.from(Dog).set((p) => ({
      guardDogLevel: p.guardDogLevel.plus(1),
    }));
    expect(builder).toBeDefined();
  });

  test('Shape.update() accepts function callback', () => {
    const builder = Dog.update((p) => ({
      guardDogLevel: p.guardDogLevel.plus(1),
    }));
    expect(builder).toBeDefined();
  });

  test('Shape.update() still accepts plain object', () => {
    const builder = Person.update({name: 'Bob'});
    expect(builder).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Negative type tests (compile-time only)
  // -------------------------------------------------------------------------

  test('type-level: string property cannot use .plus()', () => {
    type Bad = ExpressionUpdateProxy<Person>['name'] extends {plus: any} ? true : false;
    const check: Bad = false;
    expect(check).toBe(false);
  });

  test('type-level: numeric property has .plus()', () => {
    type Good = ExpressionUpdateProxy<Dog>['guardDogLevel'] extends {plus: any} ? true : false;
    const check: Good = true;
    expect(check).toBe(true);
  });

  test('type-level: string property has .strlen()', () => {
    type Good = ExpressionUpdateProxy<Person>['name'] extends {strlen: any} ? true : false;
    const check: Good = true;
    expect(check).toBe(true);
  });

  test('type-level: date property has .year()', () => {
    type Good = ExpressionUpdateProxy<Person>['birthDate'] extends {year: any} ? true : false;
    const check: Good = true;
    expect(check).toBe(true);
  });

  test('type-level: boolean property has .and()', () => {
    type Good = ExpressionUpdateProxy<Person>['isRealPerson'] extends {and: any} ? true : false;
    const check: Good = true;
    expect(check).toBe(true);
  });

  test('type-level: ShapeSet properties are never in ExpressionUpdateProxy', () => {
    type Check = ExpressionUpdateProxy<Person>['friends'];
    const check: Check = undefined as never;
    // The type should be `never` for ShapeSet properties
  });

  test('type-level: ExpressionUpdateResult allows ExpressionNode or literal', () => {
    // This should compile — ExpressionUpdateResult allows both
    const result: ExpressionUpdateResult<Person> = {
      name: someExprNode,
    };
    expect(result).toBeDefined();

    const result2: ExpressionUpdateResult<Person> = {
      name: 'plain string',
    };
    expect(result2).toBeDefined();
  });
});
