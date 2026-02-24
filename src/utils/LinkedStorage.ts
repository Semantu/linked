import {CoreMap} from '../collections/CoreMap.js';
import {CoreSet} from '../collections/CoreSet.js';
import {IQuadStore} from '../interfaces/IQuadStore.js';
import type {SelectQuery} from '../queries/SelectQuery.js';
import type {CreateQuery} from '../queries/CreateQuery.js';
import type {UpdateQuery} from '../queries/UpdateQuery.js';
import type {DeleteQuery, DeleteResponse} from '../queries/DeleteQuery.js';
import {Shape, ShapeType} from '../shapes/Shape.js';
import {getShapeClass} from './ShapeClass.js';

export abstract class LinkedStorage {
  private static defaultStore?: IQuadStore;
  private static shapeToStore: CoreMap<typeof Shape, IQuadStore> =
    new CoreMap();

  static isInitialised() {
    return !!this.defaultStore;
  }

  static getDefaultStore() {
    return this.defaultStore;
  }

  static setDefaultStore(store: IQuadStore) {
    this.defaultStore = store;
    if (this.defaultStore?.init) {
      this.defaultStore.init();
    }
  }

  static setStoreForShapes(store: IQuadStore, ...shapeClasses: (typeof Shape)[]) {
    shapeClasses.forEach((shapeClass) => {
      this.shapeToStore.set(shapeClass, store);
    });
  }

  static getStores(): CoreSet<IQuadStore> {
    const stores = new CoreSet<IQuadStore>();
    if (this.defaultStore) {
      stores.add(this.defaultStore);
    }
    this.shapeToStore.forEach((store) => stores.add(store));
    return stores;
  }

  static getShapeToStoreMap(): CoreMap<typeof Shape, IQuadStore> {
    return this.shapeToStore;
  }

  static getStoreForShapeClass(shapeClass?: typeof Shape | null): IQuadStore {
    let current = shapeClass || null;
    while (current) {
      const store = this.shapeToStore.get(current);
      if (store) {
        return store;
      }
      if (current === Shape) {
        break;
      }
      current = Object.getPrototypeOf(current);
    }
    return this.defaultStore;
  }

  private static resolveStoreForQueryShape(
    shape?: string | typeof Shape | ShapeType | null,
  ): IQuadStore {
    if (!shape) {
      return this.defaultStore;
    }
    if (typeof shape === 'function') {
      return this.getStoreForShapeClass(shape as typeof Shape);
    }
    if (typeof shape === 'string') {
      const shapeClass = getShapeClass(shape);
      return this.getStoreForShapeClass(shapeClass);
    }
    return this.defaultStore;
  }

  static selectQuery<ResultType>(query: SelectQuery): Promise<ResultType> {
    const store = this.resolveStoreForQueryShape(query?.root?.shape);
    if (!store?.selectQuery) {
      return Promise.reject(
        new Error('No query store configured. Call LinkedStorage.setDefaultStore().'),
      );
    }
    return store.selectQuery(query) as Promise<ResultType>;
  }

  static updateQuery<ResponseType>(query: UpdateQuery): Promise<ResponseType> {
    const store = this.resolveStoreForQueryShape(query?.shape);
    if (!store?.updateQuery) {
      return Promise.reject(
        new Error('No update handler configured on the query store.'),
      );
    }
    return store.updateQuery(query) as Promise<ResponseType>;
  }

  static createQuery<ResponseType>(query: CreateQuery): Promise<ResponseType> {
    const store = this.resolveStoreForQueryShape(query?.shape);
    if (!store?.createQuery) {
      return Promise.reject(
        new Error('No create handler configured on the query store.'),
      );
    }
    return store.createQuery(query) as Promise<ResponseType>;
  }

  static deleteQuery(query: DeleteQuery): Promise<DeleteResponse> {
    const store = this.resolveStoreForQueryShape(query?.shape);
    if (!store?.deleteQuery) {
      return Promise.reject(
        new Error('No delete handler configured on the query store.'),
      );
    }
    return store.deleteQuery(query);
  }
}
