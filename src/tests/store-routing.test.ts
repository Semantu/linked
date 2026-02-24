import {describe, expect, test} from '@jest/globals';
import {linkedPackage} from '../utils/Package';
import {Shape} from '../shapes/Shape';
import {LinkedStorage} from '../utils/LinkedStorage';
import {IQuadStore} from '../interfaces/IQuadStore';
import {NodeReferenceValue} from '../utils/NodeReference';

const {linkedShape} = linkedPackage('store-routing-test');

const type = (suffix: string): NodeReferenceValue => ({
  id: `linked://tmp/types/${suffix}`,
});

@linkedShape
class RoutedPerson extends Shape {
  static targetClass = type('RoutedPerson');
}

@linkedShape
class RoutedEmployee extends RoutedPerson {
  static targetClass = type('RoutedEmployee');
}

@linkedShape
class RoutedPet extends Shape {
  static targetClass = type('RoutedPet');
}

type StoreCalls = {
  select: number;
  update: number;
  create: number;
  delete: number;
};

const createStore = () => {
  const calls: StoreCalls = {select: 0, update: 0, create: 0, delete: 0};
  const store: IQuadStore = {
    selectQuery: async <ResultType>() => {
      calls.select += 1;
      return [] as ResultType;
    },
    updateQuery: async () => {
      calls.update += 1;
      return {} as any;
    },
    createQuery: async () => {
      calls.create += 1;
      return {} as any;
    },
    deleteQuery: async () => {
      calls.delete += 1;
      return {deleted: [], count: 0};
    },
  };
  return {store, calls};
};

describe('LinkedStorage store routing', () => {
  test('routes select queries based on shape mapping', async () => {
    const defaultStore = createStore();
    const personStore = createStore();
    LinkedStorage.setDefaultStore(defaultStore.store);
    LinkedStorage.setStoreForShapes(personStore.store, RoutedPerson);

    await LinkedStorage.selectQuery({
      kind: 'select',
      root: {
        kind: 'shape_scan',
        alias: 'a0',
        shape: RoutedPerson.shape.id,
      },
      patterns: [],
      projection: [],
    } as any);

    expect(personStore.calls.select).toBe(1);
    expect(defaultStore.calls.select).toBe(0);
  });

  test('routes select queries to default store when no mapping exists', async () => {
    const defaultStore = createStore();
    LinkedStorage.setDefaultStore(defaultStore.store);

    await LinkedStorage.selectQuery({
      kind: 'select',
      root: {
        kind: 'shape_scan',
        alias: 'a0',
        shape: RoutedPet.shape.id,
      },
      patterns: [],
      projection: [],
    } as any);

    expect(defaultStore.calls.select).toBe(1);
  });

  test('uses parent shape store for subclasses', async () => {
    const defaultStore = createStore();
    const personStore = createStore();
    LinkedStorage.setDefaultStore(defaultStore.store);
    LinkedStorage.setStoreForShapes(personStore.store, RoutedPerson);

    await LinkedStorage.selectQuery({
      kind: 'select',
      root: {
        kind: 'shape_scan',
        alias: 'a0',
        shape: RoutedEmployee.shape.id,
      },
      patterns: [],
      projection: [],
    } as any);

    expect(personStore.calls.select).toBe(1);
    expect(defaultStore.calls.select).toBe(0);
  });

  test('routes update/create/delete using node shape ids', async () => {
    const defaultStore = createStore();
    const personStore = createStore();
    LinkedStorage.setDefaultStore(defaultStore.store);
    LinkedStorage.setStoreForShapes(personStore.store, RoutedPerson);

    await LinkedStorage.updateQuery({
      kind: 'update',
      id: 'p1',
      shape: RoutedPerson.shape.id,
      data: {shape: RoutedPerson.shape.id, fields: []},
    } as any);
    await LinkedStorage.createQuery({
      kind: 'create',
      shape: RoutedPerson.shape.id,
      data: {shape: RoutedPerson.shape.id, fields: []},
    } as any);
    await LinkedStorage.deleteQuery({
      kind: 'delete',
      ids: [{id: 'p1'}],
      shape: RoutedPerson.shape.id,
    } as any);

    expect(personStore.calls.update).toBe(1);
    expect(personStore.calls.create).toBe(1);
    expect(personStore.calls.delete).toBe(1);
    expect(defaultStore.calls.update).toBe(0);
  });
});
