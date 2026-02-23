import {DesugaredSelectionPath, DesugaredStep} from './IRDesugar.js';
import {IRAliasScope} from './IRAliasScope.js';

export type CanonicalProjectionItem = {
  kind: 'projection_item';
  alias: string;
  path: DesugaredSelectionPath;
};

export type CanonicalResultMapEntry = {
  key: string;
  alias: string;
};

export type CanonicalProjectionResult = {
  projection: CanonicalProjectionItem[];
  resultMap?: {
    kind: 'result_map';
    entries: CanonicalResultMapEntry[];
  };
};

const defaultKeyFromPath = (path: DesugaredSelectionPath): string => {
  if (!path.steps.length) return 'value';
  const lastStep = path.steps[path.steps.length - 1];
  if (lastStep.kind === 'property_step') return lastStep.propertyShapeId;
  if (lastStep.kind === 'count_step') return lastStep.label || 'count';
  if (lastStep.kind === 'type_cast_step') return lastStep.shapeId;
  return 'value';
};

export const buildCanonicalProjection = (
  selections: DesugaredSelectionPath[],
  scope = new IRAliasScope('projection'),
): CanonicalProjectionResult => {
  const projection: CanonicalProjectionItem[] = [];
  const entries: CanonicalResultMapEntry[] = [];

  selections.forEach((path) => {
    const binding = scope.generateAlias(defaultKeyFromPath(path));
    projection.push({
      kind: 'projection_item',
      alias: binding.alias,
      path,
    });
    entries.push({
      key: defaultKeyFromPath(path),
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
