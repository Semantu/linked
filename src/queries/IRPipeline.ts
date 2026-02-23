import {SelectQuery} from './SelectQuery.js';
import {desugarSelectQuery} from './IRDesugar.js';
import {canonicalizeDesugaredSelectQuery} from './IRCanonicalize.js';
import {lowerSelectQuery} from './IRLower.js';
import {IRSelectQuery} from './IntermediateRepresentation.js';

export type SelectQueryIR = IRSelectQuery;

export const buildSelectQueryIR = (query: SelectQuery): IRSelectQuery => {
  const desugared = desugarSelectQuery(query);
  const canonical = canonicalizeDesugaredSelectQuery(desugared);
  return lowerSelectQuery(canonical);
};

export type LegacyParityView = {
  subjectId?: string;
  singleResult?: boolean;
  limit?: number;
  offset?: number;
  selectionCount: number;
  hasWhere: boolean;
  sortDirection?: 'ASC' | 'DESC';
};

export const toLegacyParityView = (query: SelectQuery): LegacyParityView => {
  const subjectId =
    query.subject && typeof query.subject === 'object' && 'id' in query.subject
      ? (query.subject as {id: string}).id
      : undefined;

  const selectionCount = Array.isArray(query.select) ? query.select.length : 0;

  return {
    subjectId,
    singleResult: query.singleResult,
    limit: query.limit,
    offset: query.offset,
    selectionCount,
    hasWhere: !!query.where,
    sortDirection: query.sortBy?.direction,
  };
};

export const toCanonicalParityView = (
  canonical: IRSelectQuery,
): LegacyParityView => {
  return {
    subjectId: canonical.subjectId,
    singleResult: canonical.singleResult,
    limit: canonical.limit,
    offset: canonical.offset,
    selectionCount: canonical.projection.length,
    hasWhere: !!canonical.where,
    sortDirection: canonical.orderBy?.[0]?.direction,
  };
};

// Temporary compatibility aliases during naming migration
export type CanonicalSelectIR = Omit<IRSelectQuery, 'kind'> & {kind: 'canonical_select_ir'};
export const buildCanonicalSelectIR = (query: SelectQuery): CanonicalSelectIR => {
  const next = buildSelectQueryIR(query);
  return {
    ...next,
    kind: 'canonical_select_ir',
  };
};
