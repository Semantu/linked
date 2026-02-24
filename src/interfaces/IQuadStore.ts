import type {SelectQuery} from '../queries/SelectQuery.js';
import type {CreateQuery} from '../queries/CreateQuery.js';
import type {UpdateQuery} from '../queries/UpdateQuery.js';
import type {DeleteQuery, DeleteResponse} from '../queries/DeleteQuery.js';
import type {
  SelectResult,
  CreateResult,
  UpdateResult,
} from '../queries/IntermediateRepresentation.js';

/**
 * Store interface for executing IR queries.
 *
 * Implement this interface to back Linked with a custom storage engine
 * (SPARQL endpoint, SQL database, in-memory store, etc.).
 *
 * Each method receives a canonical IR query object and returns the result.
 * The calling layer (LinkedStorage / QueryParser) threads the precise
 * DSL-level TypeScript result type back to the caller — the store only
 * needs to produce data that matches the structural result types.
 */
export interface IQuadStore {
  /**
   * Prepares the store to be used.
   */
  init?(): Promise<any>;

  selectQuery(query: SelectQuery): Promise<SelectResult>;
  updateQuery?(query: UpdateQuery): Promise<UpdateResult>;
  createQuery?(query: CreateQuery): Promise<CreateResult>;
  deleteQuery?(query: DeleteQuery): Promise<DeleteResponse>;
}
