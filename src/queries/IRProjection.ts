import {DesugaredSelectionPath} from './IRDesugar.js';
import {IRAliasScope} from './IRAliasScope.js';
import {IRExpression, IRProjectionItem, IRResultMap} from './IntermediateRepresentation.js';

export type ProjectionPathLoweringOptions = {
  rootAlias: string;
  resolveTraversal: (fromAlias: string, propertyShapeId: string) => string;
};

export type CanonicalResultMapEntry = {
  key: string;
  alias: string;
};

export type CanonicalProjectionResult = {
  projection: IRProjectionItem[];
  resultMap?: IRResultMap;
};

export type ProjectionPathInput =
  | DesugaredSelectionPath
  | {
      path: DesugaredSelectionPath;
      key?: string;
    };

export const projectionKeyFromPath = (path: DesugaredSelectionPath): string => {
  if (!path.steps.length) return 'value';
  const lastStep = path.steps[path.steps.length - 1];
  if (lastStep.kind === 'property_step') return lastStep.propertyShapeId;
  if (lastStep.kind === 'count_step') return lastStep.label || 'count';
  if (lastStep.kind === 'type_cast_step') return lastStep.shapeId;
  return 'value';
};

export const lowerSelectionPathExpression = (
  path: DesugaredSelectionPath,
  options: ProjectionPathLoweringOptions,
): IRExpression => {
  if (path.steps.length === 0) {
    return {kind: 'alias_expr', alias: options.rootAlias};
  }

  let currentAlias = options.rootAlias;

  for (let i = 0; i < path.steps.length; i++) {
    const step = path.steps[i];
    const isLast = i === path.steps.length - 1;

    if (step.kind === 'property_step') {
      if (isLast) {
        return {
          kind: 'property_expr',
          sourceAlias: currentAlias,
          property: {propertyShapeId: step.propertyShapeId},
        };
      }

      currentAlias = options.resolveTraversal(currentAlias, step.propertyShapeId);
      continue;
    }

    if (step.kind === 'count_step') {
      return {
        kind: 'aggregate_expr',
        name: 'count',
        args: step.path.map((propertyStep) => ({
          kind: 'property_expr',
          sourceAlias: currentAlias,
          property: {propertyShapeId: propertyStep.propertyShapeId},
        })),
      };
    }
  }

  return {kind: 'alias_expr', alias: currentAlias};
};

export const buildCanonicalProjection = (
  selections: ProjectionPathInput[],
  options: ProjectionPathLoweringOptions,
  scope = new IRAliasScope('projection'),
): CanonicalProjectionResult => {
  const projection: IRProjectionItem[] = [];
  const entries: CanonicalResultMapEntry[] = [];

  selections.forEach((selection) => {
    const path = 'path' in selection ? selection.path : selection;
    const key = 'path' in selection ? selection.key : undefined;
    const resultKey = key || projectionKeyFromPath(path);
    const binding = scope.generateAlias(resultKey);
    projection.push({
      kind: 'projection_item',
      alias: binding.alias,
      expression: lowerSelectionPathExpression(path, options),
    });
    entries.push({
      key: resultKey,
      alias: binding.alias,
    });
  });

  return {
    projection,
    resultMap: {
      kind: 'result_map',
      entries,
    },
  };
};
