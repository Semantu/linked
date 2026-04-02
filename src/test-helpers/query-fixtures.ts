import {linkedShape} from '../package';
import {literalProperty, objectProperty} from '../shapes/SHACL';
import {Shape} from '../shapes/Shape';
import {xsd} from '../ontologies/xsd';
import {ShapeSet} from '../collections/ShapeSet';
import {getQueryContext} from '../queries/QueryContext';
import {NodeReferenceValue, UpdatePartial} from '../queries/QueryFactory';
import {DeleteBuilder} from '../queries/DeleteBuilder';

const tmpPropBase = 'linked://tmp/props/';
const tmpTypeBase = 'linked://tmp/types/';
export const tmpEntityBase = 'linked://tmp/entities/';

const prop = (suffix: string): NodeReferenceValue => ({
  id: `${tmpPropBase}${suffix}`,
});
const type = (suffix: string): NodeReferenceValue => ({
  id: `${tmpTypeBase}${suffix}`,
});
const entity = (suffix: string): NodeReferenceValue => ({
  id: `${tmpEntityBase}${suffix}`,
});

export const name = prop('name');
export const hobby = prop('hobby');
export const nickName = prop('nickName');
export const bestFriend = prop('bestFriend');
export const hasFriend = prop('hasFriend');
export const birthDate = prop('birthDate');
export const isRealPerson = prop('isRealPerson');
export const hasPet = prop('hasPet');
export const guardDogLevel = prop('guardDogLevel');
export const pluralTestProp = prop('pluralTestProp');
export const personClass = type('Person');
export const employeeClass = type('Employee');
export const petClass = type('Pet');
export const dogClass = type('Dog');
export const employeeName = prop('employeeName');
export const employeeDepartment = prop('employeeDepartment');

@linkedShape
export class Pet extends Shape {
  static targetClass = petClass;

  @objectProperty({path: bestFriend, maxCount: 1, shape: Pet})
  get bestFriend(): Pet {
    return null;
  }
}

@linkedShape
export class Dog extends Pet {
  static targetClass = dogClass;

  @literalProperty({path: guardDogLevel, maxCount: 1, datatype: xsd.integer})
  get guardDogLevel(): number {
    return null;
  }
}

@linkedShape
export class Person extends Shape {
  static targetClass = personClass;

  @literalProperty({path: name, maxCount: 1})
  get name(): string {
    return '';
  }

  @literalProperty({path: hobby, maxCount: 1})
  get hobby(): string {
    return '';
  }

  @literalProperty({path: nickName})
  get nickNames(): string[] {
    return [];
  }

  @literalProperty({path: birthDate, datatype: xsd.dateTime, maxCount: 1})
  get birthDate(): Date {
    return null;
  }

  @literalProperty({path: isRealPerson, datatype: xsd.boolean, maxCount: 1})
  get isRealPerson(): boolean {
    return null;
  }

  @objectProperty({path: bestFriend, maxCount: 1, shape: Person})
  get bestFriend(): Person {
    return null;
  }

  @objectProperty({path: hasFriend, shape: Person})
  get friends(): ShapeSet<Person> {
    return null;
  }

  @objectProperty({path: hasPet, shape: Pet})
  get pets(): ShapeSet<Pet> {
    return null;
  }

  @objectProperty({path: hasPet, maxCount: 1, shape: Pet})
  get firstPet(): Pet {
    return null;
  }

  @objectProperty({path: pluralTestProp, shape: Person})
  get pluralTestProp(): ShapeSet<Person> {
    return null;
  }
}

@linkedShape
export class Employee extends Person {
  static targetClass = employeeClass;

  @literalProperty({path: employeeName, maxCount: 1})
  get name(): string {
    return '';
  }

  @objectProperty({path: bestFriend, maxCount: 1, shape: Employee})
  get bestFriend(): Employee {
    return null;
  }

  @literalProperty({path: employeeDepartment, maxCount: 1})
  get department(): string {
    return '';
  }
}

import {QueryBuilder} from '../queries/QueryBuilder';
import {FieldSet} from '../queries/FieldSet';

const componentLike = {query: Person.select((p) => ({name: p.name}))};

const componentFieldSet = FieldSet.for(Person.shape, ['name']);
const componentLikeWithFieldSet = {query: componentFieldSet, fields: componentFieldSet};

const updateSimple: UpdatePartial<Person> = {hobby: 'Chess'};
const updateOverwriteSet: UpdatePartial<Person> = {friends: [entity('p2')]};
const updateUnsetSingleUndefined: UpdatePartial<Person> = {hobby: undefined};
const updateUnsetSingleNull: UpdatePartial<Person> = {hobby: null};
const updateOverwriteNested: UpdatePartial<Person> = {
  bestFriend: {name: 'Bestie'},
};
const updatePassIdReferences: UpdatePartial<Person> = {
  bestFriend: entity('p2'),
};
const updateAddRemoveMulti: UpdatePartial<Person> = {
  friends: {add: [entity('p2')], remove: [entity('p3')]},
};
const updateRemoveMulti: UpdatePartial<Person> = {
  friends: {remove: [entity('p2')]},
};
const updateAddRemoveSame: UpdatePartial<Person> = {
  friends: {add: [entity('p2')], remove: [entity('p3')]},
};
const updateUnsetMultiUndefined: UpdatePartial<Person> = {friends: undefined};
const updateNestedWithPredefinedId: UpdatePartial<Person> = {
  bestFriend: {id: `${tmpEntityBase}p3-best-friend`, name: 'Bestie'},
};
const updateBirthDate: UpdatePartial<Person> = {
  birthDate: new Date('2020-01-01'),
};

export const queryFactories = {
  selectName: () => Person.select((p) => p.name),
  selectFriends: () => Person.select((p) => p.friends),
  selectBirthDate: () => Person.select((p) => p.birthDate),
  selectIsRealPerson: () => Person.select((p) => p.isRealPerson),
  selectById: () => Person.select((p) => p.name).for(entity('p1')),
  selectByIdReference: () => Person.select((p) => p.name).for(entity('p1')),
  selectNonExisting: () =>
    Person.select((p) => p.name).for({id: 'https://does.not/exist'}),
  selectUndefinedOnly: () =>
    Person.select((p) => [p.hobby, p.bestFriend]).for(entity('p3')),
  selectFriendsName: () => Person.select((p) => p.friends.name),
  selectNestedFriendsName: () => Person.select((p) => p.friends.friends.name),
  selectMultiplePaths: () =>
    Person.select((p) => [p.name, p.friends, p.bestFriend.name]),
  selectBestFriendName: () => Person.select((p) => p.bestFriend.name),
  selectBestFriendOnly: () => Person.select((p) => p.bestFriend),
  selectDeepNested: () =>
    Person.select((p) => p.friends.bestFriend.bestFriend.name),
  whereFriendsNameEquals: () =>
    Person.select((p) => p.friends.where((f) => f.name.equals('Moa'))),
  whereFriendsNameEqualsChained: () =>
    Person.select((p) => p.friends.where((f) => f.name.equals('Moa')).name),
  whereBestFriendEquals: () =>
    Person.select().where((p) => p.bestFriend.equals(entity('p3'))),
  whereHobbyEquals: () =>
    Person.select((p) => p.hobby.where((h) => h.equals('Jogging'))),
  whereAnd: () =>
    Person.select((p) =>
      p.friends.where((f) => f.name.equals('Moa').and(f.hobby.equals('Jogging'))),
    ),
  whereOr: () =>
    Person.select((p) =>
      p.friends.where((f) => f.name.equals('Jinx').or(f.hobby.equals('Jogging'))),
    ),
  selectAllProperties: () => Person.selectAll(),
  selectAll: () => Person.select(),
  selectWhereNameSemmy: () =>
    Person.select().where((p) => p.name.equals('Semmy')),
  whereAndOrAnd: () =>
    Person.select((p) =>
      p.friends.where((f) =>
        f.name.equals('Jinx').or(f.hobby.equals('Jogging')).and(f.name.equals('Moa')),
      ),
    ),
  whereAndOrAndNested: () =>
    Person.select((p) =>
      p.friends.where((f) =>
        f.name.equals('Jinx').or(f.hobby.equals('Jogging').and(f.name.equals('Moa'))),
      ),
    ),
  whereSomeImplicit: () =>
    Person.select().where((p) => p.friends.name.equals('Moa')),
  whereSomeExplicit: () =>
    Person.select().where((p) => p.friends.some((f) => f.name.equals('Moa'))),
  whereEvery: () =>
    Person.select().where((p) =>
      p.friends.every((f) => f.name.equals('Moa').or(f.name.equals('Jinx'))),
    ),
  whereSequences: () =>
    Person.select().where((p) =>
      p.friends
        .some((f) => f.name.equals('Jinx'))
        .and(p.name.equals('Semmy')),
    ),
  outerWhere: () =>
    Person.select((p) => p.friends).where((p) => p.name.equals('Semmy')),
  whereWithContext: () =>
    Person.select((p) => p.name).where((p) =>
      p.bestFriend.equals(getQueryContext('user')),
    ),
  whereWithContextPath: () =>
    Person.select((p) => p.name).where((p) => {
      const userName = getQueryContext<Person>('user').name;
      return p.friends.some((f) => f.name.equals(userName));
    }),
  countFriends: () => Person.select((p) => p.friends.size()),
  countNestedFriends: () => Person.select((p) => p.friends.friends.size()),
  countLabel: () =>
    Person.select((p) =>
      p.friends.select((f) => ({numFriends: f.friends.size()})),
    ),
  nestedObjectProperty: () => Person.select((p) => p.friends.bestFriend),
  nestedObjectPropertySingle: () => Person.select((p) => p.friends.bestFriend),
  subSelectSingleProp: () =>
    Person.select((p) => p.bestFriend.select((f) => ({name: f.name}))),
  subSelectPluralCustom: () =>
    Person.select((p) =>
      p.friends.select((f) => ({name: f.name, hobby: f.hobby})),
    ),
  doubleNestedSubSelect: () =>
    Person.select((p) =>
      p.friends.select((p2) =>
        p2.bestFriend.select((p3) => ({name: p3.name})),
      ),
    ),
  subSelectAllProperties: () =>
    Person.select((p) => p.friends.selectAll()),
  subSelectAllPropertiesSingle: () =>
    Person.select((p) => p.bestFriend.selectAll()),
  subSelectAllPrimitives: () =>
    Person.select((p) =>
      p.bestFriend.select((f) => [f.name, f.birthDate, f.isRealPerson]),
    ),
  customResultEqualsBoolean: () =>
    Person.select((p) => ({isBestFriend: p.bestFriend.equals(entity('p3'))})),
  customResultNumFriends: () =>
    Person.select((p) => ({numFriends: p.friends.size()})),
  countEquals: () =>
    Person.select().where((p) => p.friends.size().equals(2)),
  subSelectArray: () =>
    Person.select((p) => p.friends.select((f) => [f.name, f.hobby])),
  selectShapeSetAs: () =>
    Person.select((p) => p.pets.as(Dog).guardDogLevel),
  selectNonExistingMultiple: () =>
    Person.select((p) => [p.bestFriend, p.friends]),
  selectShapeAs: () =>
    Person.select((p) => p.firstPet.as(Dog).guardDogLevel),
  selectOne: () =>
    Person.select((p) => p.name).where((p) => p.equals(entity('p1'))).one(),
  nestedQueries2: () =>
    Person.select((p) => [
      p.friends.select((p2) => [
        p2.firstPet,
        p2.bestFriend.select((p3) => ({name: p3.name})),
      ]),
    ]),
  pluralFilteredNestedSubSelect: () =>
    Person.select((p) =>
      p.pluralTestProp
        .where((pp) => pp.name.equals('Moa'))
        .select((pp) => [
          pp.name,
          pp.friends.select((f) => [f.name, f.hobby]),
        ]),
    ),
  selectDuplicatePaths: () =>
    Person.select((p) => [
      p.bestFriend.name,
      p.bestFriend.hobby,
      p.bestFriend.isRealPerson,
    ]),
  outerWhereLimit: () =>
    Person.select((p) => p.name)
      .where((p) => p.name.equals('Semmy').or(p.name.equals('Moa')))
      .limit(1),
  sortByAsc: () => Person.select((p) => p.name).orderBy((p) => p.name),
  sortByDesc: () =>
    Person.select((p) => p.name).orderBy((p) => p.name, 'DESC'),
  updateSimple: (() => Person.update(updateSimple).for(entity('p1'))) as () => any,
  createSimple: (() => Person.create({name: 'Test Create', hobby: 'Chess'})) as () => any,
  createWithFriends: (() =>
    Person.create({
      name: 'Test Create',
      friends: [entity('p2'), {name: 'New Friend'}],
    })) as () => any,
  createWithFixedId: (() =>
    Person.create({
      __id: `${tmpEntityBase}fixed-id`,
      name: 'Fixed',
      bestFriend: entity('fixed-id-2'),
    } as any)) as () => any,
  deleteSingle: () => Person.delete(entity('to-delete')),
  deleteSingleRef: () => Person.delete(entity('to-delete')),
  deleteMultiple: () =>
    Person.delete([entity('to-delete-1'), entity('to-delete-2')]),
  deleteMultipleFull: () =>
    Person.delete([entity('to-delete-1'), entity('to-delete-2')]),
  updateOverwriteSet: (() => Person.update(updateOverwriteSet).for(entity('p1'))) as () => any,
  updateUnsetSingleUndefined: (() =>
    Person.update(updateUnsetSingleUndefined).for(entity('p1'))) as () => any,
  updateUnsetSingleNull: (() =>
    Person.update(updateUnsetSingleNull).for(entity('p1'))) as () => any,
  updateOverwriteNested: (() =>
    Person.update(updateOverwriteNested).for(entity('p1'))) as () => any,
  updatePassIdReferences: (() =>
    Person.update(updatePassIdReferences).for(entity('p1'))) as () => any,
  updateAddRemoveMulti: (() =>
    Person.update(updateAddRemoveMulti).for(entity('p1'))) as () => any,
  updateRemoveMulti: (() => Person.update(updateRemoveMulti).for(entity('p1'))) as () => any,
  updateAddRemoveSame: (() => Person.update(updateAddRemoveSame).for(entity('p1'))) as () => any,
  updateUnsetMultiUndefined: (() =>
    Person.update(updateUnsetMultiUndefined).for(entity('p1'))) as () => any,
  updateNestedWithPredefinedId: (() =>
    Person.update(updateNestedWithPredefinedId).for(entity('p1'))) as () => any,
  updateBirthDate: (() => Person.update(updateBirthDate).for(entity('p1'))) as () => any,
  preloadBestFriend: () =>
    Person.select((p) => p.bestFriend.preloadFor(componentLike)),
  preloadBestFriendWithFieldSet: () =>
    Person.select((p) => p.bestFriend.preloadFor(componentLikeWithFieldSet)),
  queryBuilderPreload: () =>
    QueryBuilder.from(Person).select((p) => [p.name]).preload('bestFriend', componentLike),
  selectAllEmployeeProperties: () => Employee.selectAll(),

  // --- Deep nesting boundary tests (Phase 12 validation) ---

  // Triple-nested sub-selects: 3 levels of .select()
  tripleNestedSubSelect: () =>
    Person.select((p) =>
      p.friends.select((f) =>
        f.bestFriend.select((bf) =>
          bf.friends.select((ff) => ({name: ff.name, hobby: ff.hobby})),
        ),
      ),
    ),

  // Double nested: singular → plural
  doubleNestedSingularPlural: () =>
    Person.select((p) =>
      p.bestFriend.select((bf) =>
        bf.friends.select((f) => ({name: f.name, hobby: f.hobby})),
      ),
    ),

  // Double nested: plural → singular
  doubleNestedPluralSingular: () =>
    Person.select((p) =>
      p.friends.select((f) =>
        f.bestFriend.select((bf) => ({name: bf.name, isReal: bf.isRealPerson})),
      ),
    ),

  // Sub-select returning array of paths (not custom object)
  subSelectArrayOfPaths: () =>
    Person.select((p) =>
      p.friends.select((f) => [f.name, f.hobby, f.birthDate]),
    ),

  // Sub-select on singular returning array of paths
  subSelectSingularArrayPaths: () =>
    Person.select((p) =>
      p.bestFriend.select((bf) => [bf.name, bf.hobby, bf.isRealPerson]),
    ),

  // Sub-select with count in custom object
  subSelectWithCount: () =>
    Person.select((p) =>
      p.friends.select((f) => ({
        name: f.name,
        numFriends: f.friends.size(),
      })),
    ),

  // Mixed: plain path + sub-select in array
  mixedPathAndSubSelect: () =>
    Person.select((p) => [
      p.name,
      p.friends.select((f) => ({name: f.name, hobby: f.hobby})),
    ]),

  // Multiple sub-selects in array
  multipleSubSelectsInArray: () =>
    Person.select((p) => [
      p.friends.select((f) => ({name: f.name})),
      p.bestFriend.select((bf) => ({hobby: bf.hobby})),
    ]),

  // Sub-select + one() unwrap
  subSelectWithOne: () =>
    Person.select((p) =>
      p.friends.select((f) => ({name: f.name, hobby: f.hobby})),
    )
      .where((p) => p.equals(entity('p1')))
      .one(),

  // selectAll() on sub-select plural
  subSelectAllPlural: () =>
    Person.select((p) => p.friends.selectAll()),

  // selectAll() on sub-select singular
  subSelectAllSingular: () =>
    Person.select((p) => p.bestFriend.selectAll()),

  // Employee sub-select (inheritance)
  employeeSubSelect: () =>
    Employee.select((e) =>
      e.bestFriend.select((bf) => ({name: bf.name, dept: bf.department})),
    ),

  // --- MINUS pattern tests ---

  // Exclude by shape type
  minusShape: () =>
    Person.select((p) => p.name).minus(Employee),

  // Exclude by condition
  minusCondition: () =>
    Person.select((p) => p.name).minus((p) => p.hobby.equals('Chess')),

  // Chained MINUS — two separate MINUS blocks
  minusChained: () =>
    Person.select((p) => p.name).minus(Employee).minus((p) => p.hobby.equals('Chess')),

  // MINUS multi-property — exclude where ALL listed properties exist
  minusMultiProperty: () =>
    Person.select((p) => p.name).minus((p) => [p.hobby, p.nickNames]),

  // MINUS nested path — exclude where nested property path exists
  minusNestedPath: () =>
    Person.select((p) => p.name).minus((p) => [p.bestFriend.name]),

  // MINUS mixed — flat + nested in one call
  minusMixed: () =>
    Person.select((p) => p.name).minus((p) => [p.hobby, p.bestFriend.name]),

  // MINUS single property existence (no array, returns raw QBO)
  minusSingleProperty: () =>
    Person.select((p) => p.name).minus((p) => p.hobby),

  // --- Bulk delete tests ---

  // Delete all instances of a shape
  deleteAll: () => Person.deleteAll(),

  // Delete with where condition
  deleteWhere: () => Person.deleteWhere((p) => p.hobby.equals('Chess')),

  // Builder-chain equivalents for equivalence testing
  deleteAllBuilder: () => DeleteBuilder.from(Person).all(),
  deleteWhereBuilder: () => DeleteBuilder.from(Person).where((p) => p.hobby.equals('Chess')),

  // --- Conditional update tests ---

  // Update all instances
  updateForAll: (): any => Person.update({hobby: 'Chess'}).forAll(),

  // Update with where condition
  updateWhere: (): any => Person.update({hobby: 'Archived'}).where((p) => p.hobby.equals('Chess')),

  // --- Computed expression tests ---

  // Simple expression: string length
  exprStrlen: () =>
    Person.select((p) => (p.name as any).strlen()),

  // Expression with custom key
  exprCustomKey: () =>
    Person.select((p) => ({nameLen: (p.name as any).strlen()})),

  // Expression on nested path
  exprNestedPath: () =>
    Person.select((p) => (p.bestFriend.name as any).ucase()),

  // Multiple expressions in array
  exprMultiple: () =>
    Person.select((p) => [
      p.name,
      (p.name as any).strlen(),
    ]),

  // --- Mutation expression tests ---

  // Functional callback update with expression
  updateExprCallback: (): any =>
    Dog.update((p) => ({guardDogLevel: p.guardDogLevel.plus(1)})).for(entity('d1')),

  // Expression in update with Expr.now()
  updateExprNow: (): any => {
    const {Expr} = require('../expressions/Expr');
    return Person.update({birthDate: Expr.now()}).for(entity('p1'));
  },

  // --- Traversal expression mutation tests ---

  // Multi-segment expression ref: p.bestFriend.name.ucase()
  updateExprTraversal: (): any =>
    Person.update((p) => ({hobby: p.bestFriend.name.ucase()})).for(entity('p1')),

  // Shared traversal: two fields referencing same intermediate (p.bestFriend)
  updateExprSharedTraversal: (): any =>
    Person.update((p) => ({
      name: p.bestFriend.name.ucase(),
      hobby: p.bestFriend.hobby.lcase(),
    })).for(entity('p1')),

  // --- Expression-based WHERE filter tests (Phase 8) ---

  // Expression WHERE: STRLEN filter
  whereExprStrlen: () =>
    Person.select((p) => ({name: p.name})).where(((p: any) => p.name.strlen().gt(5)) as any),

  // Expression WHERE: arithmetic
  whereExprArithmetic: () =>
    Person.select((p) => ({name: p.name})).where(((p: any) => p.name.strlen().plus(10).lt(100)) as any),

  // Expression WHERE: AND chaining on ExpressionNode
  whereExprAndChain: () =>
    Person.select((p) => ({name: p.name})).where(((p: any) =>
      p.name.strlen().gt(5).and(p.name.strlen().lt(20))
    ) as any),

  // Expression WHERE: mixed Evaluation .and() with ExpressionNode
  whereExprMixed: () =>
    Person.select((p) => ({name: p.name})).where((p) =>
      p.name.equals('Bob').and((p.name as any).strlen().gt(3)),
    ),

  // Expression WHERE on UpdateBuilder
  whereExprUpdateBuilder: () =>
    Person.update({hobby: 'Archived'}).where(((p: any) => p.name.strlen().gt(3)) as any),

  // Expression WHERE on DeleteBuilder
  whereExprDeleteBuilder: () =>
    DeleteBuilder.from(Person).where(((p: any) => p.name.strlen().gt(3)) as any),

  // Expression WHERE with nested path traversal
  whereExprNestedPath: () =>
    Person.select((p) => ({name: p.name})).where(((p: any) =>
      p.bestFriend.name.strlen().gt(3)
    ) as any),

  // Expression WHERE combined with expression projection
  whereExprWithProjection: () =>
    Person.select((p) => ({
      name: p.name,
      nameLen: (p.name as any).strlen(),
    })).where(((p: any) => p.name.strlen().gt(2)) as any),
};
