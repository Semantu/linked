/**
 * Jest globalTeardown — runs once after all test workers finish.
 * Stops the Fuseki container if it was started by globalSetup.
 */
import {stopFuseki} from '../test-helpers/fuseki-test-store';

export default async function globalTeardown() {
  await stopFuseki();
}
