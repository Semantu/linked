// --- Term types ---

export type SparqlTerm =
  | {kind: 'variable'; name: string}
  | {kind: 'iri'; value: string}
  | {kind: 'literal'; value: string; datatype?: string; language?: string}
  | {kind: 'path'; value: string; uris: string[]};

export type SparqlTriple = {
  subject: SparqlTerm;
  predicate: SparqlTerm;
  object: SparqlTerm;
};

// --- Algebra node types ---

export type SparqlAlgebraNode =
  | SparqlBGP
  | SparqlJoin
  | SparqlLeftJoin
  | SparqlFilter
  | SparqlUnion
  | SparqlMinus
  | SparqlExtend
  | SparqlGraph
  | SparqlValues;

export type SparqlBGP = {
  type: 'bgp';
  triples: SparqlTriple[];
};

export type SparqlJoin = {
  type: 'join';
  left: SparqlAlgebraNode;
  right: SparqlAlgebraNode;
};

export type SparqlLeftJoin = {
  type: 'left_join';
  left: SparqlAlgebraNode;
  right: SparqlAlgebraNode;
  condition?: SparqlExpression;
};

export type SparqlFilter = {
  type: 'filter';
  expression: SparqlExpression;
  inner: SparqlAlgebraNode;
};

export type SparqlUnion = {
  type: 'union';
  left: SparqlAlgebraNode;
  right: SparqlAlgebraNode;
};

export type SparqlMinus = {
  type: 'minus';
  left: SparqlAlgebraNode;
  right: SparqlAlgebraNode;
};

export type SparqlExtend = {
  type: 'extend';
  inner: SparqlAlgebraNode;
  variable: string;
  expression: SparqlExpression;
};

export type SparqlGraph = {
  type: 'graph';
  iri: string;
  inner: SparqlAlgebraNode;
};

export type SparqlValues = {
  type: 'values';
  variable: string;
  iris: string[];
};

// --- Expressions ---

export type SparqlExpression =
  | SparqlVariableExpr
  | SparqlIriExpr
  | SparqlLiteralExpr
  | SparqlBinaryExpr
  | SparqlLogicalExpr
  | SparqlNotExpr
  | SparqlFunctionExpr
  | SparqlAggregateExpr
  | SparqlExistsExpr
  | SparqlBoundExpr;

export type SparqlVariableExpr = {
  kind: 'variable_expr';
  name: string;
};

export type SparqlIriExpr = {
  kind: 'iri_expr';
  value: string;
};

export type SparqlLiteralExpr = {
  kind: 'literal_expr';
  value: string;
  datatype?: string;
};

export type SparqlBinaryExpr = {
  kind: 'binary_expr';
  op: string;
  left: SparqlExpression;
  right: SparqlExpression;
};

export type SparqlLogicalExpr = {
  kind: 'logical_expr';
  op: 'and' | 'or';
  exprs: SparqlExpression[];
};

export type SparqlNotExpr = {
  kind: 'not_expr';
  inner: SparqlExpression;
};

export type SparqlFunctionExpr = {
  kind: 'function_expr';
  name: string;
  args: SparqlExpression[];
};

export type SparqlAggregateExpr = {
  kind: 'aggregate_expr';
  name: string;
  args: SparqlExpression[];
  distinct?: boolean;
};

export type SparqlExistsExpr = {
  kind: 'exists_expr';
  pattern: SparqlAlgebraNode;
  negated: boolean;
};

export type SparqlBoundExpr = {
  kind: 'bound_expr';
  variable: string;
};

// --- Projection and ordering ---

export type SparqlProjectionItem =
  | {kind: 'variable'; name: string}
  | {kind: 'aggregate'; expression: SparqlAggregateExpr; alias: string}
  | {kind: 'expression'; expression: SparqlExpression; alias: string};

export type SparqlOrderCondition = {
  expression: SparqlExpression;
  direction: 'ASC' | 'DESC';
};

export type SparqlAggregateBinding = {
  variable: string;
  aggregate: SparqlAggregateExpr;
};

// --- Top-level query plans ---

export type SparqlSelectPlan = {
  type: 'select';
  algebra: SparqlAlgebraNode;
  projection: SparqlProjectionItem[];
  distinct?: boolean;
  orderBy?: SparqlOrderCondition[];
  limit?: number;
  offset?: number;
  groupBy?: string[];
  having?: SparqlExpression;
  aggregates?: SparqlAggregateBinding[];
};

export type SparqlInsertDataPlan = {
  type: 'insert_data';
  triples: SparqlTriple[];
  graph?: string;
};

export type SparqlDeleteInsertPlan = {
  type: 'delete_insert';
  deletePatterns: SparqlTriple[];
  insertPatterns: SparqlTriple[];
  whereAlgebra: SparqlAlgebraNode;
  graph?: string;
};

export type SparqlDeleteWherePlan = {
  type: 'delete_where';
  patterns: SparqlAlgebraNode;
  graph?: string;
};

export type SparqlPlan =
  | SparqlSelectPlan
  | SparqlInsertDataPlan
  | SparqlDeleteInsertPlan
  | SparqlDeleteWherePlan;
