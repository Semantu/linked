import {SparqlStore} from '../sparql/SparqlStore.js';
import type {SparqlJsonResults} from '../sparql/resultMapping.js';
import type {SparqlOptions} from '../sparql/sparqlUtils.js';

/**
 * Concrete SparqlStore implementation for Apache Jena Fuseki.
 *
 * Demonstrates how to extend SparqlStore with a real SPARQL endpoint.
 * Used by the integration tests to implicitly validate the base class.
 *
 * Usage:
 * ```ts
 * const store = new FusekiStore('http://localhost:3030', 'my-dataset');
 * await store.init();
 * const result = await store.selectQuery(irSelectQuery);
 * ```
 */
export class FusekiStore extends SparqlStore {
  private readonly queryEndpoint: string;
  private readonly updateEndpoint: string;
  private readonly baseUrl: string;
  private readonly dataset: string;
  private readonly adminAuth?: string;

  constructor(
    baseUrl: string,
    dataset: string,
    options?: SparqlOptions & {adminPassword?: string},
  ) {
    super(options);
    this.baseUrl = baseUrl;
    this.dataset = dataset;
    this.queryEndpoint = `${baseUrl}/${dataset}/sparql`;
    this.updateEndpoint = `${baseUrl}/${dataset}/update`;

    if (options?.adminPassword) {
      this.adminAuth = `Basic ${Buffer.from(`admin:${options.adminPassword}`).toString('base64')}`;
    }
  }

  async init(): Promise<void> {
    // Check availability
    const response = await fetch(this.baseUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2000),
    });
    if (response.status !== 200) {
      throw new Error(`Fuseki not available at ${this.baseUrl}`);
    }
  }

  protected async executeSparqlSelect(
    sparql: string,
  ): Promise<SparqlJsonResults> {
    const response = await fetch(this.queryEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        Accept: 'application/sparql-results+json',
      },
      body: sparql,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `SPARQL query failed: ${response.status} ${response.statusText}\n${sparql}\n${body}`,
      );
    }

    return response.json();
  }

  protected async executeSparqlUpdate(sparql: string): Promise<void> {
    const response = await fetch(this.updateEndpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/sparql-update'},
      body: sparql,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `SPARQL update failed: ${response.status} ${response.statusText}\n${sparql}\n${body}`,
      );
    }
  }
}
