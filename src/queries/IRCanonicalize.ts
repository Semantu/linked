import {
  DesugaredSelectionPath,
  DesugaredSelectQuery,
  DesugaredWhere,
  DesugaredWhereArg,
  DesugaredWhereBoolean,
  DesugaredWhereComparison,
} from './IRDesugar.js';
import {WhereMethods} from './SelectQuery.js';

export type CanonicalWhereComparison = {
  kind: 'where_binary';
  operator: WhereMethods;
  left: DesugaredSelectionPath;
  right: DesugaredWhereArg[];
};

export type CanonicalWhereLogical = {
  kind: 'where_logical';
  operator: 'and' | 'or';
  expressions: CanonicalWhereExpression[];
};

export type CanonicalWhereExists = {
  kind: 'where_exists';
  path: DesugaredSelectionPath;
  predicate: CanonicalWhereExpression;
};

export type CanonicalWhereNot = {
  kind: 'where_not';
  expression: CanonicalWhereExpression;
};

export type CanonicalWhereExpression =
  | CanonicalWhereComparison
  | CanonicalWhereLogical
  | CanonicalWhereExists
  | CanonicalWhereNot;

export type CanonicalDesugaredSelectQuery = Omit<DesugaredSelectQuery, 'where'> & {
  where?: CanonicalWhereExpression;
};

const toComparison = (
  comparison: DesugaredWhereComparison,
): CanonicalWhereComparison => {
  return {
    kind: 'where_binary',
    operator: comparison.operator,
    left: comparison.left,
    right: comparison.right,
  };
};

const isDesugaredWhere = (arg: DesugaredWhereArg): arg is DesugaredWhere => {
  return (
    typeof arg === 'object' &&
    !!arg &&
    'kind' in arg &&
    ((arg as DesugaredWhere).kind === 'where_comparison' ||
      (arg as DesugaredWhere).kind === 'where_boolean')
  );
};

const toExists = (
  comparison: DesugaredWhereComparison,
): CanonicalWhereExpression => {
  const nested = comparison.right.find(isDesugaredWhere);
  if (!nested) {
    return toComparison(comparison);
  }

  const nestedExpr = canonicalizeWhere(nested);
  if (comparison.operator === WhereMethods.SOME) {
    return {
      kind: 'where_exists',
      path: comparison.left,
      predicate: nestedExpr,
    };
  }
  if (comparison.operator === WhereMethods.EVERY) {
    return {
      kind: 'where_not',
      expression: {
        kind: 'where_exists',
        path: comparison.left,
        predicate: {
          kind: 'where_not',
          expression: nestedExpr,
        },
      },
    };
  }

  return toComparison(comparison);
};

const canonicalizeComparison = (
  comparison: DesugaredWhereComparison,
): CanonicalWhereExpression => {
  if (
    comparison.operator === WhereMethods.SOME ||
    comparison.operator === WhereMethods.EVERY ||
    (comparison.operator as unknown as string) === 'some' ||
    (comparison.operator as unknown as string) === 'every'
  ) {
    return toExists(comparison);
  }
  return toComparison(comparison);
};

const flattenLogical = (
  operator: 'and' | 'or',
  left: CanonicalWhereExpression,
  right: CanonicalWhereExpression,
): CanonicalWhereLogical => {
  const expressions: CanonicalWhereExpression[] = [];

  if (left.kind === 'where_logical' && left.operator === operator) {
    expressions.push(...left.expressions);
  } else {
    expressions.push(left);
  }

  if (right.kind === 'where_logical' && right.operator === operator) {
    expressions.push(...right.expressions);
  } else {
    expressions.push(right);
  }

  return {
    kind: 'where_logical',
    operator,
    expressions,
  };
};

/**
 * Recursively rewrites a desugared where-clause into canonical form:
 * flattens nested AND/OR groups, converts quantifiers (some/every) to exists patterns.
 */
export const canonicalizeWhere = (
  where: DesugaredWhere,
): CanonicalWhereExpression => {
  if (where.kind === 'where_comparison') {
    if (where.operator === WhereMethods.EQUALS) {
      const nestedQuantifier = where.right.find(
        (arg): arg is DesugaredWhereComparison =>
          isDesugaredWhere(arg) &&
          arg.kind === 'where_comparison' &&
          (arg.operator === WhereMethods.SOME ||
            arg.operator === WhereMethods.EVERY),
      );
      if (nestedQuantifier) {
        return canonicalizeWhere(nestedQuantifier);
      }
    }

    if (
      where.operator === WhereMethods.SOME ||
      where.operator === WhereMethods.EVERY ||
      (where.operator as unknown as string) === 'some' ||
      (where.operator as unknown as string) === 'every'
    ) {
      return toExists(where);
    }
    return toComparison(where);
  }

  const grouped = where as DesugaredWhereBoolean;
  let current: CanonicalWhereExpression = canonicalizeComparison(grouped.first);

  grouped.andOr.forEach((token) => {
    if (token.and) {
      current = flattenLogical('and', current, canonicalizeWhere(token.and));
    } else if (token.or) {
      current = flattenLogical('or', current, canonicalizeWhere(token.or));
    }
  });

  return current;
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
  };
};
