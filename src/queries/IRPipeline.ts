import {desugarSelectQuery, RawSelectInput} from './IRDesugar.js';
import {canonicalizeDesugaredSelectQuery} from './IRCanonicalize.js';
import {lowerSelectQuery} from './IRLower.js';
import {IRSelectQuery} from './IntermediateRepresentation.js';

export type SelectQueryIR = IRSelectQuery;

const isIRSelectQuery = (query: unknown): query is IRSelectQuery =>
  !!query &&
  typeof query === 'object' &&
  'kind' in query &&
  (query as IRSelectQuery).kind === 'select_query';

export const buildSelectQueryIR = (query: RawSelectInput | IRSelectQuery): IRSelectQuery => {
  if (isIRSelectQuery(query)) {
    return query;
  }

  const desugared = desugarSelectQuery(query as RawSelectInput);
  const canonical = canonicalizeDesugaredSelectQuery(desugared);
  return lowerSelectQuery(canonical);
};
