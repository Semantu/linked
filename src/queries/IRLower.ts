import {
  CanonicalDesugaredSelectQuery,
  CanonicalWhereComparison,
  CanonicalWhereExists,
  CanonicalWhereExpression,
  CanonicalWhereLogical,
  CanonicalWhereNot,
} from './IRCanonicalize.js';
import {
  DesugaredSelection,
  DesugaredSelectionPath,
  DesugaredStep,
  DesugaredWhere,
  DesugaredWhereArg,
} from './IRDesugar.js';
import {
  IRExpression,
  IRGraphPattern,
  IROrderByItem,
  IRProjectionItem,
  IRResultMapEntry,
  IRSelectQuery,
  IRShapeScanPattern,
  IRTraversePattern,
} from './IntermediateRepresentation.js';
import {canonicalizeWhere} from './IRCanonicalize.js';
import {lowerSelectionPathExpression, projectionKeyFromPath} from './IRProjection.js';
import {IRAliasScope} from './IRAliasScope.js';
import {NodeReferenceValue, ShapeReferenceValue} from './QueryFactory.js';

class LoweringContext {
  private counter = 0;
  private patterns: IRGraphPattern[] = [];
  private traverseMap = new Map<string, string>();
  private filterMap = new Map<string, IRExpression>();
  readonly rootAlias: string;

  constructor() {
    this.rootAlias = this.nextAlias();
  }

  private nextAlias(): string {
    return `a${this.counter++}`;
  }

  getOrCreateTraversal(fromAlias: string, propertyShapeId: string): string {
    const key = `${fromAlias}:${propertyShapeId}`;
    const existing = this.traverseMap.get(key);
    if (existing) return existing;

    const toAlias = this.nextAlias();
    this.patterns.push({
      kind: 'traverse',
      from: fromAlias,
      to: toAlias,
      property: propertyShapeId,
    });
    this.traverseMap.set(key, toAlias);
    return toAlias;
  }

  generateAlias(): string {
    return this.nextAlias();
  }

  /**
   * Attaches an inline where filter to the traverse pattern targeting `toAlias`.
   * The filter will be merged into the pattern when `getPatterns()` is called.
   */
  attachFilter(toAlias: string, filter: IRExpression): void {
    this.filterMap.set(toAlias, filter);
  }

  getPatterns(): IRGraphPattern[] {
    return this.patterns.map((p) => {
      if (p.kind === 'traverse' && this.filterMap.has(p.to)) {
        return {...p, filter: this.filterMap.get(p.to)!};
      }
      return p;
    });
  }
}

type PathLoweringOptions = {
  rootAlias: string;
  resolveTraversal: (fromAlias: string, propertyShapeId: string) => string;
};

const isShapeRef = (value: unknown): value is ShapeReferenceValue =>
  !!value && typeof value === 'object' && 'id' in value && 'shape' in value;

const isNodeRef = (value: unknown): value is NodeReferenceValue =>
  typeof value === 'object' && value !== null && 'id' in value;

const lowerPath = (
  path: DesugaredSelectionPath,
  options: PathLoweringOptions,
): IRExpression => lowerSelectionPathExpression(path, options);

const lowerWhereArg = (
  arg: DesugaredWhereArg,
  ctx: LoweringContext,
  options: PathLoweringOptions,
): IRExpression => {
  if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
    return {kind: 'literal_expr', value: arg};
  }
  if (arg instanceof Date) {
    return {kind: 'literal_expr', value: arg.toISOString()};
  }
  if (arg && typeof arg === 'object') {
    if ('kind' in arg && arg.kind === 'arg_path') {
      const argPath = arg as {kind: 'arg_path'; subject?: ShapeReferenceValue; path: DesugaredSelectionPath};
      if (argPath.subject && argPath.subject.id) {
        // Context entity path — resolve property relative to the context IRI
        const lastStep = argPath.path.steps[argPath.path.steps.length - 1];
        if (lastStep && lastStep.kind === 'property_step') {
          return {
            kind: 'context_property_expr',
            contextIri: argPath.subject.id,
            property: lastStep.propertyShapeId,
          };
        }
      }
      return lowerPath(argPath.path, options);
    }
    if (isShapeRef(arg)) {
      return {kind: 'reference_expr', value: arg.id};
    }
    if (isNodeRef(arg)) {
      return {kind: 'reference_expr', value: (arg as NodeReferenceValue).id};
    }
  }
  return {kind: 'literal_expr', value: null};
};

const lowerWhere = (
  where: CanonicalWhereExpression,
  ctx: LoweringContext,
  options: PathLoweringOptions,
): IRExpression => {
  switch (where.kind) {
    case 'where_binary': {
      const comp = where as CanonicalWhereComparison;
      return {
        kind: 'binary_expr',
        operator: comp.operator as '=' | '!=' | '>' | '>=' | '<' | '<=',
        left: lowerPath(comp.left, options),
        right: comp.right.length > 0
          ? lowerWhereArg(comp.right[0], ctx, options)
          : {kind: 'literal_expr', value: null},
      };
    }
    case 'where_logical': {
      const logical = where as CanonicalWhereLogical;
      return {
        kind: 'logical_expr',
        operator: logical.operator,
        expressions: logical.expressions.map((expr) => lowerWhere(expr, ctx, options)),
      };
    }
    case 'where_exists': {
      const exists = where as CanonicalWhereExists;
      const traversals: IRTraversePattern[] = [];
      const localTraversalMap = new Map<string, string>();

      const existsResolveTraversal = (fromAlias: string, propertyShapeId: string): string => {
        const key = `${fromAlias}:${propertyShapeId}`;
        const existing = localTraversalMap.get(key);
        if (existing) return existing;

        const toAlias = ctx.generateAlias();
        traversals.push({
          kind: 'traverse',
          from: fromAlias,
          to: toAlias,
          property: propertyShapeId,
        });
        localTraversalMap.set(key, toAlias);
        return toAlias;
      };

      let existsRootAlias = options.rootAlias;
      for (const step of exists.path.steps) {
        if (step.kind === 'property_step') {
          existsRootAlias = existsResolveTraversal(existsRootAlias, step.propertyShapeId);
        }
      }

      const filter = lowerWhere(exists.predicate, ctx, {
        rootAlias: existsRootAlias,
        resolveTraversal: existsResolveTraversal,
      });

      return {
        kind: 'exists_expr',
        pattern: traversals.length === 1
          ? traversals[0]
          : {kind: 'join', patterns: traversals},
        filter,
      };
    }
    case 'where_not': {
      const not = where as CanonicalWhereNot;
      return {
        kind: 'not_expr',
        expression: lowerWhere(not.expression, ctx, options),
      };
    }
    default:
      throw new Error(`Unknown canonical where kind: ${(where as any).kind}`);
  }
};

type ProjectionSeed =
  | {
      kind: 'path';
      path: DesugaredSelectionPath;
      key?: string;
    }
  | {
      kind: 'expression';
      expression: IRExpression;
      key: string;
    };

const combineWithParentPath = (
  parentPath: DesugaredStep[],
  path: DesugaredSelectionPath,
): DesugaredSelectionPath => ({
  kind: 'selection_path',
  steps: [...parentPath, ...path.steps],
});

/**
 * Lowers a canonical desugared select query into the final IRSelectQuery.
 * Introduces aliases, graph patterns (shape scans, traversals), and
 * converts selection paths and where-clauses into IR expressions.
 */
export const lowerSelectQuery = (
  canonical: CanonicalDesugaredSelectQuery,
): IRSelectQuery => {
  const ctx = new LoweringContext();
  const pathOptions: PathLoweringOptions = {
    rootAlias: ctx.rootAlias,
    resolveTraversal: (fromAlias: string, propertyShapeId: string) =>
      ctx.getOrCreateTraversal(fromAlias, propertyShapeId),
  };

  const root: IRShapeScanPattern = {
    kind: 'shape_scan',
    shape: canonical.shapeId || '',
    alias: ctx.rootAlias,
  };

  const aliasAfterPath = (steps: DesugaredStep[]): string => {
    let currentAlias = pathOptions.rootAlias;
    for (const step of steps) {
      if (step.kind === 'property_step') {
        currentAlias = pathOptions.resolveTraversal(currentAlias, step.propertyShapeId);
      }
    }
    return currentAlias;
  };

  const collectProjectionSeeds = (
    selection: DesugaredSelection,
    key?: string,
    parentPath: DesugaredStep[] = [],
  ): ProjectionSeed[] => {
    if (selection.kind === 'selection_path') {
      return [{
        kind: 'path',
        path: combineWithParentPath(parentPath, selection),
        key,
      }];
    }

    if (selection.kind === 'sub_select') {
      return collectProjectionSeeds(
        selection.selections,
        key,
        [...parentPath, ...selection.parentPath],
      );
    }

    if (selection.kind === 'custom_object_select') {
      return selection.entries.flatMap((entry) =>
        collectProjectionSeeds(entry.value, entry.key, parentPath),
      );
    }

    if (selection.kind === 'multi_selection') {
      return selection.selections.flatMap((nestedSelection) =>
        collectProjectionSeeds(nestedSelection, key, parentPath),
      );
    }

    if (selection.kind === 'evaluation_select') {
      const canonicalWhere = canonicalizeWhere(selection.where);
      return [{
        kind: 'expression',
        key: key || 'value',
        expression: lowerWhere(canonicalWhere, ctx, {
          rootAlias: aliasAfterPath(parentPath),
          resolveTraversal: pathOptions.resolveTraversal,
        }),
      }];
    }

    return [];
  };

  const projectionSeeds = canonical.selections.flatMap((selection) =>
    collectProjectionSeeds(selection),
  );

  const projectionScope = new IRAliasScope('projection');
  projectionScope.registerAlias(ctx.rootAlias, 'root');
  const projection: IRProjectionItem[] = [];
  const resultMapEntries: IRResultMapEntry[] = [];

  // Inline filter handler: when a property step has `.where()`, canonicalize
  // and lower the where predicate, then attach it to the traverse pattern.
  const inlineFilterHandler = (traverseAlias: string, where: DesugaredWhere) => {
    const canonical = canonicalizeWhere(where);
    const filterExpr = lowerWhere(canonical, ctx, {
      rootAlias: traverseAlias,
      resolveTraversal: pathOptions.resolveTraversal,
    });
    ctx.attachFilter(traverseAlias, filterExpr);
  };

  for (const seed of projectionSeeds) {
    const key = seed.kind === 'path'
      ? (seed.key || projectionKeyFromPath(seed.path))
      : seed.key;
    const alias = projectionScope.generateAlias(key).alias;
    projection.push({
      alias,
      expression: seed.kind === 'path'
        ? lowerSelectionPathExpression(seed.path, pathOptions, inlineFilterHandler)
        : seed.expression,
    });
    resultMapEntries.push({
      key,
      alias,
    });
  }

  const where = canonical.where ? lowerWhere(canonical.where, ctx, pathOptions) : undefined;

  const orderBy: IROrderByItem[] | undefined = canonical.sortBy
    ? canonical.sortBy.paths.map((path) => ({
        expression: lowerPath(path, pathOptions),
        direction: canonical.sortBy.direction,
      }))
    : undefined;

  return {
    kind: 'select',
    root,
    patterns: ctx.getPatterns(),
    projection,
    where,
    orderBy,
    limit: canonical.limit,
    offset: canonical.offset,
    subjectId: canonical.subjectId,
    subjectIds: canonical.subjectIds,
    singleResult: canonical.singleResult,
    resultMap: resultMapEntries,
  };
};
