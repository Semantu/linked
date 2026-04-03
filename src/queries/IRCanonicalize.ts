import {
  DesugaredExpressionWhere,
  DesugaredExistsWhere,
  DesugaredSelectQuery,
  DesugaredWhere,
  PropertyPathSegment,
} from './IRDesugar.js';

export type CanonicalWhereExpression =
  | DesugaredExpressionWhere
  | DesugaredExistsWhere;

/** A canonicalized MINUS entry. */
export type CanonicalMinusEntry = {
  shapeId?: string;
  where?: CanonicalWhereExpression;
  propertyPaths?: PropertyPathSegment[][];
};

export type CanonicalDesugaredSelectQuery = Omit<DesugaredSelectQuery, 'where' | 'minusEntries'> & {
  where?: CanonicalWhereExpression;
  minusEntries?: CanonicalMinusEntry[];
};

/**
 * Recursively rewrites a desugared where-clause into canonical form.
 * With the Evaluation class retired, this is now a simple passthrough
 * for expression and exists where types.
 */
export const canonicalizeWhere = (
  where: DesugaredWhere,
): CanonicalWhereExpression => {
  // ExpressionNode-based WHERE — passthrough (already canonical)
  if (where.kind === 'where_expression') {
    return where;
  }
  // ExistsCondition-based WHERE — passthrough to lowering
  if (where.kind === 'where_exists_condition') {
    return where;
  }
  const _exhaustive: never = where;
  throw new Error(`Unknown where kind: ${(_exhaustive as {kind: string}).kind}`);
};

/**
 * Canonicalizes a desugared select query by normalizing its where-clause.
 * All other fields pass through unchanged.
 */
export const canonicalizeDesugaredSelectQuery = (
  query: DesugaredSelectQuery,
): CanonicalDesugaredSelectQuery => {
  return {
    ...query,
    where: query.where ? canonicalizeWhere(query.where) : undefined,
    minusEntries: query.minusEntries?.map((entry) => ({
      shapeId: entry.shapeId,
      where: entry.where ? canonicalizeWhere(entry.where) : undefined,
      propertyPaths: entry.propertyPaths,
    })),
  };
};
