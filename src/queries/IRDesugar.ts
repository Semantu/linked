import {
  ArgPath,
  isWhereEvaluationPath,
  JSNonNullPrimitive,
  QueryPath,
  QueryStep,
  SelectQuery,
  WhereAndOr,
  WhereMethods,
  WherePath,
} from './SelectQuery.js';
import {NodeReferenceValue, ShapeReferenceValue} from './QueryFactory.js';

export type DesugaredPropertyStep = {
  kind: 'property_step';
  propertyShapeId: string;
};

export type DesugaredSelectionPath = {
  kind: 'selection_path';
  steps: DesugaredPropertyStep[];
};

export type DesugaredWhereComparison = {
  kind: 'where_comparison';
  operator: WhereMethods;
  left: DesugaredSelectionPath;
  right: DesugaredWhereArg[];
};

export type DesugaredWhereBoolean = {
  kind: 'where_boolean';
  first: DesugaredWhereComparison;
  andOr: Array<{and?: DesugaredWhere; or?: DesugaredWhere}>;
};

export type DesugaredWhere = DesugaredWhereComparison | DesugaredWhereBoolean;

export type DesugaredSortBy = {
  direction: 'ASC' | 'DESC';
  paths: DesugaredSelectionPath[];
};

export type DesugaredWhereArg =
  | JSNonNullPrimitive
  | NodeReferenceValue
  | ShapeReferenceValue
  | {
      kind: 'arg_path';
      subject?: ShapeReferenceValue;
      path: DesugaredSelectionPath;
    }
  | DesugaredWhere;

export type DesugaredSelectQuery = {
  kind: 'desugared_select';
  shapeId?: string;
  subjectId?: string;
  singleResult?: boolean;
  limit?: number;
  offset?: number;
  selections: DesugaredSelectionPath[];
  sortBy?: DesugaredSortBy;
  where?: DesugaredWhere;
};

type PropertyStepLike = {
  property?: {
    id?: string;
  };
};

const isPropertyQueryStep = (step: QueryStep): step is QueryStep & PropertyStepLike => {
  return !!step && typeof step === 'object' && 'property' in step;
};

const toPropertyStep = (step: QueryStep): DesugaredPropertyStep => {
  if ('count' in (step as any)) {
    return {
      kind: 'property_step',
      propertyShapeId: 'count',
    };
  }

  if (!isPropertyQueryStep(step) || !step.property?.id) {
    throw new Error('Unsupported query step in desugar pass: expected property step');
  }
  return {
    kind: 'property_step',
    propertyShapeId: step.property.id,
  };
};

const toSelectionPath = (path: QueryPath): DesugaredSelectionPath => {
  if (!Array.isArray(path)) {
    throw new Error('Unsupported non-array path in desugar selection pass');
  }
  return {
    kind: 'selection_path',
    steps: path.filter((step): step is QueryStep => !Array.isArray(step)).map(toPropertyStep),
  };
};

const isNodeRef = (value: unknown): value is NodeReferenceValue =>
  typeof value === 'object' && value !== null && 'id' in value;

const isShapeRef = (value: unknown): value is ShapeReferenceValue =>
  isNodeRef(value) && 'shape' in (value as ShapeReferenceValue);

const toWhereArg = (arg: unknown): DesugaredWhereArg => {
  if (
    typeof arg === 'string' ||
    typeof arg === 'number' ||
    typeof arg === 'boolean' ||
    arg instanceof Date
  ) {
    return arg;
  }
  if (isShapeRef(arg)) {
    return arg;
  }
  if (isNodeRef(arg)) {
    return arg;
  }
  if (arg && typeof arg === 'object') {
    if (isWhereEvaluationPath(arg as WherePath) || 'firstPath' in (arg as Record<string, unknown>)) {
      return toWhere(arg as WherePath);
    }

    if ('path' in (arg as ArgPath)) {
      const pathArg = arg as ArgPath;
      return {
        kind: 'arg_path',
        subject: pathArg.subject,
        path: toSelectionPath(pathArg.path as unknown as QueryPath),
      };
    }
  }
  throw new Error('Unsupported where argument in desugar pass');
};

const toWhereComparison = (path: WherePath): DesugaredWhereComparison => {
  if (!isWhereEvaluationPath(path)) {
    throw new Error('Expected where evaluation path');
  }
  return {
    kind: 'where_comparison',
    operator: path.method,
    left: toSelectionPath(path.path as unknown as QueryPath),
    right: (path.args || []).map(toWhereArg),
  };
};

const toWhere = (path: WherePath): DesugaredWhere => {
  if ((path as WhereAndOr).firstPath) {
    const grouped = path as WhereAndOr;
    return {
      kind: 'where_boolean',
      first: toWhereComparison(grouped.firstPath),
      andOr: grouped.andOr.map((token) => ({
        and: token.and ? toWhere(token.and) : undefined,
        or: token.or ? toWhere(token.or) : undefined,
      })),
    };
  }
  return toWhereComparison(path);
};


const toSortBy = (query: SelectQuery): DesugaredSortBy | undefined => {
  if (!query.sortBy) {
    return undefined;
  }

  return {
    direction: query.sortBy.direction,
    paths: query.sortBy.paths.map((path) => toSelectionPath(path as QueryPath)),
  };
};

export const desugarSelectQuery = (query: SelectQuery): DesugaredSelectQuery => {
  const selections = Array.isArray(query.select)
    ? query.select.map((path) => toSelectionPath(path as QueryPath))
    : [];

  const subjectId =
    query.subject && typeof query.subject === 'object' && 'id' in query.subject
      ? (query.subject as NodeReferenceValue).id
      : undefined;

  return {
    kind: 'desugared_select',
    shapeId: (query.shape as any)?.shape?.id || (query.shape as any)?.id,
    subjectId,
    singleResult: query.singleResult,
    limit: query.limit,
    offset: query.offset,
    selections,
    sortBy: toSortBy(query),
    where: query.where ? toWhere(query.where) : undefined,
  };
};
