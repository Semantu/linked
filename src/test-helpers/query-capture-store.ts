import {jest} from '@jest/globals';
import {QueryParser} from '../queries/QueryParser';
import {UpdateQueryFactory} from '../queries/UpdateQuery';
import {CreateQueryFactory} from '../queries/CreateQuery';
import {DeleteQueryFactory} from '../queries/DeleteQuery';
import type {NodeId} from '../queries/MutationQuery';

/**
 * Test utility that intercepts QueryParser methods via jest.spyOn and captures
 * the query object for inspection by test assertions.
 *
 * For select queries, captures the RawSelectInput (pipeline input format).
 * For mutations, captures the IR (canonical format).
 *
 * Import this module and call `captureQuery(runner)` to execute a DSL
 * call (e.g. Person.select(...)) and retrieve the captured query.
 */
let _lastQuery: any;

jest.spyOn(QueryParser, 'selectQuery').mockImplementation(async (query: any) => {
  _lastQuery = query.toRawInput();
  return [] as any;
});

jest.spyOn(QueryParser, 'createQuery').mockImplementation(
  async (updateObjectOrFn: any, shapeClass: any) => {
    const factory = new CreateQueryFactory(shapeClass, updateObjectOrFn);
    _lastQuery = factory.build();
    return {} as any;
  },
);

jest.spyOn(QueryParser, 'updateQuery').mockImplementation(
  async (id: any, updateObjectOrFn: any, shapeClass: any) => {
    const factory = new UpdateQueryFactory(shapeClass, id, updateObjectOrFn);
    _lastQuery = factory.build();
    return {} as any;
  },
);

jest.spyOn(QueryParser, 'deleteQuery').mockImplementation(
  async (id: any, shapeClass: any) => {
    const ids = (Array.isArray(id) ? id : [id]) as NodeId[];
    const factory = new DeleteQueryFactory(shapeClass, ids);
    _lastQuery = factory.build();
    return {deleted: [], count: 0};
  },
);

/**
 * Execute a query-producing callback and return whatever
 * the capture intercepted.
 */
export const captureQuery = async (
  runner: () => Promise<unknown>,
) => {
  _lastQuery = undefined;
  await runner();
  return _lastQuery;
};
