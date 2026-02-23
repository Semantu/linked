import {DeleteResponse} from '../queries/DeleteQuery.js';
import {
  IRCreateMutation,
  IRDeleteMutation,
  IRSelectQuery,
  IRUpdateMutation,
} from '../queries/IntermediateRepresentation.js';

export interface IQuadStore {
  /**
   * Prepares the store to be used.
   */
  init?(): Promise<any>;

  selectQuery<ResultType>(query: IRSelectQuery): Promise<ResultType>;
  updateQuery?<RType>(q: IRUpdateMutation): Promise<RType>;
  createQuery?<R>(q: IRCreateMutation): Promise<R>;
  deleteQuery?(query: IRDeleteMutation): Promise<DeleteResponse>;
}
