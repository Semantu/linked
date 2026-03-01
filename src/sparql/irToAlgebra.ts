import {
  IRSelectQuery,
  IRCreateMutation,
  IRUpdateMutation,
  IRDeleteMutation,
  IRGraphPattern,
  IRExpression,
  IRFieldValue,
  IRNodeData,
  IRSetModificationValue,
} from '../queries/IntermediateRepresentation.js';
import {NodeReferenceValue} from '../utils/NodeReference.js';
import {
  SparqlSelectPlan,
  SparqlInsertDataPlan,
  SparqlDeleteInsertPlan,
  SparqlAlgebraNode,
  SparqlBGP,
  SparqlTriple,
  SparqlTerm,
  SparqlExpression,
  SparqlProjectionItem,
  SparqlOrderCondition,
  SparqlAggregateBinding,
  SparqlLeftJoin,
  SparqlFilter,
} from './SparqlAlgebra.js';
import {SparqlOptions, generateEntityUri} from './sparqlUtils.js';
import {
  selectPlanToSparql,
  insertDataPlanToSparql,
  deleteInsertPlanToSparql,
} from './algebraToString.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const XSD_DATETIME = 'http://www.w3.org/2001/XMLSchema#dateTime';
const XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean';
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';
const XSD_DOUBLE = 'http://www.w3.org/2001/XMLSchema#double';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function iriTerm(value: string): SparqlTerm {
  return {kind: 'iri', value};
}

function varTerm(name: string): SparqlTerm {
  return {kind: 'variable', name};
}

function literalTerm(value: string, datatype?: string): SparqlTerm {
  if (datatype) {
    return {kind: 'literal', value, datatype};
  }
  return {kind: 'literal', value};
}

function tripleOf(
  subject: SparqlTerm,
  predicate: SparqlTerm,
  object: SparqlTerm,
): SparqlTriple {
  return {subject, predicate, object};
}

/** Produce variable name suffix from the last segment of a property URI. */
function propertySuffix(propertyUri: string): string {
  const hashIdx = propertyUri.lastIndexOf('#');
  if (hashIdx >= 0) return propertyUri.substring(hashIdx + 1);
  const slashIdx = propertyUri.lastIndexOf('/');
  return slashIdx >= 0 ? propertyUri.substring(slashIdx + 1) : propertyUri;
}

/**
 * Sanitize a string so it's valid in a SPARQL variable name.
 * Replaces any non-alphanumeric/underscore characters with underscores.
 */
function sanitizeVarName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

/**
 * Wrap a single node in a LeftJoin, making `right` optional relative to `left`.
 */
function wrapOptional(
  left: SparqlAlgebraNode,
  right: SparqlAlgebraNode,
): SparqlLeftJoin {
  return {type: 'left_join', left, right};
}

/**
 * Join two algebra nodes. If left is null, returns right.
 */
function joinNodes(
  left: SparqlAlgebraNode | null,
  right: SparqlAlgebraNode,
): SparqlAlgebraNode {
  if (!left) return right;
  return {type: 'join', left, right};
}

// ---------------------------------------------------------------------------
// Pattern helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collects all traversal alias target variables from IR patterns.
 * Used to ensure traversal aliases appear in the SELECT projection for result grouping.
 */
function collectTraversalAliases(patterns: IRGraphPattern[]): string[] {
  const aliases: string[] = [];
  for (const p of patterns) {
    if (p.kind === 'traverse') {
      aliases.push(p.to);
    } else if (p.kind === 'join') {
      aliases.push(...collectTraversalAliases(p.patterns));
    } else if (p.kind === 'optional') {
      aliases.push(...collectTraversalAliases([p.pattern]));
    } else if (p.kind === 'union') {
      for (const branch of p.branches) {
        aliases.push(...collectTraversalAliases([branch]));
      }
    }
  }
  return aliases;
}

// ---------------------------------------------------------------------------
// Variable Registry
// ---------------------------------------------------------------------------

/**
 * Maps (alias, property) → SPARQL variable name.
 * Used to deduplicate variables across traverse and property_expr nodes.
 */
class VariableRegistry {
  private map = new Map<string, string>();
  private usedVarNames = new Set<string>();

  private key(alias: string, property: string): string {
    return `${alias}::${property}`;
  }

  has(alias: string, property: string): boolean {
    return this.map.has(this.key(alias, property));
  }

  get(alias: string, property: string): string | undefined {
    return this.map.get(this.key(alias, property));
  }

  set(alias: string, property: string, variable: string): void {
    this.map.set(this.key(alias, property), variable);
    this.usedVarNames.add(variable);
  }

  getOrCreate(alias: string, property: string): string {
    const existing = this.get(alias, property);
    if (existing) return existing;
    const suffix = propertySuffix(property);
    let varName = `${sanitizeVarName(alias)}_${suffix}`;
    // Deduplicate: if varName is already used by a different (alias, property),
    // append a counter to ensure unique SPARQL variable names
    let counter = 2;
    while (this.usedVarNames.has(varName)) {
      varName = `${sanitizeVarName(alias)}_${suffix}_${counter}`;
      counter++;
    }
    this.set(alias, property, varName);
    return varName;
  }
}

// ---------------------------------------------------------------------------
// Aggregate detection
// ---------------------------------------------------------------------------

/**
 * Checks whether a SparqlExpression tree contains an aggregate sub-expression.
 * Used to route aggregate-containing filters to HAVING instead of FILTER.
 */
function containsAggregate(expr: SparqlExpression): boolean {
  switch (expr.kind) {
    case 'aggregate_expr':
      return true;
    case 'binary_expr':
      return containsAggregate(expr.left) || containsAggregate(expr.right);
    case 'logical_expr':
      return expr.exprs.some(containsAggregate);
    case 'not_expr':
      return containsAggregate(expr.inner);
    case 'function_expr':
      return expr.args.some(containsAggregate);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Select conversion
// ---------------------------------------------------------------------------

/**
 * Converts an IRSelectQuery to a SparqlSelectPlan.
 */
export function selectToAlgebra(
  query: IRSelectQuery,
  _options?: SparqlOptions,
): SparqlSelectPlan {
  const registry = new VariableRegistry();

  // Track property triples that need to be added as OPTIONAL
  const optionalPropertyTriples: SparqlTriple[] = [];

  // Track filtered traversals (inline where) — these get their own OPTIONAL blocks
  const filteredTraverseBlocks: Array<{
    traverseTriple: SparqlTriple;
    filter: IRExpression;
    toAlias: string;
  }> = [];

  // 1. Root shape scan → BGP with type triple
  const rootAlias = query.root.alias;
  const shapeUri = query.root.shape;
  const typeTriple = tripleOf(
    varTerm(rootAlias),
    iriTerm(RDF_TYPE),
    iriTerm(shapeUri),
  );
  const requiredTriples: SparqlTriple[] = [typeTriple];

  // Track traverse triples (required pattern)
  const traverseTriples: SparqlTriple[] = [];

  // 2. Process patterns → traverse triples, populate variable registry
  for (const pattern of query.patterns) {
    processPattern(pattern, registry, traverseTriples, optionalPropertyTriples, filteredTraverseBlocks);
  }

  // 3. Process projection expressions, where clause, orderBy expressions
  //    to discover any additional property_expr references
  for (const item of query.projection) {
    processExpressionForProperties(
      item.expression,
      registry,
      optionalPropertyTriples,
    );
  }

  if (query.where) {
    processExpressionForProperties(
      query.where,
      registry,
      optionalPropertyTriples,
    );
  }

  if (query.orderBy) {
    for (const orderItem of query.orderBy) {
      processExpressionForProperties(
        orderItem.expression,
        registry,
        optionalPropertyTriples,
      );
    }
  }

  // 4. Build the algebra tree
  //    - Start with the required BGP (type triple + traverse triples)
  //    - Wrap each optional property triple in a LeftJoin
  const requiredBgp: SparqlBGP = {
    type: 'bgp',
    triples: [...requiredTriples, ...traverseTriples],
  };

  let algebra: SparqlAlgebraNode = requiredBgp;

  // 4b. Build filtered OPTIONAL blocks for inline where traversals.
  //     Each block contains: traverse triple + filter property triples + FILTER.
  //     Property triples referenced by the filter are co-located inside the OPTIONAL
  //     so that the filter can reference them.
  for (const block of filteredTraverseBlocks) {
    const filterPropertyTriples: SparqlTriple[] = [];
    processExpressionForProperties(block.filter, registry, filterPropertyTriples);
    const filterExpr = convertExpression(block.filter, registry, filterPropertyTriples);
    const blockTriples: SparqlTriple[] = [block.traverseTriple, ...filterPropertyTriples];
    const blockBgp: SparqlBGP = {type: 'bgp', triples: blockTriples};
    const filteredBlock: SparqlFilter = {type: 'filter', expression: filterExpr, inner: blockBgp};
    algebra = wrapOptional(algebra, filteredBlock);
  }

  // Wrap each optional property triple in its own OPTIONAL (LeftJoin)
  for (const propTriple of optionalPropertyTriples) {
    algebra = wrapOptional(algebra, {
      type: 'bgp',
      triples: [propTriple],
    });
  }

  // 5. Where clause → Filter wrapping (or HAVING if aggregate-containing)
  let havingExpr: SparqlExpression | undefined;
  if (query.where) {
    const filterExpr = convertExpression(query.where, registry, optionalPropertyTriples);
    if (containsAggregate(filterExpr)) {
      havingExpr = filterExpr;
    } else {
      algebra = {
        type: 'filter',
        expression: filterExpr,
        inner: algebra,
      };
    }
  }

  // 6. SubjectId → Filter
  if (query.subjectId) {
    const subjectFilter: SparqlExpression = {
      kind: 'binary_expr',
      op: '=',
      left: {kind: 'variable_expr', name: rootAlias},
      right: {kind: 'iri_expr', value: query.subjectId},
    };
    algebra = {
      type: 'filter',
      expression: subjectFilter,
      inner: algebra,
    };
  }

  // 7. Build projection
  const projection: SparqlProjectionItem[] = [];
  const aggregates: SparqlAggregateBinding[] = [];
  let hasAggregates = false;

  // Always include root alias as first projection variable
  projection.push({kind: 'variable', name: rootAlias});

  // Collect traversal aliases upfront to detect aggregate alias collisions
  const traversalAliasSet = new Set(collectTraversalAliases(query.patterns));
  // Track traversal aliases consumed by aggregate renames (should not be
  // re-projected as plain variables, which would alter GROUP BY semantics)
  const aggregateRenamedAliases = new Set<string>();

  for (const item of query.projection) {
    const sparqlExpr = convertExpression(item.expression, registry, optionalPropertyTriples);

    if (sparqlExpr.kind === 'aggregate_expr') {
      hasAggregates = true;
      // Avoid collision: if aggregate alias matches a traversal alias,
      // rename it so SPARQL doesn't produce duplicate variable bindings
      let aggAlias = item.alias;
      if (traversalAliasSet.has(aggAlias)) {
        aggregateRenamedAliases.add(aggAlias);
        aggAlias = `${aggAlias}_agg`;
        // Update resultMap so result mapping uses the renamed alias
        for (const rm of query.resultMap) {
          if (rm.alias === item.alias) rm.alias = aggAlias;
        }
      }
      projection.push({
        kind: 'aggregate',
        expression: sparqlExpr,
        alias: aggAlias,
      });
      aggregates.push({
        variable: aggAlias,
        aggregate: sparqlExpr,
      });
    } else {
      // For property_expr, the variable is the resolved name from registry
      const varName = resolveExpressionVariable(item.expression, registry);
      if (varName && varName !== rootAlias) {
        projection.push({kind: 'variable', name: varName});
      } else if (!varName) {
        // Non-variable expression (binary_expr, function_expr, etc.)
        // → project as (expr AS ?alias)
        projection.push({kind: 'expression', expression: sparqlExpr, alias: item.alias});
      }
    }
  }

  // 7b. Include traversal aliases needed for result grouping
  //     When nested results are projected (e.g. p.friends.name), the result
  //     mapping needs the traversal alias variable (?a1) in the bindings to
  //     group nested rows by entity. Without this, mapNestedRows() can't
  //     identify which nested fields belong to which traversed entity.
  const projectedNames = new Set<string>();
  for (const p of projection) {
    if (p.kind === 'variable') projectedNames.add(p.name);
    else if (p.kind === 'aggregate' || p.kind === 'expression') projectedNames.add(p.alias);
  }
  for (const alias of collectTraversalAliases(query.patterns)) {
    if (!projectedNames.has(alias) && !aggregateRenamedAliases.has(alias)) {
      projection.push({kind: 'variable', name: alias});
      projectedNames.add(alias);
    }
  }

  // 8. GROUP BY inference
  let groupBy: string[] | undefined;
  if (havingExpr) {
    hasAggregates = true;
  }
  if (hasAggregates) {
    // All non-aggregate projected variables become GROUP BY targets
    groupBy = projection
      .filter((p): p is {kind: 'variable'; name: string} => p.kind === 'variable')
      .map((p) => p.name);
  }

  // 9. OrderBy
  let orderBy: SparqlOrderCondition[] | undefined;
  if (query.orderBy) {
    orderBy = query.orderBy.map((item) => ({
      expression: convertExpression(item.expression, registry, optionalPropertyTriples),
      direction: item.direction,
    }));
  }

  return {
    type: 'select',
    algebra,
    projection,
    distinct: !hasAggregates ? true : undefined,
    orderBy,
    limit: query.limit,
    offset: query.offset,
    groupBy,
    having: havingExpr,
    aggregates: aggregates.length > 0 ? aggregates : undefined,
  };
}

// ---------------------------------------------------------------------------
// Pattern processing
// ---------------------------------------------------------------------------

function processPattern(
  pattern: IRGraphPattern,
  registry: VariableRegistry,
  traverseTriples: SparqlTriple[],
  optionalPropertyTriples: SparqlTriple[],
  filteredTraverseBlocks?: Array<{traverseTriple: SparqlTriple; filter: IRExpression; toAlias: string}>,
): void {
  switch (pattern.kind) {
    case 'shape_scan':
      // Additional shape scans (non-root) are handled as type triples
      // but this case is rare — root is handled separately
      break;

    case 'traverse': {
      // Register the traverse variable: (from, property) → to
      registry.set(pattern.from, pattern.property, pattern.to);
      // Add traverse triple to required pattern (or filtered block if inline where)
      const triple = tripleOf(
        varTerm(pattern.from),
        iriTerm(pattern.property),
        varTerm(pattern.to),
      );
      if (pattern.filter && filteredTraverseBlocks) {
        filteredTraverseBlocks.push({
          traverseTriple: triple,
          filter: pattern.filter,
          toAlias: pattern.to,
        });
      } else {
        traverseTriples.push(triple);
      }
      break;
    }

    case 'join': {
      for (const sub of pattern.patterns) {
        processPattern(sub, registry, traverseTriples, optionalPropertyTriples, filteredTraverseBlocks);
      }
      break;
    }

    case 'optional': {
      // Optional patterns — process inner patterns but keep them optional
      processPattern(pattern.pattern, registry, traverseTriples, optionalPropertyTriples, filteredTraverseBlocks);
      break;
    }

    case 'union': {
      for (const branch of pattern.branches) {
        processPattern(branch, registry, traverseTriples, optionalPropertyTriples, filteredTraverseBlocks);
      }
      break;
    }

    case 'exists': {
      processPattern(pattern.pattern, registry, traverseTriples, optionalPropertyTriples, filteredTraverseBlocks);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Expression processing — discover property_expr references
// ---------------------------------------------------------------------------

function processExpressionForProperties(
  expr: IRExpression,
  registry: VariableRegistry,
  optionalPropertyTriples: SparqlTriple[],
): void {
  switch (expr.kind) {
    case 'property_expr': {
      if (!registry.has(expr.sourceAlias, expr.property)) {
        // Create a new OPTIONAL triple for this property
        const varName = registry.getOrCreate(expr.sourceAlias, expr.property);
        optionalPropertyTriples.push(
          tripleOf(
            varTerm(expr.sourceAlias),
            iriTerm(expr.property),
            varTerm(varName),
          ),
        );
      }
      break;
    }
    case 'binary_expr':
      processExpressionForProperties(expr.left, registry, optionalPropertyTriples);
      processExpressionForProperties(expr.right, registry, optionalPropertyTriples);
      break;
    case 'logical_expr':
      for (const sub of expr.expressions) {
        processExpressionForProperties(sub, registry, optionalPropertyTriples);
      }
      break;
    case 'not_expr':
      processExpressionForProperties(expr.expression, registry, optionalPropertyTriples);
      break;
    case 'function_expr':
      for (const arg of expr.args) {
        processExpressionForProperties(arg, registry, optionalPropertyTriples);
      }
      break;
    case 'aggregate_expr':
      for (const arg of expr.args) {
        processExpressionForProperties(arg, registry, optionalPropertyTriples);
      }
      break;
    case 'exists_expr':
      // exists_expr in IR has pattern + filter
      // Process the filter for property references
      if (expr.filter) {
        processExpressionForProperties(expr.filter, registry, optionalPropertyTriples);
      }
      break;
    case 'context_property_expr': {
      // Context entity property — emit a triple with fixed IRI as subject.
      // Use raw IRI as registry key to avoid collision between IRIs that
      // sanitize to the same string (e.g. ctx-1 vs ctx_1).
      const ctxKey = `__ctx__${expr.contextIri}`;
      if (!registry.has(ctxKey, expr.property)) {
        const varName = registry.getOrCreate(ctxKey, expr.property);
        optionalPropertyTriples.push(
          tripleOf(
            iriTerm(expr.contextIri),
            iriTerm(expr.property),
            varTerm(varName),
          ),
        );
      }
      break;
    }
    case 'literal_expr':
    case 'reference_expr':
    case 'alias_expr':
      // No property references to discover
      break;
  }
}

// ---------------------------------------------------------------------------
// Expression conversion
// ---------------------------------------------------------------------------

function convertExpression(
  expr: IRExpression,
  registry: VariableRegistry,
  optionalPropertyTriples: SparqlTriple[],
): SparqlExpression {
  switch (expr.kind) {
    case 'literal_expr': {
      const value = expr.value;
      if (value === null || value === undefined) {
        return {kind: 'literal_expr', value: ''};
      }
      if (typeof value === 'boolean') {
        return {
          kind: 'literal_expr',
          value: String(value),
          datatype: XSD_BOOLEAN,
        };
      }
      if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          return {
            kind: 'literal_expr',
            value: String(value),
            datatype: XSD_INTEGER,
          };
        }
        return {
          kind: 'literal_expr',
          value: String(value),
          datatype: XSD_DOUBLE,
        };
      }
      return {kind: 'literal_expr', value: String(value)};
    }

    case 'reference_expr':
      return {kind: 'iri_expr', value: expr.value};

    case 'alias_expr':
      return {kind: 'variable_expr', name: expr.alias};

    case 'context_property_expr': {
      const ctxKey = `__ctx__${expr.contextIri}`;
      const ctxVarName = registry.getOrCreate(ctxKey, expr.property);
      return {kind: 'variable_expr', name: ctxVarName};
    }

    case 'property_expr': {
      const varName = registry.getOrCreate(expr.sourceAlias, expr.property);
      return {kind: 'variable_expr', name: varName};
    }

    case 'binary_expr':
      return {
        kind: 'binary_expr',
        op: expr.operator,
        left: convertExpression(expr.left, registry, optionalPropertyTriples),
        right: convertExpression(expr.right, registry, optionalPropertyTriples),
      };

    case 'logical_expr':
      return {
        kind: 'logical_expr',
        op: expr.operator,
        exprs: expr.expressions.map((e) =>
          convertExpression(e, registry, optionalPropertyTriples),
        ),
      };

    case 'not_expr':
      return {
        kind: 'not_expr',
        inner: convertExpression(expr.expression, registry, optionalPropertyTriples),
      };

    case 'function_expr':
      return {
        kind: 'function_expr',
        name: expr.name,
        args: expr.args.map((a) =>
          convertExpression(a, registry, optionalPropertyTriples),
        ),
      };

    case 'aggregate_expr':
      return {
        kind: 'aggregate_expr',
        name: expr.name,
        args: expr.args.map((a) =>
          convertExpression(a, registry, optionalPropertyTriples),
        ),
      };

    case 'exists_expr': {
      // Convert exists expression with inner pattern + filter
      const innerAlgebra = convertExistsPattern(
        expr.pattern,
        registry,
      );

      if (expr.filter) {
        const filterExpr = convertExpression(
          expr.filter,
          registry,
          optionalPropertyTriples,
        );
        // Wrap the inner pattern with a filter
        const filteredInner: SparqlFilter = {
          type: 'filter',
          expression: filterExpr,
          inner: innerAlgebra,
        };
        return {
          kind: 'exists_expr',
          pattern: filteredInner,
          negated: false,
        };
      }

      return {
        kind: 'exists_expr',
        pattern: innerAlgebra,
        negated: false,
      };
    }

    default:
      throw new Error(`Unknown IR expression kind: ${(expr as any).kind}`);
  }
}

/**
 * Convert an exists pattern (from exists_expr) into an algebra node.
 * Recursively handles all IR graph pattern kinds.
 */
function convertExistsPattern(
  pattern: IRGraphPattern,
  registry: VariableRegistry,
): SparqlAlgebraNode {
  switch (pattern.kind) {
    case 'traverse': {
      const triple = tripleOf(
        varTerm(pattern.from),
        iriTerm(pattern.property),
        varTerm(pattern.to),
      );
      return {type: 'bgp', triples: [triple]};
    }

    case 'join': {
      let result: SparqlAlgebraNode | null = null;
      for (const sub of pattern.patterns) {
        const subNode = convertExistsPattern(sub, registry);
        result = result ? joinNodes(result, subNode) : subNode;
      }
      return result || {type: 'bgp', triples: []};
    }

    case 'shape_scan': {
      return {
        type: 'bgp',
        triples: [
          tripleOf(
            varTerm(pattern.alias),
            iriTerm(RDF_TYPE),
            iriTerm(pattern.shape),
          ),
        ],
      };
    }

    case 'optional': {
      const inner = convertExistsPattern(pattern.pattern, registry);
      return wrapOptional({type: 'bgp', triples: []}, inner);
    }

    case 'union': {
      let result: SparqlAlgebraNode | null = null;
      for (const branch of pattern.branches) {
        const branchNode = convertExistsPattern(branch, registry);
        if (!result) {
          result = branchNode;
        } else {
          result = {type: 'union', left: result, right: branchNode};
        }
      }
      return result || {type: 'bgp', triples: []};
    }

    case 'exists': {
      return convertExistsPattern(pattern.pattern, registry);
    }

    default:
      throw new Error(`Unsupported pattern kind in EXISTS: ${(pattern as any).kind}`);
  }
}

/**
 * Resolve what variable name an IR expression ultimately refers to.
 */
function resolveExpressionVariable(
  expr: IRExpression,
  registry: VariableRegistry,
): string | null {
  switch (expr.kind) {
    case 'alias_expr':
      return expr.alias;
    case 'property_expr':
      return registry.getOrCreate(expr.sourceAlias, expr.property);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Mutation conversions
// ---------------------------------------------------------------------------

/**
 * Convert a field value to one or more SparqlTerm objects for triple objects.
 */
function fieldValueToTerms(
  value: IRFieldValue,
  options?: SparqlOptions,
): SparqlTerm[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === 'string') {
    return [literalTerm(value)];
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return [literalTerm(String(value), XSD_INTEGER)];
    }
    return [literalTerm(String(value), XSD_DOUBLE)];
  }

  if (typeof value === 'boolean') {
    return [literalTerm(String(value), XSD_BOOLEAN)];
  }

  if (value instanceof Date) {
    return [literalTerm(value.toISOString(), XSD_DATETIME)];
  }

  // NodeReferenceValue
  if (typeof value === 'object' && 'id' in value && !('shape' in value) && !('fields' in value)) {
    return [iriTerm((value as NodeReferenceValue).id)];
  }

  // IRNodeData — should not produce a term directly (handled by nested create)
  if (typeof value === 'object' && 'shape' in value && 'fields' in value) {
    return []; // Handled separately
  }

  // Array
  if (Array.isArray(value)) {
    const terms: SparqlTerm[] = [];
    for (const item of value) {
      terms.push(...fieldValueToTerms(item, options));
    }
    return terms;
  }

  return [];
}

/**
 * Recursively generate triples for an IRNodeData (used in create and nested creates).
 * Returns the URI used for this node and all generated triples.
 */
function generateNodeDataTriples(
  data: IRNodeData,
  options?: SparqlOptions,
): {uri: string; triples: SparqlTriple[]} {
  const uri = data.id || generateEntityUri(data.shape, options);
  const triples: SparqlTriple[] = [];
  const subjectTerm = iriTerm(uri);

  // Type triple
  triples.push(tripleOf(subjectTerm, iriTerm(RDF_TYPE), iriTerm(data.shape)));

  // Field triples
  for (const field of data.fields) {
    const propertyTerm = iriTerm(field.property);

    if (field.value === null || field.value === undefined) {
      continue;
    }

    // Handle arrays (including mixed arrays of references and nested creates)
    if (Array.isArray(field.value)) {
      for (const item of field.value) {
        if (item && typeof item === 'object' && 'shape' in item && 'fields' in item) {
          // Nested create
          const nested = generateNodeDataTriples(item as IRNodeData, options);
          triples.push(tripleOf(subjectTerm, propertyTerm, iriTerm(nested.uri)));
          triples.push(...nested.triples);
        } else {
          const terms = fieldValueToTerms(item, options);
          for (const term of terms) {
            triples.push(tripleOf(subjectTerm, propertyTerm, term));
          }
        }
      }
      continue;
    }

    // Handle nested IRNodeData
    if (typeof field.value === 'object' && 'shape' in field.value && 'fields' in field.value) {
      const nested = generateNodeDataTriples(field.value as IRNodeData, options);
      triples.push(tripleOf(subjectTerm, propertyTerm, iriTerm(nested.uri)));
      triples.push(...nested.triples);
      continue;
    }

    // Simple values
    const terms = fieldValueToTerms(field.value, options);
    for (const term of terms) {
      triples.push(tripleOf(subjectTerm, propertyTerm, term));
    }
  }

  return {uri, triples};
}

/**
 * Converts an IRCreateMutation to a SparqlInsertDataPlan.
 */
export function createToAlgebra(
  query: IRCreateMutation,
  options?: SparqlOptions,
): SparqlInsertDataPlan {
  const {triples} = generateNodeDataTriples(query.data, options);
  return {
    type: 'insert_data',
    triples,
  };
}

/**
 * Converts an IRUpdateMutation to a SparqlDeleteInsertPlan.
 */
export function updateToAlgebra(
  query: IRUpdateMutation,
  options?: SparqlOptions,
): SparqlDeleteInsertPlan {
  const subjectTerm = iriTerm(query.id);
  const deletePatterns: SparqlTriple[] = [];
  const insertPatterns: SparqlTriple[] = [];
  const whereTriples: SparqlTriple[] = [];

  for (const field of query.data.fields) {
    const propertyTerm = iriTerm(field.property);
    const suffix = propertySuffix(field.property);

    // Check for set modification ({add, remove})
    if (
      field.value &&
      typeof field.value === 'object' &&
      !Array.isArray(field.value) &&
      !(field.value instanceof Date) &&
      !('id' in field.value) &&
      !('shape' in field.value) &&
      ('add' in field.value || 'remove' in field.value)
    ) {
      const setMod = field.value as IRSetModificationValue;

      // Remove specific values
      if (setMod.remove) {
        for (const removeItem of setMod.remove) {
          const removeTerm = iriTerm((removeItem as NodeReferenceValue).id);
          deletePatterns.push(tripleOf(subjectTerm, propertyTerm, removeTerm));
          whereTriples.push(tripleOf(subjectTerm, propertyTerm, removeTerm));
        }
      }

      // Add new values
      if (setMod.add) {
        for (const addItem of setMod.add) {
          if (addItem && typeof addItem === 'object' && 'shape' in addItem && 'fields' in addItem) {
            // Nested create in add
            const nested = generateNodeDataTriples(addItem as IRNodeData, options);
            insertPatterns.push(tripleOf(subjectTerm, propertyTerm, iriTerm(nested.uri)));
            insertPatterns.push(...nested.triples);
          } else {
            const terms = fieldValueToTerms(addItem, options);
            for (const term of terms) {
              insertPatterns.push(tripleOf(subjectTerm, propertyTerm, term));
            }
          }
        }
      }

      continue;
    }

    // Unset (undefined/null) — delete only
    if (field.value === undefined || field.value === null) {
      const oldVar = varTerm(`old_${suffix}`);
      deletePatterns.push(tripleOf(subjectTerm, propertyTerm, oldVar));
      whereTriples.push(tripleOf(subjectTerm, propertyTerm, oldVar));
      continue;
    }

    // Array overwrite — delete old values + insert new ones
    if (Array.isArray(field.value)) {
      const oldVar = varTerm(`old_${suffix}`);
      deletePatterns.push(tripleOf(subjectTerm, propertyTerm, oldVar));
      whereTriples.push(tripleOf(subjectTerm, propertyTerm, oldVar));

      for (const item of field.value) {
        if (item && typeof item === 'object' && 'shape' in item && 'fields' in item) {
          const nested = generateNodeDataTriples(item as IRNodeData, options);
          insertPatterns.push(tripleOf(subjectTerm, propertyTerm, iriTerm(nested.uri)));
          insertPatterns.push(...nested.triples);
        } else {
          const terms = fieldValueToTerms(item, options);
          for (const term of terms) {
            insertPatterns.push(tripleOf(subjectTerm, propertyTerm, term));
          }
        }
      }
      continue;
    }

    // Nested create (single object field)
    if (typeof field.value === 'object' && 'shape' in field.value && 'fields' in field.value) {
      const oldVar = varTerm(`old_${suffix}`);
      deletePatterns.push(tripleOf(subjectTerm, propertyTerm, oldVar));
      whereTriples.push(tripleOf(subjectTerm, propertyTerm, oldVar));

      const nested = generateNodeDataTriples(field.value as IRNodeData, options);
      insertPatterns.push(tripleOf(subjectTerm, propertyTerm, iriTerm(nested.uri)));
      insertPatterns.push(...nested.triples);
      continue;
    }

    // Simple value update — delete old + insert new
    const oldVar = varTerm(`old_${suffix}`);
    deletePatterns.push(tripleOf(subjectTerm, propertyTerm, oldVar));
    whereTriples.push(tripleOf(subjectTerm, propertyTerm, oldVar));

    const terms = fieldValueToTerms(field.value, options);
    for (const term of terms) {
      insertPatterns.push(tripleOf(subjectTerm, propertyTerm, term));
    }
  }

  // Wrap WHERE triples in OPTIONAL so UPDATE succeeds even when the old
  // value doesn't exist (e.g. setting bestFriend when none was set before).
  let whereAlgebra: SparqlAlgebraNode;
  if (whereTriples.length === 0) {
    whereAlgebra = {type: 'bgp', triples: []};
  } else if (whereTriples.length === 1) {
    whereAlgebra = {
      type: 'left_join',
      left: {type: 'bgp', triples: []},
      right: {type: 'bgp', triples: whereTriples},
    };
  } else {
    // Wrap each triple in its own OPTIONAL for independent matching
    whereAlgebra = {type: 'bgp', triples: []};
    for (const triple of whereTriples) {
      whereAlgebra = {
        type: 'left_join',
        left: whereAlgebra,
        right: {type: 'bgp', triples: [triple]},
      };
    }
  }

  return {
    type: 'delete_insert',
    deletePatterns,
    insertPatterns,
    whereAlgebra,
  };
}

/**
 * Converts an IRDeleteMutation to a SparqlDeleteInsertPlan (DELETE + WHERE).
 */
export function deleteToAlgebra(
  query: IRDeleteMutation,
  _options?: SparqlOptions,
): SparqlDeleteInsertPlan {
  const deletePatterns: SparqlTriple[] = [];
  const requiredTriples: SparqlTriple[] = [];
  const optionalTriples: SparqlTriple[] = [];

  for (let i = 0; i < query.ids.length; i++) {
    const subjectTerm = iriTerm(query.ids[i].id);
    const idx = query.ids.length > 1 ? `_${i}` : '';

    const subjWild = tripleOf(subjectTerm, varTerm(`p${idx}`), varTerm(`o${idx}`));
    const objWild = tripleOf(varTerm(`s${idx}`), varTerm(`p2${idx}`), subjectTerm);
    const typeGuard = tripleOf(subjectTerm, iriTerm(RDF_TYPE), iriTerm(query.shape));

    // DELETE block: all patterns (subject-wildcard, object-wildcard, type)
    deletePatterns.push(subjWild, objWild, typeGuard);

    // WHERE block: subject-wildcard and type guard are required;
    // object-wildcard is OPTIONAL (entity may have no incoming references)
    requiredTriples.push(subjWild, typeGuard);
    optionalTriples.push(objWild);
  }

  // Build WHERE algebra: required BGP + OPTIONAL for each object-wildcard
  let whereAlgebra: SparqlAlgebraNode = {type: 'bgp', triples: requiredTriples};
  for (const triple of optionalTriples) {
    whereAlgebra = {
      type: 'left_join',
      left: whereAlgebra,
      right: {type: 'bgp', triples: [triple]},
    };
  }

  return {
    type: 'delete_insert',
    deletePatterns,
    insertPatterns: [],
    whereAlgebra,
  };
}

// ---------------------------------------------------------------------------
// Convenience wrappers: IR → algebra → SPARQL string in one call
// ---------------------------------------------------------------------------

/**
 * Converts an IRSelectQuery to a SPARQL string.
 * Stub: will be implemented when algebraToString is available.
 */
export function selectToSparql(
  query: IRSelectQuery,
  options?: SparqlOptions,
): string {
  const plan = selectToAlgebra(query, options);
  return selectPlanToSparql(plan, options);
}

/**
 * Converts an IRCreateMutation to a SPARQL string.
 * Stub: will be implemented when algebraToString is available.
 */
export function createToSparql(
  query: IRCreateMutation,
  options?: SparqlOptions,
): string {
  const plan = createToAlgebra(query, options);
  return insertDataPlanToSparql(plan, options);
}

/**
 * Converts an IRUpdateMutation to a SPARQL string.
 * Stub: will be implemented when algebraToString is available.
 */
export function updateToSparql(
  query: IRUpdateMutation,
  options?: SparqlOptions,
): string {
  const plan = updateToAlgebra(query, options);
  return deleteInsertPlanToSparql(plan, options);
}

/**
 * Converts an IRDeleteMutation to a SPARQL string.
 * Stub: will be implemented when algebraToString is available.
 */
export function deleteToSparql(
  query: IRDeleteMutation,
  options?: SparqlOptions,
): string {
  const plan = deleteToAlgebra(query, options);
  return deleteInsertPlanToSparql(plan, options);
}
