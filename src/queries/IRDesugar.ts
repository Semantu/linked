import {
  ArgPath,
  isWhereEvaluationPath,
  JSNonNullPrimitive,
  PropertyQueryStep,
  QueryPropertyPath,
  QueryStep,
  SizeStep,
  SortByPath,
  WhereAndOr,
  WhereMethods,
  WherePath,
} from './SelectQuery.js';
import {NodeReferenceValue, ShapeReferenceValue} from './QueryFactory.js';
import type {FieldSetEntry} from './FieldSet.js';
import type {PropertyShape} from '../shapes/SHACL.js';

/**
 * Pipeline input type — accepts FieldSet entries directly.
 */
/** A single segment in a property path (used for MINUS property existence). */
export type PropertyPathSegment = {
  propertyShapeId: string;
};

/** A raw MINUS entry before desugaring. */
export type RawMinusEntry = {
  shapeId?: string;
  where?: WherePath;
  propertyPaths?: PropertyPathSegment[][];
};

export type RawSelectInput = {
  entries: readonly FieldSetEntry[];
  where?: WherePath;
  sortBy?: SortByPath;
  subject?: unknown;
  subjects?: unknown[];
  shape?: {shape?: {id?: string}; id?: string};
  limit?: number;
  offset?: number;
  singleResult?: boolean;
  minusEntries?: RawMinusEntry[];
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

/** A desugared MINUS entry. */
export type DesugaredMinusEntry = {
  shapeId?: string;
  where?: DesugaredWhere;
  propertyPaths?: PropertyPathSegment[][];
};

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
  minusEntries?: DesugaredMinusEntry[];
};

const isShapeRef = (value: unknown): value is ShapeReferenceValue =>
  !!value && typeof value === 'object' && 'id' in value && 'shape' in value;

const isNodeRef = (value: unknown): value is NodeReferenceValue =>
  typeof value === 'object' && value !== null && 'id' in value;

/**
 * Convert PropertyShape segments to DesugaredPropertyStep[].
 */
const segmentsToSteps = (segments: PropertyShape[]): DesugaredPropertyStep[] =>
  segments.map((seg) => ({
    kind: 'property_step' as const,
    propertyShapeId: seg.id,
  }));

/**
 * Convert a FieldSetEntry directly to a DesugaredSelection.
 */
const desugarEntry = (entry: FieldSetEntry): DesugaredSelection => {
  const segments = entry.path.segments;

  // Evaluation → where-as-selection (e.g. p.bestFriend.equals(...) used as select)
  if (entry.evaluation) {
    return {
      kind: 'evaluation_select',
      where: toWhere(entry.evaluation.wherePath),
    };
  }

  // Count aggregation → DesugaredCountStep
  if (entry.aggregation === 'count') {
    if (segments.length === 0) {
      return {kind: 'selection_path', steps: []};
    }
    const lastSegment = segments[segments.length - 1];
    const countStep: DesugaredCountStep = {
      kind: 'count_step',
      path: [{kind: 'property_step', propertyShapeId: lastSegment.id}],
      label: entry.customKey || lastSegment.label,
    };
    const parentSteps = segmentsToSteps(segments.slice(0, -1));
    return {
      kind: 'selection_path',
      steps: [...parentSteps, countStep],
    };
  }

  // Zero segments → empty path
  if (segments.length === 0) {
    return {kind: 'selection_path', steps: []};
  }

  // Build property steps, attaching scopedFilter to the last segment
  const steps: DesugaredStep[] = segments.map((segment, i) => {
    const step: DesugaredPropertyStep = {
      kind: 'property_step',
      propertyShapeId: segment.id,
    };
    if (entry.scopedFilter && i === segments.length - 1) {
      step.where = toWhere(entry.scopedFilter);
    }
    return step;
  });

  // SubSelect → produce DesugaredSubSelect with recursive entries
  if (entry.subSelect) {
    const subEntries = entry.subSelect.entries as FieldSetEntry[];
    return {
      kind: 'sub_select',
      parentPath: steps as DesugaredPropertyStep[],
      selections: desugarSubSelectEntries(subEntries),
    };
  }

  // Preload → stored as preloadSubSelect (FieldSet) on the entry
  if (entry.preloadSubSelect) {
    const subEntries = entry.preloadSubSelect.entries as FieldSetEntry[];
    return {
      kind: 'sub_select',
      parentPath: steps as DesugaredPropertyStep[],
      selections: desugarSubSelectEntries(subEntries),
    };
  }

  return {kind: 'selection_path', steps};
};

/**
 * Convert sub-select FieldSetEntry[] to a single DesugaredSelection.
 */
const desugarSubSelectEntries = (entries: FieldSetEntry[]): DesugaredSelection => {
  // Check if all entries have customKey → custom object form
  const allCustom = entries.length > 0 && entries.every((e) => e.customKey);
  if (allCustom) {
    return {
      kind: 'custom_object_select',
      entries: entries.map((e) => ({
        key: e.customKey!,
        value: desugarEntry(e),
      })),
    };
  }

  const selections = entries.map((e) => desugarEntry(e));
  if (selections.length === 1) {
    return selections[0];
  }
  return {kind: 'multi_selection', selections};
};

/**
 * Convert top-level FieldSetEntry[] to DesugaredSelection[].
 */
const desugarFieldSetEntries = (entries: readonly FieldSetEntry[]): DesugaredSelection[] => {
  // Check if all entries have customKey → wrap in single custom object
  const allCustom = entries.length > 0 && entries.every((e) => e.customKey);
  if (allCustom) {
    return [{
      kind: 'custom_object_select',
      entries: (entries as FieldSetEntry[]).map((e) => ({
        key: e.customKey!,
        value: desugarEntry(e),
      })),
    }];
  }

  return (entries as FieldSetEntry[]).map((e) => desugarEntry(e));
};

const isSizeStep = (step: QueryStep): step is SizeStep => 'count' in step;
const isPropertyStep = (step: QueryStep): step is PropertyQueryStep =>
  'property' in step && !('count' in step);

/**
 * Convert a where-clause QueryPropertyPath to a DesugaredSelectionPath.
 */
const toSelectionPath = (path: QueryPropertyPath): DesugaredSelectionPath => ({
  kind: 'selection_path',
  steps: path.map((step): DesugaredStep => {
    if (isSizeStep(step)) {
      return {
        kind: 'count_step',
        path: step.count.filter(isPropertyStep).map((s) => ({
          kind: 'property_step' as const,
          propertyShapeId: s.property.id,
        })),
        label: step.label,
      };
    }
    if (isShapeRef(step)) {
      return {
        kind: 'type_cast_step',
        shapeId: step.id,
      };
    }
    if (isPropertyStep(step)) {
      const result: DesugaredPropertyStep = {
        kind: 'property_step',
        propertyShapeId: step.property.id,
      };
      if (step.where) {
        result.where = toWhere(step.where);
      }
      return result;
    }
    throw new Error('Unsupported step in where path');
  }),
});

const isArgPath = (arg: unknown): arg is ArgPath =>
  !!arg && typeof arg === 'object' && 'path' in arg && 'subject' in arg;

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
    if (isWhereEvaluationPath(arg as WherePath) || 'firstPath' in (arg as object)) {
      return toWhere(arg as WherePath);
    }
    if (isArgPath(arg)) {
      return {
        kind: 'arg_path',
        subject: arg.subject,
        path: toSelectionPath(arg.path),
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
    left: toSelectionPath(path.path),
    right: (path.args || []).map(toWhereArg),
  };
};

export const toWhere = (path: WherePath): DesugaredWhere => {
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
    paths: query.sortBy.paths.map((path) => ({
      kind: 'selection_path' as const,
      steps: path.segments.map((seg) => ({
        kind: 'property_step' as const,
        propertyShapeId: seg.id,
      })),
    })),
  };
};

/**
 * Converts a RawSelectInput (FieldSet entries + where/sort) into a DesugaredSelectQuery.
 */
export const desugarSelectQuery = (query: RawSelectInput): DesugaredSelectQuery => {
  const selections = desugarFieldSetEntries(query.entries);

  const subjectId =
    query.subject && typeof query.subject === 'object' && 'id' in query.subject
      ? (query.subject as NodeReferenceValue).id
      : undefined;

  const subjectIds = query.subjects
    ? query.subjects.reduce<string[]>((acc, s) => {
        if (typeof s === 'object' && s !== null && 'id' in s) {
          acc.push((s as NodeReferenceValue).id);
        } else if (typeof s === 'string') {
          acc.push(s);
        }
        return acc;
      }, [])
    : undefined;

  return {
    kind: 'desugared_select',
    shapeId: query.shape?.shape?.id || query.shape?.id,
    subjectId,
    subjectIds,
    singleResult: query.singleResult,
    limit: query.limit,
    offset: query.offset,
    selections,
    sortBy: toSortBy(query),
    where: query.where ? toWhere(query.where) : undefined,
    minusEntries: query.minusEntries?.map((entry) => ({
      shapeId: entry.shapeId,
      where: entry.where ? toWhere(entry.where) : undefined,
      propertyPaths: entry.propertyPaths,
    })),
  };
};
