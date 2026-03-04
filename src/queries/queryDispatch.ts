import type {SelectQuery} from './SelectQuery.js';
import type {CreateQuery} from './CreateQuery.js';
import type {UpdateQuery} from './UpdateQuery.js';
import type {DeleteQuery, DeleteResponse} from './DeleteQuery.js';

/**
 * Abstraction boundary between the DSL layer (Shape) and the storage layer
 * (LinkedStorage / IQuadStore). Both sides import this leaf module; neither
 * imports the other.
 *
 * Return types are intentionally `any` — the DSL layer threads precise
 * result types through its own generics; the dispatch is a runtime bridge.
 */
export interface QueryDispatch {
  selectQuery<R = any>(query: SelectQuery): Promise<R>;
  createQuery<R = any>(query: CreateQuery): Promise<R>;
  updateQuery<R = any>(query: UpdateQuery): Promise<R>;
  deleteQuery(query: DeleteQuery): Promise<DeleteResponse>;
}

let dispatch: QueryDispatch | null = null;

export function setQueryDispatch(d: QueryDispatch): void {
  dispatch = d;
}

export function getQueryDispatch(): QueryDispatch {
  if (!dispatch) {
    throw new Error(
      'No query dispatch configured. Call LinkedStorage.setDefaultStore() first.',
    );
  }
  return dispatch;
}
