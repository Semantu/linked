import {desugarSelectQuery, RawSelectInput} from './IRDesugar.js';
import {canonicalizeDesugaredSelectQuery} from './IRCanonicalize.js';
import {lowerSelectQuery} from './IRLower.js';
import {IRSelectQuery} from './IntermediateRepresentation.js';

const isIRSelectQuery = (query: unknown): query is IRSelectQuery =>
  !!query &&
  typeof query === 'object' &&
  'kind' in query &&
  (query as IRSelectQuery).kind === 'select';

/**
 * Runs the full select pipeline: desugar → canonicalize → lower.
 * Accepts either a RawSelectInput (from a query factory) or an already-built
 * IRSelectQuery (returned as-is).
 */
export const buildSelectQuery = (query: RawSelectInput | IRSelectQuery): IRSelectQuery => {
  if (isIRSelectQuery(query)) {
    return query;
  }

  const desugared = desugarSelectQuery(query as RawSelectInput);
  const canonical = canonicalizeDesugaredSelectQuery(desugared);
  return lowerSelectQuery(canonical);
};
