/**
 * Test helper module for Apache Jena Fuseki integration tests.
 *
 * Provides utilities to:
 * - Ensure a Fuseki instance is running (auto-starts via Docker if needed)
 * - Check if a Fuseki instance is available
 * - Create / delete an in-memory test dataset
 * - Load N-Triples data
 * - Execute SPARQL queries and updates
 * - Clear all data
 *
 * Uses native fetch (Node 18+). No external HTTP libraries.
 */
import {execSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const FUSEKI_BASE_URL = process.env.FUSEKI_BASE_URL || 'http://localhost:3030';
const FUSEKI_ADMIN_PASSWORD = process.env.FUSEKI_ADMIN_PASSWORD || 'admin';
const DATASET_NAME = 'nashville-test';

/** Whether this process started Fuseki (so we know whether to stop it). */
let startedByUs = false;

const adminAuth = `Basic ${Buffer.from(`admin:${FUSEKI_ADMIN_PASSWORD}`).toString('base64')}`;

/**
 * Check whether a Fuseki server is reachable.
 * Returns true if a HEAD request to the base URL succeeds with status 200.
 */
export async function isFusekiAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(FUSEKI_BASE_URL, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Locate the docker-compose.test.yml for Fuseki.
 * Works from both source (src/) and compiled (lib/esm/) paths.
 */
function findComposeFile(): string | null {
  // __dirname works in both CJS and ts-jest; for ESM builds the lincd
  // toolchain injects a __dirname shim.
  const candidates = [
    resolve(__dirname, '../tests/docker-compose.test.yml'),
    resolve(__dirname, '../../src/tests/docker-compose.test.yml'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Ensure a Fuseki instance is running.
 * If Fuseki is already reachable, returns immediately.
 * Otherwise, starts it via Docker Compose and waits for the healthcheck.
 *
 * Returns true if Fuseki is available after this call.
 * Returns false if Docker is not installed or the compose file can't be found.
 */
export async function ensureFuseki(): Promise<boolean> {
  if (await isFusekiAvailable()) return true;

  const composeFile = findComposeFile();
  if (!composeFile) {
    console.warn(
      '[ensureFuseki] docker-compose.test.yml not found — cannot auto-start Fuseki',
    );
    return false;
  }

  try {
    execSync('docker compose version', {stdio: 'ignore'});
  } catch {
    console.warn('[ensureFuseki] Docker Compose not available — skipping');
    return false;
  }

  console.log('[ensureFuseki] Fuseki not running — starting via Docker...');
  try {
    execSync(`docker compose -f "${composeFile}" up -d --wait`, {
      stdio: 'inherit',
      timeout: 60_000,
    });
    startedByUs = true;

    // Verify it came up
    if (await isFusekiAvailable()) {
      console.log('[ensureFuseki] Fuseki is ready');
      return true;
    }
    console.warn('[ensureFuseki] Fuseki started but not responding');
    return false;
  } catch (err) {
    console.warn('[ensureFuseki] Failed to start Fuseki:', (err as Error).message);
    return false;
  }
}

/**
 * Stop the Fuseki container if it was started by `ensureFuseki()`.
 * No-op if Fuseki was already running before the tests.
 */
export async function stopFuseki(): Promise<void> {
  if (!startedByUs) return;

  const composeFile = findComposeFile();
  if (!composeFile) return;

  try {
    execSync(`docker compose -f "${composeFile}" down`, {
      stdio: 'inherit',
      timeout: 30_000,
    });
  } catch {
    // Best effort — don't fail the test suite on cleanup
  }
  startedByUs = false;
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
