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
  SparqlDeleteWherePlan,
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
// Variable Registry
// ---------------------------------------------------------------------------

/**
 * Maps (alias, property) → SPARQL variable name.
 * Used to deduplicate variables across traverse and property_expr nodes.
 */
class VariableRegistry {
  private map = new Map<string, string>();

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
  }

  getOrCreate(alias: string, property: string): string {
    const existing = this.get(alias, property);
    if (existing) return existing;
    const varName = `${alias}_${propertySuffix(property)}`;
    this.set(alias, property, varName);
    return varName;
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
    processPattern(pattern, registry, traverseTriples, optionalPropertyTriples);
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

  // Wrap each optional property triple in its own OPTIONAL (LeftJoin)
  for (const propTriple of optionalPropertyTriples) {
    algebra = wrapOptional(algebra, {
      type: 'bgp',
      triples: [propTriple],
    });
  }

  // 5. Where clause → Filter wrapping
  if (query.where) {
    const filterExpr = convertExpression(query.where, registry, optionalPropertyTriples);
    algebra = {
      type: 'filter',
      expression: filterExpr,
      inner: algebra,
    };
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

  for (const item of query.projection) {
    const sparqlExpr = convertExpression(item.expression, registry, optionalPropertyTriples);

    if (sparqlExpr.kind === 'aggregate_expr') {
      hasAggregates = true;
      projection.push({
        kind: 'aggregate',
        expression: sparqlExpr,
        alias: item.alias,
      });
      aggregates.push({
        variable: item.alias,
        aggregate: sparqlExpr,
      });
    } else {
      // For property_expr, the variable is the resolved name from registry
      const varName = resolveExpressionVariable(item.expression, registry);
      if (varName && varName !== rootAlias) {
        projection.push({kind: 'variable', name: varName});
      } else if (!varName) {
        // alias_expr or other — use alias directly
        projection.push({kind: 'variable', name: item.alias});
      }
    }
  }

  // 8. GROUP BY inference
  let groupBy: string[] | undefined;
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
): void {
  switch (pattern.kind) {
    case 'shape_scan':
      // Additional shape scans (non-root) are handled as type triples
      // but this case is rare — root is handled separately
      break;

    case 'traverse': {
      // Register the traverse variable: (from, property) → to
      registry.set(pattern.from, pattern.property, pattern.to);
      // Add traverse triple to required pattern
      const triple = tripleOf(
        varTerm(pattern.from),
        iriTerm(pattern.property),
        varTerm(pattern.to),
      );
      traverseTriples.push(triple);
      break;
    }

    case 'join': {
      for (const sub of pattern.patterns) {
        processPattern(sub, registry, traverseTriples, optionalPropertyTriples);
      }
      break;
    }

    case 'optional': {
      // Optional patterns — process inner patterns but keep them optional
      processPattern(pattern.pattern, registry, traverseTriples, optionalPropertyTriples);
      break;
    }

    case 'union': {
      for (const branch of pattern.branches) {
        processPattern(branch, registry, traverseTriples, optionalPropertyTriples);
      }
      break;
    }

    case 'exists': {
      processPattern(pattern.pattern, registry, traverseTriples, optionalPropertyTriples);
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
    case 'literal_expr':
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

    case 'alias_expr':
      return {kind: 'variable_expr', name: expr.alias};

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
      const triples: SparqlTriple[] = [];
      for (const sub of pattern.patterns) {
        if (sub.kind === 'traverse') {
          triples.push(
            tripleOf(
              varTerm(sub.from),
              iriTerm(sub.property),
              varTerm(sub.to),
            ),
          );
        }
      }
      return {type: 'bgp', triples};
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

    default:
      return {type: 'bgp', triples: []};
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
  let varCounter = 0;

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

  return {
    type: 'delete_insert',
    deletePatterns,
    insertPatterns,
    whereAlgebra: {type: 'bgp', triples: whereTriples},
  };
}

/**
 * Converts an IRDeleteMutation to a SparqlDeleteWherePlan.
 */
export function deleteToAlgebra(
  query: IRDeleteMutation,
  _options?: SparqlOptions,
): SparqlDeleteWherePlan {
  const triples: SparqlTriple[] = [];

  for (const idRef of query.ids) {
    const subjectTerm = iriTerm(idRef.id);

    // Subject wildcard: <id> ?p ?o
    triples.push(
      tripleOf(subjectTerm, varTerm('p'), varTerm('o')),
    );

    // Object wildcard: ?s ?p2 <id>
    triples.push(
      tripleOf(varTerm('s'), varTerm('p2'), subjectTerm),
    );

    // Type guard: <id> rdf:type <shape>
    triples.push(
      tripleOf(subjectTerm, iriTerm(RDF_TYPE), iriTerm(query.shape)),
    );
  }

  return {
    type: 'delete_where',
    patterns: {type: 'bgp', triples},
  };
}

// ---------------------------------------------------------------------------
// Convenience wrappers (stubs — wired in Phase 3 when algebraToString exists)
// ---------------------------------------------------------------------------

/**
 * Converts an IRSelectQuery to a SPARQL string.
 * Stub: will be implemented when algebraToString is available.
 */
export function selectToSparql(
  query: IRSelectQuery,
  options?: SparqlOptions,
): string {
  const _plan = selectToAlgebra(query, options);
  // Phase 3: return selectPlanToSparql(plan, options);
  throw new Error('selectToSparql not yet implemented — depends on algebraToString (Phase 3)');
}

/**
 * Converts an IRCreateMutation to a SPARQL string.
 * Stub: will be implemented when algebraToString is available.
 */
export function createToSparql(
  query: IRCreateMutation,
  options?: SparqlOptions,
): string {
  const _plan = createToAlgebra(query, options);
  // Phase 3: return insertDataPlanToSparql(plan, options);
  throw new Error('createToSparql not yet implemented — depends on algebraToString (Phase 3)');
}

/**
 * Converts an IRUpdateMutation to a SPARQL string.
 * Stub: will be implemented when algebraToString is available.
 */
export function updateToSparql(
  query: IRUpdateMutation,
  options?: SparqlOptions,
): string {
  const _plan = updateToAlgebra(query, options);
  // Phase 3: return deleteInsertPlanToSparql(plan, options);
  throw new Error('updateToSparql not yet implemented — depends on algebraToString (Phase 3)');
}

/**
 * Converts an IRDeleteMutation to a SPARQL string.
 * Stub: will be implemented when algebraToString is available.
 */
export function deleteToSparql(
  query: IRDeleteMutation,
  options?: SparqlOptions,
): string {
  const _plan = deleteToAlgebra(query, options);
  // Phase 3: return deleteWherePlanToSparql(plan, options);
  throw new Error('deleteToSparql not yet implemented — depends on algebraToString (Phase 3)');
}
