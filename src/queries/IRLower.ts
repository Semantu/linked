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
  DesugaredWhereArg,
} from './IRDesugar.js';
import {
  IRExpression,
  IRGraphPattern,
  IROrderByItem,
  IRSelectQuery,
  IRShapeScanPattern,
  IRTraversePattern,
} from './IntermediateRepresentation.js';
import {buildCanonicalProjection, lowerSelectionPathExpression} from './IRProjection.js';
import {IRAliasScope} from './IRAliasScope.js';
import {NodeReferenceValue, ShapeReferenceValue} from './QueryFactory.js';

class LoweringContext {
  private counter = 0;
  private patterns: IRGraphPattern[] = [];
  private traverseMap = new Map<string, string>();
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
      property: {propertyShapeId},
    });
    this.traverseMap.set(key, toAlias);
    return toAlias;
  }

  generateAlias(): string {
    return this.nextAlias();
  }

  getPatterns(): IRGraphPattern[] {
    return [...this.patterns];
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
      const argPath = arg as {kind: 'arg_path'; path: DesugaredSelectionPath};
      return lowerPath(argPath.path, options);
    }
    if (isShapeRef(arg)) {
      return {kind: 'literal_expr', value: arg.id};
    }
    if (isNodeRef(arg)) {
      return {kind: 'literal_expr', value: (arg as NodeReferenceValue).id};
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
          property: {propertyShapeId},
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

const extractSelectionPaths = (selections: DesugaredSelection[]): DesugaredSelectionPath[] =>
  selections.filter((s): s is DesugaredSelectionPath => s.kind === 'selection_path');

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
    shape: {shapeId: canonical.shapeId || ''},
    alias: ctx.rootAlias,
  };

  const selectionPaths = extractSelectionPaths(canonical.selections);
  const projectionScope = new IRAliasScope('projection');
  projectionScope.registerAlias(ctx.rootAlias, 'root');
  const projection = buildCanonicalProjection(selectionPaths, pathOptions, projectionScope);

  const where = canonical.where ? lowerWhere(canonical.where, ctx, pathOptions) : undefined;

  const orderBy: IROrderByItem[] | undefined = canonical.sortBy
    ? canonical.sortBy.paths.map((path) => ({
        kind: 'order_by_item',
        expression: lowerPath(path, pathOptions),
        direction: canonical.sortBy.direction,
      }))
    : undefined;

  return {
    kind: 'select_query',
    root,
    patterns: ctx.getPatterns(),
    projection: projection.projection,
    where,
    orderBy,
    limit: canonical.limit,
    offset: canonical.offset,
    subjectId: canonical.subjectId,
    singleResult: canonical.singleResult,
    resultMap: projection.resultMap,
  };
};
