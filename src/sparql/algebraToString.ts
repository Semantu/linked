import {
  SparqlAlgebraNode,
  SparqlExpression,
  SparqlTerm,
  SparqlTriple,
  SparqlSelectPlan,
  SparqlInsertDataPlan,
  SparqlDeleteInsertPlan,
  SparqlDeleteWherePlan,
} from './SparqlAlgebra.js';
import {
  SparqlOptions,
  formatUri,
  formatLiteral,
  collectPrefixes,
} from './sparqlUtils.js';

// ---------------------------------------------------------------------------
// URI collector — gathers all IRIs encountered during serialization so that
// the prefix block can be built afterwards.
// ---------------------------------------------------------------------------

type UriCollector = {uris: Set<string>};

function collectUri(collector: UriCollector, uri: string): void {
  collector.uris.add(uri);
}

// ---------------------------------------------------------------------------
// Term serialization
// ---------------------------------------------------------------------------

export function serializeTerm(
  term: SparqlTerm,
  collector?: UriCollector,
): string {
  switch (term.kind) {
    case 'variable':
      return `?${term.name}`;
    case 'iri':
      if (collector) collectUri(collector, term.value);
      return formatUri(term.value);
    case 'literal': {
      if (term.language) {
        return `"${term.value}"@${term.language}`;
      }
      if (term.datatype) {
        if (collector) collectUri(collector, term.datatype);
      }
      return formatLiteral(term.value, term.datatype);
    }
  }
}

// ---------------------------------------------------------------------------
// Triple serialization
// ---------------------------------------------------------------------------

function serializeTriple(
  triple: SparqlTriple,
  collector?: UriCollector,
): string {
  const s = serializeTerm(triple.subject, collector);
  const p = serializeTerm(triple.predicate, collector);
  const o = serializeTerm(triple.object, collector);
  return `${s} ${p} ${o}`;
}

function serializeTriples(
  triples: SparqlTriple[],
  collector?: UriCollector,
): string {
  return triples
    .map((t) => serializeTriple(t, collector) + ' .')
    .join('\n');
}

// ---------------------------------------------------------------------------
// Expression serialization
// ---------------------------------------------------------------------------

export function serializeExpression(
  expr: SparqlExpression,
  collector?: UriCollector,
): string {
  switch (expr.kind) {
    case 'variable_expr':
      return `?${expr.name}`;

    case 'iri_expr':
      if (collector) collectUri(collector, expr.value);
      return formatUri(expr.value);

    case 'literal_expr': {
      if (expr.datatype && collector) collectUri(collector, expr.datatype);
      return formatLiteral(expr.value, expr.datatype);
    }

    case 'binary_expr': {
      const left = serializeExpression(expr.left, collector);
      const right = serializeExpression(expr.right, collector);
      return `${left} ${expr.op} ${right}`;
    }

    case 'logical_expr': {
      const op = expr.op === 'and' ? '&&' : '||';
      const parts = expr.exprs.map((e) => serializeExpression(e, collector));
      return parts.join(` ${op} `);
    }

    case 'not_expr':
      return `!${serializeExpression(expr.inner, collector)}`;

    case 'function_expr': {
      const args = expr.args
        .map((a) => serializeExpression(a, collector))
        .join(', ');
      return `${expr.name}(${args})`;
    }

    case 'aggregate_expr': {
      const args = expr.args
        .map((a) => serializeExpression(a, collector))
        .join(', ');
      const distinctPrefix = expr.distinct ? 'DISTINCT ' : '';
      return `${expr.name}(${distinctPrefix}${args})`;
    }

    case 'exists_expr': {
      const inner = serializeAlgebraNode(expr.pattern, collector);
      const prefix = expr.negated ? 'NOT EXISTS' : 'EXISTS';
      return `${prefix} {\n${indent(inner)}\n}`;
    }

    case 'bound_expr':
      return `BOUND(?${expr.variable})`;
  }
}

// ---------------------------------------------------------------------------
// Algebra node serialization
// ---------------------------------------------------------------------------

export function serializeAlgebraNode(
  node: SparqlAlgebraNode,
  collector?: UriCollector,
): string {
  switch (node.type) {
    case 'bgp':
      return serializeTriples(node.triples, collector);

    case 'join': {
      const left = serializeAlgebraNode(node.left, collector);
      const right = serializeAlgebraNode(node.right, collector);
      return `${left}\n${right}`;
    }

    case 'left_join': {
      const left = serializeAlgebraNode(node.left, collector);
      const right = serializeAlgebraNode(node.right, collector);
      let optionalBlock = `OPTIONAL {\n${indent(right)}\n}`;
      if (node.condition) {
        const cond = serializeExpression(node.condition, collector);
        // OPTIONAL with filter: OPTIONAL { pattern FILTER(cond) }
        // Re-build to include filter inside the OPTIONAL block
        optionalBlock = `OPTIONAL {\n${indent(right)}\n  FILTER(${cond})\n}`;
      }
      return `${left}\n${optionalBlock}`;
    }

    case 'filter': {
      const inner = serializeAlgebraNode(node.inner, collector);
      const expr = serializeExpression(node.expression, collector);
      return `${inner}\nFILTER(${expr})`;
    }

    case 'union': {
      const left = serializeAlgebraNode(node.left, collector);
      const right = serializeAlgebraNode(node.right, collector);
      return `{\n${indent(left)}\n}\nUNION\n{\n${indent(right)}\n}`;
    }

    case 'minus': {
      const left = serializeAlgebraNode(node.left, collector);
      const right = serializeAlgebraNode(node.right, collector);
      return `${left}\nMINUS {\n${indent(right)}\n}`;
    }

    case 'extend': {
      const inner = serializeAlgebraNode(node.inner, collector);
      const expr = serializeExpression(node.expression, collector);
      return `${inner}\nBIND(${expr} AS ?${node.variable})`;
    }

    case 'graph': {
      if (collector) collectUri(collector, node.iri);
      const inner = serializeAlgebraNode(node.inner, collector);
      return `GRAPH ${formatUri(node.iri)} {\n${indent(inner)}\n}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function indent(text: string, level: number = 1): string {
  const prefix = '  '.repeat(level);
  return text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

function buildPrefixBlock(usedUris: Set<string>): string {
  const prefixes = collectPrefixes([...usedUris]);
  const lines = Object.entries(prefixes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, uri]) => `PREFIX ${prefix}: <${uri}>`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Top-level plan serializers
// ---------------------------------------------------------------------------

export function selectPlanToSparql(
  plan: SparqlSelectPlan,
  _options?: SparqlOptions,
): string {
  const collector: UriCollector = {uris: new Set()};

  // 1. Serialize WHERE body
  const body = serializeAlgebraNode(plan.algebra, collector);

  // 2. Build SELECT line
  const projectionParts = plan.projection.map((item) => {
    if (item.kind === 'variable') {
      return `?${item.name}`;
    } else {
      // aggregate projection: (AGG(...) AS ?alias)
      const aggExpr = serializeExpression(item.expression, collector);
      return `(${aggExpr} AS ?${item.alias})`;
    }
  });

  const distinctStr = plan.distinct ? 'DISTINCT ' : '';
  const selectLine = `SELECT ${distinctStr}${projectionParts.join(' ')}`;

  // 3. Build WHERE block
  const whereBlock = `WHERE {\n${indent(body)}\n}`;

  // 4. Build trailing clauses
  const clauses: string[] = [];

  if (plan.groupBy && plan.groupBy.length > 0) {
    clauses.push(
      `GROUP BY ${plan.groupBy.map((v) => `?${v}`).join(' ')}`,
    );
  }

  if (plan.having) {
    const havingExpr = serializeExpression(plan.having, collector);
    clauses.push(`HAVING(${havingExpr})`);
  }

  if (plan.orderBy && plan.orderBy.length > 0) {
    const orderParts = plan.orderBy.map((cond) => {
      const expr = serializeExpression(cond.expression, collector);
      return `${cond.direction}(${expr})`;
    });
    clauses.push(`ORDER BY ${orderParts.join(' ')}`);
  }

  if (plan.limit !== undefined) {
    clauses.push(`LIMIT ${plan.limit}`);
  }

  if (plan.offset !== undefined) {
    clauses.push(`OFFSET ${plan.offset}`);
  }

  // 5. Build PREFIX block (after collecting all URIs)
  const prefixBlock = buildPrefixBlock(collector.uris);

  // 6. Assemble
  const parts: string[] = [];
  if (prefixBlock) parts.push(prefixBlock);
  parts.push(selectLine);
  parts.push(whereBlock);
  parts.push(...clauses);

  return parts.join('\n');
}

export function insertDataPlanToSparql(
  plan: SparqlInsertDataPlan,
  _options?: SparqlOptions,
): string {
  const collector: UriCollector = {uris: new Set()};

  let triplesStr: string;
  if (plan.graph) {
    if (collector) collectUri(collector, plan.graph);
    const innerTriples = serializeTriples(plan.triples, collector);
    triplesStr = `GRAPH ${formatUri(plan.graph)} {\n${indent(innerTriples)}\n}`;
  } else {
    triplesStr = serializeTriples(plan.triples, collector);
  }

  const body = `INSERT DATA {\n${indent(triplesStr)}\n}`;

  const prefixBlock = buildPrefixBlock(collector.uris);
  const parts: string[] = [];
  if (prefixBlock) parts.push(prefixBlock);
  parts.push(body);
  return parts.join('\n');
}

export function deleteInsertPlanToSparql(
  plan: SparqlDeleteInsertPlan,
  _options?: SparqlOptions,
): string {
  const collector: UriCollector = {uris: new Set()};

  // DELETE block
  const deleteTriples = serializeTriples(plan.deletePatterns, collector);
  const deletePart = `DELETE {\n${indent(deleteTriples)}\n}`;

  // INSERT block (may be empty)
  let insertPart = '';
  if (plan.insertPatterns.length > 0) {
    const insertTriples = serializeTriples(plan.insertPatterns, collector);
    insertPart = `INSERT {\n${indent(insertTriples)}\n}\n`;
  }

  // WHERE block
  const whereBody = serializeAlgebraNode(plan.whereAlgebra, collector);
  const wherePart = `WHERE {\n${indent(whereBody)}\n}`;

  const prefixBlock = buildPrefixBlock(collector.uris);
  const parts: string[] = [];
  if (prefixBlock) parts.push(prefixBlock);
  parts.push(deletePart);
  if (insertPart) parts.push(insertPart.trimEnd());
  parts.push(wherePart);
  return parts.join('\n');
}

export function deleteWherePlanToSparql(
  plan: SparqlDeleteWherePlan,
  _options?: SparqlOptions,
): string {
  const collector: UriCollector = {uris: new Set()};

  const body = serializeAlgebraNode(plan.patterns, collector);

  let content: string;
  if (plan.graph) {
    if (collector) collectUri(collector, plan.graph);
    content = `GRAPH ${formatUri(plan.graph)} {\n${indent(body)}\n}`;
  } else {
    content = body;
  }

  const result = `DELETE WHERE {\n${indent(content)}\n}`;

  const prefixBlock = buildPrefixBlock(collector.uris);
  const parts: string[] = [];
  if (prefixBlock) parts.push(prefixBlock);
  parts.push(result);
  return parts.join('\n');
}
