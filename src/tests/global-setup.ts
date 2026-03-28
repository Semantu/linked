/**
 * Jest globalSetup — runs once before any test worker starts.
 * Ensures Fuseki is available so integration tests don't have to
 * race against Docker startup from within parallel workers.
 */
import {ensureFuseki} from '../test-helpers/fuseki-test-store';

export default async function globalSetup() {
  const available = await ensureFuseki();
  if (!available) {
    console.warn(
      '[globalSetup] Fuseki could not be started — integration tests will fail',
    );
  }
}
