import type {IQuadStore} from '../interfaces/IQuadStore.js';
import type {SelectQuery} from '../queries/SelectQuery.js';
import type {CreateQuery} from '../queries/CreateQuery.js';
import type {UpdateQuery} from '../queries/UpdateQuery.js';
import type {DeleteQuery, DeleteResponse} from '../queries/DeleteQuery.js';
import type {
  SelectResult,
  CreateResult,
  UpdateResult,
} from '../queries/IntermediateRepresentation.js';
import type {SparqlJsonResults} from './resultMapping.js';
import {
  selectToSparql,
  createToSparql,
  updateToSparql,
  deleteToSparql,
} from './irToAlgebra.js';
import {
  mapSparqlSelectResult,
  mapSparqlCreateResult,
  mapSparqlUpdateResult,
} from './resultMapping.js';
import {generateEntityUri, type SparqlOptions} from './sparqlUtils.js';

/**
 * Abstract base class for SPARQL-backed quad stores.
 *
 * Handles the full pipeline: IR query → SPARQL string → execute → map results.
 * Subclasses only need to implement the two transport methods:
 * - `executeSparqlSelect` — send a SPARQL SELECT and return JSON results
 * - `executeSparqlUpdate` — send a SPARQL UPDATE (INSERT DATA / DELETE..INSERT / etc.)
 *
 * Example subclass (Fuseki):
 * ```ts
 * class FusekiStore extends SparqlStore {
 *   constructor(baseUrl: string, dataset: string) {
 *     super({ dataRoot: 'http://data.example.org' });
 *     this.queryEndpoint = `${baseUrl}/${dataset}/sparql`;
 *     this.updateEndpoint = `${baseUrl}/${dataset}/update`;
 *   }
 *   protected async executeSparqlSelect(sparql: string) {
 *     const res = await fetch(this.queryEndpoint, { ... });
 *     return res.json();
 *   }
 *   protected async executeSparqlUpdate(sparql: string) {
 *     await fetch(this.updateEndpoint, { ... });
 *   }
 * }
 * ```
 */
export abstract class SparqlStore implements IQuadStore {
  protected options?: SparqlOptions;

  constructor(options?: SparqlOptions) {
    this.options = options;
  }

  /**
   * Send a SPARQL SELECT/ASK/CONSTRUCT query and return the parsed
   * SPARQL JSON Results (application/sparql-results+json).
   */
  protected abstract executeSparqlSelect(
    sparql: string,
  ): Promise<SparqlJsonResults>;

  /**
   * Send a SPARQL UPDATE request (INSERT DATA, DELETE/INSERT, etc.).
   * No return value — the update is fire-and-forget at the SPARQL level.
   */
  protected abstract executeSparqlUpdate(sparql: string): Promise<void>;

  async selectQuery(query: SelectQuery): Promise<SelectResult> {
    const sparql = selectToSparql(query, this.options);
    const json = await this.executeSparqlSelect(sparql);
    return mapSparqlSelectResult(json, query);
  }

  async createQuery(query: CreateQuery): Promise<CreateResult> {
    const uri = generateEntityUri(query.data.shape, this.options);
    query.data.id = uri;
    const sparql = createToSparql(query, this.options);
    await this.executeSparqlUpdate(sparql);
    return mapSparqlCreateResult(uri, query);
  }

  async updateQuery(query: UpdateQuery): Promise<UpdateResult> {
    if (query.kind === 'update_where') {
      throw new Error('update_where is not yet implemented in SparqlStore');
    }
    const sparql = updateToSparql(query, this.options);
    await this.executeSparqlUpdate(sparql);
    return mapSparqlUpdateResult(query);
  }

  async deleteQuery(query: DeleteQuery): Promise<DeleteResponse> {
    if (query.kind === 'delete_all' || query.kind === 'delete_where') {
      throw new Error(`${query.kind} is not yet implemented in SparqlStore`);
    }
    const sparql = deleteToSparql(query, this.options);
    await this.executeSparqlUpdate(sparql);
    return {
      deleted: query.ids,
      count: query.ids.length,
    };
  }
}
