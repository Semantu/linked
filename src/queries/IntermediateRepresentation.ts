import {NodeReferenceValue} from './QueryFactory.js';

export type IRDirection = 'ASC' | 'DESC';
export type IRAlias = string;

export type IRValue = string | number | boolean | null;

export type IRQuery =
  | IRSelectQuery
  | IRCreateMutation
  | IRUpdateMutation
  | IRDeleteMutation
  | IRDeleteAllMutation
  | IRDeleteWhereMutation
  | IRUpdateWhereMutation;

export type IRSelectQuery = {
  kind: 'select';
  root: IRShapeScanPattern;
  patterns: IRGraphPattern[];
  projection: IRProjectionItem[];
  where?: IRExpression;
  orderBy?: IROrderByItem[];
  limit?: number;
  offset?: number;
  subjectId?: string;
  subjectIds?: string[];
  singleResult?: boolean;
  resultMap?: IRResultMapEntry[];
};

export type IRProjectionItem = {
  alias: IRAlias;
  expression: IRExpression;
};

export type IROrderByItem = {
  expression: IRExpression;
  direction: IRDirection;
};

export type IRResultMapEntry = {
  key: string;
  alias: IRAlias;
};

export type IRGraphPattern =
  | IRShapeScanPattern
  | IRTraversePattern
  | IRJoinPattern
  | IROptionalPattern
  | IRUnionPattern
  | IRExistsPattern
  | IRMinusPattern;

export type IRShapeScanPattern = {
  kind: 'shape_scan';
  shape: string;
  alias: IRAlias;
};

export type IRTraversePattern = {
  kind: 'traverse';
  from: IRAlias;
  to: IRAlias;
  property: string;
  filter?: IRExpression;
};

export type IRJoinPattern = {
  kind: 'join';
  patterns: IRGraphPattern[];
};

export type IROptionalPattern = {
  kind: 'optional';
  pattern: IRGraphPattern;
};

export type IRUnionPattern = {
  kind: 'union';
  branches: IRGraphPattern[];
};

export type IRExistsPattern = {
  kind: 'exists';
  pattern: IRGraphPattern;
};

export type IRMinusPattern = {
  kind: 'minus';
  pattern: IRGraphPattern;
  filter?: IRExpression;
};

export type IRExpression =
  | IRLiteralExpression
  | IRReferenceExpression
  | IRAliasExpression
  | IRPropertyExpression
  | IRContextPropertyExpression
  | IRBinaryExpression
  | IRLogicalExpression
  | IRNotExpression
  | IRFunctionExpression
  | IRAggregateExpression
  | IRExistsExpression;

export type IRLiteralExpression = {
  kind: 'literal_expr';
  value: IRValue;
};

export type IRReferenceExpression = {
  kind: 'reference_expr';
  value: string;
};

export type IRAliasExpression = {
  kind: 'alias_expr';
  alias: IRAlias;
};

export type IRPropertyExpression = {
  kind: 'property_expr';
  sourceAlias: IRAlias;
  property: string;
};

export type IRContextPropertyExpression = {
  kind: 'context_property_expr';
  contextIri: string;
  property: string;
};

export type IRBinaryOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<=';

export type IRBinaryExpression = {
  kind: 'binary_expr';
  operator: IRBinaryOperator;
  left: IRExpression;
  right: IRExpression;
};

export type IRLogicalOperator = 'and' | 'or';

export type IRLogicalExpression = {
  kind: 'logical_expr';
  operator: IRLogicalOperator;
  expressions: IRExpression[];
};

export type IRNotExpression = {
  kind: 'not_expr';
  expression: IRExpression;
};

export type IRFunctionExpression = {
  kind: 'function_expr';
  name: string;
  args: IRExpression[];
};

export type IRAggregateExpression = {
  kind: 'aggregate_expr';
  name: 'count' | 'sum' | 'avg' | 'min' | 'max';
  args: IRExpression[];
};

export type IRExistsExpression = {
  kind: 'exists_expr';
  pattern: IRGraphPattern;
  filter?: IRExpression;
};

export type IRCreateMutation = {
  kind: 'create';
  shape: string;
  data: IRNodeData;
};

export type IRUpdateMutation = {
  kind: 'update';
  shape: string;
  id: string;
  data: IRNodeData;
};

export type IRDeleteMutation = {
  kind: 'delete';
  shape: string;
  ids: NodeReferenceValue[];
};

export type IRDeleteAllMutation = {
  kind: 'delete_all';
  shape: string;
};

export type IRDeleteWhereMutation = {
  kind: 'delete_where';
  shape: string;
  where: IRExpression;
  wherePatterns: IRGraphPattern[];
};

export type IRUpdateWhereMutation = {
  kind: 'update_where';
  shape: string;
  data: IRNodeData;
  where?: IRExpression;
  wherePatterns?: IRGraphPattern[];
};

export type IRNodeData = {
  shape: string;
  fields: IRFieldUpdate[];
  id?: string;
};

export type IRFieldUpdate = {
  property: string;
  value: IRFieldValue;
};

export type IRSetModificationValue = {
  add?: IRFieldValue[];
  remove?: NodeReferenceValue[];
};

export type IRFieldValue =
  | IRValue
  | Date
  | NodeReferenceValue
  | IRNodeData
  | IRSetModificationValue
  | IRFieldValue[]
  | undefined;

// ---------------------------------------------------------------------------
// Store result types
// ---------------------------------------------------------------------------
// These types describe what an IQuadStore implementation should return.
// The calling layer (LinkedStorage via queryDispatch) threads the precise
// DSL-level TypeScript result type back to the caller, so the store
// only needs to produce data that satisfies these structural contracts.
// ---------------------------------------------------------------------------

/**
 * A single result row — an object with a node id and dynamic fields.
 * Used in select and create results.
 */
export type ResultRow = {id: string; [key: string]: ResultFieldValue};

/**
 * Possible field values in a select or create result row.
 */
export type ResultFieldValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | ResultRow
  | ResultRow[];

/**
 * What `selectQuery` should return.
 *
 * - Array of rows for multi-result queries (the default).
 * - A single row when `query.singleResult` is true (`.one()` or subject-targeted query).
 * - `null` when `singleResult` is true and the target node doesn't exist.
 */
export type SelectResult = ResultRow[] | ResultRow | null;

/**
 * What `createQuery` should return.
 *
 * A single row with the generated `id` and the created field values.
 * Nested creates appear as nested `ResultRow` objects (with their own ids).
 * Array fields (e.g. friends) appear as `ResultRow[]`.
 */
export type CreateResult = ResultRow;

/**
 * When a set property is fully overwritten, the result contains `updatedTo`
 * with the new complete set of values.
 */
export type SetOverwriteResult = {updatedTo: ResultRow[]};

/**
 * When a set property is incrementally modified with `{add, remove}`,
 * the result contains the added and removed entries.
 */
export type SetModificationResult = {added: ResultRow[]; removed: ResultRow[]};

/**
 * Possible field values in an update result row.
 * Extends `ResultFieldValue` with set modification shapes.
 */
export type UpdateFieldValue =
  | ResultFieldValue
  | SetOverwriteResult
  | SetModificationResult;

/**
 * What `updateQuery` should return.
 *
 * A single row with the target node's `id` and only the changed fields.
 * Fields not included in the update are omitted (not returned).
 *
 * Field value shapes depend on the type of update:
 * - Literal fields: the new value (string, number, boolean, Date).
 * - Single object fields: a `ResultRow` with the referenced/created node.
 * - Set overwrite (passing an array): `{updatedTo: ResultRow[]}`.
 * - Set add/remove (passing `{add, remove}`): `{added: ResultRow[], removed: ResultRow[]}`.
 * - Unset single field (passing `undefined` or `null`): field is `undefined`.
 * - Unset multi-value field (passing `undefined`): empty array `[]`.
 */
export type UpdateResult = {id: string; [key: string]: UpdateFieldValue};
