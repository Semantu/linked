import {
  CanonicalDesugaredSelectQuery,
  CanonicalWhereComparison,
  CanonicalWhereExists,
  CanonicalWhereExpression,
  CanonicalWhereLogical,
  CanonicalWhereNot,
} from './IRCanonicalize.js';
import {
  DesugaredExpressionSelect,
  DesugaredExpressionWhere,
  DesugaredExistsWhere,
  DesugaredSelection,
  DesugaredSelectionPath,
  DesugaredStep,
  DesugaredWhere,
  DesugaredWhereArg,
} from './IRDesugar.js';
import {resolveExpressionRefs, ExistsCondition} from '../expressions/ExpressionNode.js';
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
import type {PathExpr} from '../paths/PropertyPathExpr.js';

/**
 * Creates a memoized traversal resolver that deduplicates (fromAlias, propertyShapeId)
 * pairs, generates unique aliases, and accumulates the resulting patterns.
 * Used by both select-query lowering and mutation expression resolution.
 */
export function createTraversalResolver<P>(
  generateAlias: () => string,
  createPattern: (from: string, to: string, property: string) => P,
): {resolve: (fromAlias: string, propertyShapeId: string) => string; patterns: P[]} {
  const patterns: P[] = [];
  const seen = new Map<string, string>();

  const resolve = (fromAlias: string, propertyShapeId: string): string => {
    const key = `${fromAlias}:${propertyShapeId}`;
    if (seen.has(key)) return seen.get(key)!;
    const toAlias = generateAlias();
    seen.set(key, toAlias);
    patterns.push(createPattern(fromAlias, toAlias, propertyShapeId));
    return toAlias;
  };

  return {resolve, patterns};
}

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

  getOrCreateTraversal(fromAlias: string, propertyShapeId: string, pathExpr?: PathExpr): string {
    const key = `${fromAlias}:${propertyShapeId}`;
    const existing = this.traverseMap.get(key);
    if (existing) return existing;

    const toAlias = this.nextAlias();
    const pattern: IRTraversePattern = {
      kind: 'traverse',
      from: fromAlias,
      to: toAlias,
      property: propertyShapeId,
    };
    if (pathExpr) {
      pattern.pathExpr = pathExpr;
    }
    this.patterns.push(pattern);
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

/** Minimal interface for alias generation used by lowerWhere and traversal resolvers. */
type AliasGenerator = {
  generateAlias(): string;
};

type PathLoweringOptions = {
  rootAlias: string;
  resolveTraversal: (fromAlias: string, propertyShapeId: string, pathExpr?: PathExpr) => string;
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
  ctx: AliasGenerator,
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
  ctx: AliasGenerator,
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
      const {resolve: existsResolveTraversal, patterns: traversals} = createTraversalResolver(
        () => ctx.generateAlias(),
        (from, to, property): IRTraversePattern => ({kind: 'traverse', from, to, property}),
      );

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
    case 'where_expression': {
      // ExpressionNode-based WHERE — resolve refs and return IRExpression directly
      const exprWhere = where as DesugaredExpressionWhere;
      return resolveExpressionRefs(
        exprWhere.expressionNode.ir,
        exprWhere.expressionNode._refs,
        options.rootAlias,
        options.resolveTraversal,
      );
    }
    case 'where_exists_condition': {
      // ExistsCondition-based WHERE (from .some()/.every()/.none())
      const existsWhere = where as DesugaredExistsWhere;
      return lowerExistsCondition(existsWhere.existsCondition, ctx, options);
    }
    default:
      const _exhaustive: never = where;
      throw new Error(`Unknown canonical where kind: ${(_exhaustive as {kind: string}).kind}`);
  }
};

/**
 * Lower an ExistsCondition to IRExistsExpression with proper traversal patterns.
 */
const lowerExistsCondition = (
  condition: ExistsCondition,
  ctx: AliasGenerator,
  options: PathLoweringOptions,
): IRExpression => {
  // Build traversal patterns for the collection path
  const {resolve: existsResolve, patterns: traversals} = createTraversalResolver(
    () => ctx.generateAlias(),
    (from, to, property): IRTraversePattern => ({kind: 'traverse', from, to, property}),
  );

  // Walk the path segments to create traversal patterns
  let currentAlias = options.rootAlias;
  for (const segmentId of condition.pathSegmentIds) {
    currentAlias = existsResolve(currentAlias, segmentId);
  }

  // Resolve the inner predicate's property refs against the EXISTS scope
  const filter = resolveExpressionRefs(
    condition.predicate.ir,
    condition.predicate._refs,
    currentAlias,
    existsResolve,
  );

  let existsExpr: IRExpression = {
    kind: 'exists_expr',
    pattern: traversals.length === 1
      ? traversals[0]
      : {kind: 'join', patterns: traversals},
    filter,
  };

  // Wrap in NOT if negated (.none() or outer NOT of .every())
  if (condition.negated) {
    existsExpr = {kind: 'not_expr', expression: existsExpr};
  }

  // Handle .and()/.or() chaining
  if (condition.chain.length > 0) {
    let result: IRExpression = existsExpr;
    for (const link of condition.chain) {
      let rightExpr: IRExpression;
      if (link.condition instanceof ExistsCondition) {
        rightExpr = lowerExistsCondition(link.condition, ctx, options);
      } else {
        rightExpr = resolveExpressionRefs(
          link.condition.ir,
          link.condition._refs,
          options.rootAlias,
          options.resolveTraversal,
        );
      }
      result = {
        kind: 'logical_expr',
        operator: link.op,
        expressions: [result, rightExpr],
      };
    }
    return result;
  }

  return existsExpr;
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
    resolveTraversal: (fromAlias: string, propertyShapeId: string, pathExpr?: PathExpr) =>
      ctx.getOrCreateTraversal(fromAlias, propertyShapeId, pathExpr),
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
        currentAlias = pathOptions.resolveTraversal(currentAlias, step.propertyShapeId, step.pathExpr);
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

    if (selection.kind === 'expression_select') {
      const exprSelect = selection as DesugaredExpressionSelect;
      const resolved = resolveExpressionRefs(
        exprSelect.expressionNode.ir,
        exprSelect.expressionNode._refs,
        aliasAfterPath(parentPath),
        pathOptions.resolveTraversal,
      );
      return [{
        kind: 'expression',
        key: key || 'expr',
        expression: resolved,
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

  // Lower MINUS entries → IRMinusPattern objects
  const minusPatterns: IRGraphPattern[] = [];
  if (canonical.minusEntries) {
    for (const entry of canonical.minusEntries) {
      if (entry.shapeId) {
        // Shape exclusion: MINUS { ?a0 a <Shape> }
        minusPatterns.push({
          kind: 'minus',
          pattern: {kind: 'shape_scan', shape: entry.shapeId, alias: ctx.rootAlias},
        });
      } else if (entry.propertyPaths && entry.propertyPaths.length > 0) {
        // Property existence exclusion: MINUS { ?a0 <prop1> ?m0 . ?a0 <prop2> ?m1 . }
        // Supports nested paths: ?a0 <bestFriend> ?m0 . ?m0 <name> ?m1 .
        const traversals: IRTraversePattern[] = [];
        for (const path of entry.propertyPaths) {
          let currentAlias = ctx.rootAlias;
          for (const segment of path) {
            const toAlias = ctx.generateAlias();
            traversals.push({
              kind: 'traverse',
              from: currentAlias,
              to: toAlias,
              property: segment.propertyShapeId,
            });
            currentAlias = toAlias;
          }
        }
        const innerPattern: IRGraphPattern = traversals.length === 1
          ? traversals[0]
          : {kind: 'join', patterns: traversals};
        minusPatterns.push({kind: 'minus', pattern: innerPattern});
      } else if (entry.where) {
        // Condition-based exclusion: MINUS { ?a0 <prop> ?val . FILTER(...) }
        const {resolve: minusResolveTraversal, patterns: minusTraversals} = createTraversalResolver(
          () => ctx.generateAlias(),
          (from, to, property): IRTraversePattern => ({kind: 'traverse', from, to, property}),
        );
        const minusOptions: PathLoweringOptions = {
          rootAlias: ctx.rootAlias,
          resolveTraversal: minusResolveTraversal,
        };
        const filter = lowerWhere(entry.where, ctx, minusOptions);
        const innerPattern: IRGraphPattern = minusTraversals.length === 1
          ? minusTraversals[0]
          : minusTraversals.length > 1
            ? {kind: 'join', patterns: minusTraversals}
            : {kind: 'shape_scan', shape: canonical.shapeId || '', alias: ctx.rootAlias};
        minusPatterns.push({kind: 'minus', pattern: innerPattern, filter});
      }
    }
  }

  return {
    kind: 'select',
    root,
    patterns: [...ctx.getPatterns(), ...minusPatterns],
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

/**
 * Standalone WHERE lowering — converts a CanonicalWhereExpression to IR expression + patterns.
 * Used by mutation builders (DeleteBuilder, UpdateBuilder) that don't go through the select pipeline.
 */
export const lowerWhereToIR = (
  where: CanonicalWhereExpression,
  rootAlias: string = 'a0',
): {where: IRExpression; wherePatterns: IRGraphPattern[]} => {
  let counter = 1; // start at 1 since a0 is the root
  const ctx: AliasGenerator = {
    generateAlias: () => `a${counter++}`,
  };

  const {resolve, patterns: traversals} = createTraversalResolver(
    () => ctx.generateAlias(),
    (from, to, property): IRTraversePattern => ({kind: 'traverse', from, to, property}),
  );

  const expr = lowerWhere(where, ctx, {rootAlias, resolveTraversal: resolve});
  return {where: expr, wherePatterns: traversals};
};
