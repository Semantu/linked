import {QShape, QueryShape} from './SelectQuery.js';
import {Shape} from '../shapes/Shape.js';

const queryContext = new Map<string, QShape<any, any, any>>();

/**
 * A live reference returned by getQueryContext when the context hasn't been set yet.
 * Its `id` getter resolves lazily from the global context map, so queries built with
 * a PendingQueryContext will pick up the value once it's set (e.g. after auth completes).
 */
export class PendingQueryContext {
  constructor(public readonly contextName: string) {}

  get id(): string | undefined {
    return queryContext.get(this.contextName)?.id;
  }
}

export function getQueryContext<T extends Shape>(name: string): QShape<T> {
  if (queryContext.has(name)) {
    return queryContext.get(name);
  }
  // Return a live reference that resolves lazily when the context is set.
  // This avoids the timing issue where module-level queries capture null
  // because the context hasn't been set yet (e.g. useEffect hasn't fired).
  return new PendingQueryContext(name) as any;
}

export function setQueryContext(name: string, value: any, shapeType?) {
  // Clearing a context entry
  if (!value) {
    queryContext.delete(name);
    return;
  }

  //if a QResult was provided
  if (typeof value.id === 'string') {
    //convert to QShape
    if (!shapeType) {
      console.warn(
        'setQueryContext: value is a QResult but no shapeType provided',
        value,
      );
      return;
    }
    const shape = new (shapeType as any)();
    shape.id = value.id;
    shape.__queryContextId = value.id;
    value = QueryShape.create(shape);
  }
  if (value instanceof Shape) {
    //convert to QShape
    value = new QueryShape(value);
  } else if (!(value instanceof QueryShape)) {
    console.warn('setQueryContext: value is not a QueryShape or Shape', value);
    return;
  }

  queryContext.set(name, value);
}
