import {
  ArgPath,
  CustomQueryObject,
  isWhereEvaluationPath,
  JSNonNullPrimitive,
  QueryPath,
  QueryStep,
  SelectPath,
  SizeStep,
  SortByPath,
  WhereAndOr,
  WhereMethods,
  WherePath,
} from './SelectQuery.js';
import {NodeReferenceValue, ShapeReferenceValue} from './QueryFactory.js';

/**
 * Internal pipeline input type — captures exactly what the desugar pass
 * needs from a select query factory. Replaces the old LegacySelectQuery
 * as the pipeline entry point.
 */
export type RawSelectInput = {
  select: SelectPath;
  where?: WherePath;
  sortBy?: SortByPath;
  subject?: unknown;
  subjects?: unknown[];
  shape?: unknown;
  limit?: number;
  offset?: number;
  singleResult?: boolean;
};

export type DesugaredPropertyStep = {
  kind: 'property_step';
  propertyShapeId: string;
  where?: DesugaredWhere;
};

export type DesugaredCountStep = {
  kind: 'count_step';
  path: DesugaredPropertyStep[];
  label?: string;
};

export type DesugaredTypeCastStep = {
  kind: 'type_cast_step';
  shapeId: string;
};

export type DesugaredStep = DesugaredPropertyStep | DesugaredCountStep | DesugaredTypeCastStep;

export type DesugaredSelectionPath = {
  kind: 'selection_path';
  steps: DesugaredStep[];
};

export type DesugaredSubSelect = {
  kind: 'sub_select';
  parentPath: DesugaredStep[];
  selections: DesugaredSelection;
};

export type DesugaredCustomObjectSelect = {
  kind: 'custom_object_select';
  entries: DesugaredCustomObjectEntry[];
};

export type DesugaredCustomObjectEntry = {
  key: string;
  value: DesugaredSelection;
};

export type DesugaredEvaluationSelect = {
  kind: 'evaluation_select';
  where: DesugaredWhere;
};

export type DesugaredMultiSelection = {
  kind: 'multi_selection';
  selections: DesugaredSelection[];
};

export type DesugaredSelection =
  | DesugaredSelectionPath
  | DesugaredSubSelect
  | DesugaredCustomObjectSelect
  | DesugaredEvaluationSelect
  | DesugaredMultiSelection;

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
  subjectIds?: string[];
  singleResult?: boolean;
  limit?: number;
  offset?: number;
  selections: DesugaredSelection[];
  sortBy?: DesugaredSortBy;
  where?: DesugaredWhere;
};

type PropertyStepLike = {
  property?: {
    id?: string;
  };
  where?: unknown;
};

const isPropertyQueryStep = (step: unknown): step is PropertyStepLike & {property: {id: string}} => {
  return !!step && typeof step === 'object' && 'property' in step &&
    !!(step as PropertyStepLike).property?.id;
};

const isSizeStep = (step: unknown): step is SizeStep => {
  return !!step && typeof step === 'object' && 'count' in step;
};

const isShapeRef = (value: unknown): value is ShapeReferenceValue =>
  !!value && typeof value === 'object' && 'id' in value && 'shape' in value;

const isNodeRef = (value: unknown): value is NodeReferenceValue =>
  typeof value === 'object' && value !== null && 'id' in value;

const isCustomQueryObject = (value: unknown): value is CustomQueryObject =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  !('property' in value) && !('count' in value) && !('id' in value) &&
  !('args' in value) && !('firstPath' in value) && !('method' in value);

const toStep = (step: QueryStep): DesugaredStep => {
  if (isSizeStep(step)) {
    return {
      kind: 'count_step',
      path: step.count.map((s) => toPropertyStepOnly(s)),
      label: step.label,
    };
  }

  if (isShapeRef(step)) {
    return {
      kind: 'type_cast_step',
      shapeId: (step as ShapeReferenceValue).id,
    };
  }

  if (isPropertyQueryStep(step)) {
    const result: DesugaredPropertyStep = {
      kind: 'property_step',
      propertyShapeId: step.property.id,
    };
    if (step.where) {
      result.where = toWhere(step.where as WherePath);
    }
    return result;
  }

  // CustomQueryObject step — this appears in preload and sub-select paths
  if (isCustomQueryObject(step)) {
    // Return a property_step placeholder; the parent path handler will pick up sub-selects
    // This is an edge case for preload where the sub-query object is pushed into the path
    return {
      kind: 'property_step',
      propertyShapeId: '__sub_query',
    };
  }

  throw new Error('Unsupported query step in desugar pass: ' + JSON.stringify(step));
};

const toPropertyStepOnly = (step: QueryStep): DesugaredPropertyStep => {
  if (isPropertyQueryStep(step)) {
    return {
      kind: 'property_step',
      propertyShapeId: step.property.id,
    };
  }
  throw new Error('Expected property step in count path');
};

/**
 * Converts a SelectPath (QueryPath[] or CustomQueryObject) to desugared selections.
 */
const toSelections = (select: SelectPath): DesugaredSelection[] => {
  if (Array.isArray(select)) {
    return select.map((path) => toSelection(path as QueryPath));
  }
  // CustomQueryObject at top level
  return [toCustomObjectSelect(select)];
};

/**
 * Converts a single QueryPath to a DesugaredSelection.
 * A QueryPath can be:
 * - (QueryStep | SubQueryPaths)[] — a flat or nested array of steps
 * - WherePath — a where evaluation used as a selection (e.g. p.bestFriend.equals(...))
 */
const toSelection = (path: QueryPath): DesugaredSelection => {
  // WherePath used as a selection (e.g. customResultEqualsBoolean)
  if (!Array.isArray(path)) {
    if (isWhereEvaluationPath(path) || 'firstPath' in (path as Record<string, unknown>)) {
      return {
        kind: 'evaluation_select',
        where: toWhere(path),
      };
    }
    throw new Error('Unsupported non-array path in desugar selection pass');
  }

  // Check if the last element is a sub-query (nested array or custom object)
  const lastElement = path[path.length - 1];
  if (Array.isArray(lastElement)) {
    // Sub-select: parent path steps + nested selections
    const parentSteps = path.slice(0, -1).map((step) => toStep(step as QueryStep));
    const nestedSelect = lastElement as unknown as SelectPath;
    return {
      kind: 'sub_select',
      parentPath: parentSteps,
      selections: toSubSelections(nestedSelect),
    };
  }

  if (lastElement && typeof lastElement === 'object' && isCustomQueryObject(lastElement)) {
    // Sub-select with custom object: parent path steps + custom object selections
    const parentSteps = path.slice(0, -1).map((step) => toStep(step as QueryStep));
    return {
      kind: 'sub_select',
      parentPath: parentSteps,
      selections: toCustomObjectSelect(lastElement),
    };
  }

  // Flat selection path
  return {
    kind: 'selection_path',
    steps: path.map((step) => toStep(step as QueryStep)),
  };
};

/**
 * Converts sub-select contents (which can be QueryPath[] or CustomQueryObject).
 */
const toSubSelections = (select: SelectPath): DesugaredSelection => {
  if (Array.isArray(select)) {
    // Array of paths — could be a single path or multiple paths
    if (select.length === 0) {
      return {kind: 'selection_path', steps: []};
    }
    const selections = select.map((path) => toSelection(path as QueryPath));
    if (selections.length === 1) {
      return selections[0];
    }
    // Multiple selections in a sub-select
    return {
      kind: 'multi_selection' as const,
      selections,
    };
  }
  return toCustomObjectSelect(select);
};

/**
 * Converts a CustomQueryObject to a DesugaredCustomObjectSelect.
 */
const toCustomObjectSelect = (obj: CustomQueryObject): DesugaredCustomObjectSelect => {
  const entries: DesugaredCustomObjectEntry[] = Object.keys(obj).map((key) => ({
    key,
    value: toSelection(obj[key]),
  }));
  return {
    kind: 'custom_object_select',
    entries,
  };
};

const toSelectionPath = (path: QueryPath): DesugaredSelectionPath => {
  if (!Array.isArray(path)) {
    throw new Error('Unsupported non-array path in desugar selection pass');
  }
  return {
    kind: 'selection_path',
    steps: path.map((step) => toStep(step as QueryStep)),
  };
};

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


const toSortBy = (query: RawSelectInput): DesugaredSortBy | undefined => {
  if (!query.sortBy) {
    return undefined;
  }

  return {
    direction: query.sortBy.direction,
    paths: query.sortBy.paths.map((path) => toSelectionPath(path as QueryPath)),
  };
};

/**
 * Converts a RawSelectInput (DSL-level query) into a flat DesugaredSelectQuery
 * by walking proxy-traced select/where/sortBy paths and extracting property steps.
 */
export const desugarSelectQuery = (query: RawSelectInput): DesugaredSelectQuery => {
  const selections = toSelections(query.select);

  const subjectId =
    query.subject && typeof query.subject === 'object' && 'id' in query.subject
      ? (query.subject as NodeReferenceValue).id
      : undefined;

  const subjectIds = query.subjects
    ? query.subjects.map((s) =>
        typeof s === 'object' && s !== null && 'id' in s
          ? (s as NodeReferenceValue).id
          : String(s),
      )
    : undefined;

  return {
    kind: 'desugared_select',
    shapeId: (query.shape as any)?.shape?.id || (query.shape as any)?.id,
    subjectId,
    subjectIds,
    singleResult: query.singleResult,
    limit: query.limit,
    offset: query.offset,
    selections,
    sortBy: toSortBy(query),
    where: query.where ? toWhere(query.where) : undefined,
  };
};
