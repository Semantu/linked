import {jest} from '@jest/globals';
import {setQueryDispatch} from '../queries/queryDispatch';
import * as IRPipeline from '../queries/IRPipeline';

/**
 * Test utility that intercepts the query dispatch and captures
 * the built IR query for inspection by test assertions.
 *
 * - `captureQuery` captures the built IR (post-pipeline) — use for
 *   full-pipeline and mutation tests.
 * - `captureRawQuery` captures the raw pipeline input (pre-pipeline)
 *   — use for tests that feed intermediate pipeline stages.
 */
let _lastQuery: any;
let _lastRawInput: any;

// Spy on buildSelectQuery to capture pre-pipeline raw input
const originalBuildSelectQuery = IRPipeline.buildSelectQuery;
jest.spyOn(IRPipeline, 'buildSelectQuery').mockImplementation((raw: any) => {
  _lastRawInput = raw;
  return originalBuildSelectQuery(raw);
});

setQueryDispatch({
  selectQuery: async (query) => {
    _lastQuery = query;
    return [] as any;
  },
  createQuery: async (query) => {
    _lastQuery = query;
    return {} as any;
  },
  updateQuery: async (query) => {
    _lastQuery = query;
    return {} as any;
  },
  deleteQuery: async (query) => {
    _lastQuery = query;
    return {deleted: [], count: 0};
  },
});

/**
 * Execute a query-producing callback and return the built IR
 * (the same object that would reach IQuadStore).
 */
export const captureQuery = async (
  runner: () => Promise<unknown>,
) => {
  _lastQuery = undefined;
  await runner();
  return _lastQuery;
};

/**
 * Execute a query-producing callback and return the raw pipeline
 * input (RawSelectInput) — the state before the IR build pipeline runs.
 * Only works for select queries.
 */
export const captureRawQuery = async (
  runner: () => Promise<unknown>,
) => {
  _lastRawInput = undefined;
  await runner();
  return _lastRawInput;
};
