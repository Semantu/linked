import {SelectQuery} from './SelectQuery.js';
import {DesugaredSelection, DesugaredSelectionPath, desugarSelectQuery} from './IRDesugar.js';
import {
  canonicalizeDesugaredSelectQuery,
  CanonicalWhereExpression,
} from './IRCanonicalize.js';
import {buildCanonicalProjection, CanonicalProjectionResult} from './IRProjection.js';

export type SelectQueryIR = {
  kind: 'select_query';
  shapeId?: string;
  subjectId?: string;
  singleResult?: boolean;
  limit?: number;
  offset?: number;
  where?: CanonicalWhereExpression;
  projection: CanonicalProjectionResult['projection'];
  resultMap?: CanonicalProjectionResult['resultMap'];
  orderBy?: SelectQueryIROrderByItem[];
};

export type SelectQueryIROrderByItem = {
  kind: 'order_by_item';
  direction: 'ASC' | 'DESC';
  path: DesugaredSelectionPath;
};


const toOrderBy = (
  sortBy: ReturnType<typeof desugarSelectQuery>['sortBy'],
): SelectQueryIROrderByItem[] | undefined => {
  if (!sortBy) {
    return undefined;
  }

  return sortBy.paths.map((path) => ({
    kind: 'order_by_item',
    direction: sortBy.direction,
    path,
  }));
};

const extractSelectionPaths = (selections: DesugaredSelection[]): DesugaredSelectionPath[] =>
  selections.filter((s): s is DesugaredSelectionPath => s.kind === 'selection_path');

export const buildSelectQueryIR = (query: SelectQuery): SelectQueryIR => {
  const desugared = desugarSelectQuery(query);
  const canonical = canonicalizeDesugaredSelectQuery(desugared);
  const projection = buildCanonicalProjection(extractSelectionPaths(canonical.selections));

  return {
    kind: 'select_query',
    shapeId: canonical.shapeId,
    subjectId: canonical.subjectId,
    singleResult: canonical.singleResult,
    limit: canonical.limit,
    offset: canonical.offset,
    where: canonical.where,
    projection: projection.projection,
    resultMap: projection.resultMap,
    orderBy: toOrderBy(canonical.sortBy),
  };
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
  canonical: SelectQueryIR | CanonicalSelectIR,
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
export type CanonicalSelectIR = Omit<SelectQueryIR, 'kind'> & {kind: 'canonical_select_ir'};
export const buildCanonicalSelectIR = (query: SelectQuery): CanonicalSelectIR => {
  const next = buildSelectQueryIR(query);
  return {
    ...next,
    kind: 'canonical_select_ir',
  };
};
