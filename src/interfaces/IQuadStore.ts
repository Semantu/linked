import type {SelectQuery} from '../queries/SelectQuery.js';
import type {CreateQuery} from '../queries/CreateQuery.js';
import type {UpdateQuery} from '../queries/UpdateQuery.js';
import type {DeleteQuery, DeleteResponse} from '../queries/DeleteQuery.js';

export interface IQuadStore {
  /**
   * Prepares the store to be used.
   */
  init?(): Promise<any>;

  selectQuery<ResultType>(query: SelectQuery): Promise<ResultType>;
  updateQuery?<RType>(q: UpdateQuery): Promise<RType>;
  createQuery?<R>(q: CreateQuery): Promise<R>;
  deleteQuery?(query: DeleteQuery): Promise<DeleteResponse>;
}
