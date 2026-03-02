/**
 * Test helper module for Apache Jena Fuseki integration tests.
 *
 * Provides utilities to:
 * - Check if a Fuseki instance is available
 * - Create / delete an in-memory test dataset
 * - Load N-Triples data
 * - Execute SPARQL queries and updates
 * - Clear all data
 *
 * Uses native fetch (Node 18+). No external HTTP libraries.
 */

const FUSEKI_BASE_URL = process.env.FUSEKI_BASE_URL || 'http://localhost:3030';
const FUSEKI_ADMIN_PASSWORD = process.env.FUSEKI_ADMIN_PASSWORD || 'admin';
const DATASET_NAME = 'nashville-test';

const adminAuth = `Basic ${Buffer.from(`admin:${FUSEKI_ADMIN_PASSWORD}`).toString('base64')}`;

/**
 * Check whether a Fuseki server is reachable.
 * Returns true if a HEAD request to the base URL succeeds with status 200.
 */
export async function isFusekiAvailable(): Promise<boolean> {
  try {
    const response = await fetch(FUSEKI_BASE_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Create the in-memory test dataset on Fuseki.
 * Ignores 409 Conflict (dataset already exists).
 */
export async function createTestDataset(): Promise<void> {
  const response = await fetch(`${FUSEKI_BASE_URL}/$/datasets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: adminAuth,
    },
    body: `dbName=${DATASET_NAME}&dbType=mem`,
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(
      `Failed to create test dataset: ${response.status} ${response.statusText}`,
    );
  }
}

/**
 * Delete the test dataset from Fuseki.
 */
export async function deleteTestDataset(): Promise<void> {
  const response = await fetch(
    `${FUSEKI_BASE_URL}/$/datasets/${DATASET_NAME}`,
    {method: 'DELETE', headers: {Authorization: adminAuth}},
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Failed to delete test dataset: ${response.status} ${response.statusText}`,
    );
  }
}

/**
 * Load N-Triples data into the test dataset.
 */
export async function loadTestData(ntriples: string): Promise<void> {
  const response = await fetch(`${FUSEKI_BASE_URL}/${DATASET_NAME}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/n-triples'},
    body: ntriples,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to load test data: ${response.status} ${response.statusText}\n${body}`,
    );
  }
}

/**
 * Execute a SPARQL SELECT/ASK/CONSTRUCT query against the test dataset.
 * Returns parsed SPARQL JSON results.
 */
export async function executeSparqlQuery(sparql: string): Promise<any> {
  const response = await fetch(
    `${FUSEKI_BASE_URL}/${DATASET_NAME}/sparql`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        Accept: 'application/sparql-results+json',
      },
      body: sparql,
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `SPARQL query failed: ${response.status} ${response.statusText}\n${sparql}\n${body}`,
    );
  }
  return response.json();
}

/**
 * Execute a SPARQL UPDATE against the test dataset.
 */
export async function executeSparqlUpdate(sparql: string): Promise<void> {
  const response = await fetch(
    `${FUSEKI_BASE_URL}/${DATASET_NAME}/update`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/sparql-update'},
      body: sparql,
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `SPARQL update failed: ${response.status} ${response.statusText}\n${sparql}\n${body}`,
    );
  }
}

/**
 * Remove all triples from the test dataset.
 */
export async function clearAllData(): Promise<void> {
  await executeSparqlUpdate('DELETE WHERE { ?s ?p ?o }');
}
