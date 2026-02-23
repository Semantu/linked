import {SelectQuery} from './SelectQuery.js';
import {desugarSelectQuery} from './IRDesugar.js';
import {canonicalizeDesugaredSelectQuery} from './IRCanonicalize.js';
import {lowerSelectQuery} from './IRLower.js';
import {IRSelectQuery} from './IntermediateRepresentation.js';

export type SelectQueryIR = IRSelectQuery;

const isIRSelectQuery = (query: unknown): query is IRSelectQuery =>
  !!query &&
  typeof query === 'object' &&
  'kind' in query &&
  (query as IRSelectQuery).kind === 'select_query';

export const buildSelectQueryIR = (query: SelectQuery | IRSelectQuery): IRSelectQuery => {
  if (isIRSelectQuery(query)) {
    return query;
  }

  const desugared = desugarSelectQuery(query as SelectQuery);
  const canonical = canonicalizeDesugaredSelectQuery(desugared);
  return lowerSelectQuery(canonical);
};
